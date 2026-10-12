#!/usr/bin/env bash
# Adds "Smith Chart" to the application menu (Pop!_OS COSMIC/GNOME, Ubuntu, Fedora, ...).
# The app is copied to ~/.local/share/browser-smith-chart, so this download folder can be
# deleted afterwards. Nothing is installed system-wide and no root access is needed.
set -euo pipefail
SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/browser-smith-chart"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$DEST" "$APPS"
cp -f "$SRC/BrowserSmithChart.html" "$DEST/BrowserSmithChart.html"
cp -f "$SRC/smith-chart.png" "$DEST/smith-chart.png"
cat > "$APPS/browser-smith-chart.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Version=1.0
Name=Smith Chart
GenericName=RF Smith Chart Workbench
Comment=Interactive Smith chart with matching synthesis (runs offline in your browser)
Exec=xdg-open "$DEST/BrowserSmithChart.html"
Icon=$DEST/smith-chart.png
Terminal=false
Categories=Science;Engineering;Education;
Keywords=smith;rf;impedance;matching;microwave;vswr;
DESKTOP
chmod 644 "$APPS/browser-smith-chart.desktop"
command -v update-desktop-database >/dev/null 2>&1 && update-desktop-database "$APPS" >/dev/null 2>&1 || true
echo "Installed. Open your app launcher (Super key) and search for \"Smith Chart\"."
echo "App files: $DEST"
