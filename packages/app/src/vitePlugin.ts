
import path from "path";
import ts from "typescript";
import MagicString from "magic-string";
import type { Plugin, ViteDevServer } from "vite";

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
//
// `Component` is `ComponentOverride.Component`, reachable from a collection
// through `admin.components`. It is the same ref as the other four and needs the
// same transform, or the path form the type now accepts would arrive at
// `resolveComponentRef` as a bare string.
const LAZY_COMPONENT_KEYS = new Set(["Field", "Preview", "Builder", "Filter", "Component"]);

/**
 * `callbacks:` is the server's block, all of it, and none of it may travel to
 * the browser.
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
 * Every key inside a `callbacks:` block is dropped, with no exemptions. Two
 * used to be exempt — `afterRead` and `afterSave`, because the panel was
 * believed to run them — and both exemptions were wrong in a different way:
 *
 *   - `afterSave` had no client-side call site at all. Nothing invoked
 *     `collection.callbacks.afterSave` in the browser; the body shipped and
 *     never ran.
 *   - `afterRead` did run, unconditionally, on top of the server having already
 *     run it — so a server-backed collection applied it twice, and a
 *     `direct`-transport collection got read callbacks while its write
 *     callbacks were stripped out from under it, silently.
 *
 * Callbacks the panel genuinely runs now live under `admin.browserCallbacks`,
 * which this plugin leaves alone: a separate key, so which runtime a callback
 * belongs to is a fact about the collection file rather than about a
 * `dataSources` declaration in some other file — which is the thing a
 * build-time transform cannot see.
 *
 * Dropping the value rather than the key keeps the source's comma structure
 * intact, and `callbacks.beforeSave === undefined` is what "not present" means
 * to every consumer. The AST schema editor preserves both blocks verbatim when
 * it serializes a collection back to TypeScript, so nothing round-trips through
 * this and no user code can be lost by it.
 */
/** One edit of the strip: the source range it replaces, and with what. */
interface StripEdit {
    start: number;
    end: number;
    text: string;
}

/** The object literal under `as`, `satisfies`, `!` and parentheses, if that is what a value is. */
function unwrapObjectLiteral(expr: ts.Expression): ts.ObjectLiteralExpression | undefined {
    let current: ts.Expression = expr;
    while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current)
        || ts.isSatisfiesExpression(current) || ts.isNonNullExpression(current)) {
        current = current.expression;
    }
    return ts.isObjectLiteralExpression(current) ? current : undefined;
}

/**
 * Every edit that takes a `callbacks` block out of the browser's copy.
 *
 * Matches the key exactly, so `admin.browserCallbacks` — the panel's own block,
 * which is meant to reach the browser — is not caught by it. Whatever the
 * spelling of the block, its server code goes:
 *
 *   - `callbacks: { beforeSave: … }` — each value becomes `undefined`, the key
 *     stays (the one spelling this used to know);
 *   - `callbacks: { async beforeSave() {…} }`, a getter, or `{ beforeSave }` —
 *     the member becomes `beforeSave: undefined`;
 *   - `callbacks: { ...serverHooks }` — the spread becomes `...undefined`;
 *   - `callbacks: cb`, `callbacks: makeHooks()`, or `{ callbacks }` imported
 *     from a server module — the whole block becomes `undefined`.
 *
 * The literal is looked for under `satisfies`/`as`, which is how a typed block
 * is often written. Method syntax, a block defined beside the collection and
 * one imported from a `.server` file all used to ship their bodies and their
 * imports to every visitor of the admin.
 */
