import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { spawn } from 'child_process';
import { EXTENSION_ID } from './constants';

export function registerCopyWithRefCommand(context: vscode.ExtensionContext) {
    return vscode.commands.registerCommand(`${EXTENSION_ID}.copy`, async () => {
        const editor = vscode.window.activeTextEditor;
        if (!editor) return;

        const selection = editor.selection;
        const filePath = editor.document.fileName;

        const startLine = selection.start.line + 1;
        const endLine = selection.end.line + 1;
        const lineRef = startLine === endLine ? `${startLine}` : `${startLine}-${endLine}`;

        const content = `@${filePath}:${lineRef}`;

        await vscode.env.clipboard.writeText(content);
        vscode.window.setStatusBarMessage(`Copied: ${filePath}:${lineRef}`, 2000);
    });
}

export function registerCopyFilesToSystemCommand() {
    return vscode.commands.registerCommand(
        `${EXTENSION_ID}.copyFilesToSystem`,
        async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            const targets = uris?.length ? uris : (uri ? [uri] : []);
            if (!targets.length) return;

            const content = 'copy\n' + targets.map(u => u.toString()).join('\n');

            const xclip = spawn('xclip', ['-selection', 'clipboard', '-t', 'x-special/gnome-copied-files']);
            xclip.on('error', () => {
                vscode.window.showErrorMessage('Copy to system clipboard failed: xclip not found. Run: sudo apt install xclip');
            });
            xclip.stdin.write(content);
            xclip.stdin.end();
            xclip.on('close', (code) => {
                if (code === 0) {
                    vscode.window.setStatusBarMessage(`Copied ${targets.length} file(s) to system clipboard`, 2000);
                }
            });
        }
    );
}

export function registerAddFavoriteFolderCommand(context: vscode.ExtensionContext) {
    return vscode.commands.registerCommand(
        `${EXTENSION_ID}.addFavoriteFolder`,
        async (uri: vscode.Uri) => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;

            const root = workspaceFolders[0].uri.fsPath;
            const relPath = path.relative(root, uri.fsPath);

            const favKey = `favoriteFolders.${root}`;
            const favs: string[] = context.workspaceState.get(favKey, []);

            if (favs.includes(relPath)) {
                vscode.window.showInformationMessage(`已在收藏中: ${relPath}`);
                return;
            }

            favs.push(relPath);
            context.workspaceState.update(favKey, favs);
            vscode.window.showInformationMessage(`已收藏文件夹: ${relPath}`);
        }
    );
}

export function registerRevealFolderCommand(context: vscode.ExtensionContext) {
    return vscode.commands.registerCommand(
        `${EXTENSION_ID}.revealFolderInExplorer`,
        async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) return;

            const root = workspaceFolders[0].uri.fsPath;
            const favKey = `favoriteFolders.${root}`;
            const favs: string[] = context.workspaceState.get(favKey, []);

            const output = await new Promise<string>((resolve, reject) => {
                const proc = spawn('find', [
                    root, '-type', 'd',
                    '-not', '-path', '*/.git/*',
                    '-not', '-path', '*/.git',
                    '-not', '-path', '*/node_modules/*',
                    '-not', '-path', '*/__pycache__/*',
                    '-not', '-path', '*/.venv/*',
                ]);
                let buf = '';
                proc.stdout.on('data', (data: Buffer) => { buf += data.toString(); });
                proc.on('close', () => resolve(buf));
                proc.on('error', reject);
            });

            const allDirs = output.trim().split('\n')
                .filter(d => d && d !== root)
                .map(d => path.relative(root, d))
                .sort();

            const favSet = new Set(favs);
            const topFavs = favs.filter(f => allDirs.includes(f)).slice(0, 10);
            const rest = allDirs.filter(d => !favSet.has(d));

            const quickPickItems: vscode.QuickPickItem[] = [];
            for (const f of topFavs) {
                quickPickItems.push({ label: `$(star-full) ${f}`, description: '收藏' });
            }
            if (topFavs.length > 0 && rest.length > 0) {
                quickPickItems.push({ label: '──────────', kind: vscode.QuickPickItemKind.Separator });
            }
            for (const d of rest) {
                quickPickItems.push({ label: d });
            }

            const selected = await vscode.window.showQuickPick(quickPickItems, {
                placeHolder: '搜索文件夹，选中后在资源管理器中展开',
            });

            if (selected && selected.kind !== vscode.QuickPickItemKind.Separator) {
                const cleanLabel = selected.label.replace(/^\$\(star-full\)\s*/, '');
                const uri = vscode.Uri.file(path.join(root, cleanLabel));
                await vscode.commands.executeCommand('revealInExplorer', uri);
            }
        }
    );
}

export function registerCopyFileNameCommand() {
    return vscode.commands.registerCommand(
        `${EXTENSION_ID}.copyFileName`,
        async (uri: vscode.Uri) => {
            if (!uri) return;
            const fileName = path.basename(uri.fsPath);
            await vscode.env.clipboard.writeText(fileName);
            vscode.window.setStatusBarMessage(`Copied: ${fileName}`, 2000);
        }
    );
}

