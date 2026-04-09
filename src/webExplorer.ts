import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { EXTENSION_ID } from './constants';

interface BookmarkNode {
    kind: 'bookmark';
    name: string;
    url: string;
}

const BOOKMARKS_PATH = path.join(os.homedir(), '.config', 'trainning_extension', 'bookmarks.json');

/**
 * 确保目录存在
 */
function ensureDir(): void {
    const dir = path.dirname(BOOKMARKS_PATH);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

/**
 * 读取书签列表
 */
function readBookmarks(): BookmarkNode[] {
    try {
        ensureDir();
        if (!fs.existsSync(BOOKMARKS_PATH)) {
            return [];
        }
        const content = fs.readFileSync(BOOKMARKS_PATH, 'utf-8');
        const parsed = JSON.parse(content);
        return Array.isArray(parsed) ? parsed : [];
    } catch (error) {
        console.error('Error reading bookmarks:', error);
        return [];
    }
}

/**
 * 写入书签列表
 */
function writeBookmarks(bookmarks: BookmarkNode[]): void {
    try {
        ensureDir();
        fs.writeFileSync(BOOKMARKS_PATH, JSON.stringify(bookmarks, null, 2), 'utf-8');
    } catch (error) {
        console.error('Error writing bookmarks:', error);
        vscode.window.showErrorMessage('Failed to save bookmarks');
    }
}

class WebExplorerProvider implements vscode.TreeDataProvider<BookmarkNode> {
    private _onDidChangeTreeData: vscode.EventEmitter<BookmarkNode | undefined | void> =
        new vscode.EventEmitter<BookmarkNode | undefined | void>();
    readonly onDidChangeTreeData: vscode.Event<BookmarkNode | undefined | void> =
        this._onDidChangeTreeData.event;

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: BookmarkNode): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(element.name, vscode.TreeItemCollapsibleState.None);
        treeItem.tooltip = element.url;
        treeItem.iconPath = new vscode.ThemeIcon('globe');
        treeItem.contextValue = 'bookmarkItem';
        treeItem.command = {
            command: `${EXTENSION_ID}.openBookmark`,
            title: 'Open Bookmark',
            arguments: [element],
        };
        return treeItem;
    }

    getChildren(element?: BookmarkNode): Thenable<BookmarkNode[]> {
        // 只有一层，无 children
        if (element) {
            return Promise.resolve([]);
        }

        const bookmarks = readBookmarks();
        return Promise.resolve(bookmarks);
    }
}

/**
 * 添加书签：两步输入框（名称 + URL）
 */
async function addBookmark(provider: WebExplorerProvider) {
    const name = await vscode.window.showInputBox({
        prompt: '书签名称',
        placeHolder: 'e.g. GitHub',
    });

    if (!name) {
        return;
    }

    const url = await vscode.window.showInputBox({
        prompt: '网址 URL',
        value: 'https://',
        placeHolder: 'https://example.com',
        validateInput: (value) => {
            if (!value.match(/^https?:\/\//i)) {
                return '网址必须以 http:// 或 https:// 开头';
            }
            return '';
        },
    });

    if (!url) {
        return;
    }

    const bookmarks = readBookmarks();
    bookmarks.push({ kind: 'bookmark', name, url });
    writeBookmarks(bookmarks);
    provider.refresh();
    vscode.window.showInformationMessage(`✓ 书签 "${name}" 已添加`);
}

/**
 * 删除书签
 */
async function removeBookmark(node: BookmarkNode, provider: WebExplorerProvider) {
    if (!node || node.kind !== 'bookmark') {
        return;
    }

    const confirmed = await vscode.window.showWarningMessage(
        `确定删除书签 "${node.name}" 吗？`,
        { modal: true },
        '删除'
    );

    if (confirmed === '删除') {
        const bookmarks = readBookmarks().filter(b => !(b.name === node.name && b.url === node.url));
        writeBookmarks(bookmarks);
        provider.refresh();
        vscode.window.showInformationMessage(`✓ 书签已删除`);
    }
}

/**
 * 打开书签
 * 优先使用 Simple Browser（VSCode 内部 tab）
 */
async function openBookmark(node: BookmarkNode) {
    if (!node || node.kind !== 'bookmark') {
        return;
    }

    try {
        // 优先尝试 Simple Browser（VSCode 1.76+ 内置）
        await vscode.commands.executeCommand('simpleBrowser.show', node.url);
    } catch (error) {
        // fallback 到系统浏览器
        try {
            await vscode.env.openExternal(vscode.Uri.parse(node.url));
        } catch (fallbackError) {
            vscode.window.showErrorMessage(`无法打开网址: ${node.url}`);
        }
    }
}

/**
 * 注册 Web Explorer 视图
 */
export function registerWebExplorerView(context: vscode.ExtensionContext): vscode.Disposable[] {
    const provider = new WebExplorerProvider();
    const treeView = vscode.window.createTreeView(`${EXTENSION_ID}_web`, {
        treeDataProvider: provider,
        showCollapseAll: false,
    });

    // 注册命令
    const addBookmarkCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.addBookmark`, () =>
        addBookmark(provider)
    );

    const removeBookmarkCmd = vscode.commands.registerCommand(
        `${EXTENSION_ID}.removeBookmark`,
        (node: BookmarkNode) => removeBookmark(node, provider)
    );

    const openBookmarkCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.openBookmark`, openBookmark);

    const refreshWebCmd = vscode.commands.registerCommand(`${EXTENSION_ID}.refreshWeb`, () => {
        provider.refresh();
    });

    return [treeView, addBookmarkCmd, removeBookmarkCmd, openBookmarkCmd, refreshWebCmd];
}