function callbackStripEdits(sourceFile: ts.SourceFile): StripEdit[] {
    const edits: StripEdit[] = [];
    const memberEdit = (member: ts.ObjectLiteralElementLike): StripEdit | undefined => {
        if (ts.isPropertyAssignment(member)) {
            return { start: member.initializer.getStart(sourceFile), end: member.initializer.getEnd(), text: "undefined" };
        }
        if (ts.isSpreadAssignment(member)) {
            return { start: member.getStart(sourceFile), end: member.getEnd(), text: "...undefined" };
        }
        // Method, getter, setter, shorthand: the member, rewritten as a key.
        const name = member.name;
        return name ? { start: member.getStart(sourceFile), end: member.getEnd(), text: `${name.getText(sourceFile)}: undefined` } : undefined;
    };
    walkAST(sourceFile, (node) => {
        if (ts.isShorthandPropertyAssignment(node) && node.name.text === "callbacks") {
            edits.push({ start: node.getStart(sourceFile), end: node.getEnd(), text: "callbacks: undefined" });
            return;
        }
        if (!ts.isPropertyAssignment(node) || getPropertyName(node) !== "callbacks") return;
        const literal = unwrapObjectLiteral(node.initializer);
        if (!literal) {
            edits.push({ start: node.initializer.getStart(sourceFile), end: node.initializer.getEnd(), text: "undefined" });
            return;
        }
        for (const member of literal.properties) {
            const edit = memberEdit(member);
            if (edit) edits.push(edit);
        }
    });
    // A `callbacks:` inside a range already replaced is gone with it.
    return edits.filter(edit => !edits.some(outer => outer !== edit && outer.start <= edit.start && edit.end <= outer.end));
}

/** Whether an identifier is a read of a binding, rather than a name being declared or a property key. */
function isReference(id: ts.Identifier): boolean {
    const parent = id.parent;
    if (!parent) return false;
    if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
    if (ts.isQualifiedName(parent) && parent.right === id) return false;
    if ((ts.isPropertyAssignment(parent) || ts.isMethodDeclaration(parent) || ts.isPropertyDeclaration(parent)
        || ts.isPropertySignature(parent) || ts.isMethodSignature(parent) || ts.isGetAccessorDeclaration(parent)
        || ts.isSetAccessorDeclaration(parent) || ts.isEnumMember(parent) || ts.isJsxAttribute(parent)) && parent.name === id) return false;
    if ((ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent)
        || ts.isParameter(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent)
        || ts.isBindingElement(parent) || ts.isFunctionExpression(parent) || ts.isClassExpression(parent)
        || ts.isTypeAliasDeclaration(parent) || ts.isInterfaceDeclaration(parent) || ts.isTypeParameterDeclaration(parent))
        && parent.name === id) return false;
    if (ts.isBindingElement(parent) && parent.propertyName === id) return false;
    if (ts.isImportSpecifier(parent)) return false;
    if (ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent)) return false;
    return true;
}

/** A top-level statement the strip may take out, and the names it declares. */
interface TopLevelBinding {
    statement: ts.Statement;
    names: string[];
}

/**
 * Top-level code that only the stripped callbacks used: the imports and the
 * declarations nothing else reads.
 *
 * Replacing a block with `undefined` is not enough on its own. A module an
 * import names is still loaded — and evaluated, for its side effects — whether
 * or not anything reads the binding, so `import { charge } from "./stripe.server"`
 * kept the server module in the bundle (or broke the build on a Node built-in),
 * and `const stripe = new Stripe(process.env.KEY)` still ran in the browser. A
 * statement goes when something stripped read it and nothing left does; that
 * repeats until nothing more goes, so a declaration only a removed declaration
 * used goes too. An exported declaration stays: another file may import it.
 */
