#!/bin/bash
set -e

echo "Building plugin..."
bun run build

echo "Creating notifier bundles..."
chmod +x scripts/create-notifiers.sh
./scripts/create-notifiers.sh

PLUGINS_DIR="$HOME/.config/opencode/plugins"
BIN_DIR="$PLUGINS_DIR/bin"

echo "Installing to $PLUGINS_DIR/opencode-plugin-alarm.js..."
mkdir -p "$PLUGINS_DIR"
cp dist/index.js "$PLUGINS_DIR/opencode-plugin-alarm.js"

echo "Installing assets..."
cp -r asset "$PLUGINS_DIR/"

echo "Installing terminal-notifier..."
mkdir -p "$BIN_DIR"
cp -r bin/terminal-notifier.app "$BIN_DIR/"

echo "Done!"
