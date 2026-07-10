#!/usr/bin/env sh
set -eu

image="${1:-containerlab-web:smoke}"
container_name="containerlab-app-smoke-$$"

cleanup() {
  docker rm -f "$container_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT INT TERM

docker run -d \
  --name "$container_name" \
  --read-only \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=64m \
  --tmpfs /home/node/.config/containerlab-web/tls:rw,noexec,nosuid,nodev,size=16m,uid=1000,gid=1000,mode=0700 \
  "$image" >/dev/null

attempt=0
until docker exec "$container_name" node -e \
  "const request = require('node:https').get({ hostname: '127.0.0.1', port: 3001, path: '/api/health/live', rejectUnauthorized: false }, response => { let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => { try { if (response.statusCode !== 200 || JSON.parse(body).status !== 'ok') process.exit(1); } catch { process.exit(1); } }); }); request.on('error', () => process.exit(1));"
do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    docker logs "$container_name"
    exit 1
  fi
  sleep 1
done

test "$(docker inspect --format '{{.Config.User}}' "$container_name")" = "node"
test "$(docker inspect --format '{{.HostConfig.ReadonlyRootfs}}' "$container_name")" = "true"
test "$(docker inspect --format '{{json .HostConfig.CapDrop}}' "$container_name")" = '["ALL"]'

echo "Container image smoke check passed: $image"
