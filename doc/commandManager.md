# commandManager.ts 说明

## 概述

`commandManager.ts` 实现了**命令管理器 TreeView**，提供一个交互式 UI 来浏览和执行预定义的 shell 命令。用户可以在侧边栏中按分类浏览命令，点击命令后通过参数收集流程，最终在终端中执行。

## 架构

```
活动栏 (activitybar)
  └── trainning_extension 容器
       └── trainning_extension_commands 视图
            ├── Category 节点 1 (tmux.json)
            │    ├── Command 1
            │    ├── Command 2
            │    └── ...
            ├── Category 节点 2 (train.json)
            │    └── ...
```

## 类型定义

### CommandNode

树节点联合类型，分为分类节点和命令节点。

```typescript
type CommandNode = CategoryNode | CommandItemNode
```

### CategoryNode

分类节点，对应 `command_config/` 目录下的一个 JSON 配置文件。

| 属性 | 类型 | 说明 |
|------|------|------|
| `kind` | `'category'` | 节点类型标识 |
| `name` | `string` | JSON 文件名（无扩展名） |
| `filePath` | `string` | JSON 文件完整路径 |

### CommandItemNode

命令节点，对应 JSON 中 `commands` 数组的一项。

| 属性 | 类型 | 说明 |
|------|------|------|
| `kind` | `'command'` | 节点类型标识 |
| `name` | `string` | 命令显示名称 |
| `command` | `string` | 待执行的 shell 命令模板 |
| `parameters` | `Record<string, any>` | 内联参数定义（可选） |
| `parameter_refs` | `string[]` | 引用全局参数名列表（可选） |
| `categoryName` | `string` | 所属分类名 |
| `categoryData` | `any` | 整个 JSON 的 parsed 数据 |

### Parameter

参数定义接口，用于描述命令需要的交互参数。

| 属性 | 类型 | 说明 |
|------|------|------|
| `type` | `string` | 参数类型：`select` 或 `string` |
| `prompt` | `string` | 输入框/下拉框的提示文本 |
| `options` | `string[]` | 下拉选项（仅 `select` 类型需要） |

## 核心类：CommandManagerProvider

实现 `vscode.TreeDataProvider<CommandNode>` 接口，提供树形数据。

### 构造函数

```typescript
constructor(extensionPath: string, context: vscode.ExtensionContext)
```

- 设置文件监听器，监听 `command_config/*.json` 的增删改，自动刷新树

### 核心方法

| 方法 | 说明 |
|------|------|
| `getTreeItem(element)` | 返回节点的 TreeItem 配置（图标、可点击命令等） |
| `getChildren(element?)` | 返回子节点列表：根节点返回分类，分类节点返回命令 |
| `getCategories()` | 扫描 `command_config/*.json`，过滤 `_` 开头的文件，返回分类节点列表 |
| `refresh()` | 触发树刷新事件 |
| `dispose()` | 释放文件监听器 |

## 核心函数

### collectParameters

收集命令参数，通过 QuickPick 或 InputBox 与用户交互。

```typescript
async function collectParameters(
    categoryData: any,
    cmdItem: CommandItemNode,
    context: vscode.ExtensionContext,
    categoryName: string
): Promise<Record<string, string> | undefined>
```

**参数来源优先级**：
1. `cmdItem.parameter_refs` — 引用分类 JSON 中的全局 `parameters`
2. `cmdItem.parameters` — 使用命令内联参数

**交互方式**：
- `select` 类型 → `showQuickPick` 下拉选择
- `string` 类型 → `showInputBox` 文本输入

**状态持久化**：每个参数的上次输入值保存到 `context.workspaceState`，键为 `cmdmgr.<categoryName>.<paramName>`。

### replaceParameters

将命令模板中的 `{paramName}` 占位符替换为实际值。

```typescript
function replaceParameters(command: string, params: Record<string, string>): string
```

### getOrCreateTerminal

获取或创建名为 "Command Manager" 的终端，复用已有终端避免重复创建。

```typescript
function getOrCreateTerminal(name?: string): vscode.Terminal
```

## 注册的命令

| 命令 ID | 说明 | 触发方式 |
|---------|------|----------|
| `trainning_extension.runCommand` | 执行命令（收集参数 → 替换 → 发送到终端） | 点击命令节点 |
| `trainning_extension.openCommandConfig` | 打开 JSON 配置文件编辑 | 点击分类节点 |
| `trainning_extension.refreshCommands` | 手动刷新命令树 | 视图右上角刷新按钮 |

## 执行流程

```
1. 用户点击命令节点
       ↓
2. collectParameters() 按顺序弹出参数输入框
   - select → QuickPick 下拉
   - string → InputBox 文本框
   - 用户取消则中断
       ↓
3. replaceParameters() 替换命令模板中的 {param} 占位符
       ↓
4. getOrCreateTerminal() 获取/创建终端
       ↓
5. terminal.sendText(finalCmd) 发送命令执行
```

## 状态管理

| 键 | 值 | 说明 |
|----|----|----|
| `cmdmgr.<category>.<paramName>` | `string` | 命令参数的上次输入值 |

## 文件监听

通过 `vscode.FileSystemWatcher` 监听 `command_config/*.json` 文件变化，实现配置热更新。文件增删改时自动调用 `refresh()` 刷新树视图。
