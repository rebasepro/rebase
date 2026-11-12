/**
 * Who uses the kernel? Measures every exported symbol of `@rebasepro/types`
 * and `@rebasepro/common` against the workspace, and classifies it:
 *
 *   backend              something on the backend side needs it to stay in the kernel
 *   backend (temporary)  only bridge / mid-migration backend files (and backend tests) need it
 *   cms-only             only admin-side packages import it — it can move out of the kernel
 *   unused               nobody outside the kernel imports it, and no kept kernel code uses it
 *
 * "Needs it" is transitive: a kernel declaration that a kept declaration references
 * (a type in a signature, a helper called in a body) is kept too, because the kernel
 * can never import from `@rebasepro/cms-types`. The closure is computed over every
 * top-level declaration of `packages/{types,common,utils}/src`, with the type checker
 * resolving each identifier, so an internal (unexported) helper carries its
 * dependencies along.
 *
 * Roots of "backend":
 *   - imports from a backend package's source (server, server-postgres, cli, codegen,
 *     client, mcp, rls-check, utils, inference — inference is a headless core package
 *     by `check:types-headless`, it cannot import cms-types), `app/backend`,
 *     `examples/* /backend`, `saas/backend`;
 *   - every declaration of the table model: `packages/types/src/schema/**`,
 *     `packages/common/src/{schema,table}/**`.
 * Roots of "backend (temporary)": the files `TEMPORARY` lists (the lowering/lift bridge,
 * the driver runtime mid-migration) and every backend source file that calls
 * `driverCollection` (the seams). A backend TEST importer pins a symbol like a source
 * one: a backend test cannot import an admin package either.
 *
 * Output: a markdown report (default `~/.rebase-audits/pgfirst/kernel-usage.md`) and,
 * with `--json <file>`, the raw table (the input for move-kernel-symbols.mts maps).
 *
 * Run: node --import tsx tooling/scripts/kernel-usage.mts [--out <md>] [--json <file>]
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Node, Project, SyntaxKind, ts, type Symbol as MorphSymbol } from "ts-morph";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

const args = process.argv.slice(2);
function flag(name: string): string | undefined {
    const at = args.indexOf(name);
    return at >= 0 ? args[at + 1] : undefined;
}
const outMd = flag("--out") ?? path.join(os.homedir(), ".rebase-audits", "pgfirst", "kernel-usage.md");
const outJson = flag("--json");

const KERNEL_PACKAGES = ["types", "common"] as const;
type KernelPackage = typeof KERNEL_PACKAGES[number];

const BACKEND_PACKAGES = new Set([
    "server", "server-postgres", "cli", "codegen", "client", "mcp", "rls-check", "utils", "inference"
]);
const CMS_PACKAGES = new Set([
    "cms", "cms-types", "app", "studio", "firebase", "ui", "forms", "mcp-apps",
    "plugin-ai", "plugin-insights", "plugin-review"
]);

/** Kernel files that ARE the table model: everything they reference stays. */
const TABLE_MODEL = [/^packages\/types\/src\/schema\//, /^packages\/common\/src\/(schema|table)\//];

/** Files scheduled for deletion or a later slice: their imports pin a symbol only temporarily. */
const TEMPORARY = [
    /^packages\/common\/src\/schema\/(lower-tables|lift-collection|lift-rule-spelling)\.ts$/,
    /^packages\/server-postgres\/src\/schema\/(lowered-tables|collection-input)\.ts$/,
    /^packages\/server-postgres\/src\/(services|utils)\//,
    /^packages\/server-postgres\/src\/(PostgresBackendDriver|data-transformer|websocket)\.ts$/,
    /^packages\/server\/src\/schema\/driver-seam\.ts$/
];

const SOURCE_EXT = /\.(ts|tsx|mts|cts)$/;
const SKIP_DIRS = new Set(["node_modules", "dist", ".astro", ".git", "coverage", ".turbo", "build", ".vite", ".claude"]);

type Side = "backend" | "backend-temp" | "cms" | "kernel" | "other";
type Scope = "src" | "test" | "docs";

interface Importer {
    file: string;
    unit: string;
    side: Side;
    scope: Scope;
}

const rel = (file: string) => path.relative(ROOT, file).split(path.sep).join("/");
const isTest = (file: string) =>
    /(^|\/)(test|tests|__tests__|e2e)\//.test(file) || /\.(test|spec)\.(ts|tsx|mts)$/.test(file) ||
    /^tests\//.test(file);

/** Which workspace unit a file belongs to: `cms`, `app/frontend`, `examples/hybrid/backend`, … */
function unitOf(file: string): string {
    const parts = file.split("/");
    if (parts[0] === "packages") return parts[1];
    if (parts[0] === "examples" || parts[0] === "app" || parts[0] === "saas") {
        if (parts[0] === "app") return `app/${parts[1]}`;
        if (parts[0] === "saas") return `saas/${parts[1]}`;
        return `examples/${parts[1]}/${parts[2] ?? ""}`;
    }
    return parts[0];
}

function sideOf(file: string, unit: string): Side {
    if (file.startsWith("packages/types/") || file.startsWith("packages/common/")) return "kernel";
    if (TEMPORARY.some(re => re.test(file))) return "backend-temp";
    if (BACKEND_PACKAGES.has(unit)) return "backend";
    if (CMS_PACKAGES.has(unit)) return "cms";
    if (/^(app|saas)\/backend$/.test(unit) || /^examples\/[^/]+\/backend$/.test(unit)) return "backend";
    if (/^(app|saas)\/frontend$/.test(unit) || /^examples\/[^/]+\/frontend$/.test(unit) || unit === "website") return "cms";
    if (unit === "tests") return "backend";
    return "other";
}

function walk(dir: string, out: string[]): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (SOURCE_EXT.test(entry.name) && !entry.name.endsWith(".d.ts")) out.push(full);
    }
}

