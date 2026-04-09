const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PACKAGE_PATH = path.join(ROOT, 'package.json');
const CONTRIBUTES_DIR = path.join(ROOT, 'contributes');

function deduplicateBy(arr, keyFn) {
    const seen = new Set();
    const result = [];
    for (const item of arr) {
        const key = JSON.stringify(keyFn(item));
        if (!seen.has(key)) {
            seen.add(key);
            result.push(item);
        }
    }
    return result;
}

function mergeContributes() {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_PATH, 'utf-8'));

    // Reset contributes arrays/objects to empty before merging
    pkg.contributes.commands = [];
    pkg.contributes.viewsContainers = {};
    pkg.contributes.views = {};
    pkg.contributes.menus = {};
    pkg.contributes.keybindings = [];

    // Read all JSON files from contributes directory
    const files = fs.readdirSync(CONTRIBUTES_DIR).filter(f => f.endsWith('.json'));

    let configurationTitle = 'Trainning Extension';
    const configurationProperties = {};

    for (const file of files) {
        const filePath = path.join(CONTRIBUTES_DIR, file);
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

        // Merge commands
        if (data.commands) {
            pkg.contributes.commands.push(...data.commands);
        }

        // Merge viewsContainers (if any)
        if (data.viewsContainers) {
            for (const [container, items] of Object.entries(data.viewsContainers)) {
                if (!pkg.contributes.viewsContainers[container]) {
                    pkg.contributes.viewsContainers[container] = [];
                }
                pkg.contributes.viewsContainers[container].push(...items);
            }
        }

        // Merge views
        if (data.views) {
            for (const [container, items] of Object.entries(data.views)) {
                if (!pkg.contributes.views[container]) {
                    pkg.contributes.views[container] = [];
                }
                pkg.contributes.views[container].push(...items);
            }
        }

        // Merge menus
        if (data.menus) {
            for (const [menu, items] of Object.entries(data.menus)) {
                if (!pkg.contributes.menus[menu]) {
                    pkg.contributes.menus[menu] = [];
                }
                pkg.contributes.menus[menu].push(...items);
            }
        }

        // Merge keybindings
        if (data.keybindings) {
            pkg.contributes.keybindings.push(...data.keybindings);
        }

        // Merge configuration.properties
        if (data.configuration) {
            if (data.configuration.title) {
                configurationTitle = data.configuration.title;
            }
            if (data.configuration.properties) {
                Object.assign(configurationProperties, data.configuration.properties);
            }
        }
    }

    if (Object.keys(configurationProperties).length > 0) {
        pkg.contributes.configuration = {
            title: configurationTitle,
            properties: configurationProperties,
        };
    } else {
        delete pkg.contributes.configuration;
    }

    // Deduplicate all arrays
    pkg.contributes.commands = deduplicateBy(pkg.contributes.commands, item => ({ command: item.command }));
    pkg.contributes.keybindings = deduplicateBy(pkg.contributes.keybindings, item => ({ key: item.key, command: item.command }));

    for (const container of Object.keys(pkg.contributes.viewsContainers)) {
        pkg.contributes.viewsContainers[container] = deduplicateBy(
            pkg.contributes.viewsContainers[container],
            item => ({ id: item.id })
        );
    }

    for (const container of Object.keys(pkg.contributes.views)) {
        pkg.contributes.views[container] = deduplicateBy(
            pkg.contributes.views[container],
            item => ({ id: item.id })
        );
    }

    for (const menu of Object.keys(pkg.contributes.menus)) {
        pkg.contributes.menus[menu] = deduplicateBy(
            pkg.contributes.menus[menu],
            item => ({ command: item.command, when: item.when, group: item.group })
        );
    }

    // Write back to package.json
    fs.writeFileSync(PACKAGE_PATH, JSON.stringify(pkg, null, 2) + '\n');
    console.log('✓ Merged', files.length, 'contribute files into package.json');
}

mergeContributes();
