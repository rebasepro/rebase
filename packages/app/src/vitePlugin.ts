
import path from "path";
import ts from "typescript";
import MagicString from "magic-string";
import fs from "fs";
import type { Plugin, ResolvedConfig, ViteDevServer } from "vite";

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

    // Small libraries the entry needs, named before the heavy groups. A name
    // takes the unassigned dependencies of its modules with it, so
    // `prism-react-renderer` took `clsx` — which the kit imports statically — and
    // the entry imported 85 kB of syntax highlighter for a 633-byte helper;
    // React core landed in `vendor-dnd` the same way.
    if (/[\\/]node_modules[\\/](react|scheduler|use-sync-external-store)[\\/]/.test(id)) return "vendor-react";
    if (/[\\/]node_modules[\\/]clsx[\\/]/.test(id)) return "vendor-clsx";

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
    // the preload set. Left to the bundler, the map gets its own async chunk
    // and the named icons land in the chunks that import them — except the
    // few the map shares with an eager chunk, which come out as small eager
    // chunks of their own (2 of 19, under 4 kB each, in a scaffold-shaped app
    // measured 2026-10-07). Keeping those together takes a `codeSplitting`
    // group tagged `$initial`, which a manualChunks function cannot express;
    // app/frontend/vite.config.ts does it that way.

    return undefined;
}


// ─── The MCP App view ────────────────────────────────────────────────────────

/**
 * The view an MCP client like Claude shows the project's data in
 * (show_collection, show_record, show_app), built from this app.
 *
 * A server serves a generic view — the admin panel with nothing of the
 * project's own. This builds the project's: its `App` component (the one
 * `src/main.tsx` renders under its router) and its stylesheet, mounted inside
 * the view (`startMcpView` in `@rebasepro/cms/mcp-view`), so the app's custom
 * views, entity views, fields, previews, actions, plugins and slots are what
 * Claude draws. Not `main.tsx` itself: a browser router cannot address a frame
 * whose document is `about:srcdoc`, and in the view `<RebaseShell>` brings a
 * router of its own. The output is one self-contained document,
 * `rebase-view.html` beside the build: a view's frame fetches nothing, so
 * every script, style and font is inside it. The backend serves it in place
 * of the generic one (`serveSPA` finds it in the frontend it serves).
 *
 * A second build, after the app's, from the same config.
 */
export interface RebaseMcpViewPluginOptions {
    /** The module that exports the app's root component, `App`. Default `src/App.tsx`. */
    app?: string;
    /** The app's stylesheet. Default `src/index.css`, where it exists. */
    styles?: string;
    /** The file written into the build's output directory. Default `rebase-view.html`. */
    fileName?: string;
}

/** Set while the view's own build runs, so it does not build a view of itself. */
const MCP_VIEW_BUILD = "REBASE_MCP_VIEW_BUILD";

export function rebaseMcpViewPlugin(options: RebaseMcpViewPluginOptions = {}): Plugin {
    let config: ResolvedConfig;
    return {
        name: "rebase-mcp-view",
        apply: "build",
        configResolved(resolved) {
            config = resolved;
        },
        async closeBundle() {
            if (process.env[MCP_VIEW_BUILD] || config.build.ssr) return;
            const app = path.resolve(config.root, options.app ?? "src/App.tsx");
            if (!fs.existsSync(app)) {
                config.logger.warn(`[rebase] No MCP view: ${path.relative(config.root, app)} does not exist.`);
                return;
            }
            const styles = path.resolve(config.root, options.styles ?? "src/index.css");
            const work = fs.mkdtempSync(path.join(config.root, ".rebase-mcp-view-"));
            try {
                fs.writeFileSync(path.join(work, "index.html"), mcpViewDocument());
                fs.writeFileSync(path.join(work, "view.css"), MCP_VIEW_UTILITIES);
                fs.writeFileSync(path.join(work, "boot.tsx"), mcpViewBoot(
                    app,
                    fs.existsSync(styles) ? styles : undefined,
                    resolvesFrom(config.root, "@rebasepro/plugin-insights")));
                const { build } = await import("vite");
                process.env[MCP_VIEW_BUILD] = "1";
                try {
                    await build({
                        configFile: config.configFile,
                        root: config.root,
                        mode: config.mode,
                        logLevel: "warn",
                        plugins: [mcpViewWithoutLazyExtras(), mcpViewInlineIntoHtml()],
                        build: {
                            outDir: path.join(work, "out"),
                            emptyOutDir: true,
                            copyPublicDir: false,
                            sourcemap: false,
                            modulePreload: false,
                            cssCodeSplit: false,
                            // Everything but fonts: a view's frame loads no
                            // font file, inlined or not, so they would only
                            // be megabytes the host downloads to throw away.
                            assetsInlineLimit: file => !/\.(woff2?|ttf|otf|eot)$/i.test(file),
                            rollupOptions: {
                                input: path.join(work, "index.html"),
                                output: { codeSplitting: false }
                            }
                        }
                    });
                } finally {
                    delete process.env[MCP_VIEW_BUILD];
                }
                const built = path.join(work, "out", path.relative(config.root, path.join(work, "index.html")));
                const target = path.join(config.build.outDir, options.fileName ?? "rebase-view.html");
                fs.copyFileSync(fs.existsSync(built) ? built : path.join(work, "out", "index.html"), target);
                config.logger.info(`[rebase] MCP view: ${path.relative(config.root, target)} (${Math.round(fs.statSync(target).size / 1024)} kB)`);
            } finally {
                fs.rmSync(work, { recursive: true, force: true });
            }
        }
    };
}

