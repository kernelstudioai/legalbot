#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly ENV_FILE="$PROJECT_ROOT/.env"
readonly DEFAULT_DATABASE_URL="file:./data/legalbot.sqlite"
readonly REQUIRED_DIRECTORIES=("data" "backups" "openwa-session" "logs")
readonly ENV_KEYS_REQUIRED=("LAWYER_PHONE_E164" "DATABASE_URL" "BUSINESS_PERSISTENCE_ENABLED" "DATABASE_MIGRATIONS_ENABLED")
readonly ENV_KEYS_WITH_DEFAULTS=(
  "NODE_ENV=production"
  "LOG_LEVEL=info"
  "BOT_MODE=smoke"
  "OPENWA_SESSION_ID=legalbot-smoke"
  "DATABASE_URL=file:./data/legalbot.sqlite"
  "DATABASE_MIGRATIONS_ENABLED=true"
  "BUSINESS_PERSISTENCE_ENABLED=true"
  "TECHNICAL_PERSISTENCE_ENABLED=true"
  "OPENWA_STATUS_SERVER_ENABLED=true"
  "OPENWA_STATUS_SERVER_HOST=127.0.0.1"
  "OPENWA_STATUS_SERVER_PORT=3001"
)

DRY_RUN=0
START_BOT=0
REVIEW_SYSTEMD=0
ENV_LOADED=0
BROWSER_PATH=""

usage() {
  cat <<'EOF'
Usage:
  ./install.sh --dry-run
  ./install.sh

Options:
  --dry-run  Print planned actions without changing files or running install commands.
  -h, --help Show this help.
EOF
}

log() {
  printf '[%s] %s\n' "$SCRIPT_NAME" "$*"
}

warn() {
  printf '[%s] WARNING: %s\n' "$SCRIPT_NAME" "$*" >&2
}

fail() {
  printf '[%s] ERROR: %s\n' "$SCRIPT_NAME" "$*" >&2
  exit 1
}

run_cmd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: $*"
    return 0
  fi

  "$@"
}

prompt_yes_no() {
  local prompt="$1"
  local default_answer="${2:-n}"
  local reply=""

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: prompt would ask: $prompt"
    return 1
  fi

  if [[ ! -t 0 ]]; then
    fail "Interactive input is required for: $prompt"
  fi

  while true; do
    if [[ "$default_answer" == "y" ]]; then
      read -r -p "$prompt [Y/n] " reply
      reply="${reply:-Y}"
    else
      read -r -p "$prompt [y/N] " reply
      reply="${reply:-N}"
    fi

    case "${reply,,}" in
      y|yes) return 0 ;;
      n|no) return 1 ;;
      *) warn "Please answer yes or no." ;;
    esac
  done
}

prompt_non_empty() {
  local prompt="$1"
  local value=""

  if [[ ! -t 0 ]]; then
    fail "Interactive input is required for: $prompt"
  fi

  while true; do
    read -r -p "$prompt: " value
    if [[ -n "$value" ]]; then
      printf '%s' "$value"
      return 0
    fi

    warn "A value is required."
  done
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run)
        DRY_RUN=1
        shift
        ;;
      -h|--help)
        usage
        exit 0
        ;;
      *)
        fail "Unknown argument: $1"
        ;;
    esac
  done
}

require_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    fail "This installer supports Linux hosts only."
  fi
}

require_node_22() {
  if ! command -v node >/dev/null 2>&1; then
    fail "Node.js 22 is required but 'node' was not found."
  fi

  local node_major
  node_major="$(node -p "process.versions.node.split('.')[0]")"
  if [[ "$node_major" != "22" ]]; then
    fail "Node.js 22 is required. Found major version: $node_major"
  fi

  log "Node.js 22 detected."
}

require_npm() {
  if ! command -v npm >/dev/null 2>&1; then
    fail "npm is required but was not found."
  fi

  log "npm detected."
}

detect_browser() {
  local candidates=(
    "${OPENWA_BROWSER_EXECUTABLE_PATH:-}"
    "$(command -v google-chrome-stable 2>/dev/null || true)"
    "$(command -v google-chrome 2>/dev/null || true)"
    "$(command -v chromium-browser 2>/dev/null || true)"
    "$(command -v chromium 2>/dev/null || true)"
    "/usr/bin/google-chrome"
    "/usr/bin/chromium-browser"
    "/usr/bin/chromium"
  )
  local candidate=""

  for candidate in "${candidates[@]}"; do
    if [[ -n "$candidate" && -x "$candidate" ]]; then
      BROWSER_PATH="$candidate"
      log "Browser detected at $BROWSER_PATH"
      return 0
    fi
  done

  warn "Chrome/Chromium was not detected."
  warn "Install Google Chrome or Chromium before starting the bot."
  warn "Examples: 'sudo apt-get install -y chromium-browser' or install the Google Chrome Linux package."
  return 1
}

