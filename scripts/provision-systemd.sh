#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly DEFAULT_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEFAULT_ENV_FILE_FALLBACK="/etc/legalbot/legalbot.env"

MODE=""
DRY_RUN=0
START_SERVICE=0
ENABLE_SERVICE=0
TRANSPORT="openwa"
PROJECT_ROOT="$DEFAULT_PROJECT_ROOT"
UNIT_PATH=""
ENV_FILE_PATH=""
SERVICE_USER=""
SERVICE_NAME=""
NPM_PATH="${LEGALBOT_NPM_PATH:-}"
EXEC_SCRIPT=""
EXEC_START=""
UNIT_DESCRIPTION=""

usage() {
  cat <<'EOF'
Usage:
  ./scripts/provision-systemd.sh --dry-run [options]
  ./scripts/provision-systemd.sh --install [options]
  ./scripts/provision-systemd.sh --uninstall [options]
  ./scripts/provision-systemd.sh --status [options]

Required mode:
  --dry-run    Print the planned unit configuration without changing system files.
  --install    Install or refresh the documented single-bot unit file.
  --uninstall  Remove the installed unit file if present.
  --status     Show whether the unit file exists and whether systemd knows the service.

Options:
  --transport MODE      Runtime transport. Supported: openwa, cloud. Default: openwa
  --project-root PATH   WorkingDirectory for the unit. Default: repo root.
  --env-file PATH       Environment file path. Default: project .env when present, else /etc/legalbot/legalbot.env
  --user USER           User for the unit. Default: current non-root operator user
  --service-user USER   Alias for --user.
  --service-name NAME   systemd unit filename. Defaults: legalbot-openwa.service or legalbot-whatsapp-cloud.service
  --exec-script NAME    npm script for ExecStart. Defaults: smoke:openwa or start:whatsapp-cloud
  --npm-path PATH       Absolute npm path for ExecStart. Default: LEGALBOT_NPM_PATH or command -v npm
  --start               With --install only, start the service after install.
  --enable              With --install only, enable the service after install.
  -h, --help            Show this help.
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

current_operator_user() {
  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" ]]; then
    printf '%s\n' "$SUDO_USER"
    return 0
  fi

  id -un
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --dry-run|--install|--uninstall|--status)
        if [[ -n "$MODE" ]]; then
          fail "Choose exactly one mode."
        fi
        MODE="$1"
        if [[ "$1" == "--dry-run" ]]; then
          DRY_RUN=1
        fi
        shift
        ;;
      --transport)
        [[ $# -ge 2 ]] || fail "--transport requires a value."
        TRANSPORT="$2"
        shift 2
        ;;
      --project-root)
        [[ $# -ge 2 ]] || fail "--project-root requires a value."
        PROJECT_ROOT="$2"
        shift 2
        ;;
      --env-file)
        [[ $# -ge 2 ]] || fail "--env-file requires a value."
        ENV_FILE_PATH="$2"
        shift 2
        ;;
      --user|--service-user)
        [[ $# -ge 2 ]] || fail "$1 requires a value."
        SERVICE_USER="$2"
        shift 2
        ;;
      --service-name)
        [[ $# -ge 2 ]] || fail "--service-name requires a value."
        SERVICE_NAME="$2"
        shift 2
        ;;
      --exec-script)
        [[ $# -ge 2 ]] || fail "--exec-script requires a value."
        EXEC_SCRIPT="$2"
        shift 2
        ;;
      --npm-path)
        [[ $# -ge 2 ]] || fail "--npm-path requires a value."
        NPM_PATH="$2"
        shift 2
        ;;
      --start)
        START_SERVICE=1
        shift
        ;;
      --enable)
        ENABLE_SERVICE=1
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

  if [[ -z "$MODE" ]]; then
    fail "A mode is required. Use --dry-run, --install, --uninstall, or --status."
  fi

  if [[ "$MODE" != "--install" ]] && ([[ "$START_SERVICE" -eq 1 ]] || [[ "$ENABLE_SERVICE" -eq 1 ]]); then
    fail "--start and --enable are supported only with --install."
  fi
}

require_linux() {
  if [[ "$(uname -s)" != "Linux" ]]; then
    fail "This systemd provisioner supports Linux hosts only."
  fi
}

require_systemctl() {
  if ! command -v systemctl >/dev/null 2>&1; then
    fail "systemctl is required on the target host."
  fi
}

require_root_for_mutation() {
  if [[ "$MODE" == "--install" || "$MODE" == "--uninstall" ]]; then
    if [[ "$(id -u)" -ne 0 ]]; then
      fail "Root privileges are required for $MODE because $UNIT_PATH lives under /etc/systemd/system."
    fi
  fi
}

resolve_transport_defaults() {
  case "$TRANSPORT" in
    openwa)
      UNIT_DESCRIPTION="LegalBot OpenWA Smoke Runtime (legacy/dev-only)"
      if [[ -z "$SERVICE_NAME" ]]; then
        SERVICE_NAME="legalbot-openwa.service"
      fi
      if [[ -z "$EXEC_SCRIPT" ]]; then
        EXEC_SCRIPT="smoke:openwa"
      fi
      ;;
    cloud)
      UNIT_DESCRIPTION="LegalBot WhatsApp Cloud Runtime"
      if [[ -z "$SERVICE_NAME" ]]; then
        SERVICE_NAME="legalbot-whatsapp-cloud.service"
      fi
      if [[ -z "$EXEC_SCRIPT" ]]; then
        EXEC_SCRIPT="start:whatsapp-cloud"
      fi
      ;;
    *)
      fail "--transport must be either 'openwa' or 'cloud'."
      ;;
  esac

  UNIT_PATH="/etc/systemd/system/$SERVICE_NAME"
}

resolve_env_file_path() {
  if [[ -n "$ENV_FILE_PATH" ]]; then
    return 0
  fi

  if [[ -f "$PROJECT_ROOT/.env" ]]; then
    ENV_FILE_PATH="$PROJECT_ROOT/.env"
    return 0
  fi

  ENV_FILE_PATH="$DEFAULT_ENV_FILE_FALLBACK"
}

resolve_service_user() {
  if [[ -n "$SERVICE_USER" ]]; then
    return 0
  fi

  SERVICE_USER="$(current_operator_user)"
}

discover_npm_path() {
  local discovered_path=""

  if [[ -n "${SUDO_USER:-}" && "${SUDO_USER}" != "root" && "$(id -u)" -eq 0 ]]; then
    discovered_path="$(su - "$SUDO_USER" -c 'command -v npm' 2>/dev/null || true)"
  fi

  if [[ -z "$discovered_path" ]]; then
    discovered_path="$(command -v npm 2>/dev/null || true)"
  fi

  printf '%s\n' "$discovered_path"
}

resolve_npm_path() {
  if [[ -z "$NPM_PATH" ]]; then
    local discovered_path=""
    discovered_path="$(discover_npm_path)"
    if [[ -z "$discovered_path" ]]; then
      fail "npm was not found. Install Node.js 22 and npm before provisioning systemd."
    fi
    NPM_PATH="$discovered_path"
  fi

  if [[ "$NPM_PATH" != /* ]]; then
    fail "--npm-path must be an absolute path. Found: $NPM_PATH"
  fi

  if [[ ! -e "$NPM_PATH" ]]; then
    fail "Selected npm path does not exist: $NPM_PATH"
  fi

  if [[ ! -x "$NPM_PATH" ]]; then
    fail "Selected npm path is not executable: $NPM_PATH"
  fi

  EXEC_START="$NPM_PATH run $EXEC_SCRIPT"
}

validate_inputs() {
  if [[ "$PROJECT_ROOT" != /* ]]; then
    fail "--project-root must be an absolute path."
  fi

  if [[ ! -d "$PROJECT_ROOT" ]]; then
    fail "Project root does not exist: $PROJECT_ROOT"
  fi

  if [[ "$ENV_FILE_PATH" != /* ]]; then
    fail "--env-file must be an absolute path."
  fi

  if [[ -z "$SERVICE_USER" ]]; then
    fail "--user must not be empty."
  fi

  if [[ -z "$SERVICE_NAME" ]]; then
    fail "--service-name must not be empty."
  fi

  if [[ -z "$EXEC_SCRIPT" ]]; then
    fail "--exec-script must not be empty."
  fi

  if [[ -z "$NPM_PATH" ]]; then
    fail "npm path resolution failed."
  fi

  if [[ -z "$EXEC_START" ]]; then
    fail "ExecStart resolution failed."
  fi
}

print_unit_preview() {
  cat <<EOF
[Unit]
Description=$UNIT_DESCRIPTION
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$PROJECT_ROOT
EnvironmentFile=$ENV_FILE_PATH
ExecStart=$EXEC_START
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
}

print_mode_summary() {
  log "Transport: $TRANSPORT"
  log "Service name: $SERVICE_NAME"
  log "Project root: $PROJECT_ROOT"
  log "Environment file: $ENV_FILE_PATH"
  log "Service user: $SERVICE_USER"
  log "ExecScript: $EXEC_SCRIPT"
  log "ExecStart: $EXEC_START"
  log "Unit path: $UNIT_PATH"
}

recommended_preflight_command() {
  if [[ "$TRANSPORT" == "cloud" ]]; then
    printf '%s\n' "npm run ops:preflight:cloud"
    return 0
  fi

  printf '%s\n' "npm run ops:preflight"
}

recommended_post_start_command() {
  if [[ "$TRANSPORT" == "cloud" ]]; then
    printf '%s\n' "npm run ops:post-start:cloud"
    return 0
  fi

  printf '%s\n' "npm run ops:post-start"
}

install_unit() {
  local tmp_unit
  local preflight_command
  local post_start_command

  preflight_command="$(recommended_preflight_command)"
  post_start_command="$(recommended_post_start_command)"

  if [[ ! -f "$ENV_FILE_PATH" ]]; then
    warn "Environment file not found yet: $ENV_FILE_PATH"
    warn "Install will still write the unit, but manual start will fail until the env file exists."
  fi

  log "Recommended before service start: $preflight_command"
  if [[ "$START_SERVICE" -eq 1 ]]; then
    log "Recommended after service start: $post_start_command"
  fi

  if [[ "$DRY_RUN" -eq 1 ]]; then
    log "DRY-RUN: would install the following unit file:"
    print_unit_preview
    if [[ "$ENABLE_SERVICE" -eq 0 ]]; then
      log "DRY-RUN: service would remain disabled by default."
    fi
    if [[ "$START_SERVICE" -eq 0 ]]; then
      log "DRY-RUN: service would remain stopped by default."
    fi
    return 0
  fi

  tmp_unit="$(mktemp)"
  cat >"$tmp_unit" <<EOF
[Unit]
Description=$UNIT_DESCRIPTION
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$PROJECT_ROOT
EnvironmentFile=$ENV_FILE_PATH
ExecStart=$EXEC_START
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

  install -d -m 0755 "$(dirname "$UNIT_PATH")"
  install -m 0644 "$tmp_unit" "$UNIT_PATH"
  rm -f "$tmp_unit"

  run_cmd systemctl daemon-reload
  log "Installed unit file at $UNIT_PATH"
  log "Run '$preflight_command' before any manual start or restart."

  if [[ "$ENABLE_SERVICE" -eq 1 ]]; then
    run_cmd systemctl enable "$SERVICE_NAME"
  else
    log "Service was not enabled automatically."
  fi

  if [[ "$START_SERVICE" -eq 1 ]]; then
    run_cmd systemctl start "$SERVICE_NAME"
    log "Run '$post_start_command' after confirming the service is active."
  else
    log "Service was not started automatically."
  fi
}

uninstall_unit() {
  if [[ "$DRY_RUN" -eq 1 ]]; then
    if [[ -f "$UNIT_PATH" ]]; then
      log "DRY-RUN: would remove unit file at $UNIT_PATH"
    else
      log "DRY-RUN: unit file is already absent at $UNIT_PATH"
    fi
    log "DRY-RUN: no runtime data, backups, sessions, databases, or logs would be removed."
    return 0
  fi

  if [[ -f "$UNIT_PATH" ]]; then
    rm -f "$UNIT_PATH"
    log "Removed unit file at $UNIT_PATH"
  else
    log "Unit file already absent at $UNIT_PATH"
  fi

  run_cmd systemctl daemon-reload
  log "Service data directories and env files were left untouched."
}

status_unit() {
  if [[ -f "$UNIT_PATH" ]]; then
    log "Unit file present: $UNIT_PATH"
  else
    log "Unit file not present: $UNIT_PATH"
  fi

  if systemctl list-unit-files "$SERVICE_NAME" >/dev/null 2>&1; then
    systemctl status "$SERVICE_NAME" --no-pager || true
  else
    log "systemd does not currently list $SERVICE_NAME"
  fi
}

main() {
  parse_args "$@"
  require_linux
  require_systemctl
  resolve_transport_defaults
  resolve_env_file_path
  resolve_service_user
  resolve_npm_path
  validate_inputs
  require_root_for_mutation
  print_mode_summary

  case "$MODE" in
    --dry-run)
      install_unit
      ;;
    --install)
      install_unit
      ;;
    --uninstall)
      uninstall_unit
      ;;
    --status)
      status_unit
      ;;
    *)
      fail "Unhandled mode: $MODE"
      ;;
  esac
}

main "$@"
