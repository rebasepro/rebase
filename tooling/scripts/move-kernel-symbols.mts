/**
 * Move exported symbols (and whole modules) between workspace packages, and
 * rewrite every import that names them.
 *
 * Built for moving the CMS view model out of the kernel (`@rebasepro/types`,
 * `@rebasepro/common`) into `@rebasepro/cms-types` / `@rebasepro/cms` /
 * `@rebasepro/firebase`, and reusable for each later part of that move: the
 * declarations themselves are moved by hand (a split is a judgement call); this
 * rewrites the import lines, which is the part that must not be done by hand.
 *
 * The map (JSON):
 *
 *   {
 *     "symbols": [
 *       { "name": "evaluateCondition",
 *         "from": "packages/common/src/util/conditions.ts",
 *         "to":   "packages/cms-types/src/util/conditions.ts" }
 *     ],
 *     "files": { "packages/common/test/conditions.test.ts": "packages/cms-types/test/conditions.test.ts" }
 *   }
 *
 * - `symbols`: the declaring module before and after. An import of the symbol
 *   from the old package's bare name (`@rebasepro/common`), or by a relative path
 *   that resolves to `from`, is rewritten to the new package's bare name — or to a
 *   relative path to `to` when the importer is in the same package's `src`.
 *   Named imports, `import type`, inline `type` specifiers, aliases, mixed imports
 *   (some names stay, some move), `export { … } from` re-exports and `import("…").X`
 *   type references are all handled; a name that joins a package the file already
 *   imports from is merged into that import.
 * - `files`: physical moves, done first (a file already at its destination is left
 *   alone, so a run is repeatable). Relative imports in a moved file, and relative
 *   imports OF a moved file, are recomputed: same package → relative path, another
 *   package → its bare name.
 *
 * Scanned: every .ts/.tsx/.mts under packages/, app/, examples/, tests/, tooling/,
 * saas/ (minus node_modules/dist), and the TypeScript code fences of the English
 * docs (`website/src/content/docs/docs/**`) and the agent skills
 * (`tooling/rebase-agent-skills/**`), so published examples keep compiling.
 *
 * Run: node --import tsx tooling/scripts/move-kernel-symbols.mts <map.json> [--dry-run] [--only <path-prefix>]…
 * Prints every file it changed (or would change).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export interface SymbolMove {
    name: string;
    /** Repo-relative path of the declaring module before the move. */
    from: string;
    /** Repo-relative path of the declaring module after the move. */
    to: string;
}

export interface MoveMap {
    symbols?: SymbolMove[];
    files?: Record<string, string>;
}

const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".astro", ".git", "coverage", ".turbo", "build", ".vite", ".claude"]);
const SCAN_DIRS = ["packages", "app", "examples", "tests", "tooling", "saas"];
const DOC_DIRS = ["website/src/content/docs/docs", "tooling/rebase-agent-skills"];

const posix = (p: string) => p.split(path.sep).join("/");
const rel = (abs: string) => posix(path.relative(ROOT, abs));

/** `packages/cms-types/src/x.ts` → `{ name: "cms-types", area: "src" }`. */
function packageOf(file: string): { name: string; area: string } | undefined {
    const match = /^packages\/([^/]+)\/([^/]+)\//.exec(file);
    return match ? { name: match[1], area: match[2] } : undefined;
}

function bareName(file: string): string {
    const pkg = packageOf(file);
    if (!pkg || pkg.area !== "src") throw new Error(`${file} is not inside a package's src: no bare specifier reaches it`);
    return `@rebasepro/${pkg.name}`;
}

/** Module specifier the importer (at `importer`) uses to reach `target`. */
function specifierFor(importer: string, target: string, viaIndexDir: boolean): string {
    const a = packageOf(importer);
    const b = packageOf(target);
    if (a && b && a.name === b.name && a.area === b.area) {
        let to = target.replace(/\.(d\.ts|ts|tsx|mts)$/, "");
        if (viaIndexDir) to = to.replace(/\/index$/, "");
        let out = posix(path.relative(path.dirname(importer), to));
        if (!out.startsWith(".")) out = `./${out}`;
        return out;
    }
    if (a && b && a.name === b.name && b.area === "src") {
        // A package's tests import its own source by its bare name (jest/vitest map it).
        return bareName(target);
    }
    return bareName(target);
}

function walk(dir: string, accept: (name: string) => boolean, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, accept, out);
        else if (accept(entry.name)) out.push(full);
    }
}

// ---------------------------------------------------------------------------

interface Edit { start: number; end: number; text: string }

