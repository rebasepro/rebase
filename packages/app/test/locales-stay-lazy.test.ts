/**
 * Only English ships on the login screen; the other six translations are
 * fetched when someone picks one.
 *
 * `RebaseI18nProvider` imported all seven statically and built them into
 * i18next's resources, so every admin downloaded, parsed and deep-merged six
 * languages it never showed: ~616 kB (159 kB gzipped) of the eager bundle, and
 * ~6 ms of merging on mount, twice. English stays static because it is the
 * fallback for every key; the others are `import()`ed by the provider's
 * backend the first time their language is asked for.
 *
 * Read from source, not from a build: a static import or a re-export of a
 * locale from anything the package entry reaches is the whole regression, and
 * it is one line.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../src");
const ENTRY = path.join(SRC, "index.ts");
const LOCALES = path.join(SRC, "locales");
const PROVIDER = path.join(SRC, "i18n/RebaseI18nProvider.tsx");

function refsOf(file: string): { staticRelative: string[]; dynamic: string[] } {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const refs = { staticRelative: [] as string[], dynamic: [] as string[] };
    const visit = (node: ts.Node) => {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            if (!node.importClause?.isTypeOnly && node.moduleSpecifier.text.startsWith(".")) {
                refs.staticRelative.push(node.moduleSpecifier.text);
            }
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            if (!node.isTypeOnly && node.moduleSpecifier.text.startsWith(".")) {
                refs.staticRelative.push(node.moduleSpecifier.text);
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

function resolveRelative(from: string, spec: string): string | undefined {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return undefined;
}

/** Every module of this package the entry reaches through static value imports. */
function staticGraph(): Set<string> {
    const seen = new Set<string>();
    const queue = [ENTRY];
    while (queue.length) {
        const file = queue.pop()!;
        if (seen.has(file)) continue;
        seen.add(file);
        for (const spec of refsOf(file).staticRelative) {
            if (/\.(css|scss|json)$/.test(spec)) continue;
            const resolved = resolveRelative(file, spec);
            if (resolved) queue.push(resolved);
        }
    }
    return seen;
}

const shippedLocales = fs.readdirSync(LOCALES)
    .filter(name => name.endsWith(".ts"))
    .map(name => path.join(LOCALES, name));

describe("translations other than English stay out of the static graph", () => {
    const graph = staticGraph();

    it("English is static — it is the fallback for every key", () => {
        expect(graph.has(path.join(LOCALES, "en.ts"))).toBe(true);
    });

    it("no other locale is reachable from the package entry by a static import or re-export", () => {
        const eager = shippedLocales
            .filter(file => !file.endsWith(`${path.sep}en.ts`) && graph.has(file))
            .map(file => path.relative(SRC, file));
        expect(eager).toEqual([]);
    });

    it("the provider can load every other locale on demand", () => {
        const loaded = refsOf(PROVIDER).dynamic
            .map(spec => resolveRelative(PROVIDER, spec))
            .filter((file): file is string => Boolean(file));
        const others = shippedLocales.filter(file => !file.endsWith(`${path.sep}en.ts`));
        expect(others.length).toBeGreaterThan(0);
        expect(loaded.sort()).toEqual(others.sort());
    });
});
