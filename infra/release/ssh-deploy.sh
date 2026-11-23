#!/usr/bin/env bash
set -euo pipefail
environment=${1:?environment required}
sha=${2:?source SHA required}
manifest=${3:?manifest required}
[[ $environment =~ ^(staging|production)$ && $sha =~ ^[0-9a-f]{40}$ ]]
ssh_dir=$(mktemp -d)
trap 'rm -f -- "$ssh_dir/key" "$ssh_dir/known_hosts"; rmdir -- "$ssh_dir"' EXIT
umask 077
printf '%s\n' "$DEPLOY_KEY" > "$ssh_dir/key"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$ssh_dir/known_hosts"
ssh_args=(-T -i "$ssh_dir/key" -o IdentitiesOnly=yes -o BatchMode=yes
          -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$ssh_dir/known_hosts"
          -o GlobalKnownHostsFile=/dev/null -o ConnectTimeout=15)
ssh "${ssh_args[@]}" "$DEPLOY_USER@$DEPLOY_HOST" \
    "sudo -n /usr/local/libexec/yaskapp-release/submit.py $environment $sha --stdin" < "$manifest"
