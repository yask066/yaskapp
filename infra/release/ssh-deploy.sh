#!/usr/bin/env bash
set -euo pipefail
environment=${1:?environment required}
sha=${2:?source SHA required}
manifest=${3:?manifest required}
[[ $environment =~ ^(staging|production)$ && $sha =~ ^[0-9a-f]{40}$ ]]
install -d -m 700 "$HOME/.ssh"
printf '%s\n' "$DEPLOY_KEY" > "$HOME/.ssh/yaskapp_release"
chmod 600 "$HOME/.ssh/yaskapp_release"
printf '%s\n' "$DEPLOY_KNOWN_HOSTS" > "$HOME/.ssh/known_hosts"
ssh_args=(-i "$HOME/.ssh/yaskapp_release" -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15)
scp "${ssh_args[@]}" "$manifest" "$DEPLOY_USER@$DEPLOY_HOST:/var/lib/yaskapp-release/$environment/incoming/$sha.json"
ssh "${ssh_args[@]}" "$DEPLOY_USER@$DEPLOY_HOST" "sudo -n /usr/local/libexec/yaskapp-release/submit.py $environment $sha"
