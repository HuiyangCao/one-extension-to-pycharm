"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const fs = require("fs");
const os = require("os");
const path = require("path");
const config_1 = require("./config");
const actions_1 = require("./actions");
const debug_1 = require("./debug");
const commandManager_1 = require("./commandManager");
const sshManager_1 = require("./sshManager");
const webExplorer_1 = require("./webExplorer");
function activate(context) {
    const jetbrainsFlagFile = path.join(os.homedir(), '.config', 'trainning_extension', 'jetbrains_mode_enabled');
    const shouldApplyJetbrainsPreset = (() => {
        try {
            const raw = fs.readFileSync(jetbrainsFlagFile, 'utf8').trim();
            return raw !== '0';
        }
        catch {
            // Default to enabled for backward compatibility when flag file is absent.
            return true;
        }
    })();
    if (shouldApplyJetbrainsPreset) {
        const cfg = (0, config_1.loadConfig)(context.extensionPath);
        (0, config_1.applySettings)(context, cfg.settings);
        (0, config_1.applyUserKeybindings)(context, cfg.keybindings);
    }
    const cmd = (0, actions_1.registerCopyWithRefCommand)(context);
    const copyFilesCmd = (0, actions_1.registerCopyFilesToSystemCommand)();
    const addFavoriteFolderCmd = (0, actions_1.registerAddFavoriteFolderCommand)(context);
    const revealFolderCmd = (0, actions_1.registerRevealFolderCommand)(context);
    const copyFileNameCmd = (0, actions_1.registerCopyFileNameCommand)();
    const deleteModelFilesCmd = (0, actions_1.registerDeleteModelFilesCommand)(context);
    const killPythonDebugCmd = (0, actions_1.registerKillPythonDebugCommand)();
    const debugProvider = (0, debug_1.registerDebugConfigurationProviderAndCommand)(context);
    const cmdMgrDisposables = (0, commandManager_1.registerCommandManagerView)(context);
    const sshDisposables = (0, sshManager_1.registerSshServerView)(context);
    const webDisposables = (0, webExplorer_1.registerWebExplorerView)(context);
    context.subscriptions.push(cmd, copyFilesCmd, addFavoriteFolderCmd, revealFolderCmd, copyFileNameCmd, deleteModelFilesCmd, killPythonDebugCmd, debugProvider, ...cmdMgrDisposables, ...sshDisposables, ...webDisposables);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map