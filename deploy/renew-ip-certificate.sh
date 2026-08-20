#!/usr/bin/env bash

set -euo pipefail

APP_DIR="/opt/budgetpro"
CERTBOT_IMAGE="certbot/certbot:v5.4.0"
CERT_NAME="46.225.60.142"

exec 9>/run/lock/budgetpro-cert-renew.lock
if ! flock -n 9; then
  echo "Certificate renewal is already running; exiting."
  exit 0
fi

cd "$APP_DIR"
mkdir -p deploy/nginx/acme deploy/nginx/certs/letsencrypt

docker run --rm \
  -v "$APP_DIR/deploy/nginx/certs/letsencrypt:/etc/letsencrypt" \
  -v "$APP_DIR/deploy/nginx/acme:/var/www/certbot" \
  "$CERTBOT_IMAGE" renew \
  --cert-name "$CERT_NAME" \
  --preferred-profile shortlived \
  --webroot \
  --webroot-path /var/www/certbot \
  --non-interactive \
  --work-dir /tmp/certbot-work \
  --logs-dir /tmp/certbot-logs

docker compose --env-file .env.production exec -T nginx nginx -t
docker compose --env-file .env.production exec -T nginx nginx -s reload
