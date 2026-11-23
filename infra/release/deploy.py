"""Root-owned Linux deployment runner. Invoke through submit.py/systemd."""
import argparse
from contextlib import ExitStack, contextmanager
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import time
import urllib.request

from release import validate_manifest


APPLICATIONS = {'api', 'web', 'moderation-web', 'account-deletion-worker',
                'notification-worker', 'poll-feed-snapshot-cleanup'}
WRITERS = APPLICATIONS - {'web', 'moderation-web'}


def read(path):
    return json.loads(path.read_text()) if path.exists() else None


def save(path, data):
    temporary = path.with_suffix('.tmp')
    with temporary.open('w') as output:
        json.dump(data, output, indent=2)
        output.flush()
        os.fsync(output.fileno())
    os.replace(temporary, path)


def perform(host, state, manifest):
    validate_manifest(manifest)
    previous = read(state / 'current.json')
    attempt = read(state / 'attempt.json') or {}
    if attempt.get('status') not in (None, 'success', 'failed-before-stop', 'rolled-back'):
        raise ValueError('Previous attempt requires operator recovery')
    if previous == manifest:
        return
    if previous and manifest['sequence'] <= previous['sequence']:
        raise ValueError('Refusing an older or conflicting release sequence')

    def status(value):
        save(state / 'attempt.json', {'status': value, 'release': manifest, 'time': time.time()})

    status('preflight')
    try:
        host.pull(manifest)
        host.backup()
    except Exception:
        status('failed-before-stop')
        raise
    migrated = False
    try:
        status('stopping')
        host.stop()
        status('migrating')
        host.migrate(manifest)
        migrated = True
        status('starting')
        host.start(manifest)
        status('checking')
        host.check(manifest)
    except Exception:
        status('maintenance')
        host.stop()
        # A migration error may follow successful earlier migrations. Never infer
        # safety from process exit status or automatically restore user data.
        if migrated and previous and previous['migrations'] == manifest['migrations']:
            try:
                host.start(previous)
                host.check(previous)
                status('rolled-back')
            except Exception:
                host.stop()
                status('maintenance')
        raise
    if previous:
        save(state / 'previous.json', previous)
    save(state / 'current.json', manifest)
    status('success')


def command(args, timeout=600):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        # Docker/config/migration output can contain credentials; do not echo it.
        raise RuntimeError('Command failed: ' + args[0])
    return result.stdout


def secure_file(path):
    info = path.lstat()
    if path.is_symlink() or not path.is_file() or info.st_uid != 0 or info.st_mode & 0o022:
        raise ValueError('Expected root-owned non-writable configuration: ' + str(path))


@contextmanager
def locked(path):
    import fcntl
    with path.open('a') as handle:
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        yield


class DockerHost:
    def __init__(self, cfg, state):
        self.cfg, self.state = cfg, state
        self.services = cfg['services']
        if not self.services or not set(self.services) <= APPLICATIONS or 'api' not in self.services:
            raise ValueError('Invalid application service allowlist')
        if cfg['environment'] == 'staging' and cfg['project_name'] == 'yaskapp-staging':
            raise ValueError('Historical production project cannot be used for test deploys')
        self.base = ['docker', 'compose', '--env-file', cfg['env_file'], '-p', cfg['project_name']]
        for filename in cfg['compose_files']:
            self.base += ['-f', filename]
        self.backup_module = None
        if cfg['environment'] == 'production':
            path = Path(cfg['backup_module'])
            secure_file(path)
            spec = importlib.util.spec_from_file_location('release_backup', path)
            self.backup_module = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(self.backup_module)
            self.backup_cfg = self.backup_module.config(cfg['backup_config'])
            if self.backup_cfg.project_name != cfg['project_name']:
                raise ValueError('Backup targets a different project')

    def compose(self, manifest):
        images = manifest['images']
        override = self.state / 'images.json'
        save(override, {'services': {name: {'image': images[name if name in images else 'api']}
                                     for name in [*self.services, 'migrate']}})
        return [*self.base, '-f', str(override)]

    def pull(self, manifest):
        for reference in manifest['images'].values():
            command(['docker', 'pull', reference])
            info = json.loads(command(['docker', 'image', 'inspect', reference]))[0]
            if info['Config'].get('Labels', {}).get('org.opencontainers.image.revision') != manifest['source_sha']:
                raise ValueError('Image revision does not match manifest')

    def backup(self):
        if self.backup_module:
            try:
                self.backup_module.backup(self.backup_cfg)
            finally:
                self.backup_module.clear_stage(self.backup_cfg)

    def stop(self):
        command([*self.base, 'stop', *sorted(set(self.services) & WRITERS)], timeout=120)

    def migrate(self, manifest):
        command([*self.compose(manifest), 'run', '--rm', '--no-deps', '-T', 'migrate'], timeout=900)

    def start(self, manifest):
        command([*self.compose(manifest), 'up', '-d', '--no-deps', '--no-build',
                 '--wait', '--wait-timeout', '180', *self.services], timeout=240)

    def check(self, manifest):
        ids = command([*self.base, 'ps', '-q', *self.services]).split()
        if not ids:
            raise RuntimeError('No application containers')
        infos = json.loads(command(['docker', 'inspect', *ids]))
        found = set()
        for info in infos:
            service = info['Config']['Labels']['com.docker.compose.service']
            found.add(service)
            expected = manifest['images'][service if service in manifest['images'] else 'api']
            if info['Config']['Image'] != expected or not info['State']['Running']:
                raise RuntimeError('Mixed or stopped application containers')
            if info['State'].get('Health', {}).get('Status', 'healthy') != 'healthy':
                raise RuntimeError('Unhealthy application container')
        if found != set(self.services):
            raise RuntimeError('Missing application service')
        for url in self.cfg['smoke_urls']:
            with urllib.request.urlopen(url, timeout=20) as response:
                if response.status != 200:
                    raise RuntimeError('Public smoke check failed')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('environment', choices=['staging', 'production'])
    parser.add_argument('sha')
    args = parser.parse_args()
    import re
    if not re.fullmatch('[0-9a-f]{40}', args.sha) or os.geteuid() != 0:
        raise ValueError('Root and full source SHA required')
    os.umask(0o077)
    config_path = Path('/etc/yaskapp/release') / (args.environment + '.json')
    secure_file(config_path)
    cfg = read(config_path)
    if cfg['environment'] != args.environment or cfg.get('enabled') is not True:
        raise ValueError('Environment disabled or mismatched')
    state = Path('/var/lib/yaskapp-release') / args.environment
    state.mkdir(parents=True, exist_ok=True)
    manifest_path = state / 'requests' / (args.sha + '.json')
    secure_file(manifest_path)
    manifest = validate_manifest(read(manifest_path))
    if manifest['source_sha'] != args.sha:
        raise ValueError('Request SHA mismatch')
    with ExitStack() as stack:
        stack.enter_context(locked(state / 'deploy.lock'))
        host = DockerHost(cfg, state)
        if host.backup_module:
            if not (state / 'current.json').exists():
                raise ValueError('Production baseline manifest must be registered first')
            stack.enter_context(locked(host.backup_cfg.work / 'operation.lock'))
        perform(host, state, manifest)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Deployment failed: ' + type(error).__name__)
        raise SystemExit(1) from None
