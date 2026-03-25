#!/bin/bash
set -e

echo "Building plugin..."
bun run build

echo "Installing to ~/.config/opencode/plugins/alarm.js..."
cp dist/index.js ~/.config/opencode/plugins/alarm.js

echo "Done!"
