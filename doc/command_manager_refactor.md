# Command Manager 重构说明

## 概述
对命令管理系统进行了全面重构，优化了用户交互流程和项目结构组织。

## 主要改动

### 1. 项目结构整理
**目的**：清理项目根目录，将用户无关的内容移到 `other_files` 文件夹

#### 移动的文件：
- `icon.png` → `other_files/icon.png`
- `gen_icon.py` → `other_files/gen_icon.py`
- `uninstall_config.py` → `other_files/uninstall_config.py`
- `tsconfig.json` → `other_files/tsconfig.json`

#### 同步修改的配置：
- **package.json**: 
  - 更新 `icon` 字段为 `other_files/icon.png`
  - 更新 `compile` 和 `watch` 脚本指向 `other_files/tsconfig.json`

- **install.sh**: 
  - 更新 `gen_icon.py` 调用路径为 `other_files/gen_icon.py`

- **uninstall.sh**: 
  - 更新 `uninstall_config.py` 调用路径为 `other_files/uninstall_config.py`

- **.vscodeignore**: 
  - 更新 `tsconfig.json` 排除路径为 `other_files/tsconfig.json`

- **other_files/tsconfig.json**: 
  - 更新 `rootDir` 为 `../src`（相对于 other_files 目录）
  - 更新 `outDir` 为 `../out`（相对于 other_files 目录）
  - 添加 `include` 字段为 `["../src/**/*"]` 以正确解析源文件

### 2. 命令配置模板化
**目的**：防止用户因未配置命令导致功能不可用

#### 新增文件：
- `other_files/template_commands.json` - 命令配置模板

#### 模板结构：
```json
{
  "parameters": {
    "example_param": {
      "type": "select",
      "prompt": "请选择一个选项",
      "options": ["选项1", "选项2", "选项3"]
    }
  },
  "commands": [
    {
      "name": "示例命令 1",
      "command": "echo '这是一个示例命令'"
    }
  ]
}
```

#### install.sh 集成：
- 自动创建 `~/.config/trainning_extension/command_config/` 目录
- 首次安装时将模板配置复制到用户目录
- 用户可以基于模板创建自己的命令配置

### 3. 命令编辑交互优化
**目的**：改进命令配置编辑的触发方式，使操作更加显式和直观

#### 改动内容：

**package.json**：
- 为 `openCommandConfig` 命令添加编辑图标 `$(edit)`
- 在菜单配置 `view/title` 中添加编辑按钮（长期显示）
- 编辑按钮始终显示在 Commands 视图标题栏中，位于 Refresh 按钮左侧
- 按钮会在选中任何 category 项目后激活

**src/commandManager.ts**：

1. **移除双击编辑**
   - 删除 category 项的 `item.command` 绑定
   - 添加 `item.contextValue = 'category'` 标记，用于菜单过滤

2. **菜单驱动编辑**
   - 通过视图标题栏的编辑按钮触发编辑
   - 按钮长期显示，无需右键操作
   - 工作流：选中一个 category → 点击标题栏编辑按钮 → 打开配置文件

3. **选择事件监听**
   ```typescript
   // 添加选择变化监听
   treeView.onDidChangeSelection((event) => {
       if (event.selection.length > 0) {
           const element = event.selection[0];
           // 保存最后选中的元素供菜单使用
           (context as any).lastSelectedCommandElement = element;
       }
   });
   ```

4. **改进的命令处理**
   ```typescript
   // openCommandConfig 命令现在支持多种调用方式：
   // 1. 菜单项调用：从保存的 lastSelectedCommandElement 获取 filePath
   // 2. 直接调用：接受字符串路径参数
   // 3. 后备方案：从 element 参数的 kind 属性检查
   ```

## 用户体验变化

### 之前
- 双击 category 项目 → 打开编辑
- 点击 command 项目 → 执行命令

### 现在
- 选中 category 项目 → 点击视图标题栏的编辑按钮（📝 图标） → 打开编辑
- 点击 command 项目 → 执行命令（保持不变）

**优势**：
- 编辑操作更加显式，不易误触
- 编辑按钮始终可见，提高可发现性
- 操作流程更清晰：先选择，再编辑

## 技术细节

### 文件路径管理
- 所有相对路径引用都已更新为相对于项目根目录
- TypeScript 编译配置支持 `other_files` 目录中的文件

### 菜单上下文
- 使用 TreeItem 的 `contextValue` 属性进行菜单过滤
- 通过 `onDidChangeSelection` 事件捕获用户选择
- 菜单项的 `group: "inline"` 使按钮显示在树项右侧

### 命令参数传递
- 菜单命令依赖 `lastSelectedCommandElement` 上下文变量
- 改进的命令处理器支持灵活的参数来源

## 后续改进建议

1. **命令参数验证**：在执行前验证所有参数定义
2. **配置文件监视**：增强文件变化检测的健壮性
3. **批量编辑**：支持同时编辑多个配置文件
4. **配置模板库**：提供更多预设的命令配置模板
