#!/usr/bin/env bash
set -euo pipefail

if [[ "$(id -u)" -eq 0 ]]; then
  echo "Run this script as the ubuntu user; it uses sudo where required." >&2
  exit 1
fi

sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg git unattended-upgrades

# AWS CLI is only required when BACKUP_S3_URI is configured. Ubuntu 24.04 does
# not publish the awscli package in every regional mirror, so it must not block
# a server-only deployment.
awscli_candidate="$(apt-cache policy awscli | awk '/Candidate:/ {print $2}')"
if [[ -n "$awscli_candidate" && "$awscli_candidate" != "(none)" ]]; then
  sudo apt-get install -y awscli
else
  echo "awscli is unavailable from apt; continuing without optional S3 backup support."
fi

sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  | sudo gpg --dearmor --yes -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

. /etc/os-release
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" \
  | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

sudo install -d -m 0700 \
  /srv/marble-park/postgres \
  /srv/marble-park/assets \
  /srv/marble-park/backups \
  /srv/marble-park/caddy/data \
  /srv/marble-park/caddy/config
sudo chown -R "$USER":"$USER" /srv/marble-park

if ! swapon --show=NAME --noheadings | grep -q .; then
  sudo fallocate -l 4G /swapfile
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

echo 'vm.swappiness=10' | sudo tee /etc/sysctl.d/99-marble-park.conf >/dev/null
sudo sysctl --system >/dev/null
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

echo "Host bootstrap complete. Sign out and reconnect once so Docker group membership applies."
