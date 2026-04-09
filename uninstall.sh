#!/bin/bash
set -e
cd "$(dirname "$0")"

# ---------- 彩色输出 ----------

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

info()    { echo -e "${BLUE}[INFO]${NC} $*"; }
success() { echo -e "${GREEN}[OK]${NC} $*"; }
warn()    { echo -e "${YELLOW}[WARN]${NC} $*"; }
error()   { echo -e "${RED}[ERROR]${NC} $*"; }

confirm() {
    local reason="$1"
    local cmd="$2"
    echo ""
    info "$reason"
    echo -e "  ${CYAN}\$ ${cmd}${NC}"
    read -r -p "$(echo -e "${YELLOW}执行? [Y/n] ${NC}")" choice
    case "$choice" in
        [nN]) warn "已跳过"; return 1 ;;
        *)    return 0 ;;
    esac
}

# ---------- 读取扩展信息 ----------

PUBLISHER=$(node -p "require('./package.json').publisher" 2>/dev/null || echo "user")
EXT_ID="${PUBLISHER}.Trainning-Extension"
EXT_ID_OLD="${PUBLISHER}.copy-with-ref"

info "准备卸载扩展: ${EXT_ID}"

# ---------- 回退 settings / keybindings ----------

if confirm "回退扩展写入的 settings 和 keybindings 配置" "python3 other_files/uninstall_config.py"; then
    if python3 "$(dirname "$0")/other_files/uninstall_config.py"; then
        success "配置回退完成"
    else
        error "配置回退失败"
    fi
fi

# ---------- 卸载编辑器扩展 ----------

DARCULA_EXT="Anan.jetbrains-darcula-theme"

if command -v code &>/dev/null; then
    if confirm "从 VS Code 卸载扩展" "code --uninstall-extension ${EXT_ID}"; then
        code --uninstall-extension "$EXT_ID_OLD" 2>/dev/null || true
        if code --uninstall-extension "$EXT_ID" 2>/dev/null; then
            success "已从 VS Code 卸载"
        else
            warn "VS Code 中未安装此扩展或卸载失败"
        fi
    fi
    if code --list-extensions 2>/dev/null | grep -qi "jetbrains.*darcula"; then
        if confirm "从 VS Code 卸载 JetBrains Darcula 主题" "code --uninstall-extension ${DARCULA_EXT}"; then
            if code --uninstall-extension "$DARCULA_EXT" 2>/dev/null; then
                success "Darcula 主题已从 VS Code 卸载"
            else
                warn "Darcula 主题卸载失败"
            fi
        fi
    fi
else
    warn "未检测到 'code' CLI，跳过 VS Code"
fi

if command -v cursor &>/dev/null; then
    if confirm "从 Cursor 卸载扩展" "cursor --uninstall-extension ${EXT_ID}"; then
        cursor --uninstall-extension "$EXT_ID_OLD" 2>/dev/null || true
        if cursor --uninstall-extension "$EXT_ID" 2>/dev/null; then
            success "已从 Cursor 卸载"
        else
            warn "Cursor 中未安装此扩展或卸载失败"
        fi
    fi
    if cursor --list-extensions 2>/dev/null | grep -qi "jetbrains.*darcula"; then
        if confirm "从 Cursor 卸载 JetBrains Darcula 主题" "cursor --uninstall-extension ${DARCULA_EXT}"; then
            if cursor --uninstall-extension "$DARCULA_EXT" 2>/dev/null; then
                success "Darcula 主题已从 Cursor 卸载"
            else
                warn "Darcula 主题卸载失败"
            fi
        fi
    fi
else
    warn "未检测到 'cursor' CLI，跳过 Cursor"
fi

# ---------- 卸载 JetBrains Mono 字体 ----------

FONT_DIR="$HOME/.local/share/fonts"
if ls "$FONT_DIR"/JetBrainsMono*.ttf &>/dev/null; then
    if confirm "从 ${FONT_DIR} 删除 JetBrains Mono 字体文件" \
                "rm ${FONT_DIR}/JetBrainsMono*.ttf && fc-cache -f"; then
        rm "$FONT_DIR"/JetBrainsMono*.ttf
        fc-cache -f
        success "JetBrains Mono 字体已卸载"
    fi
elif fc-list 2>/dev/null | grep -qi "JetBrains Mono"; then
    warn "JetBrains Mono 字体已安装但不在 ${FONT_DIR}，请手动卸载"
fi

# ---------- 清理本地构建产物 ----------

if [ -d node_modules ]; then
    if confirm "删除项目依赖目录" "rm -rf node_modules"; then
        rm -rf node_modules
        success "node_modules 已删除"
    fi
fi

if [ -d out ]; then
    if confirm "删除编译输出目录" "rm -rf out"; then
        rm -rf out
        success "out 已删除"
    fi
fi

VSIX_FILES=$(ls Trainning-Extension-*.vsix 2>/dev/null || true)
OLD_VSIX_FILES=$(ls copy-with-ref-*.vsix 2>/dev/null || true)
if [ -n "$VSIX_FILES" ] || [ -n "$OLD_VSIX_FILES" ]; then
    if confirm "删除打包的 .vsix 文件" "rm -f Trainning-Extension-*.vsix copy-with-ref-*.vsix"; then
        rm -f Trainning-Extension-*.vsix copy-with-ref-*.vsix
        success ".vsix 文件已删除"
    fi
fi

# ---------- 卸载全局工具 ----------

if command -v vsce &>/dev/null; then
    if confirm "卸载全局 vsce（install.sh 安装的打包工具）" "sudo npm uninstall -g @vscode/vsce"; then
        sudo npm uninstall -g @vscode/vsce
        success "vsce 已卸载"
    fi
fi

echo ""
success "卸载完成！请重载编辑器窗口使其生效。"
