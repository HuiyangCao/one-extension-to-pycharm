"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activate = activate;
exports.deactivate = deactivate;
const config_1 = require("./config");
const commands_1 = require("./commands");
const debug_1 = require("./debug");
const commandManager_1 = require("./commandManager");
function activate(context) {
    const cfg = (0, config_1.loadConfig)(context.extensionPath);
    (0, config_1.applySettings)(context, cfg.settings);
    (0, config_1.applyUserKeybindings)(context, cfg.keybindings);
    const cmd = (0, commands_1.registerCopyWithRefCommand)(context);
    const copyFilesCmd = (0, commands_1.registerCopyFilesToSystemCommand)();
    const addFavoriteFolderCmd = (0, commands_1.registerAddFavoriteFolderCommand)(context);
    const revealFolderCmd = (0, commands_1.registerRevealFolderCommand)(context);
    const copyFileNameCmd = (0, commands_1.registerCopyFileNameCommand)();
    const killPythonDebugCmd = (0, commands_1.registerKillPythonDebugCommand)();
    const debugProvider = (0, debug_1.registerDebugConfigurationProviderAndCommand)(context);
    const cmdMgrDisposables = (0, commandManager_1.registerCommandManagerView)(context);
    context.subscriptions.push(cmd, copyFilesCmd, addFavoriteFolderCmd, revealFolderCmd, copyFileNameCmd, killPythonDebugCmd, debugProvider, ...cmdMgrDisposables);
}
function deactivate() { }
//# sourceMappingURL=extension.js.map