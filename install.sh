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

# 询问用户是否执行，显示原因和将要执行的命令
# confirm "原因" "命令"
# 用户输入 n 则跳过，其他任意键或回车则执行
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

# 和 confirm 类似，但跳过会直接退出（必要步骤）
confirm_required() {
    local reason="$1"
    local cmd="$2"
    echo ""
    info "$reason"
    echo -e "  ${CYAN}\$ ${cmd}${NC}"
    read -r -p "$(echo -e "${YELLOW}执行? [Y/n] ${NC}")" choice
    case "$choice" in
        [nN]) error "此步骤为必需，退出安装。"; exit 1 ;;
        *)    return 0 ;;
    esac
}

# ---------- 系统检测 ----------

OS="$(uname -s)"
if [ "$OS" = "Darwin" ]; then
    PKG_MANAGER="brew"
elif [ -f /etc/debian_version ]; then
    PKG_MANAGER="apt"
elif [ -f /etc/redhat-release ]; then
    PKG_MANAGER="yum"
elif [ -f /etc/arch-release ]; then
    PKG_MANAGER="pacman"
else
    PKG_MANAGER=""
fi

info "系统: ${OS}, 包管理器: ${PKG_MANAGER:-unknown}"

# ---------- 依赖检查与安装 ----------

# Node.js & npm
if ! command -v node &>/dev/null || ! command -v npm &>/dev/null; then
    case "$PKG_MANAGER" in
        brew)
            if confirm "未检测到 Node.js/npm，需要通过 Homebrew 安装" "brew install node"; then
                brew install node
            else
                error "Node.js 为必需依赖，退出安装。"; exit 1
            fi
            ;;
        apt)
            if confirm "未检测到 Node.js/npm，Ubuntu apt 自带版本常有依赖冲突，使用 NodeSource 官方源安装 LTS 版本" \
                        "curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs"; then
                if ! command -v curl &>/dev/null; then
                    sudo apt update -qq && sudo apt install -y curl
                fi
                curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
                sudo apt install -y nodejs
            else
                error "Node.js 为必需依赖，退出安装。"; exit 1
            fi
            ;;
        yum)
            if confirm "未检测到 Node.js/npm，使用 NodeSource 官方源安装" \
                        "curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash - && sudo yum install -y nodejs"; then
                curl -fsSL https://rpm.nodesource.com/setup_lts.x | sudo bash -
                sudo yum install -y nodejs
            else
                error "Node.js 为必需依赖，退出安装。"; exit 1
            fi
            ;;
        pacman)
            if confirm "未检测到 Node.js/npm，通过 pacman 安装" "sudo pacman -S nodejs npm"; then
                sudo pacman -S --noconfirm nodejs npm
            else
                error "Node.js 为必需依赖，退出安装。"; exit 1
            fi
            ;;
        *)
            error "未检测到 Node.js/npm，且无法识别包管理器。请手动安装: https://nodejs.org/"
            exit 1
            ;;
    esac
    if command -v node &>/dev/null && command -v npm &>/dev/null; then
        success "Node.js $(node -v), npm $(npm -v)"
    else
        error "Node.js/npm 安装失败。"; exit 1
    fi
else
    success "Node.js $(node -v), npm $(npm -v)"
fi

# vsce
if ! command -v vsce &>/dev/null; then
    if confirm "未检测到 vsce（VS Code 扩展打包工具），需要全局安装" "sudo npm install -g @vscode/vsce"; then
        sudo npm install -g @vscode/vsce
        success "vsce 已安装"
    else
        error "vsce 为必需依赖，退出安装。"; exit 1
    fi
else
    success "vsce 已就绪"
fi

# npm dependencies
if [ ! -d node_modules ]; then
    if confirm "未检测到 node_modules 目录，需要安装项目依赖" "npm install"; then
        npm install
        success "项目依赖已安装"
    else
        error "项目依赖为必需，退出安装。"; exit 1
    fi
else
    success "node_modules 已就绪"
fi

# Python (for icon generation)
if ! command -v python3 &>/dev/null; then
    warn "未检测到 python3，跳过图标生成"
else
    if confirm "使用 Python 生成扩展图标" "python3 gen_icon.py"; then
        python3 gen_icon.py
        success "图标已生成"
    else
        warn "跳过图标生成"
    fi
fi

# ---------- 构建与打包 ----------

confirm_required "编译 TypeScript 源码" "npm run compile"
npm run compile
success "编译完成"

VERSION=$(node -p "require('./package.json').version")
PUBLISHER=$(node -p "require('./package.json').publisher")
VSIX="copy-with-ref-${VERSION}.vsix"

confirm_required "打包为 .vsix 扩展文件 (v${VERSION})" "vsce package --no-dependencies"
vsce package --no-dependencies
success "已打包: ${VSIX}"

# ---------- 安装到编辑器 ----------

DARCULA_EXT="xr0master.jetbrains-darcula-theme"
installed=""

if command -v code &>/dev/null; then
    if confirm "检测到 VS Code，安装扩展" "code --install-extension ${VSIX}"; then
        code --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
        if code --install-extension "$VSIX" 2>/dev/null; then
            success "已安装到 VS Code"
            installed="${installed} VS Code"
        else
            warn "VS Code 安装失败"
        fi
    fi
    if ! code --list-extensions 2>/dev/null | grep -qi "jetbrains.*darcula"; then
        if confirm "VS Code 未安装 JetBrains Darcula 主题，安装后可获得 PyCharm 风格外观" \
                    "code --install-extension ${DARCULA_EXT}"; then
            if code --install-extension "$DARCULA_EXT" 2>/dev/null; then
                success "JetBrains Darcula 主题已安装到 VS Code"
            else
                warn "主题安装失败"
            fi
        fi
    else
        success "VS Code 已有 JetBrains Darcula 主题"
    fi
else
    warn "未检测到 'code' CLI，跳过 VS Code"
fi

if command -v cursor &>/dev/null; then
    if confirm "检测到 Cursor，安装扩展" "cursor --install-extension ${VSIX}"; then
        cursor --uninstall-extension "${PUBLISHER}.copy-with-ref" 2>/dev/null || true
        if cursor --install-extension "$VSIX" 2>/dev/null; then
            success "已安装到 Cursor"
            installed="${installed} Cursor"
        else
            warn "Cursor 安装失败"
        fi
    fi
    if ! cursor --list-extensions 2>/dev/null | grep -qi "jetbrains.*darcula"; then
        if confirm "Cursor 未安装 JetBrains Darcula 主题，安装后可获得 PyCharm 风格外观" \
                    "cursor --install-extension ${DARCULA_EXT}"; then
            if cursor --install-extension "$DARCULA_EXT" 2>/dev/null; then
                success "JetBrains Darcula 主题已安装到 Cursor"
            else
                warn "主题安装失败"
            fi
        fi
    else
        success "Cursor 已有 JetBrains Darcula 主题"
    fi
else
    warn "未检测到 'cursor' CLI，跳过 Cursor"
fi

echo ""
if [ -z "$installed" ]; then
    warn "未安装到任何编辑器。VSIX 文件: ${VSIX}"
    info "手动安装: code --install-extension ${VSIX}"
else
    success "安装完成！请重载${installed} 窗口使其生效。"
fi
