#!/usr/bin/env bash
# Runs the root-only ownership tests (src/images/ownership.root.test.ts) as uid 0 in a throwaway
# Docker container. The repo is mounted read-only, so root writes nothing into it; the test
# creates its files under the container's /tmp.
set -euo pipefail
repo="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
image="${ROOT_TEST_IMAGE:-node:24-slim}"
exec docker run --rm --user 0:0 -v "$repo:$repo:ro" -w "$repo/packages/app-server" "$image" \
  node --import tsx --test src/images/ownership.root.test.ts
