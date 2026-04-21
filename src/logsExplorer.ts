import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn } from 'child_process';
import { EXTENSION_ID } from './constants';

// ──────────────────────────── Types ────────────────────────────

/** 顶层分组节点，如 rsl_rl/g1_tracking */
interface TaskGroupNode {
    kind: 'taskGroup';
    label: string;
    children: RunFolderNode[];
}

/** 单次训练运行文件夹，如 2026-04-20_11-49-29 */
interface RunFolderNode {
    kind: 'runFolder';
    /** 文件夹名（即日期时间串） */
    name: string;
    /** 文件夹绝对路径 */
    folderPath: string;
    /** 从文件夹名解析的时间戳 */
    parsedTime: number;
    /** 文件夹内的可展示文件 */
    children: RunFileNode[];
}

/** 运行文件夹内的具体文件（onnx 或 pt） */
interface RunFileNode {
    kind: 'runFile';
    name: string;
    fullPath: string;
    size: number;
    /** 所属 RunFolder 引用，用于 getParent */
    parentFolder: RunFolderNode;
}

type LogsNode = TaskGroupNode | RunFolderNode | RunFileNode;

// ──────────────────────── Per-project config ───────────────────

const CONFIG_DIR = path.join(os.homedir(), '.config', 'trainning_extension');

function ensureConfigDir(): void {
    if (!fs.existsSync(CONFIG_DIR)) {
        fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }
}

function getLogsMapPath(): string {
    return path.join(CONFIG_DIR, 'logs_directories.json');
}

function readLogsMap(): Record<string, string> {
    try {
        ensureConfigDir();
        const p = getLogsMapPath();
        if (!fs.existsSync(p)) return {};
        return JSON.parse(fs.readFileSync(p, 'utf-8'));
    } catch {
        return {};
    }
}

function writeLogsMap(map: Record<string, string>): void {
    try {
        ensureConfigDir();
        fs.writeFileSync(getLogsMapPath(), JSON.stringify(map, null, 2), 'utf-8');
    } catch (err) {
        console.error('Error writing logs map:', err);
    }
}

function getWorkspaceKey(): string {
    const folders = vscode.workspace.workspaceFolders;
    return folders?.[0]?.uri.fsPath ?? '__global__';
}

function getLogsDirectory(): string {
    const map = readLogsMap();
    return map[getWorkspaceKey()] ?? '';
}

function setLogsDirectoryPath(dir: string): void {
    const map = readLogsMap();
    map[getWorkspaceKey()] = dir;
    writeLogsMap(map);
}

// ──────────────────────── File scanning ────────────────────────

/**
 * 从字符串中解析 `2026-04-20_13-11-53` 格式的日期时间。
 */
function parseTimeFromName(name: string): number {
    const m = name.match(/(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/);
    if (!m) return 0;
    return new Date(
        parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]),
        parseInt(m[4]), parseInt(m[5]), parseInt(m[6]),
    ).getTime();
}

/**
 * 在目录中找到编号最大的 model_*.pt 文件。
 * 返回 { name, fullPath, size } 或 null。
 */
function findLargestModelPt(dirPath: string): { name: string; fullPath: string; size: number } | null {
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch {
        return null;
    }

    let bestNum = -1;
    let bestName = '';

    for (const e of entries) {
        if (!e.isFile()) continue;
        const m = e.name.match(/^model_(\d+)\.pt$/);
        if (m) {
            const num = parseInt(m[1], 10);
            if (num > bestNum) {
                bestNum = num;
                bestName = e.name;
            }
        }
    }

    if (bestNum < 0) return null;

    const fullPath = path.join(dirPath, bestName);
    try {
        const stat = fs.statSync(fullPath);
        return { name: bestName, fullPath, size: stat.size };
    } catch {
        return null;
    }
}

/**
 * 判断一个目录是否为「训练运行文件夹」。
 * 条件：文件夹名匹配日期格式 YYYY-MM-DD_HH-MM-SS，
 *       且包含 .onnx 或 model_*.pt 文件。
 */