check_project_writable() {
  local probe_file
  probe_file="$(mktemp "$PROJECT_ROOT/.install-write-test.XXXXXX")"
  rm -f "$probe_file"
  log "Project directory is writable."
}

ensure_runtime_directories() {
  local directory=""

  for directory in "${REQUIRED_DIRECTORIES[@]}"; do
    if [[ -d "$PROJECT_ROOT/$directory" ]]; then
      log "Directory already present: $directory/"
      continue
    fi

    if [[ "$DRY_RUN" -eq 1 ]]; then
      log "DRY-RUN: would create directory $directory/"
      continue
    fi

    mkdir -p "$PROJECT_ROOT/$directory"
    log "Directory prepared: $directory/"
  done
}

env_key_exists() {
  local key="$1"
  [[ -f "$ENV_FILE" ]] && grep -Eq "^[[:space:]]*${key}=" "$ENV_FILE"
}

env_key_has_exact_value() {
  local key="$1"
  local expected_value="$2"
  [[ -f "$ENV_FILE" ]] && grep -Eq "^[[:space:]]*${key}=${expected_value}[[:space:]]*$" "$ENV_FILE"
}

create_env_file() {
  local lawyer_phone="$1"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: would create .env with guided defaults and a prompted LAWYER_PHONE_E164 value."
    return 0
  fi

  umask 077
  cat >"$ENV_FILE" <<EOF
# Generated by ./install.sh for single-bot VPS setup.
LAWYER_PHONE_E164=$lawyer_phone
NODE_ENV=production
LOG_LEVEL=info
BOT_MODE=smoke
OPENWA_SESSION_ID=legalbot-smoke
DATABASE_URL=$DEFAULT_DATABASE_URL
DATABASE_MIGRATIONS_ENABLED=true
BUSINESS_PERSISTENCE_ENABLED=true
TECHNICAL_PERSISTENCE_ENABLED=true
OPENWA_STATUS_SERVER_ENABLED=true
OPENWA_STATUS_SERVER_HOST=127.0.0.1
OPENWA_STATUS_SERVER_PORT=3001
EOF
  log "Created .env with guided defaults."
}

append_missing_env_defaults() {
  local missing_keys=("$@")
  local entry=""
  local key=""

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: would append missing non-secret .env keys: ${missing_keys[*]}"
    return 0
  fi

  {
    printf '\n# Added by ./install.sh\n'
    for entry in "${ENV_KEYS_WITH_DEFAULTS[@]}"; do
      key="${entry%%=*}"
      if printf '%s\n' "${missing_keys[@]}" | grep -Fxq "$key"; then
        printf '%s\n' "$entry"
      fi
    done
  } >>"$ENV_FILE"

  log "Appended missing non-secret .env defaults."
}

ensure_env_file() {
  local missing_keys=()
  local key=""
  local lawyer_phone=""

  if [[ ! -f "$ENV_FILE" ]]; then
    log ".env is missing."
    if [[ "$DRY_RUN" -eq 1 ]]; then
      create_env_file "+15551234567"
      return 0
    fi

    lawyer_phone="$(prompt_non_empty "Enter LAWYER_PHONE_E164 in +15551234567 format")"
    create_env_file "$lawyer_phone"
    return 0
  fi

  log ".env exists. The installer will not display its contents."
  for key in "${ENV_KEYS_REQUIRED[@]}"; do
    if ! env_key_exists "$key"; then
      missing_keys+=("$key")
    fi
  done

  if [[ "${#missing_keys[@]}" -eq 0 ]]; then
    log ".env already contains the required keys."
    return 0
  fi

  warn ".env is missing required keys: ${missing_keys[*]}"

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: would ask before modifying .env."
    return 0
  fi

  if ! prompt_yes_no "Append safe non-secret defaults to .env for the missing keys?" "n"; then
    fail "Required .env keys are missing. Re-run after updating .env or allow the installer to append safe defaults."
  fi

  if printf '%s\n' "${missing_keys[@]}" | grep -Fxq "LAWYER_PHONE_E164"; then
    local remaining_keys=()
    lawyer_phone="$(prompt_non_empty "Enter LAWYER_PHONE_E164 in +15551234567 format")"
    printf '\n# Added by ./install.sh\nLAWYER_PHONE_E164=%s\n' "$lawyer_phone" >>"$ENV_FILE"
    for key in "${missing_keys[@]}"; do
      if [[ "$key" != "LAWYER_PHONE_E164" ]]; then
        remaining_keys+=("$key")
      fi
    done
    missing_keys=("${remaining_keys[@]}")
  fi

  if [[ "${#missing_keys[@]}" -gt 0 ]]; then
    append_missing_env_defaults "${missing_keys[@]}"
  fi
}