// ---------------------------------------------------------------------------
// 1. The kernel's declaration graph.
// ---------------------------------------------------------------------------

const project = new Project({
    compilerOptions: {
        target: ts.ScriptTarget.ESNext,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        strict: true,
        skipLibCheck: true,
        allowImportingTsExtensions: true,
        noEmit: true,
        jsx: ts.JsxEmit.ReactJSX,
        baseUrl: ROOT,
        paths: {
            "@rebasepro/types": ["packages/types/src/index.ts"],
            "@rebasepro/utils": ["packages/utils/src/index.ts"],
            "@rebasepro/common": ["packages/common/src/index.ts"]
        }
    },
    skipAddingFilesFromTsConfig: true
});

const kernelFiles: string[] = [];
for (const pkg of [...KERNEL_PACKAGES, "utils"]) walk(path.join(ROOT, "packages", pkg, "src"), kernelFiles);
for (const file of kernelFiles.filter(f => !isTest(rel(f)))) project.addSourceFileAtPath(file);

/** `packages/types/src/types/chips.ts#ChipColorKey` */
type DeclKey = string;

function topLevelOf(node: Node): Node | undefined {
    let current: Node | undefined = node;
    while (current && current.getParent() && !Node.isSourceFile(current.getParent()!)) current = current.getParent();
    return current;
}

function namesOfStatement(statement: Node): string[] {
    if (Node.isVariableStatement(statement)) return statement.getDeclarations().map(d => d.getName());
    if (Node.isFunctionDeclaration(statement) || Node.isClassDeclaration(statement) ||
        Node.isInterfaceDeclaration(statement) || Node.isTypeAliasDeclaration(statement) ||
        Node.isEnumDeclaration(statement) || Node.isModuleDeclaration(statement)) {
        const name = statement.getName();
        return name ? [name] : [];
    }
    return [];
}

