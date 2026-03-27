#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ASSET_DIR="$SCRIPT_DIR/../asset"
NOTIFIERS_DIR="$ASSET_DIR/notifiers"
SOURCE_NOTIFIER="$SCRIPT_DIR/../bin/terminal-notifier.app"

echo "Creating notifier bundles..."

rm -rf "$NOTIFIERS_DIR"
mkdir -p "$NOTIFIERS_DIR"

create_notifier() {
    local agent="$1"
    local bundle_id="$2"
    local agent_display_name="$3"
    local app_dir="$NOTIFIERS_DIR/${agent}.app"
    
    echo "Creating $agent.app..."
    
    cp -R "$SOURCE_NOTIFIER" "$app_dir"
    
    if [ -f "$ASSET_DIR/${agent}.png" ]; then
        ICONSET_DIR=$(mktemp -d)/AppIcon.iconset
        mkdir -p "$ICONSET_DIR"
        
        PNG="$ASSET_DIR/${agent}.png"
        sips -z 16 16     "$PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null 2>&1
        sips -z 32 32     "$PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null 2>&1
        sips -z 32 32     "$PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null 2>&1
        sips -z 64 64     "$PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null 2>&1
        sips -z 128 128   "$PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null 2>&1
        sips -z 256 256   "$PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null 2>&1
        sips -z 256 256   "$PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null 2>&1
        sips -z 512 512   "$PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null 2>&1
        sips -z 512 512   "$PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null 2>&1
        sips -z 1024 1024 "$PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null 2>&1
        
        iconutil -c icns "$ICONSET_DIR" -o "$app_dir/Contents/Resources/AppIcon.icns" 2>/dev/null
        rm -rf "$ICONSET_DIR"
    fi
    
    cat > "$app_dir/Contents/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleIdentifier</key>
    <string>${bundle_id}</string>
    <key>CFBundleExecutable</key>
    <string>terminal-notifier</string>
    <key>CFBundleIconFile</key>
    <string>AppIcon</string>
    <key>CFBundleName</key>
    <string>${agent_display_name} Notifier</string>
    <key>CFBundleDisplayName</key>
    <string>${agent_display_name} Notifier</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>CFBundleVersion</key>
    <string>1.0.0</string>
    <key>CFBundleShortVersionString</key>
    <string>1.0.0</string>
    <key>NSPrincipalClass</key>
    <string>NSApplication</string>
    <key>NSMainNibFile</key>
    <string>MainMenu</string>
    <key>LSUIElement</key>
    <true/>
    <key>LSMinimumSystemVersion</key>
    <string>10.10</string>
</dict>
</plist>
EOF
}

create_notifier "build" "com.opencode.notifier.build" "Build"
create_notifier "plan" "com.opencode.notifier.plan" "Plan"
create_notifier "explore" "com.opencode.notifier.explore" "Explore"
create_notifier "general" "com.opencode.notifier.general" "General"
create_notifier "research" "com.opencode.notifier.research" "Research"

echo "All notifier bundles created!"
