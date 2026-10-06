/**
 * lucide's full `icons` map (~1,750 icons, ~500 kB minified) must stay out of
 * every static chunk. It is fetched on demand by `loadLucideIcons`, the first
 * time an icon chosen at runtime renders.
 *
 * That "on demand" was dead for two months without anything noticing. The
 * loader did `import("lucide-react")`, and this package also imports named
 * icons from `lucide-react` statically, as does every app built with it. A
 * module that is statically imported already sits in a static chunk, so a
 * dynamic import of it cannot move it anywhere: the bundler keeps the module
 * where it is and materialises its whole namespace, `icons` included, right
 * there. The example app's entry-preloaded `rebase-core` chunk carried 1,757
 * icon modules (1.0 MB rendered) before the login form painted. Rollup and
 * rolldown say so — `INEFFECTIVE_DYNAMIC_IMPORT` — and both this package's and
 * the example app's Vite configs were silencing that warning.
 *
 * The working shape: the loader imports a LOCAL module whose only content is
 * `export { icons } from "lucide-react"`. Nothing imports that module
 * statically, so it gets an async chunk of its own, and the map lands there.
 *
 * Read from source, not from a build: it is deterministic and cheap, and each
 * of the three ways back to the old cost is a line of source.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../src");
const ENTRY = path.join(SRC, "index.ts");
const LOADER = path.join(SRC, "icons/LucideIconByName.tsx");
const MAP_MODULE = path.join(SRC, "icons/lucide_icon_map.ts");

type ModuleRefs = {
    /** Relative specifiers that are imported or re-exported as values. */
    staticRelative: string[];
    /** Every `import("…")` specifier. */
    dynamic: string[];
    /** Static value imports/re-exports from "lucide-react", by imported name ("*" for a namespace). */
    lucideBindings: string[];
};

function read(file: string): ts.SourceFile {
    return ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
}

function refsOf(file: string): ModuleRefs {
    const source = read(file);
    const refs: ModuleRefs = { staticRelative: [], dynamic: [], lucideBindings: [] };

    const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            const clause = node.importClause;
            const typeOnly = clause?.isTypeOnly ?? false;
            const spec = node.moduleSpecifier.text;
            if (!typeOnly) {
                if (spec.startsWith(".")) refs.staticRelative.push(spec);
                if (spec === "lucide-react" && clause) {
                    if (clause.name) refs.lucideBindings.push("default");
                    const bindings = clause.namedBindings;
                    if (bindings && ts.isNamespaceImport(bindings)) refs.lucideBindings.push("*");
                    if (bindings && ts.isNamedImports(bindings)) {
                        for (const el of bindings.elements) {
                            if (!el.isTypeOnly) refs.lucideBindings.push((el.propertyName ?? el.name).text);
                        }
                    }
                }
            }
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            const spec = node.moduleSpecifier.text;
            if (!node.isTypeOnly) {
                if (spec.startsWith(".")) refs.staticRelative.push(spec);
                if (spec === "lucide-react") {
                    const clause = node.exportClause;
                    if (!clause || ts.isNamespaceExport(clause)) refs.lucideBindings.push("*");
                    else for (const el of clause.elements) {
                        if (!el.isTypeOnly) refs.lucideBindings.push((el.propertyName ?? el.name).text);
                    }
                }
            }
        } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
            const [arg] = node.arguments;
            if (arg && ts.isStringLiteralLike(arg)) refs.dynamic.push(arg.text);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return refs;
}

function resolveRelative(from: string, spec: string): string {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    throw new Error(`cannot resolve ${spec} from ${path.relative(SRC, from)}`);
}

/** Every module the package entry reaches through static value imports. */
function staticGraph(): Map<string, ModuleRefs> {
    const graph = new Map<string, ModuleRefs>();
    const queue = [ENTRY];
    while (queue.length) {
        const file = queue.pop()!;
        if (graph.has(file)) continue;
        const refs = refsOf(file);
        graph.set(file, refs);
        for (const spec of refs.staticRelative) {
            if (/\.(css|scss)$/.test(spec)) continue;
            queue.push(resolveRelative(file, spec));
        }
    }
    return graph;
}

function allSources(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) return entry.name === "scripts" ? [] : allSources(full);
        return /\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts") ? [full] : [];
    });
}

describe("lucide's full icon map stays out of the static graph", () => {
    const graph = staticGraph();
    const rel = (file: string) => path.relative(SRC, file);

    it("the kit statically imports named lucide icons — which is why a dynamic import of lucide-react cannot be lazy", () => {
        // The premise. If this ever reads zero, the rule below is still right
        // for every app that imports one icon itself.
        const withNamedIcons = [...graph.values()].filter(r => r.lucideBindings.some(b => b !== "icons" && b !== "*"));
        expect(withNamedIcons.length).toBeGreaterThan(0);
    });

    it("no module dynamically imports lucide-react itself", () => {
        const offenders = allSources(SRC)
            .filter(file => refsOf(file).dynamic.includes("lucide-react"))
            .map(rel);
        expect(offenders).toEqual([]);
    });

    it("the loader dynamically imports the local map module, and that module only re-exports the map", () => {
        expect(fs.existsSync(MAP_MODULE)).toBe(true);
        const targets = refsOf(LOADER).dynamic
            .filter(spec => spec.startsWith("."))
            .map(spec => resolveRelative(LOADER, spec));
        expect(targets).toContain(MAP_MODULE);

        const map = refsOf(MAP_MODULE);
        expect(map.lucideBindings).toEqual(["icons"]);
        expect(map.staticRelative).toEqual([]);
    });

    it("nothing reachable from the package entry imports the map module statically", () => {
        expect([...graph.keys()].map(rel)).not.toContain(rel(MAP_MODULE));
    });

    it("nothing reachable from the package entry pulls the whole map or namespace in statically", () => {
        // `lucideIcons` is the one documented exception: a public re-export a
        // consumer opts into by importing it. An unused re-export binding
        // tree-shakes; an import that USES the map in this package does not.
        const offenders = [...graph.entries()].flatMap(([file, refs]) => refs.lucideBindings
            .filter(binding => binding === "*" || binding === "default" ||
                (binding === "icons" && rel(file) !== path.join("icons", "index.ts")))
            .map(binding => `${rel(file)}: ${binding}`));
        expect(offenders).toEqual([]);
    });
});
