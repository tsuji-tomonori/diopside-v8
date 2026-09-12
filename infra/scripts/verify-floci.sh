#!/usr/bin/env bash
set -euo pipefail

infra_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
compose_file="$infra_dir/compose.floci.yaml"
endpoint="http://127.0.0.1:4566"

cleanup() {
  docker compose --file "$compose_file" down --volumes
}
trap cleanup EXIT

docker compose --file "$compose_file" up --detach

ready=false
for _attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "$endpoint/_localstack/health" >/dev/null; then
    ready=true
    break
  fi
  sleep 1
done

if [[ "$ready" != "true" ]]; then
  docker compose --file "$compose_file" logs floci
  echo "Floci did not become ready within 30 seconds" >&2
  exit 1
fi

DIOPSIDE_AWS_ENDPOINT_URL="$endpoint" \
  uv run --directory "$infra_dir" --locked pytest -q --no-cov tests/test_aws_integration.py
