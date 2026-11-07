#!/usr/bin/env python3
"""Exercise the backup CLI with a disposable local Docker deployment."""
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import sys
import tempfile
import time

import staging_backup as backup


SEED = r'''
const {Pool}=require('pg');
const {S3Client,CreateBucketCommand,PutObjectCommand}=require('@aws-sdk/client-s3');
async function run(){
  const pg=new Pool({connectionString:process.env.DATABASE_URL});
  const s3=new S3Client({endpoint:process.env.S3_ENDPOINT,region:'us-east-1',forcePathStyle:true,
    credentials:{accessKeyId:process.env.S3_ACCESS_KEY_ID,secretAccessKey:process.env.S3_SECRET_ACCESS_KEY}});
  const Bucket=process.env.S3_BUCKET;
  try{
    if(process.argv[1]==='seed'){
      await pg.query('CREATE TABLE fixture(id serial PRIMARY KEY, message text, value jsonb)');
      await pg.query("INSERT INTO fixture(message,value) VALUES ('BACKUP_FIXTURE_SECRET_TEXT','{\"x\":1}'), ('два','{}')");
      await s3.send(new CreateBucketCommand({Bucket}));
      await s3.send(new PutObjectCommand({Bucket,Key:'avatars/avatar.webp',Body:Buffer.from([0,255,15])}));
      await s3.send(new PutObjectCommand({Bucket,Key:'poll-images/first.webp',Body:'before snapshot'}));
    }else{
      await pg.query("INSERT INTO fixture(message,value) VALUES ('after snapshot','{}')");
      await s3.send(new PutObjectCommand({Bucket,Key:'poll-images/first.webp',Body:'changed after snapshot'}));
    }
  }finally{await pg.end();s3.destroy();}
}
run().catch(e=>{console.error(e.name,e.code);process.exitCode=1;});
'''


def run_cli(config, action, *, env=None, expected=0):
    result = subprocess.run([sys.executable, str(Path(backup.__file__)), action, '--config', str(config)],
                            env=env, text=True, capture_output=True, timeout=360)
    print(result.stdout, end='', flush=True)
    print(result.stderr, end='', flush=True)
    assert result.returncode == expected, (action, result.returncode)