function isRunFolder(dirName: string, entries: fs.Dirent[]): boolean {
    if (!parseTimeFromName(dirName)) return false;
    return entries.some(e =>
        e.isFile() && (e.name.endsWith('.onnx') || /^model_\d+\.pt$/.test(e.name))
    );
}

/**
 * 递归扫描 directory，查找训练运行文件夹（含 .onnx 或 model_*.pt），
 * 按日期过滤，按任务路径分组。
 *
 * 目录结构:
 *   logs / <任意层级任务路径> / <日期文件夹> / {*.onnx, model_*.pt, ...}
 */
function scanLogsTree(directory: string, days: number, maxDepth: number = 5): TaskGroupNode[] {
    const cutoff = Date.now() - days * 86400_000;
    const groupMap = new Map<string, RunFolderNode[]>();

    function walk(dir: string, depth: number) {
        if (depth > maxDepth) return;
        let entries: fs.Dirent[];
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
            return;
        }

        const folderName = path.basename(dir);

        if (isRunFolder(folderName, entries)) {
            // 当前 dir 是运行文件夹
            const parsedTime = parseTimeFromName(folderName);
            if (parsedTime < cutoff) return; // 时间过滤

            // 分组 key = 相对于 logs 根目录的父路径
            const relToRoot = path.relative(directory, dir);
            const parts = relToRoot.split(path.sep);
            const groupKey = parts.length > 1
                ? parts.slice(0, parts.length - 1).join('/')
                : '(root)';

            // 构建 RunFolderNode
            const runFolder: RunFolderNode = {
                kind: 'runFolder',
                name: folderName,
                folderPath: dir,
                parsedTime,
                children: [],
            };

            // 添加 onnx 文件（如有）
            const onnxEntry = entries.find(e => e.isFile() && e.name.endsWith('.onnx'));
            if (onnxEntry) {
                const onnxFullPath = path.join(dir, onnxEntry.name);
                let onnxSize = 0;
                try { onnxSize = fs.statSync(onnxFullPath).size; } catch { /* ignore */ }
                runFolder.children.push({
                    kind: 'runFile',
                    name: onnxEntry.name,
                    fullPath: onnxFullPath,
                    size: onnxSize,
                    parentFolder: runFolder,
                });
            }

            // 编号最大的 model_*.pt
            const bestPt = findLargestModelPt(dir);
            if (bestPt) {
                runFolder.children.push({
                    kind: 'runFile',
                    name: bestPt.name,
                    fullPath: bestPt.fullPath,
                    size: bestPt.size,
                    parentFolder: runFolder,
                });
            }

            const list = groupMap.get(groupKey) ?? [];
            list.push(runFolder);
            groupMap.set(groupKey, list);
            return; // 不再往下递归
        }

        // 不是 run folder，继续递归子目录
        for (const e of entries) {
            if (e.isDirectory()) {
                walk(path.join(dir, e.name), depth + 1);
            }
        }
    }

    walk(directory, 0);

    const result: TaskGroupNode[] = [];
    for (const [label, runs] of groupMap) {
        // 每个分组内按文件名时间降序（最新在前）
        runs.sort((a, b) => b.parsedTime - a.parsedTime);
        result.push({ kind: 'taskGroup', label, children: runs });
    }
    result.sort((a, b) => a.label.localeCompare(b.label));
    return result;
}

// ──────────────────────── TreeDataProvider ──────────────────────

class LogsExplorerProvider implements vscode.TreeDataProvider<LogsNode> {
    private _onDidChange = new vscode.EventEmitter<LogsNode | undefined | void>();
    readonly onDidChangeTreeData = this._onDidChange.event;

    private groups: TaskGroupNode[] = [];
    private logsDir = '';

    constructor() {
        this.logsDir = getLogsDirectory();
        this.rescan();
    }

    refresh(): void {
        this.logsDir = getLogsDirectory();
        this.rescan();
        this._onDidChange.fire();
    }

