#!/usr/bin/env python3
"""Root-only, serialized PostgreSQL/MinIO backups and isolated restore drills."""
import argparse
from contextlib import contextmanager
import json
import os
from pathlib import Path
import secrets
import shutil
import signal
import stat
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
from urllib.parse import unquote, urlsplit

WRITERS = {'api', 'account-deletion-worker', 'notification-worker', 'poll-feed-snapshot-cleanup'}
NON_WRITERS = {'postgres', 'redis', 'minio', 'https', 'web', 'moderation-web'}
TAG = 'yaskapp-staging'
LABEL = 'io.yaskapp.backup-drill'
GIB = 1024 ** 3
maintenance_deadline = None


class BackupError(Exception):
    pass


def command(args, *, env=None, stdin=None, stdout=None, timeout=900):
    if maintenance_deadline is not None:
        timeout = min(timeout, maintenance_deadline - time.monotonic())
        if timeout <= 0:
            raise BackupError('Five-minute maintenance limit reached')
    try:
        result = subprocess.run([str(a) for a in args], env=env, stdin=stdin,
                                stdout=stdout or subprocess.PIPE, stderr=subprocess.PIPE,
                                timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise BackupError('Command timed out: ' + str(args[0])) from None
    if result.returncode:
        # Never include subprocess output: it can contain SDK credentials or user data.
        raise BackupError('Command failed (%s): %s' % (result.returncode, ' '.join(map(str, args[:2]))))
    return '' if stdout else result.stdout.decode('utf-8')


def docker_inspect(kind, name):
    return json.loads(command(['docker', kind, 'inspect', name], timeout=20))[0]


def write_json(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.with_name(path.name + '.tmp')
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(fd, 'w') as output:
        json.dump(data, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def private_file(path):
    info = Path(path).lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise BackupError('Expected a root-owned private regular file: ' + str(path))


def private_directory(path):
    path = Path(path)
    if path.is_symlink():
        raise BackupError('Directory must not be a symlink')
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    info = path.stat()
    if info.st_uid != 0 or info.st_mode & 0o077:
        raise BackupError('Expected a root-owned private directory: ' + str(path))


def check_paths(repository, work):
    repository, work = Path(repository).resolve(), Path(work).resolve()
    if repository == Path(repository.anchor) or work == Path(work.anchor):
        raise BackupError('Filesystem root cannot be used for backup storage')
    if repository == work or repository in work.parents or work in repository.parents:
        raise BackupError('Repository and working directory must not overlap')


def require_space(path, required):
    if shutil.disk_usage(path).free < required:
        raise BackupError('Insufficient free disk space; no services were stopped')


def config(filename, *, require_password=True):
    private_file(filename)
    raw = json.loads(Path(filename).read_text())
    cfg = SimpleNamespace(project=Path(raw.get('project_root', '/opt/yaskapp')).resolve(),
                          project_name=raw.get('compose_project', 'yaskapp-staging'),
                          repository=Path(raw.get('repository', '/var/backups/yaskapp/restic')),
                          password=Path(raw.get('password_file', '/etc/yaskapp/backup/restic-password')),
                          work=Path(raw.get('work_dir', '/var/lib/yaskapp-backup')),
                          reserve=int(raw.get('reserve_bytes', 2 * GIB)))
    if not all(p.is_absolute() for p in (cfg.repository, cfg.password, cfg.work)) or cfg.reserve < 0:
        raise BackupError('Backup paths must be absolute; disk reserve must be nonnegative')
    check_paths(cfg.repository, cfg.work)
    if cfg.repository in cfg.password.resolve().parents or cfg.work in cfg.password.resolve().parents:
        raise BackupError('Keep the repository password outside snapshot/working directories')
    private_directory(cfg.work)
    if require_password:
        private_directory(cfg.repository)
        private_file(cfg.password)
    cfg.env = {**os.environ, 'RESTIC_REPOSITORY': str(cfg.repository),
               'RESTIC_PASSWORD_FILE': str(cfg.password), 'RESTIC_CACHE_DIR': str(cfg.work / 'cache')}
    return cfg


def restic(cfg, *args, timeout=1800):
    return command(['restic', *args], env=cfg.env, timeout=timeout)


def init(cfg):
    if not (cfg.repository / 'config').exists():
        if any(cfg.repository.iterdir()):
            raise BackupError('Refusing to initialize a nonempty unrelated directory')
        restic(cfg, 'init')
    restic(cfg, 'cat', 'config')
    restic(cfg, 'unlock')
    print('PASS: encrypted repository accessible; password is not printed', flush=True)


def recovery_container(cfg, identifier):
    info = docker_inspect('container', identifier)
    labels = info['Config'].get('Labels') or {}
    if labels.get('com.docker.compose.project') != cfg.project_name or labels.get('com.docker.compose.service') not in WRITERS | {'minio'}:
        raise BackupError('Refusing to recover a container outside this deployment')
    return info


def stop_recorded(cfg, containers):
    marker = cfg.work / 'maintenance.json'
    state = json.loads(marker.read_text())
    if not set(containers) <= set(state['containers']):
        raise BackupError('Stop target is missing from the recovery marker')
    state['stopping'] = containers
    write_json(marker, state)
    command(['docker', 'stop', *containers], timeout=60)
    state['stopping'] = []
    write_json(marker, state)


def resume(cfg):
    marker = cfg.work / 'maintenance.json'
    if not marker.exists():
        return
    private_file(marker)
    state = json.loads(marker.read_text())
    stopping = state.get('stopping', [])
    if stopping:
        if not set(stopping) <= set(state['containers']):
            raise BackupError('Invalid interrupted stop marker')
        for identifier in stopping:
            recovery_container(cfg, identifier)
        # Docker may finish a stop after the CLI disconnects. Await a confirmed stop
        # before starting these containers and discarding the recovery marker.
        stop_recorded(cfg, stopping)
    errors = []
    for container in reversed(state['containers']):
        try:
            info = recovery_container(cfg, container)
            if not info['State']['Running']:
                command(['docker', 'start', container])
        except BackupError as error:
            errors.append(str(error))
    for timer in state.get('timers', []):
        if timer != 'yaskapp-avatar-cleanup.timer':
            errors.append('Refusing to start an unknown timer')
            continue
        try:
            command(['systemctl', 'start', timer])
        except BackupError as error:
            errors.append(str(error))
    if errors:
        raise BackupError('Service recovery incomplete: ' + '; '.join(errors))
    wait_containers(state['containers'])
    marker.unlink()


@contextmanager
def maintenance(cfg, containers, timers):
    global maintenance_deadline
    if (cfg.work / 'maintenance.json').exists():
        raise BackupError('Previous maintenance must be recovered first')
    write_json(cfg.work / 'maintenance.json', {'containers': containers, 'timers': timers})
    try:
        maintenance_deadline = time.monotonic() + 300
        for timer in timers:
            command(['systemctl', 'stop', timer])
        if command(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + cfg.project_name,
                    '--filter', 'label=com.docker.compose.oneoff=True']).split():
            raise BackupError('An ad-hoc job is still running; no containers were stopped')
        stop_recorded(cfg, containers)
        yield
    finally:
        maintenance_deadline = None
        resume(cfg)


def environments(info):
    return dict(entry.split('=', 1) for entry in info['Config'].get('Env', []) if '=' in entry)


def validate_minio_kms(container, values):
    key_file = 'MINIO_KMS_SECRET_KEY_FILE'
    unsupported = 'External KMS restore is not configured; refusing an incomplete backup'
    if any(key.startswith('MINIO_KMS') and key != key_file and value for key, value in values.items()):
        raise BackupError(unsupported)
    if not values.get(key_file):
        return
    if values[key_file] != 'kms_master_key':
        raise BackupError(unsupported)
    # MinIO's community image sets this filename even when KMS is unused.
    # Inspect only presence, including a dangling symlink, without reading the file.
    result = command(['docker', 'exec', '--user', '0', container, 'sh', '-c',
                      'for path in "$1" "/proc/1/cwd/$1" "/run/secrets/$1"; do '
                      'if [ -e "$path" ] || [ -L "$path" ]; then printf "present\\n"; exit; fi; '
                      'done; printf "absent\\n"', 'sh', 'kms_master_key'], timeout=20)
    if result.strip() != 'absent':
        raise BackupError(unsupported)


def belongs_to_endpoint(url, container, network, scheme, port):
    endpoint = urlsplit(url)
    connection = container['NetworkSettings']['Networks'][network]
    hosts = set(connection.get('Aliases') or []) | set(connection.get('DNSNames') or [])
    hosts.add(connection.get('IPAddress'))
    endpoint_port = endpoint.port or {'postgres': 5432, 'postgresql': 5432, 'http': 80}.get(endpoint.scheme)
    return endpoint.hostname in hosts and endpoint.scheme in scheme and endpoint_port == port


def deployment(cfg):
    ids = command(['docker', 'ps', '-q', '--filter', 'label=com.docker.compose.project=' + cfg.project_name]).split()
    infos = [docker_inspect('container', identifier) for identifier in ids]
    groups = {}
    for info in infos:
        labels = info['Config'].get('Labels') or {}
        service = labels.get('com.docker.compose.service')
        if service not in WRITERS | NON_WRITERS:
            raise BackupError('An unexpected service is running in the backup project')
        if service in WRITERS | {'minio', 'postgres'}:
            if labels.get('com.docker.compose.oneoff', 'false').lower() == 'true':
                raise BackupError('An ad-hoc writer/cleanup is running; retry after it finishes')
            groups.setdefault(service, []).append(info)
    if not groups.get('api') or len(groups.get('postgres', [])) != 1 or len(groups.get('minio', [])) != 1:
        raise BackupError('Expected running API, exactly one PostgreSQL and one MinIO')
    api, pg, minio = groups['api'][0], groups['postgres'][0], groups['minio'][0]
    for info in groups['api']:
        if info['Image'] != api['Image'] or info['State'].get('Health', {}).get('Status', 'healthy') != 'healthy':
            raise BackupError('API deployment is mixed or unhealthy')
    mounts = [m for m in minio['Mounts'] if m['Destination'] == '/data' and m['Type'] == 'volume']
    if len(mounts) != 1:
        raise BackupError('MinIO /data must be a named Docker volume')
    data = Path(mounts[0]['Source'])
    if not data.is_dir() or data.is_symlink():
        raise BackupError('MinIO volume is not accessible from the Docker host')
    for root in (cfg.repository.resolve(), cfg.work.resolve()):
        if root == data or data in root.parents or root in data.parents:
            raise BackupError('MinIO volume and backup storage must not overlap')
    networks = set(api['NetworkSettings']['Networks']) & set(pg['NetworkSettings']['Networks']) & set(minio['NetworkSettings']['Networks'])
    if len(networks) != 1:
        raise BackupError('Expected one unambiguous shared Docker network')
    minio_env = environments(minio)
    if not minio_env.get('MINIO_ROOT_USER') or not minio_env.get('MINIO_ROOT_PASSWORD'):
        raise BackupError('This restore implementation requires explicit MinIO root credentials')
    validate_minio_kms(minio['Id'], minio_env)
    required = ['DATABASE_URL', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY']
    api_env = environments(api)
    if any(not api_env.get(key) for key in required):
        raise BackupError('API database/media configuration is incomplete')
    network = next(iter(networks))
    if not belongs_to_endpoint(api_env['S3_ENDPOINT'], minio, network, {'http'}, 9000):
        raise BackupError('API media endpoint does not point at this MinIO container')
    if not belongs_to_endpoint(api_env['DATABASE_URL'], pg, network, {'postgres', 'postgresql'}, 5432):
        raise BackupError('API database endpoint does not point at this PostgreSQL container')
    if unquote(urlsplit(api_env['DATABASE_URL']).path.lstrip('/')) != environments(pg).get('POSTGRES_DB'):
        raise BackupError('API database name differs from the database selected for pg_dump')
    probe_env = {key: value for key, value in api_env.items() if key in required + ['S3_FORCE_PATH_STYLE']}
    pg_size = int(command(['docker', 'exec', pg['Id'], 'sh', '-c',
                          'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "SELECT pg_database_size(current_database());"']).strip())
    media_size = sum(p.stat().st_size for p in data.rglob('*') if p.is_file())
    image_size = docker_inspect('image', minio['Image'])['Size']
    required_space = cfg.reserve + 3 * (pg_size + media_size + image_size)
    require_space(cfg.work, required_space)
    require_space(cfg.repository, required_space)
    writers = [i['Id'] for service, group in groups.items() if service in WRITERS for i in group]
    return {'api_image': api['Image'], 'postgres_image': pg['Image'], 'minio_image': minio['Image'],
            'postgres_id': pg['Id'], 'minio_id': minio['Id'], 'media_path': str(data),
            'network': network, 'probe_env': probe_env,
            'minio_env': minio_env, 'minio_command': minio['Config']['Cmd'],
            'writers': writers, 'database_bytes': pg_size, 'media_bytes': media_size,
            'minio_image_bytes': image_size}


def env_file(path, values):
    if any('\n' in value or '\r' in value for value in values.values()):
        raise BackupError('Multiline environment values are not supported')
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as output:
        output.write(''.join(key + '=' + value + '\n' for key, value in values.items()))


def probe(context, directory, network=None, values=None):
    run_id = secrets.token_hex(6)
    name = 'yaskapp-restore-' + run_id + '-inspector'
    env_path = Path(directory) / ('probe-' + run_id + '.env')
    env_file(env_path, values or context['probe_env'])
    inspector = Path(__file__).with_name('inspect-data.cjs').resolve()
    try:
        raw = command(['docker', 'run', '--rm', '--name', name, '--label', LABEL + '=' + run_id,
                       '--network', network or context['network'], '--env-file', env_path,
                       '--user', '0', '--mount', 'type=bind,src=%s,dst=/app/services/api/inspect-data.cjs,readonly' % inspector,
                       '--entrypoint', 'node', context['api_image'], '/app/services/api/inspect-data.cjs'])
        return json.loads(raw)
    finally:
        env_path.unlink(missing_ok=True)
        # If the Docker client timed out, the remote process can still exist.
        try:
            remove_resource('container', name, run_id)
        except BackupError:
            pass


def wait_containers(ids, timeout=120):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if all((i := docker_inspect('container', identifier))['State']['Running'] and
               i['State'].get('Health', {}).get('Status', 'healthy') == 'healthy' for identifier in ids):
            return
        time.sleep(2)
    raise BackupError('Services did not become healthy after maintenance')


def clear_stage(cfg):
    stage = cfg.work / 'snapshot'
    if not stage.exists():
        return
    private_directory(stage)
    names = {'context.json', 'context.json.tmp', 'manifest.json', 'manifest.json.tmp',
             'postgres.dump', 'minio-image.tar'}
    for path in stage.iterdir():
        if path.name not in names or not path.is_file() or path.is_symlink():
            raise BackupError('Unexpected entry in backup staging directory')
        path.unlink()


def backup(cfg):
    resume(cfg)
    cleanup_drill(cfg)
    init(cfg)
    context = deployment(cfg)
    stage = cfg.work / 'snapshot'
    private_directory(stage)
    clear_stage(cfg)
    config_paths = [cfg.project / name for name in [
        'services/api/.env.staging', 'services/api/.env.minio.staging',
        'infra/docker/docker-compose.staging.yml', 'infra/docker/Caddyfile',
        'infra/docker/secrets/firebase-service-account.json'] if (cfg.project / name).is_file()]
    if not (cfg.project / 'services/api/.env.staging').is_file():
        raise BackupError('Missing deployment environment file')
    context['config_paths'] = [str(path) for path in config_paths]
    # Community images can disappear from registries. Save the exact MinIO image before pausing writers.
    with (stage / 'minio-image.tar').open('wb') as output:
        command(['docker', 'image', 'save', context['minio_image']], stdout=output)
    timers = []
    if cfg.project_name == 'yaskapp-staging' and shutil.which('systemctl'):
        state = subprocess.run(['systemctl', 'is-active', 'yaskapp-avatar-cleanup.timer'], capture_output=True, timeout=15)
        if state.returncode == 0:
            timers = ['yaskapp-avatar-cleanup.timer']
    started = time.monotonic()
    # Write recovery state before stopping any writers; MinIO is stopped only after the inspector.
    all_ids = context['writers'] + [context['minio_id']]
    with maintenance(cfg, context['writers'], timers):
        write_json(stage / 'context.json', context)
        write_json(stage / 'manifest.json', probe(context, stage))
        with (stage / 'postgres.dump').open('wb') as output:
            os.chmod(stage / 'postgres.dump', 0o600)
            command(['docker', 'exec', context['postgres_id'], 'sh', '-c',
                     'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-privileges -U "$POSTGRES_USER" -d "$POSTGRES_DB"'], stdout=output)
        write_json(cfg.work / 'maintenance.json', {'containers': all_ids, 'timers': timers})
        stop_recorded(cfg, [context['minio_id']])
        output = restic(cfg, 'backup', '--json', '--host', cfg.project_name, '--tag', TAG,
                        str(stage), context['media_path'], *map(str, config_paths))
        summaries = [row for line in output.splitlines() if (row := json.loads(line)).get('message_type') == 'summary']
        if len(summaries) != 1 or not summaries[0].get('snapshot_id'):
            raise BackupError('No complete restic snapshot was committed')
        snapshot = summaries[0]['snapshot_id']
    restic(cfg, 'check')
    restic(cfg, 'forget', '--host', cfg.project_name, '--tag', TAG, '--group-by', 'host,tags',
           '--keep-within', '30d', '--keep-last', '1', '--prune')
    report = {'status': 'success', 'snapshot': snapshot, 'completed_at': time.time(),
              'maintenance_and_health_seconds': round(time.monotonic() - started, 2),
              'database_bytes': context['database_bytes'], 'media_bytes': context['media_bytes']}
    write_json(cfg.work / 'last-backup.json', report)
    print(json.dumps(report), flush=True)


def remove_resource(kind, name, run_id):
    if kind not in {'container', 'volume', 'network'} or not name.startswith('yaskapp-restore-' + run_id + '-'):
        raise BackupError('Refusing to remove an unrelated Docker resource')
    try:
        info = docker_inspect(kind, name)
    except BackupError:
        field = '{{.Names}}' if kind == 'container' else '{{.Name}}'
        names = command(['docker', kind, 'ls', *(['-a'] if kind == 'container' else []), '--format', field]).splitlines()
        if name not in names:
            return
        raise
    labels = info.get('Config', {}).get('Labels') if kind == 'container' else info.get('Labels')
    if not labels or labels.get(LABEL) != run_id:
        raise BackupError('Restore resource ownership label does not match')
    command(['docker', kind, 'rm', *(['-f'] if kind == 'container' else []), name])


def cleanup_drill(cfg):
    marker = cfg.work / 'drill.json'
    if not marker.exists():
        return
    private_file(marker)
    state = json.loads(marker.read_text())
    run_id = state['run_id']
    directory = Path(state['directory'])
    if not run_id or any(c not in '0123456789abcdef' for c in run_id):
        raise BackupError('Invalid restore ownership marker')
    if directory.parent.resolve() != cfg.work.resolve() or not directory.name.startswith('restore-' + run_id + '-') or directory.is_symlink():
        raise BackupError('Refusing to clean an unrelated restore directory')
    for kind, name in reversed(state['resources']):
        remove_resource(kind, name, run_id)
    if directory.exists():
        shutil.rmtree(directory)
    marker.unlink()


def restored_path(root, original):
    source = Path(original)
    if not source.is_absolute() or '..' in source.parts:
        raise BackupError('Invalid absolute snapshot path')
    result = Path(root) / str(source).lstrip('/')
    if Path(root).resolve() not in result.resolve().parents:
        raise BackupError('Restored path escapes the isolated directory')
    return result


def require_restore_space(cfg, context, pg_target, media_target, image_target=None):
    requirements = [(pg_target, 3 * int(context['database_bytes'])),
                    (media_target, 2 * int(context['media_bytes']))]
    if image_target is not None:
        requirements.append((image_target, 2 * int(context['minio_image_bytes'])))
    filesystems = {}
    for target, size in requirements:
        device = target.stat().st_dev
        if device not in filesystems:
            filesystems[device] = (target, cfg.reserve)
        path, total = filesystems[device]
        filesystems[device] = (path, total + size)
    for path, required in filesystems.values():
        require_space(path, required)


def verify(cfg):
    if (cfg.work / 'maintenance.json').exists():
        raise BackupError('Recover incomplete maintenance before running a restore drill')
    cleanup_drill(cfg)
    last_backup = cfg.work / 'last-backup.json'
    if not last_backup.exists():
        raise BackupError('No successful backup has been recorded')
    private_file(last_backup)
    report = json.loads(last_backup.read_text())
    if report.get('status') != 'success' or not report.get('snapshot'):
        raise BackupError('No successful backup has been recorded')
    snapshots = json.loads(restic(cfg, 'snapshots', '--json', '--host', cfg.project_name, '--tag', TAG))
    matches = [item for item in snapshots if item['id'].startswith(report['snapshot'])]
    if len(matches) != 1:
        raise BackupError('Last successful snapshot is absent or ambiguous')
    selected = matches[0]
    snapshot = selected['id']
    restic(cfg, 'check', '--read-data')
    sizes = json.loads(restic(cfg, 'stats', snapshot, '--mode', 'restore-size', '--json'))
    require_space(cfg.work, cfg.reserve + 3 * int(sizes['total_size']))
    run_id = secrets.token_hex(8)
    prefix = 'yaskapp-restore-' + run_id + '-'
    resources = []
    with tempfile.TemporaryDirectory(prefix='restore-' + run_id + '-', dir=cfg.work) as temporary:
        root = Path(temporary)
        write_json(cfg.work / 'drill.json', {'run_id': run_id, 'directory': str(root), 'resources': []})
        def register(kind, name):
            resources.append((kind, name))
            write_json(cfg.work / 'drill.json', {'run_id': run_id, 'directory': str(root), 'resources': resources})
        try:
            restic(cfg, 'restore', snapshot, '--target', str(root / 'files'), '--verify')
            candidates = [path for path in selected['paths'] if Path(path).name == 'snapshot']
            if len(candidates) != 1:
                raise BackupError('Cannot identify the snapshot metadata directory')
            stage = restored_path(root / 'files', candidates[0])
            context = json.loads((stage / 'context.json').read_text())
            expected = json.loads((stage / 'manifest.json').read_text())
            for original in context['config_paths']:
                if not restored_path(root / 'files', original).is_file():
                    raise BackupError('A deployment configuration file is absent from the restored snapshot')
            for image in ['api_image', 'postgres_image']:
                docker_inspect('image', context[image])
            image_target = None
            try:
                docker_inspect('image', context['minio_image'])
            except BackupError:
                image_target = Path(command(['docker', 'info', '--format', '{{.DockerRootDir}}'], timeout=20).strip())
            label = LABEL + '=' + run_id
            network = prefix + 'network'
            register('network', network)
            command(['docker', 'network', 'create', '--internal', '--label', label, network])
            volumes = {}
            for role in ['postgres', 'minio']:
                name = prefix + role + '-data'
                register('volume', name)
                command(['docker', 'volume', 'create', '--label', label, name])
                volumes[role] = name
            media_source = restored_path(root / 'files', context['media_path'])
            targets = {}
            for role, name in volumes.items():
                volume = docker_inspect('volume', name)
                target = Path(volume['Mountpoint'])
                if (volume.get('Labels') or {}).get(LABEL) != run_id or not target.is_absolute() or target.is_symlink() or any(target.iterdir()):
                    raise BackupError('Restore target must be an empty volume owned by this drill')
                targets[role] = target
            require_restore_space(cfg, context, targets['postgres'], targets['minio'], image_target)
            if image_target is not None:
                command(['docker', 'image', 'load', '-i', stage / 'minio-image.tar'])
                docker_inspect('image', context['minio_image'])
            command(['cp', '-a', str(media_source) + '/.', str(targets['minio'])])
            pg_password = secrets.token_hex(24)
            pg_env = root / 'postgres.env'
            env_file(pg_env, {'POSTGRES_USER': 'restore', 'POSTGRES_PASSWORD': pg_password, 'POSTGRES_DB': 'restore'})
            minio_env = root / 'minio.env'
            env_file(minio_env, context['minio_env'])
            containers = {}
            for role, environment, destination, extra in [
                ('postgres', pg_env, '/var/lib/postgresql/data', []),
                ('minio', minio_env, '/data', context['minio_command'])]:
                name = prefix + role
                register('container', name)
                command(['docker', 'run', '-d', '--name', name, '--label', label,
                         '--network', network, '--network-alias', role, '--env-file', environment,
                         '--mount', 'type=volume,src=%s,dst=%s' % (volumes[role], destination),
                         context[role + '_image'], *extra])
                containers[role] = name
            deadline = time.monotonic() + 90
            while True:
                try:
                    command(['docker', 'exec', containers['postgres'], 'pg_isready', '-h', '127.0.0.1', '-U', 'restore', '-d', 'restore'], timeout=10)
                    break
                except BackupError:
                    if time.monotonic() > deadline:
                        raise
                    time.sleep(2)
            with (stage / 'postgres.dump').open('rb') as dump:
                command(['docker', 'exec', '-i', containers['postgres'], 'pg_restore', '--exit-on-error',
                         '--no-owner', '--no-privileges', '-U', 'restore', '-d', 'restore'], stdin=dump)
            values = {**context['probe_env'], 'DATABASE_URL': 'postgres://restore:' + pg_password + '@postgres:5432/restore',
                      'S3_ENDPOINT': 'http://minio:9000'}
            actual = probe(context, root, network, values)
            if actual != expected:
                raise BackupError('Restored database/media fingerprints differ from the snapshot manifest')
            report = {'status': 'success', 'snapshot': snapshot, 'completed_at': time.time(),
                      'tables': len(actual['tables']), 'objects': len(actual['objects']),
                      'media_bytes': sum(row['bytes'] for row in actual['objects']),
                      'isolated_network': True, 'public_ports': False}
        finally:
            cleanup_drill(cfg)
    write_json(cfg.work / 'last-verify.json', report)
    print(json.dumps(report), flush=True)


def interrupted(signum, _frame):
    raise BackupError('Operation interrupted by signal ' + str(signum))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['init', 'preflight', 'backup', 'verify', 'resume', 'cleanup', 'status'])
    parser.add_argument('--config', default='/etc/yaskapp/backup/config.json')
    args = parser.parse_args()
    if not hasattr(os, 'geteuid') or os.geteuid() != 0:
        raise BackupError('Run this tool as root on the Linux Docker host')
    os.umask(0o077)
    cfg = config(args.config, require_password=args.action not in {'resume', 'cleanup', 'status'})
    import fcntl
    with (cfg.work / 'operation.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise BackupError('Another backup/restore operation is already running') from None
        for signum in [signal.SIGTERM, signal.SIGINT]:
            signal.signal(signum, interrupted)
        try:
            if args.action == 'preflight':
                ctx = deployment(cfg)
                print(json.dumps({key: ctx[key] for key in ['database_bytes', 'media_bytes', 'minio_image_bytes', 'api_image', 'postgres_image', 'minio_image']}))
            elif args.action == 'status':
                print(json.dumps({name: json.loads((cfg.work / name).read_text()) if (cfg.work / name).exists() else None
                                  for name in ['last-backup.json', 'last-verify.json', 'last-failure.json']}))
            elif args.action == 'cleanup':
                cleanup_drill(cfg)
            elif args.action == 'resume':
                resume(cfg)
                clear_stage(cfg)
            elif args.action == 'backup':
                try:
                    backup(cfg)
                finally:
                    clear_stage(cfg)
            elif args.action == 'init':
                init(cfg)
            elif args.action == 'verify':
                verify(cfg)
        except Exception as error:
            write_json(cfg.work / 'last-failure.json', {'action': args.action, 'time': time.time(),
                                                     'error': str(error) if isinstance(error, BackupError) else type(error).__name__})
            raise


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('FAIL: ' + (str(error) if isinstance(error, BackupError) else type(error).__name__), file=sys.stderr)
        sys.exit(1)
