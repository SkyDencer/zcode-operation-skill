#!/usr/bin/env bash
# ZCode Skill Router — One-Command Install (Unix / macOS / WSL)
#
# Usage:
#   ./install.sh                # interactive
#   ./install.sh --yes          # skip confirmation
#   ./install.sh --dry-run      # show plan only
#
# Prerequisites: Node.js >= 20

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALL_SCRIPT="${SCRIPT_DIR}/scripts/install.mjs"

if [[ ! -f "$INSTALL_SCRIPT" ]]; then
    echo "Error: scripts/install.mjs not found at: $INSTALL_SCRIPT" >&2
    exit 1
fi

exec node "$INSTALL_SCRIPT" "$@"
