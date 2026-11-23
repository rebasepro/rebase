/**
 * Every built file a runtime loads from these packages holds no character
 * above U+00FF.
 *
 * V8 keeps a module's source for the life of the process and stores it one
 * byte per character only when every character fits in Latin-1; a single em
 * dash doubles the whole file. The builds write such characters in literals as
 * `\u` escapes and fail on any they cannot (tooling/scripts/one-byte-source.ts),
 * so this only fails if a package stops running that step — which costs every
 * runtime several megabytes and is otherwise invisible.
 *
 * It follows the files a consumer can actually reach — each export, then every
 * relative `import`/`import()` from there — rather than listing `dist/`, which
 * keeps the chunks of earlier builds until something deletes them.
 */
import { strict as assert } from "node:assert";
import { test } from "node:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The packages whose built source a Rebase runtime loads. */
const RUNTIME_PACKAGES = ["server", "server-postgres", "common", "types", "utils"];

const WIDE = /[\u0100-\uffff]/;
const RELATIVE_IMPORT = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["'](\.{1,2}\/[^"']+\.js)["']/g;

function exportTargets(dir) {
    const manifest = JSON.parse(readFileSync(path.join(dir, "package.json"), "utf8"));
    const targets = new Set();
    const walk = (node) => {
        if (typeof node === "string") {
            if (node.endsWith(".js")) targets.add(path.join(dir, node));
        } else if (node && typeof node === "object") {
            for (const [condition, value] of Object.entries(node)) if (condition !== "types") walk(value);
        }
    };
    walk(manifest.exports);
    if (typeof manifest.main === "string") targets.add(path.join(dir, manifest.main));
    return [...targets].filter(existsSync);
}

function reachableFiles(entries) {
    const seen = new Set();
    const queue = [...entries];
    while (queue.length > 0) {
        const file = queue.pop();
        if (seen.has(file) || !existsSync(file)) continue;
        seen.add(file);
        for (const match of readFileSync(file, "utf8").matchAll(RELATIVE_IMPORT)) {
            queue.push(path.resolve(path.dirname(file), match[1]));
        }
    }
    return [...seen];
}

for (const name of RUNTIME_PACKAGES) {
    const dir = path.join(ROOT, "packages", name);
    const entries = existsSync(path.join(dir, "dist")) ? exportTargets(dir) : [];
    test(`@rebasepro/${name}: every built file a runtime can load is one byte per character`, { skip: entries.length === 0 && "not built" }, () => {
        const files = reachableFiles(entries);
        assert.ok(files.length > 0);
        const wide = files
            .map(file => {
                const text = readFileSync(file, "utf8");
                const at = text.search(WIDE);
                return at === -1 ? undefined : `${path.relative(ROOT, file)}: ${JSON.stringify(text.slice(Math.max(0, at - 50), at + 10))}`;
            })
            .filter(Boolean);
        assert.deepEqual(wide, [], "these files are stored as UTF-16 by V8; is `oneByteSource()` in the package's vite config?");
    });
}
