#!/usr/bin/env bash
# Starts the images-capable web image (Dockerfile.images) in local-labs mode.
# Every path is mounted at the same location inside and outside the container.
# Settings come from the environment. CLIMG_PATH (a climg checkout) and VRNETLAB
# have no default and must be set.
set -euo pipefail

NAME="${NAME:-containerlab-app-images}"
IMAGE="${IMAGE:-containerlab-web:images-dev}"
PORT="${PORT:-3001}"
CLIMG_PATH="${CLIMG_PATH:?set CLIMG_PATH to a climg checkout (contains bin/climg)}"   # mounted read-only
VRNETLAB="${VRNETLAB:?set VRNETLAB to your vrnetlab checkout}"
CLIMG_CONFIG="${CLIMG_CONFIG:-$HOME/.config/climg/config.yaml}"
CLIMG_STATE="${CLIMG_STATE:-$HOME/.local/share/climg}"
IMAGES_DIR="${IMAGES_DIR:-$CLIMG_STATE/images}"
WORKSPACE="${WORKSPACE:-$HOME/.clab}"
CLAB_BINARY="${CLAB_BINARY:-$(command -v containerlab)}"
CLIMG_UID="${CLIMG_UID:-$(id -u)}"
CLIMG_GID="${CLIMG_GID:-$(stat -c %g /var/run/docker.sock)}"
CLIMG_HOME="${CLIMG_HOME:-$HOME}"                     # HOME of climg in the container; the host user's, not the image's passwd
ALLOWED_HOSTS="${ALLOWED_HOSTS:-localhost,127.0.0.1,[::1]}"

mkdir -p "$WORKSPACE/ui" "$CLIMG_STATE" "$IMAGES_DIR"

# Forwarded only when set in the caller's environment; the server's defaults apply otherwise.
LIMIT_ENV=()
for var in WEB_LOCAL_IMAGES_UPLOAD_MAX WEB_LOCAL_IMAGES_MAX_RUNNING WEB_LOCAL_IMAGES_MAX_QUEUED; do
  if [ -n "${!var+x}" ]; then LIMIT_ENV+=(-e "$var=${!var}"); fi
done

docker run -d --name "$NAME" \
  --user root --privileged --network host --pid host \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v /var/run/netns:/var/run/netns \
  -v /var/lib/docker/containers:/var/lib/docker/containers \
  -v /etc/hosts:/etc/hosts \
  -v "$CLAB_BINARY":/usr/local/bin/containerlab:ro \
  -v "$CLIMG_PATH":"$CLIMG_PATH":ro \
  -v "$VRNETLAB":"$VRNETLAB" \
  -v "$(dirname "$CLIMG_CONFIG")":"$(dirname "$CLIMG_CONFIG")" \
  -v "$CLIMG_STATE":"$CLIMG_STATE" \
  -v "$IMAGES_DIR":"$IMAGES_DIR" \
  -v "$WORKSPACE":"$WORKSPACE" \
  -e PORT="$PORT" \
  -e WEB_LOCAL_LABS=true \
  -e WEB_LOCAL_WORKSPACE="$WORKSPACE" \
  -e WEB_LOCAL_CLIMG_PATH="$CLIMG_PATH/bin/climg" \
  -e WEB_LOCAL_CLIMG_CONFIG="$CLIMG_CONFIG" \
  -e WEB_LOCAL_CLIMG_STATE="$CLIMG_STATE" \
  -e WEB_LOCAL_CLIMG_USER="$CLIMG_UID:$CLIMG_GID" \
  -e WEB_LOCAL_CLIMG_HOME="$CLIMG_HOME" \
  -e WEB_ALLOWED_HOSTS="$ALLOWED_HOSTS" \
  ${LIMIT_ENV[@]+"${LIMIT_ENV[@]}"} \
  "$IMAGE"
