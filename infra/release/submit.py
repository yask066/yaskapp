#!/usr/bin/python3
"""Constrained sudo entry point; no arbitrary paths or shell commands accepted."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from release import validate_manifest
from deploy import save


def main():
    if os.geteuid() != 0 or len(sys.argv) != 3:
        raise ValueError('Expected environment and source SHA')
    environment, sha = sys.argv[1:]
    if environment not in ('staging', 'production') or not re.fullmatch('[0-9a-f]{40}', sha):
        raise ValueError('Invalid request')
    os.umask(0o077)
    state = Path('/var/lib/yaskapp-release') / environment
    source = state / 'incoming' / (sha + '.json')
    descriptor = os.open(source, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as handle:
        manifest = validate_manifest(json.loads(handle.read(131073)))
    if manifest['source_sha'] != sha:
        raise ValueError('Mismatched request')
    target = state / 'requests' / (sha + '.json')
    if target.exists() and json.loads(target.read_text()) != manifest:
        raise ValueError('Cannot replace an immutable request')
    save(target, manifest)
    # The system service remains alive if the SSH client goes away. The caller
    # waits for the result; a later retry cannot silently continue a broken run.
    subprocess.run(['systemd-run', '--quiet', '--wait', '--collect',
                    '--unit=yaskapp-release-' + environment + '-' + sha,
                    '--property=Type=oneshot', '--property=TimeoutStartSec=1800',
                    '/usr/bin/python3', '/usr/local/libexec/yaskapp-release/deploy.py',
                    environment, sha], check=True)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print('Release request failed: ' + type(error).__name__)
        sys.exit(1)
