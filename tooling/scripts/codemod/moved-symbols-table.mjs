#!/usr/bin/env node
/**
 * Write the migration codemod's moved-symbol table from the guard files.
 *
 *   node tooling/scripts/codemod/moved-symbols-table.mjs           # write it
 *   node tooling/scripts/codemod/moved-symbols-table.mjs --check   # exit 1 when it is stale
 *
 * The symbols that left `@rebasepro/types` / `@rebasepro/common` (or moved
 * between packages) are recorded in two files next to the headless guard:
 *
 * - `tooling/scripts/headless-guard/moved-symbols.json` — `{ symbol, from, to,
 *   instead?, as? }` for every move (`to: null` = removed, `instead` says what
 *   to write; `as` = renamed on the way);
 * - `tooling/scripts/headless-guard/cms-only-symbols.json` — the symbols the
 *   guard refuses back in the kernel, keyed by destination package, with no
 *   `from`.
 *
 * `rebase migrate sdk-calls` rewrites a project's imports from that table, but
 * the CLI is published and cannot read `tooling/` at run time, so this script
 * writes it as a checked-in module:
 * `packages/cli/src/codemod/collections-to-tables/moved-symbols.generated.ts`.
 * A symbol `cms-only-symbols.json` names that `moved-symbols.json` does not
 * gets its `from` derived from the last release (`v0.30.1`): the kernel
 * package whose entry point exported it then. A symbol neither exported is an
 * error, so a typo cannot ship as a silent no-op.
 *
 * Re-run it after every change to either JSON file;
 * `packages/cli/src/codemod/collections-to-tables/moved-imports.test.ts`
 * fails while the module and the JSON disagree. Never edit the output by hand.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const MOVES_FILE = "tooling/scripts/headless-guard/moved-symbols.json";
const CMS_ONLY_FILE = "tooling/scripts/headless-guard/cms-only-symbols.json";
const OUTPUT = "packages/cli/src/codemod/collections-to-tables/moved-symbols.generated.ts";
/** The release a project migrates from: where a missing `from` is read. */
const BASE_REF = "v0.30.1";
const KERNEL = [
    { name: "@rebasepro/types", entry: "packages/types/src/index.ts" },
    { name: "@rebasepro/common", entry: "packages/common/src/index.ts" }
];

function git(...args) {
    return execFileSync("git", ["-c", "core.fsmonitor=false", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

/**
 * Every name a module exports at `ref`, following `export *` and
 * `export { … } from` through relative modules.
 *
 * @param {string} ref a git revision
 * @param {string} entry the module, relative to the repository root
 * @returns {Set<string>}
 */
export function exportedNamesAt(ref, entry) {
    const files = new Set(git("ls-tree", "-r", "--name-only", ref, path.posix.dirname(entry)).split("\n").filter(Boolean));
    const resolve = (from, specifier) => {
        const base = path.posix.normalize(path.posix.join(path.posix.dirname(from), specifier));
        const stripped = base.replace(/\.(js|mjs|ts|tsx)$/, "");
        for (const candidate of [`${stripped}.ts`, `${stripped}.tsx`, `${stripped}/index.ts`, `${stripped}/index.tsx`]) {
            if (files.has(candidate)) return candidate;
        }
        return undefined;
    };
    const cache = new Map();
    const visit = (file) => {
        if (cache.has(file)) return cache.get(file);
        const names = new Set();
        cache.set(file, names);
        const source = ts.createSourceFile(file, git("show", `${ref}:${file}`), ts.ScriptTarget.Latest, true);
        const exported = (node) => ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword);
        for (const statement of source.statements) {
            if (ts.isExportDeclaration(statement)) {
                const specifier = statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier) ? statement.moduleSpecifier.text : undefined;
                if (!statement.exportClause) {
                    const target = specifier?.startsWith(".") ? resolve(file, specifier) : undefined;
                    if (target) for (const name of visit(target)) names.add(name);
                } else if (ts.isNamedExports(statement.exportClause)) {
                    for (const element of statement.exportClause.elements) names.add(element.name.text);
                } else if (ts.isNamespaceExport(statement.exportClause)) {
                    names.add(statement.exportClause.name.text);
                }
                continue;
            }
            if (!exported(statement)) continue;
            if (ts.isVariableStatement(statement)) {
                for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
            } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isInterfaceDeclaration(statement) ||
                ts.isTypeAliasDeclaration(statement) || ts.isEnumDeclaration(statement) || ts.isModuleDeclaration(statement)) && statement.name) {
                names.add(statement.name.text);
            }
        }
        return names;
    };
    return visit(entry);
}