    private rescan(): void {
        if (!this.logsDir || !fs.existsSync(this.logsDir)) {
            this.groups = [];
            return;
        }
        const cfg = vscode.workspace.getConfiguration(EXTENSION_ID);
        const days = cfg.get<number>('logsDaysFilter', 3);
        const maxDepth = cfg.get<number>('logsScanDepth', 5);
        this.groups = scanLogsTree(this.logsDir, days, maxDepth);
    }

    // ──── TreeDataProvider API ────

    getTreeItem(element: LogsNode): vscode.TreeItem {
        if (element.kind === 'taskGroup') {
            const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.Expanded);
            item.iconPath = new vscode.ThemeIcon('folder-library');
            item.contextValue = 'taskGroup';
            item.description = `${element.children.length} runs`;
            return item;
        }

        if (element.kind === 'runFolder') {
            const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.Collapsed);
            item.iconPath = new vscode.ThemeIcon('folder');
            item.contextValue = 'runFolder';
            item.tooltip = element.folderPath;
            // 描述中显示子文件概要
            const names = element.children.map(c => c.name);
            item.description = names.join('  ');
            return item;
        }

        // runFile (onnx / pt)
        const item = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
        item.contextValue = 'onnxFile';
        item.description = formatSize(element.size);
        item.tooltip = element.fullPath;
        item.resourceUri = vscode.Uri.file(element.fullPath);
        if (element.name.endsWith('.onnx')) {
            item.iconPath = new vscode.ThemeIcon('file-binary');
        } else {
            item.iconPath = new vscode.ThemeIcon('file');
        }
        return item;
    }

    getChildren(element?: LogsNode): LogsNode[] {
        if (!element) {
            return this.groups;
        }
        if (element.kind === 'taskGroup') {
            return element.children;
        }
        if (element.kind === 'runFolder') {
            return element.children;
        }
        return [];
    }

    getParent(element: LogsNode): LogsNode | undefined {
        if (element.kind === 'runFile') {
            // 找到所属 runFolder
            return element.parentFolder;
        }
        if (element.kind === 'runFolder') {
            return this.groups.find(g => g.children.includes(element));
        }
        return undefined;
    }
}

// ──────────────────────── Helpers ──────────────────────────────

function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * 从一组节点中收集所有可复制的文件路径。
 * 选中 taskGroup → 展开所有 runFolder 的所有文件
 * 选中 runFolder → 展开其所有文件
 * 选中 runFile   → 该文件
 */
function collectFilePaths(nodes: LogsNode[]): string[] {
    const paths: string[] = [];
    for (const n of nodes) {
        if (n.kind === 'runFile') {
            paths.push(n.fullPath);
        } else if (n.kind === 'runFolder') {
            for (const c of n.children) paths.push(c.fullPath);
        } else if (n.kind === 'taskGroup') {
            for (const run of n.children) {
                for (const c of run.children) paths.push(c.fullPath);
            }
        }
    }
    return [...new Set(paths)]; // 去重
}

// ──────────────────── Command handlers ─────────────────────────

async function cmdSetLogsDirectory(provider: LogsExplorerProvider) {
    const current = getLogsDirectory();
    const picked = await vscode.window.showOpenDialog({
        canSelectFolders: true,
        canSelectFiles: false,
        canSelectMany: false,
        openLabel: '选择 Logs 目录',
        defaultUri: current ? vscode.Uri.file(current) : undefined,
    });
    if (!picked?.[0]) return;
    setLogsDirectoryPath(picked[0].fsPath);
    provider.refresh();
    vscode.window.showInformationMessage(`Logs 目录已设为: ${picked[0].fsPath}`);
}

/**
 * 复制选中文件到系统剪贴板（GNOME 格式），
 * 支持 Ctrl/Shift 多选，可在文件管理器中 Ctrl+V 粘贴。
 */
