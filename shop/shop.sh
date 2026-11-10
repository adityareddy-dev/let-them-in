#!/usr/bin/env bash
# Runs the public OpenTelemetry Demo shop that the shoppers visit.
#   shop.sh up      clone the shop at a fixed release (first time) and start it
#   shop.sh fix D   put patch file D on the released frontend, rebuild it and restart it
#   shop.sh reset   undo any patch and go back to the released frontend
#   shop.sh down    stop the shop
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
src="$here/src"
tag="${SHOP_TAG:-3.1.0}"
port="${SHOP_PORT:-8090}"
compose() {
  ENVOY_PORT="$port" DEMO_VERSION="$tag" docker compose -p lti-shop --project-directory "$src" \
    -f "$src/compose.yaml" -f "$here/compose.override.yaml" "$@"
}
wait_up() {
  for _ in $(seq 1 90); do
    if curl -fsS -o /dev/null "http://127.0.0.1:$port/"; then echo "shop is up on http://127.0.0.1:$port"; return 0; fi
    sleep 2
  done
  echo "shop did not answer on port $port" >&2; return 1
}
case "${1:-}" in
  up)
    [ -d "$src/.git" ] || git clone -q --depth 1 --branch "$tag" https://github.com/open-telemetry/opentelemetry-demo.git "$src"
    # The frontend is built from source, before and after a fix, so the patch is the only difference.
    compose build frontend
    compose up -d --quiet-pull
    # The demo's own fake traffic is not needed and only takes CPU from the shoppers.
    compose stop load-generator
    wait_up ;;
  fix)
    # the patch holds every change from the release, so start from the release each time
    patch="$(realpath "$2")"
    git -C "$src" checkout -- src/frontend
    git -C "$src" apply --check "$patch"
    git -C "$src" apply "$patch"
    compose build frontend
    compose up -d frontend
    wait_up ;;
  reset)
    git -C "$src" checkout -- src/frontend
    compose build frontend
    compose up -d frontend
    wait_up ;;
  down)
    compose down ;;
  *)
    echo "usage: shop.sh up|fix <patch>|reset|down" >&2; exit 2 ;;
esac