load_env_file() {
  if [[ "$ENV_LOADED" -eq 1 ]]; then
    return 0
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    ENV_LOADED=1
    return 0
  fi

  if [[ ! -f "$ENV_FILE" ]]; then
    fail ".env is required before running install commands."
  fi

  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
  ENV_LOADED=1
}

assert_runtime_env() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    if [[ ! -f "$ENV_FILE" ]]; then
      log "DRY-RUN: .env is currently missing and would be generated through prompts."
      return 0
    fi

    if ! env_key_exists "DATABASE_URL"; then
      warn "DRY-RUN: DATABASE_URL is currently missing from .env."
    fi

    if ! env_key_has_exact_value "BUSINESS_PERSISTENCE_ENABLED" "true"; then
      warn "DRY-RUN: BUSINESS_PERSISTENCE_ENABLED is not explicitly set to true in .env."
    fi

    if ! env_key_has_exact_value "DATABASE_MIGRATIONS_ENABLED" "true"; then
      warn "DRY-RUN: DATABASE_MIGRATIONS_ENABLED is not explicitly set to true in .env."
    fi

    log "DRY-RUN: runtime env policy check completed without reading secret values into output."
    return 0
  fi

  load_env_file

  local database_url="${DATABASE_URL:-}"
  local business_persistence_enabled="${BUSINESS_PERSISTENCE_ENABLED:-}"
  local database_migrations_enabled="${DATABASE_MIGRATIONS_ENABLED:-}"

  if [[ -z "$database_url" ]]; then
    fail "DATABASE_URL must be configured before continuing."
  fi

  if [[ "$business_persistence_enabled" != "true" ]]; then
    fail "BUSINESS_PERSISTENCE_ENABLED must be set to true."
  fi

  if [[ "$database_migrations_enabled" != "true" ]]; then
    fail "DATABASE_MIGRATIONS_ENABLED must be set to true."
  fi

  log "Required runtime env policy is configured."
}

run_npm_ci() {
  load_env_file
  run_cmd npm ci --include=dev
}

run_db_migrate() {
  load_env_file
  run_cmd npm run db:migrate
}

run_ops_preflight() {
  load_env_file
  run_cmd npm run ops:preflight
}

ask_to_start_bot() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: would ask whether to start the bot manually."
    return 0
  fi

  if prompt_yes_no "Start the bot now with 'npm run smoke:openwa'?" "n"; then
    START_BOT=1
  fi
}

ask_to_review_systemd() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: would ask whether to preview optional systemd provisioning."
    return 0
  fi

  if prompt_yes_no "Preview the optional systemd provisioning helper with './scripts/provision-systemd.sh --dry-run'?" "n"; then
    REVIEW_SYSTEMD=1
  fi
}

preview_systemd_if_approved() {
  if [[ "$REVIEW_SYSTEMD" -ne 1 ]]; then
    log "Optional systemd provisioning was not previewed."
    return 0
  fi

  run_cmd "$PROJECT_ROOT/scripts/provision-systemd.sh" --dry-run --project-root "$PROJECT_ROOT"
}

start_bot_if_approved() {
  if [[ "$START_BOT" -ne 1 ]]; then
    log "Bot was not started automatically."
    return 0
  fi

  load_env_file
  exec npm run smoke:openwa
}

print_summary() {
  log "Installer complete."
  log "Systemd service installation stays explicit and separate from this installer."
  log "Use ./scripts/provision-systemd.sh for dry-run, install, uninstall, or status checks."
  log "Use docs/VPS_SYSTEMD_RUNBOOK.md for the documented unit and post-install workflow."
}

main() {
  parse_args "$@"
  cd "$PROJECT_ROOT"

  require_linux
  require_node_22
  require_npm
  detect_browser || true
  check_project_writable
  ensure_runtime_directories
  ensure_env_file
  assert_runtime_env
  run_npm_ci
  run_db_migrate
  run_ops_preflight
  ask_to_start_bot
  ask_to_review_systemd
  print_summary
  preview_systemd_if_approved
  start_bot_if_approved
}

main "$@"
