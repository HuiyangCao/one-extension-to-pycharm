import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { EXTENSION_ID } from './constants';

interface SshHostNode {
    kind: 'host';
    host: string;
    hostname?: string;
    user?: string;
    port?: string;
    latency?: number | null;
}

interface SshErrorNode {
    kind: 'error';
    message: string;
}

type SshTreeNode = SshHostNode | SshErrorNode;

/**
 * 解析 SSH config 文件，返回主机列表
 * 跳过 Host * 全局配置块
 */
function parseSshConfig(configPath: string): SshHostNode[] {
    if (!fs.existsSync(configPath)) {
        throw new Error('SSH config file not found at ' + configPath);
    }

    const content = fs.readFileSync(configPath, 'utf-8');
    const lines = content.split('\n');
    const hosts: SshHostNode[] = [];
    let currentHost: SshHostNode | null = null;

    for (const line of lines) {
        const trimmed = line.trim();

        // 空行或注释行，跳过
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        // 检查 Host 行
        if (trimmed.toLowerCase().startsWith('host ')) {
            // 保存之前的主机
            if (currentHost && currentHost.host !== '*') {
                hosts.push(currentHost);
            }

            // 提取 Host 别名
            const hostName = trimmed.substring(5).trim();
            currentHost = {
                kind: 'host',
                host: hostName,
            };

            // 跳过 Host * 全局配置
            if (hostName === '*') {
                currentHost = null;
            }
            continue;
        }

        // 解析主机配置字段（缩进的行）
        if (currentHost) {
            const keyValue = trimmed.split(/\s+/);
            if (keyValue.length >= 2) {
                const key = keyValue[0].toLowerCase();
                const value = keyValue.slice(1).join(' ');

                if (key === 'hostname') {
                    currentHost.hostname = value;
                } else if (key === 'user') {
                    currentHost.user = value;
                } else if (key === 'port') {
                    currentHost.port = value;
                }
            }
        }
    }

    // 保存最后一个主机
    if (currentHost && currentHost.host !== '*') {
        hosts.push(currentHost);
    }

    return hosts;
}

