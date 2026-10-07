/**
 * A CommonJS stand-in for `lucide-react/dynamicIconImports.mjs`, which jest's
 * CommonJS runtime cannot import. Built from the real table: every key it has,
 * mapped to the icon its file defines, taken from lucide's CommonJS build.
 * `loads` records the keys fetched, so a test can count them.
 */
const fs = require("node:fs");
const path = require("node:path");
const { icons } = require("lucide-react");

const root = path.dirname(require.resolve("lucide-react/package.json"));
const table = fs.readFileSync(path.join(root, "dist/esm/dynamicIconImports.mjs"), "utf8");

const loads = [];
const imports = {};
for (const [, key, file] of table.matchAll(/"([a-z0-9-]+)": \(\) => import\('\.\/icons\/([a-z0-9-]+)\.mjs'\)/g)) {
    const source = fs.readFileSync(path.join(root, "dist/esm/icons", `${file}.mjs`), "utf8");
    const name = /const (\w+) = createLucideIcon\(/.exec(source)[1];
    imports[key] = () => {
        loads.push(key);
        return Promise.resolve({ default: icons[name] });
    };
}

module.exports = { __esModule: true, default: imports, loads };