interface Context {
    /** name → moves of that name (a name can move out of two modules). */
    byName: Map<string, SymbolMove[]>;
    /** bare package → the moves out of it. */
    byPackage: Map<string, SymbolMove[]>;
    /** old path → new path (repo-relative), for physical moves. */
    files: Map<string, string>;
    /** new path → old path. */
    filesBack: Map<string, string>;
    exists: (file: string) => boolean;
}

/** Resolve a relative specifier written in a file at `fromFile` (its location when written). */
function resolveRelative(ctx: Context, fromFile: string, spec: string): { file: string; viaIndexDir: boolean } | undefined {
    const base = posix(path.normalize(path.join(path.dirname(fromFile), spec)));
    const stripped = base.replace(/\.(js|mjs|ts|tsx)$/, "");
    const candidates: Array<[string, boolean]> = [
        [base, false], [`${stripped}.ts`, false], [`${stripped}.tsx`, false], [`${stripped}.d.ts`, false],
        [`${stripped}.mts`, false], [`${base}/index.ts`, true], [`${base}/index.tsx`, true]
    ];
    for (const [candidate, viaIndexDir] of candidates) {
        if (/\.(ts|tsx|mts)$/.test(candidate) && (ctx.exists(candidate) || ctx.files.has(candidate))) {
            return { file: candidate, viaIndexDir };
        }
    }
    return undefined;
}

interface Group {
    spec: string;
    typeOnly: boolean;
    elements: string[];
}

function quoteOf(text: string): string {
    return text.includes("'") && !text.includes("\"") ? "'" : "\"";
}

function render(kind: "import" | "export", group: Group, original: string, quote: string): string {
    const semi = /;\s*$/.test(original) ? ";" : "";
    const head = `${kind}${group.typeOnly ? " type" : ""}`;
    if (original.includes("\n")) {
        const indent = /\n([ \t]+)\S/.exec(original)?.[1] ?? "    ";
        return `${head} {\n${group.elements.map(e => `${indent}${e}`).join(",\n")}\n} from ${quote}${group.spec}${quote}${semi}`;
    }
    return `${head} { ${group.elements.join(", ")} } from ${quote}${group.spec}${quote}${semi}`;
}

/**
 * The edits one source text needs. `here` is the file's path now; `written` where it
 * was when its relative specifiers were written (differs for a moved file).
 */
