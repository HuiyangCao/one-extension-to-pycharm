import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { EXTENSION_ID } from './constants';

type CommandNode = CategoryNode | CommandItemNode;

interface CategoryNode {
    kind: 'category';
    name: string;
    filePath: string;
}

interface CommandItemNode {
    kind: 'command';
    name: string;
    command: string;
    parameters?: Record<string, any>;
    parameter_refs?: string[];
    categoryName: string;
    categoryData: any;
}

interface Parameter {
    type: string;
    prompt: string;
    options?: string[];
    [key: string]: any;
}

class CommandManagerProvider implements vscode.TreeDataProvider<CommandNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<CommandNode | undefined | null | void> =
        new vscode.EventEmitter<CommandNode | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<CommandNode | undefined | null | void> =
        this._onDidChangeTreeData.event;

    private fileWatchers: vscode.FileSystemWatcher[] = [];

    private get configDirs(): string[] {
        const userConfigDir = path.join(process.env.HOME || '', '.config', 'user_extension', 'command_config');
        // const extConfigDir = path.join(this.extensionPath, 'command_config');
        return [userConfigDir];
    }

    constructor(private extensionPath: string, private context: vscode.ExtensionContext) {
        this.setupFileWatcher();
    }

    private setupFileWatcher(): void {
        for (const configDir of this.configDirs) {
            try {
                if (!fs.existsSync(configDir)) continue;
                const pattern = new vscode.RelativePattern(configDir, '*.json');
                const watcher = vscode.workspace.createFileSystemWatcher(pattern);

                watcher.onDidChange(() => this.refresh());
                watcher.onDidCreate(() => this.refresh());
                watcher.onDidDelete(() => this.refresh());

                this.fileWatchers.push(watcher);
            } catch (error) {
                console.error(`Failed to setup file watcher for ${configDir}:`, error);
            }
        }
    }

    dispose(): void {
        for (const watcher of this.fileWatchers) {
            watcher.dispose();
        }
        this.fileWatchers = [];
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: CommandNode): vscode.TreeItem {
        if (element.kind === 'category') {
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
            item.iconPath = new vscode.ThemeIcon('file-json');
            // 移除双击编辑逻辑，改用按钮触发
            item.contextValue = 'category';
            // 保存完整的 element 对象用于菜单传递
            (item as any).element = element;
            return item;
        } else {
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
            item.iconPath = new vscode.ThemeIcon('run');
            item.command = {
                command: `${EXTENSION_ID}.runCommand`,
                title: 'Run Command',
                arguments: [element.categoryName, element],
            };
            return item;
        }
    }

    async getChildren(element?: CommandNode): Promise<CommandNode[]> {
        if (!element) {
            // Root: list all JSON categories
            return this.getCategories();
        } else if (element.kind === 'category') {
            // Category: list commands
            try {
                const data = JSON.parse(fs.readFileSync(element.filePath, 'utf-8'));
                const commands = data.commands || [];
                return commands.map((cmd: any) => ({
                    kind: 'command',
                    name: cmd.name,
                    command: cmd.command,
                    parameters: cmd.parameters,
                    parameter_refs: cmd.parameter_refs,
                    categoryName: element.name,
                    categoryData: data,
                } as CommandItemNode));
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to read ${element.filePath}: ${e}`);
                return [];
            }
        }
        return [];
    }

    private getCategories(): CategoryNode[] {
        console.log('[CommandManager] configDirs:', this.configDirs)
        const categories: CategoryNode[] = [];
        const seen = new Set<string>();

        for (const configDir of this.configDirs) {
            if (!fs.existsSync(configDir)) continue;

            const files = fs.readdirSync(configDir);
            for (const f of files) {
                if (!f.endsWith('.json') || f.startsWith('_')) continue;
                const name = path.basename(f, '.json');
                if (seen.has(name)) continue;

                seen.add(name);
                categories.push({
                    kind: 'category' as const,
                    name,
                    filePath: path.join(configDir, f),
                });
            }
        }

        return categories;
    }
}

async function collectParameters(
    categoryData: any,
    cmdItem: CommandItemNode,
    context: vscode.ExtensionContext,
    categoryName: string
): Promise<Record<string, string> | undefined> {
    const result: Record<string, string> = {};

    // Determine which parameters to collect
    let paramDefs: Record<string, Parameter> = {};
    const paramNames: string[] = [];

    if (cmdItem.parameter_refs && cmdItem.parameter_refs.length > 0) {
        // Use global parameter_refs
        paramNames.push(...cmdItem.parameter_refs);
        paramDefs = categoryData.parameters || {};
    } else if (cmdItem.parameters && typeof cmdItem.parameters === 'object') {
        // Use inline parameters
        paramDefs = cmdItem.parameters;
        paramNames.push(...Object.keys(cmdItem.parameters));
    }

    // Collect each parameter
    for (const paramName of paramNames) {
        const paramDef = paramDefs[paramName];
        if (!paramDef) {
            vscode.window.showWarningMessage(`Parameter '${paramName}' not found in definitions`);
            continue;
        }

        const stateKey = `cmdmgr.${categoryName}.${paramName}`;
        const lastValue = context.workspaceState.get<string>(stateKey);

        let value: string | undefined;

        if (paramDef.type === 'select' && paramDef.options) {
            // Quick pick with last value first
            const options = paramDef.options;
            const items = options.map((opt: string) => ({
                label: opt,
                picked: opt === lastValue,
            }));

            const selected = await vscode.window.showQuickPick(items, {
                placeHolder: paramDef.prompt,
                ignoreFocusOut: true,
            });

            if (!selected) {
                return undefined; // User cancelled
            }
            value = selected.label;
        } else if (paramDef.type === 'string') {
            const input = await vscode.window.showInputBox({
                prompt: paramDef.prompt,
                value: lastValue,
                ignoreFocusOut: true,
            });

            if (input === undefined) {
                return undefined; // User cancelled
            }
            value = input;
        } else {
            vscode.window.showWarningMessage(
                `Unknown parameter type '${paramDef.type}' for '${paramName}'`
            );
            continue;
        }

        // Save to workspace state
        await context.workspaceState.update(stateKey, value);
        result[paramName] = value;
    }

    return result;
}

function replaceParameters(command: string, params: Record<string, string>): string {
    let result = command;
    for (const [key, value] of Object.entries(params)) {
        result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
    }
    return result;
}

function getOrCreateTerminal(name: string = 'Command Manager'): vscode.Terminal {
    // 优先使用活跃终端，其次查找同名终端，最后创建新终端
    let terminal = vscode.window.activeTerminal;
    if (!terminal) {
        const existing = vscode.window.terminals.find(t => t.name === name);
        if (existing) {
            return existing;
        }
        terminal = vscode.window.createTerminal(name);
    }
    return terminal;
}

export function registerCommandManagerView(context: vscode.ExtensionContext): vscode.Disposable[] {
    const disposables: vscode.Disposable[] = [];

    // Create tree provider
    const provider = new CommandManagerProvider(context.extensionPath, context);
    const treeView = vscode.window.createTreeView(`${EXTENSION_ID}_commands`, {
        treeDataProvider: provider,
        showCollapseAll: true,
    });
    disposables.push(treeView);

    // 为树视图元素解析器设置，使菜单可以正确获取元素信息
    const treeSelectDisposable = treeView.onDidChangeSelection((event) => {
        if (event.selection.length > 0) {
            const element = event.selection[0];
            // 保存最后右键点击的元素
            (context as any).lastSelectedCommandElement = element;
        }
    });
    disposables.push(treeSelectDisposable);

    // Register runCommand
    const runCommandDisposable = vscode.commands.registerCommand(
        `${EXTENSION_ID}.runCommand`,
        async (categoryName: string, cmdItem: CommandItemNode) => {
            try {
                // Collect parameters
                const params = await collectParameters(
                    cmdItem.categoryData,
                    cmdItem,
                    context,
                    categoryName
                );

                if (params === undefined) {
                    // User cancelled
                    return;
                }

                // Replace parameters in command
                const finalCmd = replaceParameters(cmdItem.command, params);

                // Get or create terminal and execute command
                const terminal = getOrCreateTerminal('Command Manager');
                terminal.show(true);
                terminal.sendText(finalCmd, true);
            } catch (e) {
                vscode.window.showErrorMessage(`Error running command: ${e}`);
            }
        }
    );
    disposables.push(runCommandDisposable);

    // Register openCommandConfig
    const openConfigDisposable = vscode.commands.registerCommand(
        `${EXTENSION_ID}.openCommandConfig`,
        async (element?: any) => {
            try {
                let filePath: string | undefined;
                
                if (typeof element === 'string') {
                    // 直接传入文件路径字符串
                    filePath = element;
                } else if (element && 'kind' in element && element.kind === 'category') {
                    // element 是 CategoryNode
                    filePath = element.filePath;
                } else {
                    // 从上下文中获取最后选中的元素
                    const lastSelected = (context as any).lastSelectedCommandElement;
                    if (lastSelected && 'kind' in lastSelected && lastSelected.kind === 'category') {
                        filePath = lastSelected.filePath;
                    }
                }
                
                if (!filePath) {
                    vscode.window.showErrorMessage('Unable to determine config file path');
                    return;
                }
                
                const doc = await vscode.workspace.openTextDocument(filePath);
                await vscode.window.showTextDocument(doc);
            } catch (e) {
                vscode.window.showErrorMessage(`Failed to open config file: ${e}`);
            }
        }
    );
    disposables.push(openConfigDisposable);

    // Register refreshCommands
    const refreshDisposable = vscode.commands.registerCommand(`${EXTENSION_ID}.refreshCommands`, () => {
        provider.refresh();
    });
    disposables.push(refreshDisposable);

    // Add provider disposal
    disposables.push(new vscode.Disposable(() => provider.dispose()));

    return disposables;
}
