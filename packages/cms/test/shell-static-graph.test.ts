/**
 * The admin shell must not statically reach the record views.
 *
 * `<RebaseShell>` (and the `<RebaseCMS>` beside it) render on the login screen
 * and the home page, neither of which shows a collection table, a record form
 * or the side panel. Those are the heaviest part of the admin — the example
 * app's `form` chunk alone is ~415 kB — and they were modulepreloaded before
 * the login form could paint, because two static edges reached them:
 *
 *  - `routes/RebaseRoute.tsx` imported `CollectionViewBinding`,
 *    `EditViewBinding` and `DetailViewBinding` at the top;
 *  - `hooks/useBuildSidePanel.tsx` imported two string constants from
 *    `components/EditViewBinding` (they live in `util/view_constants`) and
 *    `SidePanelBinding` itself, and `RebaseNavigation` mounts the provider
 *    that runs that hook on every page.
 *
 * Both now go through `components/lazy_record_views.ts`. Two more edges kept
 * the form and the record preview eager for any app using the AI plugin or
 * the account actions:
 *
 *  - `getFieldId` lived in `components/field_configs.tsx`, which imports every
 *    field binding; it now lives in `components/field_ids.ts`;
 *  - `components/common/default_entity_actions.tsx` (imported by the
 *    navigation layer for the account actions) imported `DeleteEntityDialog`,
 *    which renders the record preview; it is lazy now.
 *
 * Read from source: a single static import puts the whole stack back, and it
 * is one line. This walks modules, not bindings, so it cannot see through a
 * barrel that is imported for one light export (`_cms_internals.ts`, the
 * `preview` index) — the bundle check in tooling/scripts/check-bundle-budget.mjs
 * covers what a build actually keeps.
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(__dirname, "../src");
const SHELL_ENTRIES = [
    path.join(SRC, "components/RebaseShell.tsx"),
    path.join(SRC, "components/RebaseCMS.tsx")
];
const RECORD_VIEWS = [
    "components/CollectionViewBinding/CollectionViewBinding.tsx",
    "components/EditViewBinding.tsx",
    "components/DetailViewBinding.tsx",
    "components/SidePanelBinding.tsx",
    "components/DeleteEntityDialog.tsx",
    "form/EntityForm.tsx"
];

function staticRelativeImports(file: string): string[] {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true,
        file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    const specs: string[] = [];
    for (const node of source.statements) {
        if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
            if (!node.importClause?.isTypeOnly) specs.push(node.moduleSpecifier.text);
        } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            if (!node.isTypeOnly) specs.push(node.moduleSpecifier.text);
        }
    }
    return specs.filter(spec => spec.startsWith(".") && !/\.(css|scss|json)$/.test(spec));
}

function resolveRelative(from: string, spec: string): string | undefined {
    const base = path.resolve(path.dirname(from), spec);
    for (const candidate of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")]) {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    }
    return undefined;
}

/** Static path from an entry to each module it reaches, for a readable failure. */
function staticGraph(entries: string[]): Map<string, string[]> {
    const via = new Map<string, string[]>();
    const queue: [string, string[]][] = entries.map(entry => [entry, [path.relative(SRC, entry)]]);
    while (queue.length) {
        const [file, trail] = queue.shift()!;
        if (via.has(file)) continue;
        via.set(file, trail);
        for (const spec of staticRelativeImports(file)) {
            const resolved = resolveRelative(file, spec);
            if (resolved && !via.has(resolved)) queue.push([resolved, [...trail, path.relative(SRC, resolved)]]);
        }
    }
    return via;
}

describe("the admin shell loads the record views on demand", () => {
    const graph = staticGraph(SHELL_ENTRIES);

    it("reaches the routes and the side-panel provider statically (the premise)", () => {
        expect(graph.has(path.join(SRC, "routes/RebaseRoute.tsx"))).toBe(true);
        expect(graph.has(path.join(SRC, "hooks/useBuildSidePanel.tsx"))).toBe(true);
    });

    it("does not reach the collection table, the record views, the side panel or the entity form", () => {
        const reached = RECORD_VIEWS
            .map(rel => path.join(SRC, rel))
            .filter(file => graph.has(file))
            .map(file => graph.get(file)!.join(" -> "));
        expect(reached).toEqual([]);
    });

    it("asking which widget a property gets does not import the widgets", () => {
        const fieldIds = staticGraph([path.join(SRC, "components/field_ids.ts")]);
        const reached = [...fieldIds.keys()]
            .filter(file => file.startsWith(path.join(SRC, "form") + path.sep) || file.endsWith("field_configs.tsx"))
            .map(file => fieldIds.get(file)!.join(" -> "));
        expect(reached).toEqual([]);
    });
});
