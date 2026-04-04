import * as vscode from 'vscode';
import { loadConfig, applySettings, applyUserKeybindings } from './config';
import {
    registerCopyWithRefCommand,
    registerCopyFilesToSystemCommand,
    registerAddFavoriteFolderCommand,
    registerRevealFolderCommand,
    registerCopyFileNameCommand,
    registerKillPythonDebugCommand,
} from './actions';
import { registerDebugConfigurationProviderAndCommand } from './debug';
import { registerCommandManagerView } from './commandManager';
import { registerSshServerView } from './sshManager';
import { registerWebExplorerView } from './webExplorer';

export function activate(context: vscode.ExtensionContext) {
    const cfg = loadConfig(context.extensionPath);
    applySettings(context, cfg.settings);
    applyUserKeybindings(context, cfg.keybindings);

    const cmd = registerCopyWithRefCommand(context);
    const copyFilesCmd = registerCopyFilesToSystemCommand();
    const addFavoriteFolderCmd = registerAddFavoriteFolderCommand(context);
    const revealFolderCmd = registerRevealFolderCommand(context);
    const copyFileNameCmd = registerCopyFileNameCommand();
    const killPythonDebugCmd = registerKillPythonDebugCommand();
    const debugProvider = registerDebugConfigurationProviderAndCommand(context);
    const cmdMgrDisposables = registerCommandManagerView(context);
    const sshDisposables = registerSshServerView(context);
    const webDisposables = registerWebExplorerView(context);

    context.subscriptions.push(cmd, copyFilesCmd, addFavoriteFolderCmd, revealFolderCmd, copyFileNameCmd, killPythonDebugCmd, debugProvider, ...cmdMgrDisposables, ...sshDisposables, ...webDisposables);
}

export function deactivate() {}
