#!/usr/bin/env bash

set -euo pipefail

readonly SCRIPT_NAME="$(basename "$0")"
readonly DEFAULT_PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly SERVICE_NAME="legalbot-openwa.service"
readonly DEFAULT_UNIT_PATH="/etc/systemd/system/$SERVICE_NAME"
readonly DEFAULT_ENV_FILE="/etc/legalbot/legalbot.env"
readonly DEFAULT_SERVICE_USER="legalbot"
readonly DEFAULT_EXEC_START="/usr/bin/npm run smoke:openwa"

MODE=""
DRY_RUN=0
START_SERVICE=0
ENABLE_SERVICE=0
PROJECT_ROOT="$DEFAULT_PROJECT_ROOT"
UNIT_PATH="$DEFAULT_UNIT_PATH"
ENV_FILE_PATH="$DEFAULT_ENV_FILE"
SERVICE_USER="$DEFAULT_SERVICE_USER"
EXEC_START="$DEFAULT_EXEC_START"

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
  --project-root PATH   WorkingDirectory for the unit. Default: repo root.
  --env-file PATH       External env file path. Default: /etc/legalbot/legalbot.env
  --service-user USER   User for the unit. Default: legalbot
  --exec-start CMD      ExecStart command. Default: /usr/bin/npm run smoke:openwa
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
      --service-user)
        [[ $# -ge 2 ]] || fail "--service-user requires a value."
        SERVICE_USER="$2"
        shift 2
        ;;
      --exec-start)
        [[ $# -ge 2 ]] || fail "--exec-start requires a value."
        EXEC_START="$2"
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

validate_inputs() {
  if [[ "$PROJECT_ROOT" != /* ]]; then
    fail "--project-root must be an absolute path."
  fi

  if [[ ! -d "$PROJECT_ROOT" ]]; then
    fail "Project root does not exist: $PROJECT_ROOT"
  fi

  if [[ "$UNIT_PATH" != /* ]]; then
    fail "Unit path must be absolute."
  fi

  if [[ "$ENV_FILE_PATH" != /* ]]; then
    fail "--env-file must be an absolute path."
  fi

  if [[ -z "$SERVICE_USER" ]]; then
    fail "--service-user must not be empty."
  fi

  if [[ -z "$EXEC_START" ]]; then
    fail "--exec-start must not be empty."
  fi
}

print_unit_preview() {
  cat <<EOF
[Unit]
Description=LegalBot OpenWA Smoke Runtime
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
  log "Service name: $SERVICE_NAME"
  log "Project root: $PROJECT_ROOT"
  log "Environment file: $ENV_FILE_PATH"
  log "Service user: $SERVICE_USER"
  log "ExecStart: $EXEC_START"
  log "Unit path: $UNIT_PATH"
}

install_unit() {
  local tmp_unit

  if [[ ! -x /usr/bin/npm ]]; then
    warn "/usr/bin/npm was not found. The documented ExecStart expects Node/npm to be installed there."
  fi

  log "Recommended before service start: npm run ops:preflight"
  if [[ "$START_SERVICE" -eq 1 ]]; then
    log "Recommended after service start: npm run ops:post-start"
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
Description=LegalBot OpenWA Smoke Runtime
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
  log "Run 'npm run ops:preflight' before any manual start or restart."

  if [[ "$ENABLE_SERVICE" -eq 1 ]]; then
    run_cmd systemctl enable "$SERVICE_NAME"
  else
    log "Service was not enabled automatically."
  fi

  if [[ "$START_SERVICE" -eq 1 ]]; then
    run_cmd systemctl start "$SERVICE_NAME"
    log "Run 'npm run ops:post-start' after confirming the service is active."
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