function editsFor(ctx: Context, text: string, here: string, written: string, kind: ts.ScriptKind): Edit[] {
    const source = ts.createSourceFile(here, text, ts.ScriptTarget.Latest, true, kind);
    const edits: Edit[] = [];

    /** Where a module specifier points: a bare kernel package or a resolved file. */
    const targetOf = (spec: string): { bare?: string; file?: string; viaIndexDir: boolean } | undefined => {
        if (spec.startsWith(".")) {
            const resolved = resolveRelative(ctx, written, spec);
            return resolved ? { file: resolved.file, viaIndexDir: resolved.viaIndexDir } : undefined;
        }
        return ctx.byPackage.has(spec) ? { bare: spec, viaIndexDir: false } : undefined;
    };

    /** The move that applies to `name` imported through `target`, if any. */
    const moveOf = (name: string, target: { bare?: string; file?: string }): SymbolMove | undefined => {
        for (const move of ctx.byName.get(name) ?? []) {
            if (target.bare && bareName(move.from) === target.bare) return move;
            if (target.file && (target.file === move.from || ctx.files.get(target.file) === move.from)) return move;
            // A barrel (`../src`, `../src/util`) re-exports its directory.
            if (target.file && /\/index\.tsx?$/.test(target.file) &&
                move.from.startsWith(`${path.posix.dirname(target.file)}/`)) return move;
        }
        return undefined;
    };

    /** The specifier for the module part that stays, recomputed if a file moved. */
    const staySpec = (spec: string, target: { bare?: string; file?: string; viaIndexDir: boolean }): string => {
        if (!target.file) return spec;
        const now = ctx.files.get(target.file) ?? target.file;
        if (now === target.file && here === written) return spec;
        return specifierFor(here, now, target.viaIndexDir);
    };

    // Existing, untouched named imports, for merging: `${spec}|${typeOnly}` → declaration.
    const mergeable = new Map<string, ts.ImportDeclaration>();
    const pending = new Map<ts.ImportDeclaration, Group[]>();
    const additions = new Map<ts.ImportDeclaration, string[]>();

    for (const statement of source.statements) {
        const isImport = ts.isImportDeclaration(statement);
        const isExport = ts.isExportDeclaration(statement);
        if (!isImport && !isExport) continue;
        if (!statement.moduleSpecifier || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
        const spec = statement.moduleSpecifier.text;
        const target = targetOf(spec);
        const elementsNode = isImport
            ? (statement.importClause?.namedBindings && ts.isNamedImports(statement.importClause.namedBindings) ? statement.importClause.namedBindings : undefined)
            : (statement.exportClause && ts.isNamedExports(statement.exportClause) ? statement.exportClause : undefined);
        const typeOnly = isImport ? Boolean(statement.importClause?.isTypeOnly) : statement.isTypeOnly;
        const hasDefault = isImport && Boolean(statement.importClause?.name);

        if (!target) {
            if (isImport && elementsNode && !hasDefault) mergeable.set(`${spec}|${typeOnly}`, statement);
            continue;
        }

        const newStay = staySpec(spec, target);
        if (!elementsNode) {
            // Side-effect, namespace or `export *`: only the specifier can change.
            if (newStay !== spec) {
                edits.push({ start: statement.moduleSpecifier.getStart(), end: statement.moduleSpecifier.getEnd(), text: `${quoteOf(statement.moduleSpecifier.getText())}${newStay}${quoteOf(statement.moduleSpecifier.getText())}` });
            }
            if (isImport && statement.importClause?.namedBindings && ts.isNamespaceImport(statement.importClause.namedBindings) && target.bare) {
                console.warn(`  ! ${here}: namespace import of ${spec} — check by hand`);
            }
            continue;
        }

        const groups: Group[] = [];
        const groupFor = (s: string, t: boolean) => {
            let g = groups.find(x => x.spec === s && x.typeOnly === t);
            if (!g) { g = { spec: s, typeOnly: t, elements: [] }; groups.push(g); }
            return g;
        };
        const stay: string[] = [];
        let moved = false;
        for (const element of elementsNode.elements) {
            const imported = (element.propertyName ?? element.name).text;
            const move = moveOf(imported, target);
            if (move && move.to === here) {
                // The declaration now lives in this very file.
                moved = true;
            } else if (move) {
                moved = true;
                groupFor(specifierFor(here, move.to, false), typeOnly).elements.push(element.getText());
            } else stay.push(element.getText());
        }
        if (!moved && newStay === spec) {
            if (isImport && !hasDefault) mergeable.set(`${spec}|${typeOnly}`, statement);
            continue;
        }
        if (hasDefault) {
            console.warn(`  ! ${here}: default import alongside moved names from ${spec} — check by hand`);
            continue;
        }
        const all: Group[] = [];
        if (stay.length > 0) all.push({ spec: newStay, typeOnly, elements: stay });
        all.push(...groups);
        if (isImport) pending.set(statement, all);
        else {
            const quote = quoteOf(statement.moduleSpecifier.getText());
            edits.push({ start: statement.getStart(), end: statement.getEnd(), text: all.map(g => render("export", g, statement.getText(), quote)).join("\n") });
        }
    }

    for (const [statement, groups] of pending) {
        const quote = quoteOf(statement.moduleSpecifier.getText());
        const out: string[] = [];
        for (const group of groups) {
            const into = mergeable.get(`${group.spec}|${group.typeOnly}`);
            if (into && !pending.has(into)) {
                additions.set(into, [...(additions.get(into) ?? []), ...group.elements]);
                continue;
            }
            out.push(render("import", group, statement.getText(), quote));
        }
        // Removing the whole statement takes its line break with it.
        let end = statement.getEnd();
        if (out.length === 0 && text[end] === "\n") end += 1;
        edits.push({ start: statement.getStart(), end, text: out.join("\n") });
    }
    for (const [statement, extra] of additions) {
        const clause = statement.importClause!.namedBindings as ts.NamedImports;
        const existing = clause.elements.map(e => e.getText());
        const names = [...existing, ...extra.filter(e => !existing.includes(e))];
        const quote = quoteOf(statement.moduleSpecifier.getText());
        edits.push({
            start: statement.getStart(), end: statement.getEnd(),
            text: render("import", { spec: (statement.moduleSpecifier as ts.StringLiteral).text, typeOnly: Boolean(statement.importClause?.isTypeOnly), elements: names }, statement.getText(), quote)
        });
    }

    // `import("@rebasepro/types").Foo` in a type position.
    const visit = (node: ts.Node): void => {
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) && ts.isStringLiteral(node.argument.literal) && node.qualifier) {
            const literal = node.argument.literal;
            const target = targetOf(literal.text);
            const first = ts.isIdentifier(node.qualifier) ? node.qualifier : node.qualifier.left;
            if (target && ts.isIdentifier(first)) {
                const move = moveOf(first.text, target);
                const spec = move ? specifierFor(here, move.to, false) : staySpec(literal.text, target);
                if (spec !== literal.text) {
                    const q = quoteOf(literal.getText());
                    edits.push({ start: literal.getStart(), end: literal.getEnd(), text: `${q}${spec}${q}` });
                }
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return edits;
}

function applyEdits(text: string, edits: Edit[]): string {
    let out = text;
    for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
        out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    }
    return out;
}

/** Rewrite the TypeScript code fences of a markdown file. */
function rewriteDoc(ctx: Context, text: string, file: string): string {
    return text.replace(/(```(?:ts|tsx|typescript|js|jsx)[^\n]*\n)([\s\S]*?)(```)/g, (whole, open: string, body: string, close: string) => {
        // A fence is not in any package: every specifier it writes is bare.
        const edits = editsFor(ctx, body, `docs/${file}`, `docs/${file}`, ts.ScriptKind.TSX);
        return edits.length === 0 ? whole : `${open}${applyEdits(body, edits)}${close}`;
    });
}

export function runMove(map: MoveMap, options: { dryRun?: boolean; only?: string[] } = {}): string[] {
    const files = new Map(Object.entries(map.files ?? {}));
    const filesBack = new Map([...files].map(([a, b]) => [b, a]));
    const byName = new Map<string, SymbolMove[]>();
    const byPackage = new Map<string, SymbolMove[]>();
    for (const move of map.symbols ?? []) {
        byName.set(move.name, [...(byName.get(move.name) ?? []), move]);
        const bare = bareName(move.from);
        byPackage.set(bare, [...(byPackage.get(bare) ?? []), move]);
    }

    // Physical moves first.
    for (const [from, to] of files) {
        const absFrom = path.join(ROOT, from);
        const absTo = path.join(ROOT, to);
        if (fs.existsSync(absTo) || !fs.existsSync(absFrom)) continue;
        if (options.dryRun) { console.log(`  mv ${from} → ${to}`); continue; }
        fs.mkdirSync(path.dirname(absTo), { recursive: true });
        fs.renameSync(absFrom, absTo);
        console.log(`  mv ${from} → ${to}`);
    }

    const ctx: Context = {
        byName, byPackage, files, filesBack,
        exists: (file) => fs.existsSync(path.join(ROOT, file)) || filesBack.has(file)
    };
    const inScope = (file: string) => !options.only || options.only.some(prefix => file.startsWith(prefix));
    const changed: string[] = [];

    const sources: string[] = [];
    for (const dir of SCAN_DIRS) walk(path.join(ROOT, dir), name => SOURCE_EXT.test(name) && !name.endsWith(".d.ts"), sources);
    for (const abs of sources) {
        const here = rel(abs);
        if (!inScope(here)) continue;
        const written = filesBack.get(here) ?? here;
        const text = fs.readFileSync(abs, "utf8");
        // Cheap filter: a file that names no moved symbol, no moved file and was not moved itself.
        if (written === here && !(map.symbols ?? []).some(m => text.includes(m.name)) &&
            ![...files.keys()].some(f => text.includes(path.basename(f).replace(/\.(ts|tsx)$/, "")))) continue;
        const edits = editsFor(ctx, text, here, written, here.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
        if (edits.length === 0) continue;
        changed.push(here);
        if (!options.dryRun) fs.writeFileSync(abs, applyEdits(text, edits));
    }

    const docs: string[] = [];
    for (const dir of DOC_DIRS) walk(path.join(ROOT, dir), name => /\.(md|mdx)$/.test(name), docs);
    for (const abs of docs) {
        const here = rel(abs);
        if (!inScope(here)) continue;
        const text = fs.readFileSync(abs, "utf8");
        if (!(map.symbols ?? []).some(m => text.includes(m.name))) continue;
        const next = rewriteDoc(ctx, text, here);
        if (next === text) continue;
        changed.push(here);
        if (!options.dryRun) fs.writeFileSync(abs, next);
    }
    return changed;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
    const args = process.argv.slice(2);
    const mapPath = args.find(a => !a.startsWith("--") && args[args.indexOf(a) - 1] !== "--only");
    if (!mapPath) {
        console.error("usage: move-kernel-symbols.mts <map.json> [--dry-run] [--only <path-prefix>]…");
        process.exit(2);
    }
    const only: string[] = [];
    args.forEach((a, i) => { if (a === "--only" && args[i + 1]) only.push(args[i + 1]); });
    const map: MoveMap = JSON.parse(fs.readFileSync(path.resolve(mapPath), "utf8"));
    const changed = runMove(map, { dryRun: args.includes("--dry-run"), only: only.length > 0 ? only : undefined });
    for (const file of changed) console.log(`  ${args.includes("--dry-run") ? "would rewrite" : "rewrote"} ${file}`);
    console.log(`${changed.length} file(s)`);
}
