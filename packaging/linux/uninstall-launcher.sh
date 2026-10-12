#!/usr/bin/env bash
# Removes the menu entry and the copied app. Saved projects live in your browser's
# storage for this file and are not touched.
set -euo pipefail
DATA="${XDG_DATA_HOME:-$HOME/.local/share}"
rm -f "$DATA/applications/browser-smith-chart.desktop"
rm -rf "$DATA/browser-smith-chart"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$DATA/applications" >/dev/null 2>&1 || true
echo "Smith Chart launcher removed."