/** Key of the top-level declaration that `node` sits in, when it is kernel code. */
function keyOfNode(node: Node): DeclKey | undefined {
    const file = rel(node.getSourceFile().getFilePath());
    if (!/^packages\/(types|common|utils)\/src\//.test(file)) return undefined;
    const top = topLevelOf(node);
    if (!top) return undefined;
    let name: string | undefined;
    if (Node.isVariableDeclaration(node)) name = node.getName();
    else {
        const decl = node.getFirstAncestorByKind(SyntaxKind.VariableDeclaration);
        name = decl && topLevelOf(decl) === top ? decl.getName() : namesOfStatement(top)[0];
    }
    return name ? `${file}#${name}` : undefined;
}

const edges = new Map<DeclKey, Set<DeclKey>>();
const declFile = new Map<DeclKey, string>();
const symbolCache = new Map<MorphSymbol, DeclKey[]>();

function keysOfSymbol(symbol: MorphSymbol): DeclKey[] {
    const cached = symbolCache.get(symbol);
    if (cached) return cached;
    let target = symbol;
    if (target.isAlias()) target = target.getAliasedSymbol() ?? target;
    const keys = new Set<DeclKey>();
    for (const decl of target.getDeclarations()) {
        const key = keyOfNode(decl);
        if (key) keys.add(key);
    }
    const out = [...keys];
    symbolCache.set(symbol, out);
    return out;
}

for (const sf of project.getSourceFiles()) {
    const file = rel(sf.getFilePath());
    for (const statement of sf.getStatements()) {
        const names = namesOfStatement(statement);
        if (names.length === 0) continue;
        const declarators = Node.isVariableStatement(statement) ? statement.getDeclarations() : [statement];
        for (const declarator of declarators) {
            const name = Node.isVariableDeclaration(declarator) ? declarator.getName() : names[0];
            const key = `${file}#${name}`;
            declFile.set(key, file);
            const out = edges.get(key) ?? new Set<DeclKey>();
            edges.set(key, out);
            for (const id of declarator.getDescendantsOfKind(SyntaxKind.Identifier)) {
                const symbol = id.getSymbol();
                if (!symbol) continue;
                for (const target of keysOfSymbol(symbol)) if (target !== key) out.add(target);
            }
        }
    }
}

// Exported symbols of the two barrels.
interface ExportedSymbol {
    name: string;
    pkg: KernelPackage;
    keys: DeclKey[];
    kind: string;
}
const exported: ExportedSymbol[] = [];
const exportedByName = new Map<string, ExportedSymbol[]>();
for (const pkg of KERNEL_PACKAGES) {
    const index = project.getSourceFileOrThrow(path.join(ROOT, "packages", pkg, "src", "index.ts"));
    for (const [name, decls] of index.getExportedDeclarations()) {
        const keys = [...new Set(decls.map(d => keyOfNode(d)).filter((k): k is DeclKey => k !== undefined))];
        const kinds = new Set(decls.map(d => d.getKindName().replace(/Declaration$/, "")));
        const symbol: ExportedSymbol = { name, pkg, keys, kind: [...kinds].join("+") };
        exported.push(symbol);
        exportedByName.set(name, [...(exportedByName.get(name) ?? []), symbol]);
    }
}

// ---------------------------------------------------------------------------
// 2. Importers outside the kernel (syntactic scan; no type checker needed).
// ---------------------------------------------------------------------------

const MODULE_TO_PKG: Record<string, KernelPackage> = { "@rebasepro/types": "types", "@rebasepro/common": "common" };
const importers = new Map<string, Importer[]>(); // `${pkg}:${name}` → importers
const namespaceImporters: Importer[] = [];

function record(pkg: KernelPackage, name: string, importer: Importer): void {
    const key = `${pkg}:${name}`;
    const list = importers.get(key) ?? [];
    if (!list.some(i => i.file === importer.file && i.scope === importer.scope)) list.push(importer);
    importers.set(key, list);
}

function scanSource(text: string, importer: Importer, kind: ts.ScriptKind): void {
    const source = ts.createSourceFile(importer.file, text, ts.ScriptTarget.Latest, false, kind);
    const visit = (node: ts.Node): void => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier &&
            ts.isStringLiteral(node.moduleSpecifier)) {
            const pkg = MODULE_TO_PKG[node.moduleSpecifier.text];
            if (pkg) {
                if (ts.isImportDeclaration(node)) {
                    const bindings = node.importClause?.namedBindings;
                    if (bindings && ts.isNamedImports(bindings)) {
                        for (const el of bindings.elements) record(pkg, (el.propertyName ?? el.name).text, importer);
                    } else if (bindings && ts.isNamespaceImport(bindings)) namespaceImporters.push(importer);
                } else if (node.exportClause && ts.isNamedExports(node.exportClause)) {
                    for (const el of node.exportClause.elements) record(pkg, (el.propertyName ?? el.name).text, importer);
                } else namespaceImporters.push(importer);
            }
        }
        if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument) &&
            ts.isStringLiteral(node.argument.literal)) {
            const pkg = MODULE_TO_PKG[node.argument.literal.text];
            if (pkg && node.qualifier) {
                const first = ts.isIdentifier(node.qualifier) ? node.qualifier : node.qualifier.left;
                if (ts.isIdentifier(first)) record(pkg, first.text, importer);
            }
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
}

