
import path from "path";
import ts from "typescript";
import MagicString from "magic-string";

export interface RebaseCollectionsPluginOptions {
    /**
     * The path to the collections directory containing the schema definitions.
     * Use a relative or absolute path from the root of your frontend workspace.
     */
    collectionsDir: string;
}

/**
 * Properties on collection objects that accept `ComponentRef` values.
 * When a string literal is found for any of these keys in a collection file,
 * the transform plugin replaces it with a `LazyComponentRef` object so the
 * component is loaded lazily and never evaluated by the backend.
 */
// `Filter` was missing: AdminPropertyOptions.Filter is a ComponentRef like the others, so
// a string path there was left as a string and the resolver logged "raw string
// ComponentRef at runtime" and rendered nothing. Key-name based, so nesting
// presentation under `admin` needs no change here.
const LAZY_COMPONENT_KEYS = new Set(["Field", "Preview", "Builder", "Filter"]);

/**
 * Callbacks that only ever run on the server, and whose bodies must not travel
 * to the browser.
 *
 * `config/collections/*.ts` is shared: the backend loads it from disk, and this
 * plugin globs the same directory into the admin bundle. Everything in those
 * files therefore shipped to every visitor — including the body of a
 * `beforeSave` that calls a third-party API with a key from `process.env`. In
 * the example app's own built bundle you could read the compiled
 * `beforeSave:({values:e` and the fixed regex beside it.
 *
 * Replacing the body with `undefined` also lets Rollup tree-shake whatever the
 * callback imported, so a server-only dependency reached from one hook stops
 * being bundled — or stops breaking the build.
 *
 * The four here have **zero** client-side call sites. Two callbacks are
 * deliberately NOT in the list because the panel genuinely runs them:
 *
 *   - `afterRead` — `useDataTableController` and `useBoardDataController` call
 *     it to transform rows before rendering.
 *   - `afterSave` — `useNavigationResolution` wraps it for the user-creation
 *     dialog.
 *
 * Dropping the value rather than the key keeps the source's comma structure
 * intact, and `callbacks.beforeSave === undefined` is what "not present" means
 * to every consumer. The collection editor already drops callbacks when it
 * serializes a collection back to TypeScript, so nothing round-trips through
 * this and no user code can be lost by it.
 */
const SERVER_ONLY_CALLBACK_KEYS = new Set([
    "beforeSave",
    "beforeDelete",
    "afterDelete",
    "afterSaveError"
]);

/**
 * True when `node` is a property of an object that is itself the value of a
 * `callbacks:` property — i.e. a real lifecycle hook, on a collection or on a
 * property, and not something that merely shares a name.
 */
function isInsideCallbacksBlock(node: ts.PropertyAssignment): boolean {
    const objectLiteral = node.parent;
    if (!objectLiteral || !ts.isObjectLiteralExpression(objectLiteral)) return false;
    const owner = objectLiteral.parent;
    if (!owner || !ts.isPropertyAssignment(owner)) return false;
    return getPropertyName(owner) === "callbacks";
}

/**
 * Walk a TypeScript AST node tree, invoking `visitor` for every node.
 */
function walkAST(node: ts.Node, visitor: (n: ts.Node) => void): void {
    visitor(node);
    node.forEachChild(child => walkAST(child, visitor));
}

/**
 * Return the property name text of a `PropertyAssignment` if the name is
 * a plain identifier or a string literal.  Returns `undefined` for computed
 * property names or other exotic forms.
 */
function getPropertyName(node: ts.PropertyAssignment): string | undefined {
    const { name } = node;
    if (ts.isIdentifier(name)) return name.text;
    if (ts.isStringLiteral(name)) return name.text;
    return undefined;
}

/**
 * Perform the AST-based transform on `code`.
 *
 * Parses the source with the TypeScript compiler API, walks the tree for
 * `PropertyAssignment` nodes whose name matches one of `LAZY_COMPONENT_KEYS`
 * and whose initializer is a string literal starting with `./` or `../`.
 *
 * Each match is rewritten in-place via `magic-string` so that source-maps
 * remain correct.
 *
 * @returns `{ code, map }` if at least one replacement was made; `null` otherwise.
 */