function runDeleteModelFilesScript(
    pythonBin: string,
    scriptPath: string,
    folderPath: string,
    channel: vscode.OutputChannel,
    opts: { ptLimit: number; modelMaxExclusive: number }
): Promise<number> {
    return new Promise((resolve) => {
        const proc = spawn(pythonBin, [
            scriptPath,
            '--path',
            folderPath,
            '--yes',
            '--folder-purge-pt-limit',
            String(opts.ptLimit),
            '--folder-purge-model-max',
            String(opts.modelMaxExclusive),
        ], {
            env: process.env,
        });
        proc.stdout.on('data', (data: Buffer) => {
            channel.append(data.toString());
        });
        proc.stderr.on('data', (data: Buffer) => {
            channel.append(data.toString());
        });
        proc.on('error', (err) => {
            channel.appendLine(String(err));
            resolve(1);
        });
        proc.on('close', (code) => {
            resolve(code ?? 1);
        });
    });
}

export function registerDeleteModelFilesCommand(context: vscode.ExtensionContext) {
    const channel = vscode.window.createOutputChannel('delete_model_files');
    context.subscriptions.push(channel);

    return vscode.commands.registerCommand(
        `${EXTENSION_ID}.deleteModelFiles`,
        async (uri: vscode.Uri, uris?: vscode.Uri[]) => {
            let targets: vscode.Uri[] = [];
            if (uris && uris.length > 0) {
                targets = uris;
            } else if (uri) {
                targets = [uri];
            } else {
                const picked = await vscode.window.showOpenDialog({
                    canSelectFolders: true,
                    canSelectFiles: false,
                    canSelectMany: true,
                    openLabel: '选择要整理的文件夹',
                });
                if (!picked?.length) {
                    return;
                }
                targets = picked;
            }

            const folders = targets.filter((u) => {
                try {
                    return fs.statSync(u.fsPath).isDirectory();
                } catch {
                    return false;
                }
            });
            if (!folders.length) {
                vscode.window.showWarningMessage('delete_model_files：请选择文件夹。');
                return;
            }

            const scriptPath = path.join(context.extensionPath, 'other_files', 'delete_model_files.py');
            if (!fs.existsSync(scriptPath)) {
                vscode.window.showErrorMessage(`未找到脚本: ${scriptPath}`);
                return;
            }

            const cfg = vscode.workspace.getConfiguration('trainning_extension');
            const pythonBin = cfg.get<string>('deleteModelFilesPython', 'python3');
            let ptLimit = cfg.get<number>('deleteModelFilesFolderPurgePtLimit', 8);
            let modelMaxExclusive = cfg.get<number>('deleteModelFilesFolderPurgeModelMax', 5000);
            if (!Number.isFinite(ptLimit) || ptLimit < 1) {
                vscode.window.showWarningMessage('deleteModelFilesFolderPurgePtLimit 无效，已改用 8。');
                ptLimit = 8;
            } else {
                ptLimit = Math.floor(ptLimit);
            }
            if (!Number.isFinite(modelMaxExclusive) || modelMaxExclusive < 0) {
                vscode.window.showWarningMessage('deleteModelFilesFolderPurgeModelMax 无效，已改用 5000。');
                modelMaxExclusive = 5000;
            } else {
                modelMaxExclusive = Math.floor(modelMaxExclusive);
            }

            const preview = folders.map((f) => f.fsPath).join('\n');
            const pick = await vscode.window.showWarningMessage(
                `delete_model_files 将在 ${folders.length} 个目录下执行：删除「少于 ${ptLimit} 个 .pt 且 model 编号均 <${modelMaxExclusive}」的直接子文件夹，并把各目录中 model_*.pt 裁减为保留编号最大的 2 个。操作不可撤销。\n\n${preview}`,
                { modal: true },
                '确定执行',
                '取消'
            );
            if (pick !== '确定执行') {
                return;
            }

            channel.clear();
            channel.show(true);
            channel.appendLine(`脚本: ${scriptPath}`);
            channel.appendLine(`Python: ${pythonBin}`);
            channel.appendLine(`folder-purge-pt-limit: ${ptLimit}`);
            channel.appendLine(`folder-purge-model-max: ${modelMaxExclusive}`);

            let hadError = false;
            for (const folderUri of folders) {
                const fp = folderUri.fsPath;
                channel.appendLine(`\n${'='.repeat(60)}\n>>> ${fp}\n${'='.repeat(60)}`);
                const code = await runDeleteModelFilesScript(pythonBin, scriptPath, fp, channel, {
                    ptLimit,
                    modelMaxExclusive,
                });
                if (code !== 0) {
                    hadError = true;
                }
            }

            if (hadError) {
                vscode.window.showWarningMessage('delete_model_files 已结束，部分步骤返回非零退出码，请查看输出面板。');
            } else {
                vscode.window.showInformationMessage('delete_model_files 已完成。');
            }
        }
    );
}

export function registerKillPythonDebugCommand() {
    return vscode.commands.registerCommand(`${EXTENSION_ID}.killPythonDebug`, () => {
        const proc = spawn('sudo', ['pkill', '-9', '-f', 'python.*debug'], { stdio: 'ignore' });
        proc.on('close', (code) => {
            if (code === 0) {
                vscode.window.showInformationMessage('已终止所有 Python 调试进程');
            } else {
                vscode.window.showInformationMessage('没有找到 Python 调试进程，或已全部终止');
            }
        });
        proc.on('error', () => {
            vscode.window.showErrorMessage('执行 sudo pkill 失败，请确认 sudo 免密配置');
        });
        vscode.debug.stopDebugging();
    });
}