async function cmdCopyOnnxFiles(
    treeView: vscode.TreeView<LogsNode>,
    _clickedNode: LogsNode | undefined,
    _selectedNodes: LogsNode[] | undefined,
) {
    let nodes: LogsNode[] = _selectedNodes?.length ? _selectedNodes : [];
    if (!nodes.length) nodes = [...treeView.selection];
    if (!nodes.length && _clickedNode) nodes = [_clickedNode];

    const filePaths = collectFilePaths(nodes);
    if (!filePaths.length) {
        vscode.window.showWarningMessage('没有选中任何文件');
        return;
    }

    const content = 'copy\n' + filePaths.map(p => vscode.Uri.file(p).toString()).join('\n');
    const xclip = spawn('xclip', ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files']);
    xclip.on('error', () => {
        vscode.window.showErrorMessage('复制失败: 未找到 xclip。请运行: sudo apt install xclip');
    });
    xclip.stdin.write(content);
    xclip.stdin.end();
    xclip.on('close', (code) => {
        if (code === 0) {
            vscode.window.setStatusBarMessage(`已复制 ${filePaths.length} 个文件到剪贴板`, 3000);
        }
    });
}

async function cmdCopyOnnxFilePath(
    treeView: vscode.TreeView<LogsNode>,
    _clickedNode: LogsNode | undefined,
    _selectedNodes: LogsNode[] | undefined,
) {
    let nodes: LogsNode[] = _selectedNodes?.length ? _selectedNodes : [];
    if (!nodes.length) nodes = [...treeView.selection];
    if (!nodes.length && _clickedNode) nodes = [_clickedNode];

    const paths = collectFilePaths(nodes);
    if (!paths.length) return;
    await vscode.env.clipboard.writeText(paths.join('\n'));
    vscode.window.setStatusBarMessage(`已复制 ${paths.length} 条路径`, 2000);
}

async function cmdRevealOnnx(node: LogsNode | undefined) {
    if (!node) return;
    if (node.kind === 'runFile') {
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(node.fullPath));
    } else if (node.kind === 'runFolder') {
        await vscode.commands.executeCommand('revealInExplorer', vscode.Uri.file(node.folderPath));
    }
}

// ──────────────────── Registration ─────────────────────────────

export function registerLogsExplorerView(context: vscode.ExtensionContext): vscode.Disposable[] {
    const provider = new LogsExplorerProvider();

    const treeView = vscode.window.createTreeView(`${EXTENSION_ID}_logs`, {
        treeDataProvider: provider,
        canSelectMany: true,
        showCollapseAll: true,
    });

    // 设置变更时自动刷新
    const configWatcher = vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration(`${EXTENSION_ID}.logsDaysFilter`) ||
            e.affectsConfiguration(`${EXTENSION_ID}.logsScanDepth`)) {
            provider.refresh();
        }
    });

    const disposables: vscode.Disposable[] = [
        treeView,
        configWatcher,

        vscode.commands.registerCommand(`${EXTENSION_ID}.setLogsDirectory`, () =>
            cmdSetLogsDirectory(provider),
        ),

        vscode.commands.registerCommand(`${EXTENSION_ID}.refreshLogs`, () =>
            provider.refresh(),
        ),

        vscode.commands.registerCommand(
            `${EXTENSION_ID}.copyOnnxFiles`,
            (clickedNode?: LogsNode, selectedNodes?: LogsNode[]) =>
                cmdCopyOnnxFiles(treeView, clickedNode, selectedNodes),
        ),

        vscode.commands.registerCommand(
            `${EXTENSION_ID}.copyOnnxFilePath`,
            (clickedNode?: LogsNode, selectedNodes?: LogsNode[]) =>
                cmdCopyOnnxFilePath(treeView, clickedNode, selectedNodes),
        ),

        vscode.commands.registerCommand(
            `${EXTENSION_ID}.revealOnnxInExplorer`,
            (node?: LogsNode) => cmdRevealOnnx(node),
        ),
    ];

    return disposables;
}
