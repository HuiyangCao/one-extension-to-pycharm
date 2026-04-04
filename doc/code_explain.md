# user-extension 代码说明文档

## 扩展概述

**user-extension** 是一个 VS Code 扩展，集成了以下功能：

1. **副本引用复制** — 复制代码位置（文件路径 + 行号）
2. **系统剪贴板同步** — 复制文件到 GNOME 系统剪贴板
3. **收藏文件夹管理** — 快速访问常用目录
4. **目录浏览** — 搜索并导航工作区目录
5. **Debug 调试** — 支持 launch.json 配置参数输入（保存上次选择）
6. **命令管理器** — 交互式命令执行 UI（主要功能）

---

## 代码架构

```
src/
├── constants.ts              # 全局常量定义
├── extension.ts              # 扩展入口点 (activate / deactivate)
├── config.ts                 # 配置加载和应用
├── commands.ts               # 6 个命令注册函数
├── debug.ts                  # Debug 配置提供者
└── commandManager.ts         # 命令管理器 TreeView 实现

command_config/
├── tmux.json                 # tmux 命令配置
├── train.json                # 训练命令配置
├── rsync.json                # 文件同步命令配置
├── deployment.json           # 部署命令配置
├── training_rsync.json       # 训练同步命令配置
└── tijirobotcontroller.json  # 机器人控制器命令配置
```

---

## 核心文件说明

### 1. `src/constants.ts` ⭐ 全局常量

```typescript
export const EXTENSION_ID = 'user_extension';
```

**作用**：
- 单一源管理扩展标识符
- 所有命令 ID、视图 ID 都通过此常量动态生成
- **更新策略**：下次改扩展名仅需改这一行，代码自动适配

**使用位置**：
- `commandManager.ts` — 7 处使用（命令 ID + 视图 ID）
- `commands.ts` — 6 处使用（所有命令注册）

---

### 2. `src/extension.ts` — 扩展入口

**职责**：
- 加载配置（`loadConfig`）
- 应用 VS Code 设置和用户快捷键
- 注册所有命令和视图

**核心逻辑**：
```typescript
export function activate(context: vscode.ExtensionContext) {
    const cfg = loadConfig(context.extensionPath);
    applySettings(context, cfg.settings);
    applyUserKeybindings(context, cfg.keybindings);

    // 注册各功能模块
    const cmd = registerCopyWithRefCommand(context);
    const copyFilesCmd = registerCopyFilesToSystemCommand();
    const addFavoriteFolderCmd = registerAddFavoriteFolderCommand(context);
    const revealFolderCmd = registerRevealFolderCommand(context);
    const copyFileNameCmd = registerCopyFileNameCommand();
    const killPythonDebugCmd = registerKillPythonDebugCommand();
    const debugProvider = registerDebugConfigurationProviderAndCommand(context);
    const cmdMgrDisposables = registerCommandManagerView(context);

    // 注册订阅
    context.subscriptions.push(...);
}
```

---

### 3. `src/commands.ts` — 6 个命令实现

| 命令 | ID | 功能 |
|------|----|----|
| Copy with Reference | `user_extension.copy` | 复制代码位置 (@filepath:line) |
| Copy Files to System | `user_extension.copyFilesToSystem` | 复制文件到系统剪贴板 |
| Add Favorite Folder | `user_extension.addFavoriteFolder` | 将文件夹加入收藏 |
| Reveal Folder | `user_extension.revealFolderInExplorer` | 浏览和导航目录（带收藏夹) |
| Copy File Name | `user_extension.copyFileName` | 复制文件名 |
| Kill Python Debug | `user_extension.killPythonDebug` | 终止所有 Python 调试进程 |

**关键实现**：
- 所有 `registerCommand` 调用使用 `` `${EXTENSION_ID}.commandName` ``
- 状态存储在 `context.workspaceState`（如收藏文件夹列表）
- 文件浏览器使用 `find` 命令递归扫描目录

---

### 4. `src/debug.ts` — Debug 配置支持

**功能**：
- 拦截 launch.json 中的 `${input:xxx}` 占位符
- 弹出 InputBox 或 QuickPick 让用户输入参数
- 将参数值保存到 `context.workspaceState` 作为 last_used

**参数类型支持**：
- `pickString` — 下拉列表（有选项列表）
- `promptString` — 文本输入框

