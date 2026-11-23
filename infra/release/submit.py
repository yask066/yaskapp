#!/usr/bin/python3
"""Constrained sudo entry point; no arbitrary paths or shell commands accepted."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from uuid import uuid4

from release import validate_manifest
from deploy import locked, read, save


MAX_MANIFEST_LENGTH = 131072


def load_manifest(state, sha, from_stdin):
    if from_stdin:
        content = sys.stdin.read(MAX_MANIFEST_LENGTH + 1)
    else:
        # Keep supporting workflows that uploaded the manifest before invoking sudo.
        source = state / 'incoming' / (sha + '.json')
        descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(descriptor) as handle:
            content = handle.read(MAX_MANIFEST_LENGTH + 1)
    if len(content) > MAX_MANIFEST_LENGTH:
        raise ValueError('Manifest exceeds the request size limit')
    manifest = validate_manifest(json.loads(content))
    if manifest['source_sha'] != sha:
        raise ValueError('Mismatched request')
    return manifest


def main():
    args = sys.argv[1:]
    if os.geteuid() != 0 or len(args) < 2 or args[2:] not in ([], ['--stdin']):
        raise ValueError('Expected environment and source SHA')
    environment, sha = args[:2]
    if environment not in ('staging', 'production') or not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Invalid request')
    os.umask(0o077)
    state = Path('/var/lib/yaskapp-release') / environment
    manifest = load_manifest(state, sha, from_stdin=len(args) == 3)
    target = state / 'requests' / (sha + '.json')
    with locked(target.with_suffix('.lock'), blocking=True):
        if target.exists():
            if read(target) != manifest:
                raise ValueError('Cannot replace an immutable request')
        else:
            save(target, manifest)
        # A transient unit may still exist when its caller finishes waiting.
        unit = f'yaskapp-release-{environment}-{sha}-{uuid4().hex}'
        subprocess.run(['systemd-run', '--quiet', '--wait', '--collect', f'--unit={unit}',
                        '--property=Type=oneshot', '--property=TimeoutStartSec=1800',
                        '/usr/bin/python3', '/usr/local/libexec/yaskapp-release/deploy.py',
                        environment, sha], check=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Release request failed: ' + type(error).__name__)
        sys.exit(1)