function readJson(file) {
    return JSON.parse(readFileSync(path.join(ROOT, file), "utf8"));
}

/**
 * The rows of the table, sorted, from the two JSON files.
 *
 * @returns {{ symbol: string; from: string; to: string | null; as?: string; instead?: string }[]}
 */
export function buildRows() {
    const moves = readJson(MOVES_FILE).moves;
    const cmsOnly = readJson(CMS_ONLY_FILE).moved;
    const rows = new Map();
    const key = (symbol, from) => `${from}\0${symbol}`;
    for (const move of moves) {
        if (typeof move.symbol !== "string" || typeof move.from !== "string" || !(typeof move.to === "string" || move.to === null)) {
            throw new Error(`${MOVES_FILE}: a row needs symbol, from and to (a package or null): ${JSON.stringify(move)}`);
        }
        if (move.to === null && typeof move.instead !== "string") throw new Error(`${MOVES_FILE}: ${move.symbol} is removed (to: null) and says nothing instead`);
        const rename = move.as ?? move.rename;
        rows.set(key(move.symbol, move.from), {
            symbol: move.symbol,
            from: move.from,
            to: move.to,
            ...(typeof rename === "string" && rename !== move.symbol ? { as: rename } : {}),
            ...(typeof move.instead === "string" ? { instead: move.instead } : {})
        });
    }
    let exportsAtBase;
    for (const [to, symbols] of Object.entries(cmsOnly)) {
        for (const symbol of symbols) {
            if ([...rows.values()].some(row => row.symbol === symbol && row.to === to)) continue;
            exportsAtBase ??= KERNEL.map(pkg => ({ name: pkg.name, names: exportedNamesAt(BASE_REF, pkg.entry) }));
            const from = exportsAtBase.find(pkg => pkg.names.has(symbol))?.name;
            if (!from) throw new Error(`${CMS_ONLY_FILE}: ${symbol} (→ ${to}) was not exported by ${KERNEL.map(pkg => pkg.name).join(" or ")} at ${BASE_REF}; record its from in ${MOVES_FILE}`);
            rows.set(key(symbol, from), { symbol, from, to });
        }
    }
    return [...rows.values()].sort((a, b) => a.from.localeCompare(b.from) || a.symbol.localeCompare(b.symbol));
}

/** The module's text. */
export function render(rows) {
    const lines = [
        "/**",
        " * GENERATED by tooling/scripts/codemod/moved-symbols-table.mjs from",
        ` * ${MOVES_FILE} and`,
        ` * ${CMS_ONLY_FILE} — do not edit by hand: change`,
        " * the JSON and run the script again. `moved-imports.test.ts` fails while they disagree.",
        " *",
        " * Every symbol that left a package's root in 0.31: `to` is the package to import it from now",
        " * (`as`: under that name), or null when it is gone and `instead` says what to write.",
        " */",
        "import type { MovedSymbol } from \"./types\";",
        "",
        "/** The symbols that moved or were removed, by the package they left. */",
        "export const MOVED_SYMBOLS: readonly MovedSymbol[] = ["
    ];
    rows.forEach((row, index) => {
        const fields = [`symbol: ${JSON.stringify(row.symbol)}`, `from: ${JSON.stringify(row.from)}`, `to: ${JSON.stringify(row.to)}`];
        if (row.as) fields.push(`as: ${JSON.stringify(row.as)}`);
        if (row.instead) fields.push(`instead: ${JSON.stringify(row.instead)}`);
        lines.push(`    { ${fields.join(", ")} }${index < rows.length - 1 ? "," : ""}`);
    });
    lines.push("];", "");
    return lines.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
    const text = render(buildRows());
    const target = path.join(ROOT, OUTPUT);
    if (process.argv.includes("--check")) {
        let current = "";
        try {
            current = readFileSync(target, "utf8");
        } catch {
            // Missing: stale.
        }
        if (current !== text) {
            console.error(`${OUTPUT} is stale: run node tooling/scripts/codemod/moved-symbols-table.mjs`);
            process.exit(1);
        }
        console.log(`${OUTPUT} is up to date.`);
    } else {
        writeFileSync(target, text);
        console.log(`Wrote ${OUTPUT}.`);
    }
}