const workspaceFiles: string[] = [];
for (const dir of ["packages", "app", "examples", "tests", "tooling", "website/src", "saas"]) {
    walk(path.join(ROOT, dir), workspaceFiles);
}
for (const full of workspaceFiles) {
    const file = rel(full);
    if (/^packages\/(types|common)\/src\//.test(file)) continue; // the kernel graph handles these
    const unit = unitOf(file);
    const scope: Scope = isTest(file) ? "test" : "src";
    const importer: Importer = { file, unit, side: sideOf(file, unit), scope };
    // A driverCollection seam is a temporary importer as a whole file.
    const text = fs.readFileSync(full, "utf8");
    if (importer.side === "backend" && scope === "src" && /\bdriverCollection\b/.test(text)) importer.side = "backend-temp";
    scanSource(text, importer, file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

// Code fences of the English docs and the agent skills: reported, never a root.
const docFiles: string[] = [];
function walkDocs(dir: string): void {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walkDocs(full); }
        else if (/\.(md|mdx)$/.test(entry.name)) docFiles.push(full);
    }
}
walkDocs(path.join(ROOT, "website", "src", "content", "docs", "docs"));
walkDocs(path.join(ROOT, "tooling", "rebase-agent-skills"));
for (const full of docFiles) {
    const file = rel(full);
    const text = fs.readFileSync(full, "utf8");
    for (const match of text.matchAll(/```(?:ts|tsx|typescript|js|jsx)[^\n]*\n([\s\S]*?)```/g)) {
        scanSource(match[1], { file, unit: "docs", side: "other", scope: "docs" }, ts.ScriptKind.TSX);
    }
}

// ---------------------------------------------------------------------------
// 3. Closures and classification.
// ---------------------------------------------------------------------------

function closure(roots: Iterable<DeclKey>): Set<DeclKey> {
    const seen = new Set<DeclKey>();
    const stack = [...roots];
    while (stack.length > 0) {
        const key = stack.pop()!;
        if (seen.has(key)) continue;
        seen.add(key);
        for (const next of edges.get(key) ?? []) stack.push(next);
    }
    return seen;
}

const isTemporaryKernelFile = (file: string) => TEMPORARY.some(re => re.test(file));
const backendRoots: DeclKey[] = [];
const tempRoots: DeclKey[] = [];
/** For each pinned declaration, one importer that pins it (for the report). */
const pinnedBy = new Map<DeclKey, string>();

for (const key of edges.keys()) {
    const file = declFile.get(key)!;
    if (isTemporaryKernelFile(file)) tempRoots.push(key);
    else if (TABLE_MODEL.some(re => re.test(file))) { backendRoots.push(key); pinnedBy.set(key, file); }
}
for (const symbol of exported) {
    const list = importers.get(`${symbol.pkg}:${symbol.name}`) ?? [];
    const hard = list.find(i => i.side === "backend" && i.scope !== "docs");
    const soft = list.find(i => i.side === "backend-temp");
    if (hard) for (const key of symbol.keys) { backendRoots.push(key); pinnedBy.set(key, hard.file); }
    else if (soft) for (const key of symbol.keys) tempRoots.push(key);
}

const pinned = closure(backendRoots);

/** Reverse edges: which kernel declarations reference a declaration. */
const referrers = new Map<DeclKey, Set<DeclKey>>();
for (const [from, targets] of edges) {
    for (const to of targets) {
        const set = referrers.get(to) ?? new Set<DeclKey>();
        set.add(from);
        referrers.set(to, set);
    }
}
const temporary = new Set([...closure(tempRoots)].filter(k => !pinned.has(k)));

type Classification = "backend" | "backend (temporary)" | "cms-only" | "unused";
interface Row {
    name: string;
    pkg: KernelPackage;
    kind: string;
    declaredIn: string[];
    classification: Classification;
    src: Record<string, number>;
    test: Record<string, number>;
    docs: number;
    temporaryImporters: string[];
    pinnedBy?: string;
    /** Kernel declarations (outside the symbol's own) that reference it: they must move with it. */
    kernelReferrers: string[];
}

function countByUnit(list: Importer[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const i of list) out[i.unit] = (out[i.unit] ?? 0) + 1;
    return out;
}

const rows: Row[] = exported.map(symbol => {
    const list = importers.get(`${symbol.pkg}:${symbol.name}`) ?? [];
    const external = list.filter(i => i.scope !== "docs");
    let classification: Classification;
    if (symbol.keys.some(k => pinned.has(k))) classification = "backend";
    else if (symbol.keys.some(k => temporary.has(k))) classification = "backend (temporary)";
    else if (external.length > 0) classification = "cms-only";
    else classification = "unused";
    const tempImporters = [...new Set(list.filter(i => i.side === "backend-temp").map(i => i.file))];
    for (const k of symbol.keys) if (temporary.has(k) && !tempImporters.length) {
        // Pinned only through a temporary kernel file's closure.
        tempImporters.push("kernel bridge closure");
        break;
    }
    const pin = symbol.keys.map(k => pinnedBy.get(k)).find(Boolean);
    return {
        name: symbol.name,
        pkg: symbol.pkg,
        kind: symbol.kind,
        declaredIn: [...new Set(symbol.keys.map(k => declFile.get(k) ?? k.split("#")[0]))],
        classification,
        src: countByUnit(external.filter(i => i.scope === "src")),
        test: countByUnit(external.filter(i => i.scope === "test")),
        docs: list.filter(i => i.scope === "docs").length,
        temporaryImporters: tempImporters,
        pinnedBy: pin ?? (classification === "backend" ? "kernel closure" : undefined),
        kernelReferrers: [...new Set(symbol.keys.flatMap(k => [...(referrers.get(k) ?? [])]))]
            .filter(k => !symbol.keys.includes(k)).sort()
    };
});

if (outJson) {
    // Every top-level kernel declaration (exported or not) with its state, so a move
    // can split a file along the line the closure draws.
    const declarations = [...edges.keys()].sort().map(key => ({
        key,
        state: pinned.has(key) ? "backend" : temporary.has(key) ? "backend (temporary)" : "free",
        referrers: [...(referrers.get(key) ?? [])].sort()
    }));
    fs.writeFileSync(outJson, JSON.stringify({ rows, declarations }, null, 2));
}

// ---------------------------------------------------------------------------
// 4. Report.
// ---------------------------------------------------------------------------

const fmt = (counts: Record<string, number>) =>
    Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([u, n]) => `${u}·${n}`).join(" ") || "—";
