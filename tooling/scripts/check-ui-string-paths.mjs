#!/usr/bin/env node
/**
 * No string the admin renders points at a file in *this* repository.
 *
 * The backups pane told people "See docs/backups.md". There is no such file in
 * a Rebase project — it is (or was) a path in the Rebase source tree, and a
 * reader following it looks in their own repo, finds nothing, and has no way to
 * discover that the sentence was written from the wrong side of the boundary.
 * `rebase.pro/docs/...` is a URL anyone can open; `docs/backups.md` is a
 * reference only a contributor can resolve.
 *
 * A path inside the *reader's* project is the opposite: `backend/crons/` and
 * `backend/schema/` are exactly what a remedy should name, and this check
 * leaves them alone. What it rejects is the repository's own furniture —
 * `docs/*.md`, `README.md`, `packages/…`, `tooling/…`, `website/…` — and the
 * project furniture a scaffold no longer has: since 0.31 there is no `config/`
 * package (tables are `backend/schema/`, resources, storage and hooks are
 * `backend/resources.ts`, `backend/storage.ts`, `backend/hooks.ts`), so a
 * remedy naming `config/collections/` sends the reader to a directory their
 * project does not have — the same failure from the other side.
 *
 *     pnpm check:ui-string-paths
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SCANNED = [
    "packages/app/src/locales",
    "packages/studio/src",
    "packages/cms/src"
];

const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;

/** Repository furniture, not anything in a reader's project. */
const REPO_PATH = /\b(?:docs\/[a-z0-9-]+\.md|README\.md|packages\/[a-z-]+\/|tooling\/[a-z-]+\/|website\/src\/)/;

/** The `config/` package a project had before 0.31, and what replaced each part. */
const RETIRED_PROJECT_PATH = /\bconfig\/(?:collections\b|resources\.ts|storage\.ts|index\.ts|cms\.d\.ts|admin\.d\.ts)/;

function files(dir) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) return [];
    const out = [];
    const walk = (d) => {
        for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
            const full = path.join(d, entry.name);
            if (entry.isDirectory()) {
                if (!/node_modules|dist/.test(full)) walk(full);
            } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
                out.push(full);
            }
        }
    };
    walk(abs);
    return out;
}

const findings = [];

for (const file of SCANNED.flatMap(files)) {
    const rel = path.relative(ROOT, file);
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
        const trimmed = line.trim();
        // A comment naming a source file is how this codebase cites its own
        // history, and is not rendered anywhere.
        if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
        // Imports and module specifiers are paths by definition.
        if (/^\s*(?:import|export)\b/.test(line) || /\b(?:from|require|import)\s*\(?\s*["']/.test(line)) return;

        // Only inside a quoted string or a JSX text run — a bare identifier
        // that happens to look like a path is not something anyone reads.
        for (const m of line.matchAll(/"([^"]{4,})"|'([^']{4,})'|>([^<>{}]{4,})</g)) {
            const text = m[1] ?? m[2] ?? m[3];
            // A className, a URL, a route.
            if (/^https?:\/\//.test(text) || /(?:^|\s)(?:text|bg|px|py|flex|rounded|font)-/.test(text)) continue;
            const retired = RETIRED_PROJECT_PATH.test(text);
            if (!REPO_PATH.test(text) && !retired) continue;
            findings.push({ file: rel, line: i + 1, text: text.trim().slice(0, 100), retired });
        }
    });
}

if (findings.length === 0) {
    console.log(green("✓ UI strings: no reference to a file in this repository, or to the retired config/ package."));
    process.exit(0);
}

console.error(red(`\n✗ ${findings.length} UI string(s) point at a file the reader's project does not have:\n`));
for (const f of findings) {
    console.error(`  ${bold(`${f.file}:${f.line}`)}${f.retired ? dim("  (the config/ package, gone since 0.31)") : ""}`);
    console.error(`    ${f.text}`);
}
console.error(dim(
    "\n  A reader following it looks in their own project and finds nothing.\n" +
    "  Link `https://rebase.pro/docs/...`, or name a path that exists in a\n" +
    "  scaffolded project (`backend/crons/`, `backend/schema/`, `frontend/src/cms/`).\n"
));
process.exit(1);