export function transformCollectionSource(
    code: string,
    id: string
): { code: string; map: ReturnType<MagicString["generateMap"]> } | null {
    // Use TSX kind to handle both .ts and .tsx files uniformly.
    const sourceFile = ts.createSourceFile(
        id,
        code,
        ts.ScriptTarget.Latest,
        /* setParentNodes */ true,
        ts.ScriptKind.TSX
    );

    const ms = new MagicString(code);
    let replaced = false;

    walkAST(sourceFile, (node) => {
        // Only look at PropertyAssignment nodes (key: value in object literals)
        if (!ts.isPropertyAssignment(node)) return;

        const name = getPropertyName(node);

        // Server-only lifecycle hooks: keep the key, drop the body.
        if (name && SERVER_ONLY_CALLBACK_KEYS.has(name) && isInsideCallbacksBlock(node)) {
            const value = node.initializer;
            ms.overwrite(value.getStart(sourceFile), value.getEnd(), "undefined");
            replaced = true;
            return;
        }

        // Check the property name matches one of the lazy component keys
        const propName = name;
        if (!propName || !LAZY_COMPONENT_KEYS.has(propName)) return;

        // Check the initializer is a string literal
        const init = node.initializer;
        if (!ts.isStringLiteral(init)) return;

        // Only transform dot-relative paths
        const importPath = init.text;
        if (!importPath.startsWith("./") && !importPath.startsWith("../")) return;

        // Preserve the original quote character from the source
        const initStart = init.getStart(sourceFile);
        const quoteChar = code.charAt(initStart);

        const replacement =
            `{ __rebaseLazy: true, load: () => import(${quoteChar}${importPath}${quoteChar}) }`;

        ms.overwrite(initStart, init.getEnd(), replacement);
        replaced = true;
    });

    if (!replaced) return null;

    return {
        code: ms.toString(),
        map: ms.generateMap({ hires: true })
    };
}

/**
 * A Vite plugin that dynamically loads and automatically wires Rebase collections.
 *
 * It provides two capabilities:
 * 1. A **virtual module** `"virtual:rebase-collections"` that statically exports
 *    the resolved collections array.
 * 2. A **transform hook** that converts string-based component references
 *    (e.g. `Field: "../../components/MyField"`) into `LazyComponentRef` objects
 *    (`{ __rebaseLazy: true, load: () => import(...) }`), enabling code-splitting
 *    and preventing the backend from loading React-dependent modules.
 */
export function rebaseCollectionsPlugin(options: RebaseCollectionsPluginOptions) {
    const virtualModuleId = "virtual:rebase-collections";
    const resolvedVirtualModuleId = "\0" + virtualModuleId;

    let resolvedCollectionsDir: string;

    return {
        name: "rebase-collections-plugin",

        configResolved(config: { root: string }) {
            // Resolve the collections directory to an absolute path
            // so the `transform` hook can match files reliably.
            resolvedCollectionsDir = path.isAbsolute(options.collectionsDir)
                ? options.collectionsDir
                : path.resolve(config.root, options.collectionsDir);
        },

        resolveId(id: string) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
            return null;
        },

        load(id: string) {
            if (id === resolvedVirtualModuleId) {
                // Vite evaluates `import.meta.glob` relative to the project root.
                // We ensure it starts with '/' so Vite knows evaluating it from the root.
                const globPath = options.collectionsDir.startsWith("/")
                    ? `${options.collectionsDir}/*.ts`
                    : `/${options.collectionsDir}/*.ts`;

                return `
                    // GENERATED BY @rebasepro/app Vite Plugin
                    const collectionModules = import.meta.glob('${globPath}', { eager: true });

                    // index exports the directory's defaults, not a collection —
                    // it has no default export, so it drops out of the list below.
                    // Mirrors loadCollectionsFromDirectory in @rebasepro/server:
                    // the admin would otherwise show a collection as having no
                    // rules while the database enforces the inherited ones.
                    const indexEntry = Object.entries(collectionModules)
                        .find(([path]) => path.endsWith("/index.ts") || path.endsWith("/index.js"));
                    const indexModule = indexEntry?.[1];
                    const defaultSecurityRules = indexModule?.defaultSecurityRules;

                    // The glob hands back files in alphabetical order, which would
                    // otherwise decide the order of the navigation groups and of the
                    // cards inside them. If index exports a \`collections\` array, that
                    // is the one place the developer states an order, so it wins;
                    // collections it does not mention keep following their filename.
                    const declaredOrder = Array.isArray(indexModule?.collections)
                        ? indexModule.collections
                        : [];
                    const rankOf = (collection) => {
                        const index = declaredOrder.indexOf(collection);
                        return index === -1 ? Number.MAX_SAFE_INTEGER : index;
                    };

                    export const collections = Object.values(collectionModules)
                        .map((module) => module.default)
                        .filter(Boolean)
                        .sort((a, b) => rankOf(a) - rankOf(b))
                        .map((collection) =>
                            defaultSecurityRules?.length && !collection.securityRules?.length
                                ? { ...collection, securityRules: defaultSecurityRules }
                                : collection
                        );
                `;
            }
            return null;
        },

        /**
         * Transform collection files to convert string component references
         * into lazy-loading `LazyComponentRef` objects.
         *
         * Example transform:
         * ```
         * // Input
         * Field: "../../frontend/src/components/MyField"
         *
         * // Output
         * Field: { __rebaseLazy: true, load: () => import("../../frontend/src/components/MyField") }
         * ```
         */
        transform(code: string, id: string) {
            // Only process .ts/.tsx files inside the collections directory
            if (!resolvedCollectionsDir) return null;
            if (!id.startsWith(resolvedCollectionsDir)) return null;
            if (!/\.tsx?$/.test(id)) return null;

            return transformCollectionSource(code, id);
        }
    };
}
