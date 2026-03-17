# Copy with File Reference

Quickly copy the current file path and line number to clipboard — no code, just the reference.

## Install
bash ./install.sh (do not sudo)

## Usage

Select any code (or just place your cursor), then press `Ctrl+Shift+C` (`Cmd+Shift+C` on Mac), or right-click → **Copy with File Reference**.

**With selection:**
```
src/mjlab/tasks/tracking/config/walk_env_cfg.py:28-29
```

**Without selection (cursor only):**
```
src/mjlab/tasks/tracking/config/walk_env_cfg.py:28
```

Paths are relative to the workspace root. A status bar message confirms the copy.

## Why

Paste precise file references into terminals, AI prompts, issue trackers, or chat — without manually typing paths or line numbers.

## Keybinding

| Key | Action |
|-----|--------|
| `Ctrl+Shift+C` / `Cmd+Shift+C` | Copy file reference |