const order: Classification[] = ["cms-only", "backend (temporary)", "unused", "backend"];
const totals = Object.fromEntries(order.map(c => [c, rows.filter(r => r.classification === c).length]));

const lines: string[] = [];
lines.push("# Kernel usage — `@rebasepro/types` and `@rebasepro/common`");
lines.push("");
lines.push(`Generated by \`tooling/scripts/kernel-usage.mts\` on ${new Date().toISOString()}.`);
lines.push("");
lines.push("| class | types | common | total |");
lines.push("|---|---|---|---|");
for (const c of order) {
    const t = rows.filter(r => r.classification === c && r.pkg === "types").length;
    const m = rows.filter(r => r.classification === c && r.pkg === "common").length;
    lines.push(`| ${c} | ${t} | ${m} | ${totals[c]} |`);
}
lines.push("");
if (namespaceImporters.length > 0) {
    lines.push(`Namespace imports (not attributable to a symbol): ${[...new Set(namespaceImporters.map(i => i.file))].join(", ")}`);
    lines.push("");
}
for (const c of order) {
    lines.push(`## ${c}`);
    lines.push("");
    lines.push(c === "backend"
        ? "| symbol | pkg | kind | declared in | src importers | test importers | docs | pinned by |"
        : c === "backend (temporary)"
            ? "| symbol | pkg | kind | declared in | src importers | test importers | docs | temporary importers |"
            : "| symbol | pkg | kind | declared in | src importers | test importers | docs | kernel referrers |");
    lines.push("|---|---|---|---|---|---|---|---|");
    for (const r of rows.filter(row => row.classification === c).sort((a, b) =>
        a.declaredIn[0].localeCompare(b.declaredIn[0]) || a.name.localeCompare(b.name))) {
        const base = `| \`${r.name}\` | ${r.pkg} | ${r.kind} | ${r.declaredIn.join("<br>")} | ${fmt(r.src)} | ${fmt(r.test)} | ${r.docs || ""}`;
        if (c === "backend") lines.push(`${base} | ${r.pinnedBy ?? ""} |`);
        else if (c === "backend (temporary)") lines.push(`${base} | ${r.temporaryImporters.join("<br>")} |`);
        else lines.push(`${base} | ${r.kernelReferrers.map(k => k.replace(/^packages\//, "")).join("<br>")} |`);
    }
    lines.push("");
}
fs.mkdirSync(path.dirname(outMd), { recursive: true });
fs.writeFileSync(outMd, lines.join("\n"));
console.log(`kernel-usage: ${rows.length} symbols — ${order.map(c => `${c} ${totals[c]}`).join(", ")}`);
console.log(`report: ${outMd}${outJson ? `, json: ${outJson}` : ""}`);