function resolvesFrom(root: string, specifier: string): boolean {
    try {
        return fs.existsSync(path.join(root, "node_modules", specifier, "package.json"));
    } catch {
        return false;
    }
}

/** The view's document: a root for the app, and storage that works in a frame with no origin of its own. */
export function mcpViewDocument(entry = "./boot.tsx"): string {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Rebase</title>
    <script>${MCP_VIEW_STORAGE_SHIM}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="${entry}"></script>
</body>
</html>
`;
}

/**
 * A host may sandbox the view without an origin of its own, and then reading
 * `localStorage` or `sessionStorage` throws. The admin keeps view preferences
 * there; in memory they last as long as the view.
 */
export const MCP_VIEW_STORAGE_SHIM = `for (const name of ["localStorage", "sessionStorage"]) {
    try { void window[name]; } catch {
        const data = new Map();
        Object.defineProperty(window, name, { configurable: true, value: {
            get length() { return data.size; },
            key: (index) => [...data.keys()][index] ?? null,
            getItem: (key) => data.has(key) ? data.get(key) : null,
            setItem: (key, value) => void data.set(key, String(value)),
            removeItem: (key) => void data.delete(key),
            clear: () => data.clear()
        } });
    }
}`;

function mcpViewBoot(app: string, styles: string | undefined, insights: boolean): string {
    return [
        "import React from \"react\";",
        "import { createRoot } from \"react-dom/client\";",
        ...(styles ? [`import ${JSON.stringify(styles)};`] : []),
        "import \"./view.css\";",
        "import { addAppModules, startMcpView } from \"@rebasepro/cms/mcp-view\";",
        ...(insights ? [
            "import { BarChart, ChartCard, ChartStatus, KpiChange, KpiGrid, KpiReadout, KpiTile, SERIES_COLORS, TimeSeriesChart, compactFormat, describeChange, formatNumber, niceTicks } from \"@rebasepro/plugin-insights\";",
            "addAppModules({ \"@rebasepro/plugin-insights\": { BarChart, ChartCard, ChartStatus, KpiChange, KpiGrid, KpiReadout, KpiTile, SERIES_COLORS, TimeSeriesChart, compactFormat, describeChange, formatNumber, niceTicks } });"
        ] : []),
        "startMcpView({",
        `    mountApp: async () => {`,
        `        const { App } = await import(${JSON.stringify(app)});`,
        "        createRoot(document.getElementById(\"root\")!).render(<App/>);",
        "    }",
        "});",
        ""
    ].join("\n");
}

/**
 * The utilities an app Claude writes may use (show_app). Tailwind generates
 * only the classes it finds when it builds, and an app's code arrives later:
 * a class missing here does nothing, silently. Colours are the app's own,
 * from its stylesheet. And the root is held to the frame's width: an app's
 * stylesheet may lay out the page (a flex body sizes the root to its content).
 */
export const MCP_VIEW_UTILITIES = `@import "tailwindcss/utilities" source(none);
/* The view is as wide as its frame, whatever the app's stylesheet does with the page. */
#root { width: 100%; min-width: 0; }
@source inline("{sm:,md:,lg:,xl:,}{flex,inline-flex,grid,block,inline-block,hidden}");
@source inline("{sm:,md:,lg:,xl:,}{flex-row,flex-col,flex-wrap,flex-1,flex-none,shrink-0,grow,order-first,order-last}");
@source inline("{sm:,md:,lg:,xl:,}grid-cols-{1,2,3,4,5,6,7,8,9,10,11,12}");
@source inline("{sm:,md:,lg:,xl:,}col-span-{1,2,3,4,5,6,7,8,9,10,11,12,full}");
@source inline("{sm:,md:,lg:,xl:,}{gap,gap-x,gap-y,p,px,py,pt,pb,pl,pr,m,mx,my,mt,mb,ml,mr,space-x,space-y}-{0,0.5,1,1.5,2,2.5,3,4,5,6,8,10,12,16}");
@source inline("{sm:,md:,lg:,xl:,}{w,h,min-w,min-h,max-w,max-h}-{0,full,screen,fit,min,max,auto,1/2,1/3,2/3,1/4,3/4}");
@source inline("{w,h,min-h,max-h,size}-{4,5,6,8,10,12,16,20,24,32,40,48,64,72,80,96}");
@source inline("max-w-{xs,sm,md,lg,xl,2xl,3xl,4xl,5xl,6xl,7xl,prose}");
@source inline("{items,self}-{start,center,end,stretch,baseline}");
@source inline("justify-{start,center,end,between,around,evenly}");
@source inline("text-{xs,sm,base,lg,xl,2xl,3xl,4xl,left,center,right}");
@source inline("font-{normal,medium,semibold,bold,mono}");
@source inline("{truncate,whitespace-nowrap,break-words,uppercase,tabular-nums,underline}");
@source inline("leading-{tight,snug,normal,relaxed} tracking-{tight,wide}");
@source inline("rounded{,-md,-lg,-xl,-full} border{,-t,-b,-l,-r}");
@source inline("overflow-{hidden,auto,x-auto,y-auto} {relative,absolute,sticky} {top,bottom,left,right,inset}-0 z-{10,20}");
@source inline("opacity-{50,75} cursor-pointer select-none");
`;

/**
 * Every chunk inlined into the view's document: a frame fetches nothing, so
 * the script and the stylesheet are written into the page. The preload
 * helper's placeholder, which a build with no chunks to preload leaves
 * unreplaced, is filled in.
 */
export function mcpViewInlineIntoHtml(): Plugin {
    return {
        name: "rebase-mcp-view-inline",
        enforce: "post",
        generateBundle(_options, bundle) {
            for (const page of Object.values(bundle)) {
                if (page.type !== "asset" || !page.fileName.endsWith(".html")) continue;
                let html = String(page.source);
                for (const [fileName, file] of Object.entries(bundle)) {
                    if (file.type === "chunk" && fileName.endsWith(".js")) {
                        const tag = new RegExp(`<script[^>]*src="[^"]*${escapeForRegExp(fileName)}"[^>]*></script>`);
                        const code = file.code
                            // `</script` inside the code would close the tag early.
                            .replace(/<\/script/gi, "<\\/script")
                            .replace(/__VITE_PRELOAD__/g, "void 0");
                        html = html.replace(tag, () => `<script type="module">${code}</script>`);
                        delete bundle[fileName];
                    } else if (file.type === "asset" && fileName.endsWith(".css")) {
                        const tag = new RegExp(`<link[^>]*href="[^"]*${escapeForRegExp(fileName)}"[^>]*>`);
                        html = html.replace(tag, () => `<style>${String(file.source)}</style>`);
                        delete bundle[fileName];
                    }
                }
                page.source = html;
            }
        }
    };
}

