#!/usr/bin/env bash

set -euo pipefail

WATCHMAN_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT_NAME="$(basename "${BASH_SOURCE[0]}")"
COMPOSE_FILE="$WATCHMAN_PROJECT_ROOT/install/management_compose.yaml"
ENV_FILE="$WATCHMAN_PROJECT_ROOT/install/.watchman-command.env"
COMPOSE_PROJECT_NAME="watchman-command"
WATCHMAN_IMAGE="watchman-command-admin:local"
WATCHMAN_HOST_PATH="${WATCHMAN_PROJECT_ROOT}/storage"
WATCHMAN_URL="http://127.0.0.1:8080"
HEALTH_ENDPOINT="${WATCHMAN_URL}/api/health"
STARTUP_TIMEOUT_SECONDS=240
POLL_INTERVAL_SECONDS=2

APP_KEY_LENGTH=64

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1"
    exit 1
  fi
}

generate_secret() {
  local length="$1"
  local charset='A-Za-z0-9'
  # shellcheck disable=SC2001
  tr -dc "$charset" < /dev/urandom | head -c "$length"
  echo
}

load_env_value() {
  local key="$1"
  local fallback="${2:-}"
  local value="$fallback"
  if [[ -f "$ENV_FILE" ]]; then
    local line
    line="$(grep -m1 -E "^${key}=" "$ENV_FILE" || true)"
    if [[ -n "$line" ]]; then
      value="${line#*=}"
    fi
  fi
  printf '%s' "$value"
}

ensure_config_file() {
  local watchman_app_key
  local watchman_db_password
  local watchman_db_root_password

  watchman_app_key="$(load_env_value WATCHMAN_APP_KEY '')"
  watchman_db_password="$(load_env_value WATCHMAN_DB_PASSWORD '')"
  watchman_db_root_password="$(load_env_value WATCHMAN_DB_ROOT_PASSWORD '')"

  if [[ -z "$watchman_app_key" ]]; then
    watchman_app_key="$(generate_secret "$APP_KEY_LENGTH")"
  fi

  if [[ -z "$watchman_db_password" ]]; then
    watchman_db_password="$(generate_secret 32)"
  fi

  if [[ -z "$watchman_db_root_password" ]]; then
    watchman_db_root_password="$(generate_secret 32)"
  fi

  cat > "$ENV_FILE" <<EOF
WATCHMAN_PROJECT_ROOT=${WATCHMAN_PROJECT_ROOT}
WATCHMAN_STORAGE_DIR=${WATCHMAN_HOST_PATH}
WATCHMAN_URL=${WATCHMAN_URL}
WATCHMAN_APP_KEY=${watchman_app_key}
WATCHMAN_DB_PASSWORD=${watchman_db_password}
WATCHMAN_DB_ROOT_PASSWORD=${watchman_db_root_password}
EOF
}

ensure_directories() {
  mkdir -p "${WATCHMAN_HOST_PATH}/logs"
  mkdir -p "${WATCHMAN_HOST_PATH}/downloads"
  mkdir -p "${WATCHMAN_HOST_PATH}/zim"
  mkdir -p "${WATCHMAN_HOST_PATH}/qdrant"
  mkdir -p "${WATCHMAN_HOST_PATH}/ollama"
}

wait_for_ready() {
  echo "Waiting for Watchman Command to report healthy on ${HEALTH_ENDPOINT} ..."
  local deadline=$((SECONDS + STARTUP_TIMEOUT_SECONDS))
  while ((SECONDS < deadline)); do
    if curl -fsS "$HEALTH_ENDPOINT" >/dev/null 2>&1; then
      echo "Watchman Command health endpoint is healthy."
      return 0
    fi
    sleep "$POLL_INTERVAL_SECONDS"
  done
  echo "ERROR: Watchman Command did not become healthy within ${STARTUP_TIMEOUT_SECONDS}s."
  echo "Check admin container logs with:"
  echo "  docker compose -p ${COMPOSE_PROJECT_NAME} -f ${COMPOSE_FILE} logs -f admin"
  echo "Check container logs with:"
  echo "  docker compose -p ${COMPOSE_PROJECT_NAME} -f ${COMPOSE_FILE} logs -f"
  return 1
}

main() {
  echo "[${SCRIPT_NAME}] Starting Watchman Command from ${WATCHMAN_PROJECT_ROOT}"

  require_command docker
  require_command docker-compose || true
  # shellcheck disable=SC2230
  if ! docker compose version >/dev/null 2>&1; then
    echo "Docker Compose plugin not available. This script requires Docker Compose v2 (docker compose)."
    exit 1
  fi

  if [[ ! -f "$COMPOSE_FILE" ]]; then
    echo "Expected compose file not found: $COMPOSE_FILE"
    exit 1
  fi

  ensure_config_file
  ensure_directories

  if [[ ! -f "$ENV_FILE" ]]; then
    echo "Config file not created at $ENV_FILE"
    exit 1
  fi

  # Build only if needed and start without duplicating containers.
  echo "Building and starting Watchman Command containers..."
  docker compose \
    --project-name "$COMPOSE_PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    up -d --build

  echo "Verifying admin image ${WATCHMAN_IMAGE} exists."
  docker image inspect "$WATCHMAN_IMAGE" >/dev/null 2>&1 || {
    echo "Admin image not available after compose start."
    exit 1
  }

  if ! wait_for_ready; then
    exit 1
  fi

  echo "Started containers:"
  docker compose --project-name "$COMPOSE_PROJECT_NAME" -f "$COMPOSE_FILE" ps

  echo "Watchman Command ready at ${WATCHMAN_URL} and can be opened in browser."
}

main "$@"