class SshServerProvider implements vscode.TreeDataProvider<SshTreeNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<SshTreeNode | undefined | void> =
        new vscode.EventEmitter<SshTreeNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<SshTreeNode | undefined | void> =
        this._onDidChangeTreeData.event;

    private configPath: string;
    private parseError: string | null = null;
    private fileWatcher: vscode.FileSystemWatcher | null = null;
    private pingTimer: NodeJS.Timeout | null = null;
    private hosts: SshHostNode[] = [];

    constructor() {
        this.configPath = path.join(os.homedir(), '.ssh', 'config');
        this.setupFileWatcher();
        this.startPingTimer();
    }

    private async pingHost(host: SshHostNode): Promise<number | null> {
        const target = host.hostname || host.host;
        return new Promise((resolve) => {
            const start = Date.now();
            const proc = spawn('ping', ['-c', '1', '-W', '3', target], { timeout: 5000 });
            let output = '';
            proc.stdout.on('data', (data) => { output += data.toString(); });
            proc.on('close', (code) => {
                if (code === 0) {
                    const match = output.match(/time[=<](\d+\.?\d*)\s*ms/);
                    if (match) {
                        resolve(Math.round(parseFloat(match[1])));
                    } else {
                        resolve(Date.now() - start);
                    }
                } else {
                    resolve(null);
                }
            });
            proc.on('error', () => resolve(null));
        });
    }

    private async pingAll(): Promise<void> {
        for (const host of this.hosts) {
            host.latency = await this.pingHost(host);
        }
        this._onDidChangeTreeData.fire();
    }

    private startPingTimer(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
        }
        this.pingAll();
        this.pingTimer = setInterval(() => this.pingAll(), 2500);
    }

    private stopPingTimer(): void {
        if (this.pingTimer) {
            clearInterval(this.pingTimer);
            this.pingTimer = null;
        }
    }

    private setupFileWatcher(): void {
        try {
            const pattern = new vscode.RelativePattern(
                path.dirname(this.configPath),
                path.basename(this.configPath)
            );
            this.fileWatcher = vscode.workspace.createFileSystemWatcher(pattern);

            this.fileWatcher.onDidChange(() => {
                this.refresh();
            });

            this.fileWatcher.onDidCreate(() => {
                this.refresh();
            });
        } catch (error) {
            console.error('Failed to setup file watcher:', error);
        }
    }

    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
        this.stopPingTimer();
    }

    refresh(): void {
        this.hosts = [];
        this.parseError = null;
        try {
            this.hosts = parseSshConfig(this.configPath);
        } catch (error) {
            this.parseError = error instanceof Error ? error.message : String(error);
        }
        this._onDidChangeTreeData.fire();
        this.pingAll();
    }

    getParseError(): string | null {
        return this.parseError;
    }

    setParseError(error: string | null): void {
        this.parseError = error;
    }

    getTreeItem(element: SshTreeNode): vscode.TreeItem {
        if (element.kind === 'error') {
            const treeItem = new vscode.TreeItem(element.message, vscode.TreeItemCollapsibleState.None);
            treeItem.iconPath = new vscode.ThemeIcon('error');
            return treeItem;
        }

        const label = element.latency !== undefined && element.latency !== null
            ? `${element.host}  ${element.latency}ms`
            : element.host;
        const treeItem = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = this.buildTooltip(element);
        treeItem.iconPath = new vscode.ThemeIcon('remote');
        treeItem.contextValue = 'sshHost';
        return treeItem;
    }

    getChildren(element?: SshTreeNode): Thenable<SshTreeNode[]> {
        if (element) {
            return Promise.resolve([]);
        }

        if (this.parseError) {
            return Promise.resolve([{
                kind: 'error',
                message: '❌ ' + this.parseError,
            }]);
        }

        if (this.hosts.length === 0) {
            try {
                this.hosts = parseSshConfig(this.configPath);
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : String(error);
                this.parseError = errorMsg;
                return Promise.resolve([{
                    kind: 'error',
                    message: '❌ ' + errorMsg,
                }]);
            }
        }
        return Promise.resolve(this.hosts);
    }

    private buildTooltip(element: SshHostNode): string {
        const parts: string[] = [element.host];
        if (element.hostname) {
            parts.push(`Host: ${element.hostname}`);
        }
        if (element.user) {
            parts.push(`User: ${element.user}`);
        }
        if (element.port) {
            parts.push(`Port: ${element.port}`);
        }
        if (element.latency !== undefined && element.latency !== null) {
            parts.push(`Latency: ${element.latency}ms`);
        } else if (element.latency === null) {
            parts.push('Latency: unreachable');
        }
        return parts.join('\n');
    }
}

/**
 * 打开 SSH config 文件
 */
async function openSshConfig() {
    const configPath = path.join(os.homedir(), '.ssh', 'config');
    const uri = vscode.Uri.file(configPath);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc);
}

/**
 * SSH 连接命令：新建终端并自动执行 ssh 命令
 */
async function connectSsh(node: SshTreeNode) {
    if (!node || node.kind !== 'host') {
        return;
    }

    const sshCommand = `ssh ${node.host}`;

    // 新建带 host 名的终端并自动执行
    const terminal = vscode.window.createTerminal({
        name: node.host,
    });

    terminal.show(true);
    terminal.sendText(sshCommand, true);
}

/**
 * 注册 SSH Server 视图
 */
export function registerSshServerView(context: vscode.ExtensionContext): vscode.Disposable[] {
    const provider = new SshServerProvider();
    const treeView = vscode.window.createTreeView(`${EXTENSION_ID}_ssh`, {
        treeDataProvider: provider,
        showCollapseAll: false,
    });

    const connectCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.connectSsh`, connectSsh);
    const openConfigCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.openSshConfig`, openSshConfig);
    const refreshCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.refreshSsh`, () => {
        provider.refresh();
    });

    const providerDisposable = vscode.Disposable.from(
        new vscode.Disposable(() => provider.dispose())
    );

    return [treeView, connectCmd, openConfigCmd, refreshCmd, providerDisposable];
}