---

### 5. `src/commandManager.ts` ⭐ 命令管理器

**架构**：
```
活动栏 (activitybar)
  └── user_extension 容器
       └── user_extension_commands 视图
            ├── Category 节点 1 (tmux.json)
            │    ├── Command 1
            │    ├── Command 2
            │    └── ...
            ├── Category 节点 2 (train.json)
            │    └── ...
```

**类型定义**：
```typescript
type CommandNode = CategoryNode | CommandItemNode

interface CategoryNode {
    kind: 'category';
    name: string;           // JSON 文件名（无扩展名）
    filePath: string;       // JSON 文件路径
}

interface CommandItemNode {
    kind: 'command';
    name: string;           // 命令显示名称
    command: string;        // 待执行的 shell 命令
    parameters?: Record<string, any>;      // 内联参数定义
    parameter_refs?: string[];             // 引用全局参数
    categoryName: string;   // 所属分类
    categoryData: any;      // 整个 JSON 的 parsed 数据
}
```

**核心流程**：

#### 1️⃣ **加载分类**
```typescript
getCategories() {
    // 扫描 command_config/*.json
    // 返回 CategoryNode[] 数组
}
```

#### 2️⃣ **加载命令**
当用户展开某个分类时：
```typescript
getChildren(categoryNode) {
    // 读取对应 JSON 文件
    // 解析 data.commands[] 为 CommandItemNode[]
}
```

#### 3️⃣ **收集参数**
当用户点击命令时：
```typescript
collectParameters(categoryData, cmdItem, context, categoryName) {
    // 确定参数来源
    if (cmdItem.parameter_refs) {
        // 使用全局参数：categoryData.parameters[ref]
    } else if (cmdItem.parameters) {
        // 使用内联参数：cmdItem.parameters
    }

    // 遍历每个参数并交互
    for (paramName of paramNames) {
        const paramDef = paramDefs[paramName];
        
        if (paramDef.type === 'select') {
            // showQuickPick(options)
        } else if (paramDef.type === 'string') {
            // showInputBox(prompt)
        }
        
        // 保存到 workspaceState (cmdmgr.<category>.<paramName>)
    }
}
```

#### 4️⃣ **参数替换 + 执行**
```typescript
runCommand(category, cmdItem) {
    const params = await collectParameters(...);
    
    // 替换 {param} 占位符
    const finalCmd = replaceParameters(cmdItem.command, params);
    
    // 发送到集成终端 "Command Manager"
    const terminal = getOrCreateTerminal('Command Manager');
    terminal.show(true);
    terminal.sendText(finalCmd);
}
```

**命令注册**：
- `user_extension.runCommand` — 点击命令节点触发
- `user_extension.openCommandConfig` — 双击分类节点打开 JSON 编辑
- `user_extension.refreshCommands` — 手动刷新命令树（右上角按钮）

---

## 配置文件格式 (`command_config/*.json`)

### 简单格式（无参数）
```json
{
  "commands": [
    {
      "name": "tmux attach",
      "command": "tmux attach -t {session_name}"
    }
  ]
}
```

### 全局参数格式（train.json 风格）
```json
{
  "auto_parameters": {
    "cuda_index": { "type": "gpu_detection", "command": "" }
  },
  "parameters": {
    "task_name": {
      "type": "select",
      "prompt": "选择任务",
      "options": ["task1", "task2", ...]
    },
    "motion_name": {
      "type": "string",
      "prompt": "输入动作名称"
    }
  },
  "commands": [
    {
      "name": "训练任务",
      "command": "CUDA_VISIBLE_DEVICES={cuda_index} python train.py --task {task_name} --motion {motion_name}",
      "parameter_refs": ["task_name", "motion_name"]
    }
  ]
}
```

### 参数类型
- **`select`** — 下拉选择，需要 `options` 数组
- **`string`** — 文本输入框，可选 `prompt` 提示
- **`gpu_detection`** — 自动检测最优 GPU（暂未实现）

---

## 用户交互流程

