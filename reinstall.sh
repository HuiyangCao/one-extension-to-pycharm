#!/bin/bash
set -e
cd "$(dirname "$0")"

USER_CONFIG_DIR="$HOME/.config/trainning_extension"
JETBRAINS_FLAG_FILE="$USER_CONFIG_DIR/jetbrains_mode_enabled"

echo ""
read -r -p "启用 JetBrains 操作方式设定（键位与界面偏好）? [Y/n] " jetbrains_choice
case "$jetbrains_choice" in
    [nN]) JETBRAINS_MODE_ENABLED=0 ;;
    *)    JETBRAINS_MODE_ENABLED=1 ;;
esac
mkdir -p "$USER_CONFIG_DIR"
echo "$JETBRAINS_MODE_ENABLED" > "$JETBRAINS_FLAG_FILE"

npm run compile
NAME=$(node -p "require('./package.json').name")
VERSION=$(node -p "require('./package.json').version")
PUBLISHER=$(node -p "require('./package.json').publisher")
VSIX="${NAME}-${VERSION}.vsix"
OLD_VSIX="copy-with-ref-${VERSION}.vsix"
if [ -f "$OLD_VSIX" ]; then rm -f "$OLD_VSIX"; fi
vsce package --no-dependencies

if command -v code &>/dev/null; then
    code --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
    code --uninstall-extension "${PUBLISHER}.${NAME}" 2>/dev/null || true
    code --install-extension "$VSIX"
fi

if command -v cursor &>/dev/null; then
    cursor --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
    cursor --uninstall-extension "${PUBLISHER}.${NAME}" 2>/dev/null || true
    cursor --install-extension "$VSIX" 2>/dev/null || true
fi

echo "Done. Reload window to take effect."
