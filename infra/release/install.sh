#!/usr/bin/env bash
set -euo pipefail
# Run on the target Linux host: sudo bash infra/release/install.sh staging deploy-test
environment=${1:?environment required}
deploy_user=${2:?dedicated SSH account required}
[[ $EUID -eq 0 && $environment =~ ^(staging|production)$ && $deploy_user =~ ^[a-z_][a-z0-9_-]*$ ]]
id "$deploy_user" >/dev/null
source_dir=$(cd -- "$(dirname -- "$0")" && pwd)
install -d -m 755 /usr/local/libexec/yaskapp-release /etc/yaskapp/release
install -m 755 "$source_dir/submit.py" /usr/local/libexec/yaskapp-release/submit.py
install -m 644 "$source_dir/release.py" "$source_dir/deploy.py" /usr/local/libexec/yaskapp-release/
install -d -m 711 /var/lib/yaskapp-release "/var/lib/yaskapp-release/$environment"
install -d -m 700 "/var/lib/yaskapp-release/$environment/requests"
install -d -m 700 -o "$deploy_user" "/var/lib/yaskapp-release/$environment/incoming"
sudo_rule=$(mktemp)
trap 'rm -f -- "$sudo_rule"' EXIT
printf '%s ALL=(root) NOPASSWD: /usr/local/libexec/yaskapp-release/submit.py %s *\n' "$deploy_user" "$environment" > "$sudo_rule"
visudo -cf "$sudo_rule"
install -m 440 "$sudo_rule" "/etc/sudoers.d/yaskapp-release-$environment"
echo 'Runner installed. Configure the environment before enabling deployments.'