### 场景 1：执行命令
```
1. 点击活动栏 "user_extension" 图标
2. 侧边栏展示 6 个分类（tmux, train, rsync 等）
3. 点击分类展开，看到该分类的所有命令
4. 点击命令
   ↓
5. 按顺序弹出参数输入框
   - 如果是 select 类型：QuickPick 下拉
   - 如果是 string 类型：InputBox 文本框
   - 用户按 Esc 取消整个流程
   ↓
6. 所有参数输入完成，替换命令中的 {param}
7. 发送最终命令到 "Command Manager" 终端执行
8. 用户在终端看到输出
```

### 场景 2：编辑配置
```
1. 双击分类节点（如 "train"）
2. train.json 在编辑器中打开
3. 用户修改 JSON，保存
4. 在侧边栏点击刷新按钮
5. TreeView 重新加载，新配置生效
```

---

## 全局状态管理

所有状态存储在 `context.workspaceState`（工作区级别）：

| 键 | 值 | 说明 |
|----|----|----|
| `cmdmgr.<category>.<paramName>` | string | 命令参数的上次输入值 |
| `favoriteFolders.<rootPath>` | string[] | 收藏文件夹列表 |
| `debugInput.<configName>.<inputName>` | string | Debug 参数的上次输入值 |

---

## 扩展名变更指南

**当前**：扩展名 = `user_extension`

**如果要改名**（如改为 `my_tools`）：

1. 修改 `src/constants.ts`：
```typescript
export const EXTENSION_ID = 'my_tools';  // 从 'user_extension' 改为 'my_tools'
```

2. 修改 `package.json`：
```json
{
  "name": "my-tools",  // 改这里（kebab-case）
  "contributes": {
    "commands": [
      { "command": "my_tools.copy", ... },  // 所有命令 ID 手动改
      ...
    ]
  }
}
```

3. 编译 + 打包：
```bash
npm run compile
./reinstall.sh
```

**代码部分无需改动** — 所有引用都通过 `EXTENSION_ID` 常量自动适配。

---

## 技术栈

- **VS Code API** — TreeView, Commands, InputBox, QuickPick, Terminals
- **TypeScript** — 强类型编程
- **Node.js** — 文件系统操作、子进程管理（spawn）

---

## 性能特性

- 📁 **延迟加载**：分类命令仅在展开时才读取 JSON 文件
- 💾 **状态缓存**：参数上次输入值存储在 workspaceState（持久化）
- 🔄 **刷新机制**：用户可手动刷新命令树（TreeView.refresh()）
- ⚡ **终端复用**：所有命令共享 "Command Manager" 终端，避免重复创建

---

## 已知限制

- ❌ `auto_parameters` 功能（gpu_detection）暂未实现
- ❌ JSON 中的 `add`/`del` 选项编辑暂未支持（可通过编辑 JSON 实现）
- ℹ️ 命令执行依赖 shell 环境（需要 bash/zsh）

---

## 开发提示

### 添加新命令

1. 在 `src/commands.ts` 中定义：
```typescript
export function registerMyCommand(context: vscode.ExtensionContext) {
    return vscode.commands.registerCommand(`${EXTENSION_ID}.myCommand`, () => {
        // 实现逻辑
    });
}
```

2. 在 `src/extension.ts` 中注册：
```typescript
const myCmd = registerMyCommand(context);
context.subscriptions.push(myCmd);
```

3. 在 `package.json` 中声明（如需在菜单中显示）：
```json
{
  "command": "user_extension.myCommand",
  "title": "My Command Title"
}
```

### 添加新的命令分类

1. 在 `command_config/` 目录下新建 JSON 文件（如 `mycat.json`）
2. 遵循格式，定义 `commands` 数组
3. 重新加载 VS Code，刷新命令树

---

## 文件大小统计

```
out/
├── extension.js          1.4 KB
├── commands.js           8.5 KB
├── commandManager.js     7.7 KB
├── config.js             1.2 KB
├── debug.js              4.1 KB
└── constants.js          0.2 KB

command_config/
├── train.json            1.7 KB
├── rsync.json            2.1 KB
├── deployment.json       1.2 KB
└── ...                   5.7 KB

total: ~7.4 MB VSIX (包含依赖和资源)
```

---

## 参考链接

- [VS Code Extension API](https://code.visualstudio.com/api)
- [TreeView API](https://code.visualstudio.com/api/extension-guides/tree-view)
- [Command Palette API](https://code.visualstudio.com/api/ux-guidelines/command-palette)