function deadTopLevelStatements(sourceFile: ts.SourceFile, removed: StripEdit[]): ts.Statement[] {
    const bindings: TopLevelBinding[] = [];
    for (const statement of sourceFile.statements) {
        const exported = ts.canHaveModifiers(statement)
            && (ts.getModifiers(statement) ?? []).some(m => m.kind === ts.SyntaxKind.ExportKeyword);
        if (exported) continue;
        if (ts.isImportDeclaration(statement)) {
            const clause = statement.importClause;
            if (!clause || clause.isTypeOnly) continue;
            const names: string[] = [];
            if (clause.name) names.push(clause.name.text);
            const named = clause.namedBindings;
            if (named && ts.isNamespaceImport(named)) names.push(named.name.text);
            if (named && ts.isNamedImports(named)) {
                for (const el of named.elements) if (!el.isTypeOnly) names.push(el.name.text);
            }
            if (names.length > 0) bindings.push({ statement, names });
        } else if (ts.isVariableStatement(statement)) {
            const names: string[] = [];
            const collect = (name: ts.BindingName) => {
                if (ts.isIdentifier(name)) names.push(name.text);
                else for (const el of name.elements) if (!ts.isOmittedExpression(el)) collect(el.name);
            };
            for (const decl of statement.declarationList.declarations) collect(decl.name);
            bindings.push({ statement, names });
        } else if ((ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) && statement.name) {
            bindings.push({ statement, names: [statement.name.text] });
        }
    }
    if (bindings.length === 0) return [];

    const references: ts.Identifier[] = [];
    walkAST(sourceFile, (node) => {
        if (ts.isIdentifier(node) && isReference(node)) references.push(node);
    });

    const ranges: { start: number; end: number }[] = removed.map(({ start, end }) => ({ start, end }));
    const within = (node: ts.Node) => {
        const at = node.getStart(sourceFile);
        return ranges.some(r => r.start <= at && node.getEnd() <= r.end);
    };
    const dead: ts.Statement[] = [];
    for (let changed = true; changed;) {
        changed = false;
        for (const binding of bindings) {
            if (dead.includes(binding.statement)) continue;
            let readByStripped = false;
            let readLive = false;
            for (const ref of references) {
                if (!binding.names.includes(ref.text)) continue;
                // A read inside the statement itself (a recursive function) is neither.
                if (ref.getStart(sourceFile) >= binding.statement.getStart(sourceFile) && ref.getEnd() <= binding.statement.getEnd()) continue;
                if (within(ref)) readByStripped = true;
                else readLive = true;
            }
            if (readByStripped && !readLive) {
                dead.push(binding.statement);
                ranges.push({ start: binding.statement.getStart(sourceFile), end: binding.statement.getEnd() });
                changed = true;
            }
        }
    }
    return dead;
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

    // Server-only lifecycle hooks: out of the browser's copy, with whatever
    // top-level code only they used.
    const strips = callbackStripEdits(sourceFile);
    for (const edit of strips) {
        ms.overwrite(edit.start, edit.end, edit.text);
        replaced = true;
    }
    const gone: { start: number; end: number }[] = [...strips];
    for (const statement of deadTopLevelStatements(sourceFile, strips)) {
        ms.remove(statement.getStart(sourceFile), statement.getEnd());
        gone.push({ start: statement.getStart(sourceFile), end: statement.getEnd() });
        replaced = true;
    }
    const stripped = (node: ts.Node) => gone.some(e => e.start <= node.getStart(sourceFile) && node.getEnd() <= e.end);

    walkAST(sourceFile, (node) => {
        // Only look at PropertyAssignment nodes (key: value in object literals)
        if (!ts.isPropertyAssignment(node)) return;
        if (stripped(node)) return;

        const name = getPropertyName(node);

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
/**
 * Annotated `Plugin` rather than inferred.
 *
 * The return used to be a bare object literal, and TypeScript 6 stopped
 * accepting it where vite wants a `PluginOption`: `configureServer` is an
 * `ObjectHook`, so a plain method's inferred signature is not assignable, and
 * the whole config object then failed with "Excessive stack depth comparing
 * types" — an error naming the caller's `defineConfig` rather than the plugin
 * that caused it. A scaffolded frontend runs `vite build && tsc` with
 * `vite.config.ts` in its `include`, so that was a broken `pnpm build` for
 * every new project on TS 6, reported against a file the user did not write.
 *
 * Declaring the type puts the check here, where the hooks are, instead of at
 * every call site.
 */
export function rebaseCollectionsPlugin(options: RebaseCollectionsPluginOptions): Plugin {
    const virtualModuleId = "virtual:rebase-collections";
    const resolvedVirtualModuleId = "\0" + virtualModuleId;

    let resolvedCollectionsDir: string;
    /** The same directory as an `import.meta.glob` pattern, which Vite reads from the root. */
    let collectionsDirGlob: string;

    return {
        name: "rebase-collections-plugin",

        configResolved(config: { root: string }) {
            // Resolve the collections directory to an absolute path
            // so the `transform` hook can match files reliably.
            resolvedCollectionsDir = path.isAbsolute(options.collectionsDir)
                ? options.collectionsDir
                : path.resolve(config.root, options.collectionsDir);
            // A glob pattern that starts with "/" is relative to the root, not
            // to the filesystem, so an absolute directory is written as the way
            // there from the root. Written as given, it found nothing: the admin
            // silently had no collections.
            const fromRoot = toModuleIdPath(path.relative(config.root, resolvedCollectionsDir));
            collectionsDirGlob = fromRoot ? "/" + fromRoot : "";
        },

        /**
         * Watch the collections directory itself, not just the files in it.
         *
         * The virtual module below is an `import.meta.glob`, and Vite already
         * invalidates a glob's importer when a matching file appears — but only
         * for files its watcher sees. The watcher watches the Vite root, plus
         * whatever individual files the module graph reached; a collections
         * directory outside the root (`collectionsDir: "../config/collections"`
         * is the shape every scaffold ships) is therefore watched one existing
         * file at a time, and a *new* file in it raises no event at all.
         *
         * That is the whole of the "created a collection, it is in the source,
         * it is not in the admin" bug: the editor wrote the file, nothing
         * invalidated the virtual module, and the collection list stayed
         * whatever it was when the dev server booted — a reload did not fix it,
         * because the stale glob was already transformed and cached. Only a
         * restart did.
         *
         * Editing an existing collection was always fine, which is why this hid
         * for so long: that file IS in the module graph, so it IS watched.
         *
         * Watching the directory is the whole fix. Vite's own glob invalidation
         * does the rest — it is listening on this same watcher, and once the
         * event reaches it, it invalidates the virtual module and reloads the
         * page exactly as it does for a collections directory inside the root.
         */
        configureServer(server: ViteDevServer) {
            server.watcher.add(resolvedCollectionsDir);
        },

        resolveId(id: string) {
            if (id === virtualModuleId) {
                return resolvedVirtualModuleId;
            }
            return null;
        },

        load(id: string) {
            if (id === resolvedVirtualModuleId) {
                // The files the backend's loader reads (`isCollectionFile` in
                // @rebasepro/server), and only those. The glob is eager, so a
                // test file it matched ran in the browser bundle and threw
                // `describe is not defined` before the admin could render.
                // Dotfiles need no pattern (`*` does not match them), and
                // neither do declaration files, which compile to nothing.
                const globPatterns = [
                    `${collectionsDirGlob}/*.ts`,
                    `!${collectionsDirGlob}/*.test.*`
                ];

                return `
                    // GENERATED BY @rebasepro/app Vite Plugin
                    const collectionModules = import.meta.glob(${JSON.stringify(globPatterns)}, { eager: true });

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
            if (!isInsideDirectory(id, resolvedCollectionsDir)) return null;
            if (!/\.tsx?$/.test(id)) return null;

            return transformCollectionSource(code, id);
        }
    };
}


/**
 * A filesystem path in the form Vite uses for module ids: forward slashes on
 * every platform. `path.resolve` answers `C:\app\config` on Windows while the
 * id of a file in it is `C:/app/config/posts.ts`, so comparing the two as they
 * came never matched — and the transform, which is what strips server
 * callbacks from the browser bundle, never ran.
 */
function toModuleIdPath(filePath: string): string {
    return filePath.replace(/\\/g, "/");
}

/**
 * Whether a module id is a file inside `directory`, whichever separators
 * either was written with. On a whole path segment, so `collections-old/` is
 * not inside `collections`.
 */
export function isInsideDirectory(id: string, directory: string): boolean {
    const dir = toModuleIdPath(directory);
    return toModuleIdPath(id).startsWith(dir.endsWith("/") ? dir : dir + "/");
}

/**
 * How the admin's dependencies are split into cached chunks.
 *
 * This was sixty-five lines copied verbatim into every scaffold's
 * `vite.config.ts`, comments and all — which meant every project got a frozen
 * snapshot of a decision that keeps being revised. When we learned that naming
 * `lucide-react` welded 822 kB of icons into the preload set, the fix landed
 * in the template and in nothing already generated.
 *
 * A name here says these modules travel TOGETHER. It does not say they travel
 * late: a chunk becomes a static dependency of the entry — and so a
 * `modulepreload` in index.html — the moment any one module in it is
 * statically reachable. Naming a library that is only partly lazy therefore
 * drags the lazy part onto the critical path. Read the two exceptions below
 * before adding a line.
 *
 * @example
 * ```ts
 * build: { rollupOptions: { output: { manualChunks: rebaseManualChunks } } }
 * ```
 */
export function rebaseManualChunks(id: string): string | undefined {
    // @rollup/plugin-commonjs emits its shared helpers as two virtual modules
    // ("\0commonjsHelpers.js" and "\0commonjs-dynamic-modules") that every
    // CommonJS dependency reaches, the entry's included. They match no rule
    // below, so Rollup parks them in one of the chunks that use them — and it
    // chose `vendor-exceljs`, which meant the entry statically imported 940 kB
    // of spreadsheet reader to get a ten-line `require` shim. Give the helpers
    // a chunk of their own so they can never anchor a heavy one to the
    // critical path.
    if (id.includes("commonjsHelpers") || id.includes("commonjs-dynamic-modules")) return "vendor-commonjs-helpers";

    if (id.includes("exceljs")) return "vendor-exceljs";
    if (id.includes("prosemirror")) return "vendor-prosemirror";
    if (id.includes("monaco-editor") || id.includes("@monaco-editor")) return "vendor-monaco";
    if (id.includes("@xyflow") || id.includes("dagre")) return "vendor-xyflow";
    if (id.includes("@dnd-kit")) return "vendor-dnd";
    if (id.includes("prism-react-renderer")) return "vendor-prism";
    if (id.includes("markdown-it")) return "vendor-markdown";
    if (id.includes("react-dropzone")) return "vendor-dropzone";
    // date-fns core only. The ~77 locales are imported one at a time by the
    // admin's date preview; sharing a chunk name with the core would make all
    // of them eager again.
    if (id.includes("date-fns/locale")) return undefined;
    if (id.includes("date-fns")) return "vendor-datefns";
    if (id.includes("fuse.js")) return "vendor-fuse";
    if (id.includes("node_modules/react-dom/")) return "vendor-react-dom";
    if (id.includes("node_modules/react-router") || id.includes("node_modules/@remix-run")) return "vendor-react-router";
    if (id.includes("node_modules/@radix-ui/")) return "vendor-radix";
    if (id.includes("node_modules/framer-motion/")) return "vendor-framer-motion";
    if (id.includes("node_modules/zod/")) return "vendor-zod";
    if (id.includes("node_modules/i18next") || id.includes("node_modules/react-i18next")) return "vendor-i18next";
    if (id.includes("node_modules/@floating-ui/")) return "vendor-floating-ui";
    if (id.includes("node_modules/tailwind-merge/")) return "vendor-tailwind-merge";
    if (id.includes("node_modules/notistack/")) return "vendor-notistack";

    // lucide-react has no line on purpose. The ~130 icons the chrome imports by
    // name are static; the by-name lookup map is fetched on demand. One chunk
    // name cannot hold both apart, and naming it welded 822 kB of icons into
    // the preload set. Left to Rollup, the named icons land in the entry and
    // the map gets its own async chunk.

    return undefined;
}
