"""Immutable release metadata shared by CI and the Linux deployment runner."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess


IMAGES = ('api', 'web', 'moderation-web')


def validate_manifest(value):
    if not isinstance(value, dict) or value.get('version') != 1:
        raise ValueError('Unsupported manifest version')
    for key in ('source_sha', 'source_tree'):
        if not re.fullmatch('[0-9a-f]{40}', str(value.get(key, ''))):
            raise ValueError('Invalid ' + key)
    if type(value.get('sequence')) is not int or value['sequence'] < 1:
        raise ValueError('Invalid release sequence')
    images = value.get('images', {})
    if not isinstance(images, dict) or set(images) != set(IMAGES):
        raise ValueError('Expected all three application images')
    for name in IMAGES:
        if not re.fullmatch(r'ghcr\.io/yask066/yaskapp-' + name + r'@sha256:[0-9a-f]{64}',
                            str(images[name])):
            raise ValueError('Expected repository-specific immutable image: ' + name)
    migrations = value.get('migrations')
    if not isinstance(migrations, dict) or not migrations:
        raise ValueError('Missing migration checksums')
    for name, checksum in migrations.items():
        if not re.fullmatch(r'[0-9]+_[a-zA-Z0-9_-]+\.sql', name) or not re.fullmatch('[0-9a-f]{64}', str(checksum)):
            raise ValueError('Invalid migration checksum entry')
    return value


def verify_promotion(manifest, source_sha, merged_tree):
    validate_manifest(manifest)
    if manifest['source_sha'] != source_sha or manifest['source_tree'] != merged_tree:
        raise ValueError('Merged source differs from the tested release')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--sequence', type=int, required=True)
    parser.add_argument('--api', required=True)
    parser.add_argument('--web', required=True)
    parser.add_argument('--moderation-web', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    git = lambda ref: subprocess.check_output(['git', 'rev-parse', ref], text=True).strip()
    value = {
        'version': 1, 'source_sha': git('HEAD'), 'source_tree': git('HEAD^{tree}'),
        'sequence': args.sequence,
        'images': {key: 'ghcr.io/yask066/yaskapp-' + key + '@' + getattr(args, key.replace('-', '_'))
                   for key in IMAGES},
        'migrations': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                       for p in sorted(Path('services/api/src/db/migrations').glob('*.sql'))},
    }
    validate_manifest(value)
    Path(args.output).write_text(json.dumps(value, indent=2) + '\n')


if __name__ == '__main__':
    main()
