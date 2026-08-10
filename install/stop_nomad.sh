#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_PROJECT_NAME="watchman-command"
COMPOSE_FILE="${SCRIPT_DIR}/management_compose.yaml"
ENV_FILE="${SCRIPT_DIR}/.watchman-command.env"

if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose plugin not available. This script requires Docker Compose v2 (docker compose)."
  exit 1
fi

compose_args=(--project-name "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE")
if [[ -f "$ENV_FILE" ]]; then
  compose_args+=(--env-file "$ENV_FILE")
else
  export WATCHMAN_PROJECT_ROOT="$PROJECT_ROOT"
fi

echo "Finding running Watchman Command containers..."

compose_containers=$(docker compose "${compose_args[@]}" ps -q 2>/dev/null || true)

if [[ -n "$compose_containers" ]]; then
  echo "Stopping Watchman Command project containers..."
  docker compose "${compose_args[@]}" stop
fi

legacy_containers=$(docker ps --filter "name=^nomad_" --filter status=running --format "{{.Names}}" || true)
if [[ -n "$legacy_containers" ]]; then
  echo "Stopping legacy Project N.O.M.A.D. containers..."
  for container in $legacy_containers; do
    echo "Gracefully stopping container: $container"
    docker stop "$container" >/dev/null || true
  done
fi

if [[ -z "$compose_containers" && -z "$legacy_containers" ]]; then
  echo "No running Watchman Command containers found."
  exit 0
fi

echo "Finished stopping Watchman Command containers."