/**
 * What the admin loads lazily and a view does without. With every chunk
 * inlined, an `import()` is no longer a fetch on demand but bytes in the
 * document: the whole Lucide map (an icon a collection names by string), every
 * date-fns locale but the default, the admin's translations (the view is in
 * English), and the toolbar's import and export (both work on files, and a
 * view has none to read nor anywhere to save one). Each becomes an empty
 * module, which every one of their loaders treats as "not there".
 */
export function mcpViewWithoutLazyExtras(): Plugin {
    return {
        name: "rebase-mcp-view-without-lazy-extras",
        enforce: "pre",
        load(id) {
            if (/\/icons\/lucide_icon_map\.[jt]s$/.test(id)) return "export const icons = {};";
            if (/\/date-fns\/locale\/(?!en-US)[^/]+\.js$/.test(id)) return "export {};";
            if (/\/app\/(src|dist)\/locales\/(?!en\.)[a-z]+\.[jt]s$/.test(id)) return "export {};";
            if (/\/data_import\/import\/ImportCollectionAction\.[jt]sx?$/.test(id)) {
                return "export const ImportCollectionAction = () => null, PropertySelectEntry = () => null, ImportDataPreview = () => null;";
            }
            if (/\/data_export\/export\/ExportCollectionAction\.[jt]sx?$/.test(id)) {
                return "export const ExportCollectionAction = () => null;";
            }
            return undefined;
        }
    };
}

function escapeForRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
