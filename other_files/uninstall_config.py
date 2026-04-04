#!/usr/bin/env python3
"""
卸载脚本：根据 config.json 回退 VSCode/Cursor 的 settings.json 和 keybindings.json。
从 settings 中删除扩展设置的键值对，从 keybindings 中删除扩展添加的条目。
"""

import json
import os
import re
import sys

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(SCRIPT_DIR, "config.json")

# VSCode / Cursor 用户配置目录（Linux）
CANDIDATE_DIRS = [
    os.path.expanduser("~/.config/Code/User"),
    os.path.expanduser("~/.config/Code - Insiders/User"),
    os.path.expanduser("~/.config/Cursor/User"),
]

BLUE = "\033[0;34m"
GREEN = "\033[0;32m"
YELLOW = "\033[1;33m"
RED = "\033[0;31m"
NC = "\033[0m"


def info(msg):
    print(f"{BLUE}[INFO]{NC} {msg}")


def success(msg):
    print(f"{GREEN}[OK]{NC} {msg}")


def warn(msg):
    print(f"{YELLOW}[WARN]{NC} {msg}")


def error(msg):
    print(f"{RED}[ERROR]{NC} {msg}")


def strip_json_comments(text: str) -> str:
    """Remove // comments and trailing commas from JSON-with-comments."""
    text = re.sub(r"//.*$", "", text, flags=re.MULTILINE)
    text = re.sub(r",\s*([\]}])", r"\1", text)
    return text


def load_json_with_comments(filepath: str):
    """Read a JSON file that may contain comments and trailing commas."""
    with open(filepath, "r", encoding="utf-8") as f:
        raw = f.read()
    stripped = strip_json_comments(raw)
    return json.loads(stripped)


def save_json(filepath: str, data):
    with open(filepath, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4, ensure_ascii=False)
        f.write("\n")


def keybinding_identity(entry: dict) -> str:
    return f"{entry.get('key', '')}|{entry.get('command', '')}"


def revert_settings(user_dir: str, config_settings: dict):
    settings_path = os.path.join(user_dir, "settings.json")
    if not os.path.isfile(settings_path):
        warn(f"  settings.json 不存在: {settings_path}")
        return

    try:
        current = load_json_with_comments(settings_path)
    except Exception as e:
        error(f"  解析 settings.json 失败: {e}")
        return

    removed = []
    for key, value in config_settings.items():
        if key in current and current[key] == value:
            del current[key]
            removed.append(key)

    if removed:
        save_json(settings_path, current)
        success(f"  settings.json: 移除了 {len(removed)} 项")
        for k in removed:
            info(f"    - {k}")
    else:
        info(f"  settings.json: 无需修改")


def revert_keybindings(user_dir: str, config_keybindings: list):
    kb_path = os.path.join(user_dir, "keybindings.json")
    if not os.path.isfile(kb_path):
        warn(f"  keybindings.json 不存在: {kb_path}")
        return

    try:
        current = load_json_with_comments(kb_path)
    except Exception as e:
        error(f"  解析 keybindings.json 失败: {e}")
        return

    config_ids = {keybinding_identity(kb) for kb in config_keybindings}
    original_len = len(current)
    current = [kb for kb in current if keybinding_identity(kb) not in config_ids]
    removed_count = original_len - len(current)

    if removed_count > 0:
        save_json(kb_path, current)
        success(f"  keybindings.json: 移除了 {removed_count} 项")
    else:
        info(f"  keybindings.json: 无需修改")


def main():
    if not os.path.isfile(CONFIG_PATH):
        error(f"找不到配置文件: {CONFIG_PATH}")
        sys.exit(1)

    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        config = json.load(f)

    config_settings = config.get("settings", {})
    config_keybindings = config.get("keybindings", [])

    found_any = False
    for user_dir in CANDIDATE_DIRS:
        if not os.path.isdir(user_dir):
            continue
        found_any = True
        editor_name = os.path.basename(os.path.dirname(user_dir))
        info(f"处理 {editor_name}: {user_dir}")
        revert_settings(user_dir, config_settings)
        revert_keybindings(user_dir, config_keybindings)
        print()

    if not found_any:
        warn("未找到任何 VSCode/Cursor 用户配置目录")


if __name__ == "__main__":
    main()
