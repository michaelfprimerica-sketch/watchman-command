#!/usr/bin/env bash

set -euo pipefail

COMPOSE_PROJECT_NAME="watchman-command"
COMPOSE_FILE="/home/user/Development/watchman-command/install/management_compose.yaml"

echo "Finding running Watchman Command containers..."

compose_containers=$(docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps -q 2>/dev/null || true)

if [[ -n "$compose_containers" ]]; then
  echo "Stopping Watchman Command project containers..."
  docker compose -p "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" stop
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