def main():
    if os.environ.get('YASKAPP_BACKUP_TEST_ACK') != 'isolated' or os.geteuid() != 0:
        raise SystemExit('Run on a disposable Linux test host with YASKAPP_BACKUP_TEST_ACK=isolated')
    os.umask(0o077)
    run_id = secrets.token_hex(6)
    project = 'yaskapp-backup-test-' + run_id
    label_key = 'io.yaskapp.backup-test'
    label = label_key + '=' + run_id
    resources = []
    fixture_root = Path(os.environ.get('YASKAPP_BACKUP_TEST_ROOT', Path(__file__).resolve().parent))
    backup.private_directory(fixture_root)
    with tempfile.TemporaryDirectory(prefix='backup-test-', dir=fixture_root) as temporary:
        root = Path(temporary)
        try:
            network = project + '-net'
            backup.command(['docker', 'network', 'create', '--internal', '--label', label, network])
            resources.append(('network', network))
            source_env = {'POSTGRES_USER': 'checks', 'POSTGRES_PASSWORD': 'fixture-pg-password',
                          'POSTGRES_DB': 'checks', 'MINIO_ROOT_USER': 'fixture-root',
                          'MINIO_ROOT_PASSWORD': 'fixture-minio-password',
                          'DATABASE_URL': 'postgres://checks:fixture-pg-password@postgres:5432/checks',
                          'S3_ENDPOINT': 'http://minio:9000', 'S3_REGION': 'us-east-1',
                          'S3_BUCKET': 'fixture-media', 'S3_ACCESS_KEY_ID': 'fixture-root',
                          'S3_SECRET_ACCESS_KEY': 'fixture-minio-password', 'S3_FORCE_PATH_STYLE': 'true'}
            project_root = root / 'project'
            env_path = project_root / 'services/api/.env.staging'
            env_path.parent.mkdir(parents=True)
            backup.env_file(env_path, source_env)
            images = {'postgres': os.environ.get('YASKAPP_TEST_POSTGRES_IMAGE', 'postgres:16-alpine'),
                      'minio': os.environ['YASKAPP_TEST_MINIO_IMAGE'],
                      'api': os.environ['YASKAPP_TEST_API_IMAGE']}
            container_names = {}
            for role in ['postgres', 'minio', 'api']:
                name = project + '-' + role
                container_names[role] = name
                args = ['docker', 'run', '-d', '--name', name, '--label', label,
                        '--label', 'com.docker.compose.project=' + project,
                        '--label', 'com.docker.compose.service=' + role,
                        '--network', network, '--network-alias', role, '--env-file', env_path]
                if role != 'api':
                    volume = name + '-data'
                    backup.command(['docker', 'volume', 'create', '--label', label, volume])
                    resources.append(('volume', volume))
                    destination = '/data' if role == 'minio' else '/var/lib/postgresql/data'
                    args.extend(['--mount', 'type=volume,src=%s,dst=%s' % (volume, destination)])
                if role == 'api':
                    args.extend(['--entrypoint', 'node', images[role], '-e', 'setInterval(()=>{},10000)'])
                else:
                    args.extend([images[role], *(['server', '/data'] if role == 'minio' else [])])
                backup.command(args)
                resources.append(('container', name))
            for _ in range(45):
                try:
                    backup.command(['docker', 'exec', container_names['postgres'], 'pg_isready', '-h', '127.0.0.1', '-U', 'checks'], timeout=5)
                    backup.command(['docker', 'exec', container_names['api'], 'node', '-e',
                                    "fetch('http://minio:9000/minio/health/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], timeout=5)
                    break
                except backup.BackupError:
                    time.sleep(2)
            else:
                raise AssertionError('Fixture PostgreSQL/MinIO did not start')
            seed = ['docker', 'exec', '-w', '/app/services/api', container_names['api'], 'node', '-e', SEED]
            backup.command([*seed, 'seed'])
            password = root / 'password'
            password.write_text(secrets.token_hex(32) + '\n')
            config = root / 'config.json'
            backup.write_json(config, {'project_root': str(project_root), 'compose_project': project,
                                       'repository': str(root / 'repository'), 'password_file': str(password),
                                       'work_dir': str(root / 'work'), 'reserve_bytes': 32 * 1024 ** 2})
            run_cli(config, 'preflight')
            run_cli(config, 'backup')
            cfg = backup.config(config)
            assert not any((cfg.work / 'snapshot').iterdir()), 'plaintext backup staging was retained'
            assert not any(b'BACKUP_FIXTURE_SECRET_TEXT' in path.read_bytes()
                           for path in (cfg.repository / 'data').glob('*/*') if path.is_file())
            backup.command([*seed, 'mutate'])
            source = backup.deployment(cfg)
            before = backup.probe(source, root)
            assert before['tables'][0]['rows'] == '3' and len(before['objects']) == 2
            run_cli(config, 'verify')
            verified = json.loads((cfg.work / 'last-verify.json').read_text())
            assert verified['status'] == 'success' and verified['tables'] == 1 and verified['objects'] == 2
            assert backup.probe(source, root) == before, 'restore changed the running test deployment'
            print('PASS: real PostgreSQL and MinIO restored from encrypted snapshot without changing source', flush=True)

            stub_dir = root / 'fault-injection'
            stub_dir.mkdir()
            restic = shutil.which('restic')
            stub = stub_dir / 'restic'
            stub.write_text('#!/bin/sh\nif [ "$1" = backup ]; then exit 97; fi\nexec ' + restic + ' "$@"\n')
            stub.chmod(0o700)
            run_cli(config, 'backup', env={**os.environ, 'PATH': str(stub_dir) + ':' + os.environ['PATH']}, expected=1)
            assert not (cfg.work / 'maintenance.json').exists()
            assert not any((cfg.work / 'snapshot').iterdir()), 'failed backup retained plaintext staging'
            for role in ('api', 'minio'):
                assert backup.docker_inspect('container', container_names[role])['State']['Running']
            print('PASS: failed snapshot resumed the original API and MinIO', flush=True)

            pack = next(path for path in (cfg.repository / 'data').glob('*/*') if path.is_file())
            data = bytearray(pack.read_bytes())
            data[len(data) // 2] ^= 1
            pack.write_bytes(data)
            run_cli(config, 'verify', expected=1)
            assert backup.probe(source, root) == before
            print('PASS: corrupt repository rejected, source data intact', flush=True)
        finally:
            for kind, name in reversed(resources):
                info = backup.docker_inspect(kind, name)
                labels = info['Config']['Labels'] if kind == 'container' else info['Labels']
                assert labels.get(label_key) == run_id
                backup.command(['docker', kind, 'rm', *(['-f'] if kind == 'container' else []), name])


if __name__ == '__main__':
    main()
