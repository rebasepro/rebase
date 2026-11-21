import * as fs from "fs";
import * as path from "path";
import { fileURLToPath, pathToFileURL } from "url";
import {
    LEGACY_LAYOUT_REMEDY,
    isRpcDef,
    isTableDef,
    isViewDef,
    type AnyRpcDef,
    type AnyTableDef,
    type AnyViewDef,
    type CompiledTable,
    type DefaultRls,
    type TableDescriptor
} from "@rebasepro/types";
import { SchemaDefinitionError, compileSchema, compileTables, type SchemaDefinitionProblem } from "@rebasepro/common";

/**
 * The one definition of "the tables".
 *
 * Every door that reads a project's `backend/schema` — server boot, the stock
 * runtime, `rebase db generate`, `db push`, the doctor, SDK generation — calls
 * {@link loadBackendSchema}, so they cannot disagree about which tables exist
 * or which of them are protected. A definition that would leave a table
 * unprotected stops all of them the same way.
 */

/** The module names that make a directory a schema: its `index`. */
const INDEX_FILES = ["index.ts", "index.mts", "index.js", "index.mjs"] as const;
const MODULE_EXTENSIONS = [".ts", ".mts", ".js", ".mjs"] as const;

/**
 * A `backend/schema` directory, imported and checked.
 *
 * @group Schema
 */
export interface LoadedSchema {
    /** The schema directory, absolute. */
    dir: string;
    /**
     * The index module the definitions were read from, absolute. Empty when the
     * directory has no index — the project declares no tables, and the runtime
     * introspects the database instead.
     */
    indexFile: string;
    /**
     * Every table and view the index exports, each once, in the order the
     * index module's namespace lists them (an ES module namespace lists its
     * exports by name; a CommonJS build in declaration order).
     */
    defs: (AnyTableDef | AnyViewDef)[];
    /** The `defaultRls` the index exports: what `rls: "inherit"` resolves to. */
    defaultRls?: DefaultRls;
    /**
     * The SQL functions the index exports with `defineRpc`, each once: what
     * `POST /api/rpc/<name>` serves. Absent when it exports none.
     */
    rpc?: AnyRpcDef[];
}

/**
 * Options of {@link loadBackendSchema}.
 *
 * @group Schema
 */
export interface LoadBackendSchemaOptions {
    /**
     * The project root, where a legacy `config/collections` directory would
     * be. Defaults to two levels above `dir` (`<root>/backend/schema`).
     * `false` skips that check — for a built bundle, whose layout the
     * manifest's format version already vouches for.
     */
    projectRoot?: string | false;
    /**
     * How a module of the directory is imported: the index and every sibling
     * module go through it. Defaults to a plain `import()`.
     *
     * The default is right wherever a loader already handles TypeScript — the
     * server under tsx, the stock runtime reading a compiled bundle, a test
     * runner. A CLI process is not running under a TypeScript loader, and a
     * schema module's relative imports are extensionless (`./users`), which
     * Node's own type stripping cannot resolve; such a caller passes an
     * importer that can (the CLI passes jiti). Whatever it returns must be the
     * module's namespace: the definitions are read off its exports.
     */
    importModule?: SchemaModuleImporter;
}

/**
 * A module importer for {@link LoadBackendSchemaOptions.importModule}: takes an
 * absolute file path, returns the module's exports.
 *
 * @group Schema
 */
export type SchemaModuleImporter = (file: string) => Promise<Record<string, unknown>>;

/**
 * The schema directory could not be read: a module failed to import, the
 * project is still on the `config/collections` layout, or the index does not
 * export what its siblings define.
 *
 * Distinct from {@link SchemaDefinitionError}, which says a definition is
 * wrong; this says the files could not be turned into definitions at all.
 *
 * @group Schema
 */
export class SchemaLoadError extends Error {

    readonly code = "SCHEMA_LOAD_FAILED";

    constructor(
        message: string,
        /** The file the failure is about, absolute, when there is one. */
        readonly file?: string,
        options?: { cause?: unknown }
    ) {
        super(message, options);
        this.name = "SchemaLoadError";
    }
}

/**
 * Whether an error is a {@link SchemaLoadError}, from this copy of the package
 * or another.
 *
 * @group Schema
 */
export function isSchemaLoadError(error: unknown): error is SchemaLoadError {
    return typeof error === "object" && error !== null && "code" in error && error.code === "SCHEMA_LOAD_FAILED";
}

async function nativeImport(file: string): Promise<Record<string, unknown>> {
    // A plain import(), so the tsx loader (or the runtime's own resolution of a
    // compiled bundle) resolves `.ts` and workspace specifiers.
    return await import(pathToFileURL(file).href);
}

/**
 * What Node's ESM loader needs when it failed on a relative import written
 * without its extension (`export { users } from "./users"` in a compiled
 * `index.js`): one sentence naming the import and its fix. Undefined for any
 * other failure — including a module that is missing under every extension,
 * where the extension is not what is wrong.
 */
function missingExtensionHint(error: unknown): string | undefined {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ERR_MODULE_NOT_FOUND") return undefined;
    // Node names the module it looked for, resolved: `Cannot find module '/app/dist/schema/users' imported from /app/dist/schema/index.js`.
    const match = /Cannot find module '([^']+)' imported from ([^\n]+)/.exec(error.message);
    if (!match) return undefined;
    const asPath = (text: string): string => (text.startsWith("file:") ? fileURLToPath(text) : text);
    const missing = asPath(match[1]);
    const importer = asPath(match[2].trim());
    if (!path.isAbsolute(missing) || path.extname(missing) !== "") return undefined;
    const found = [".js", ".ts", ".mjs", ".mts"].find(extension => fs.existsSync(missing + extension));
    if (found === undefined) return undefined;
    let written = path.relative(path.dirname(importer), missing).split(path.sep).join("/");
    if (!written.startsWith("../")) written = `./${written}`;
    const extension = found === ".mjs" || found === ".mts" ? ".mjs" : ".js";
    return `The import \`${written}\` in ${path.basename(importer)} has no extension, which Node's ESM loader needs on a relative import: ` +
        `write \`${written}${extension}\` in the source, or build with \`rebase build\`, which adds it.`;
}

async function importOrThrow(importModule: SchemaModuleImporter, file: string, role: string): Promise<Record<string, unknown>> {
    try {
        return await importModule(file);
    } catch (error) {
        const hint = missingExtensionHint(error);
        throw new SchemaLoadError(
            `Could not import ${file} (${role}).\n\n` +
            `${error instanceof Error ? error.message : String(error)}\n\n` +
            (hint !== undefined ? `${hint}\n\n` : "") +
            "Every module in backend/schema must import cleanly: a table that cannot be read is a route " +
            "without policies, or policies without a route. Fix the file, or delete it.",
            file,
            { cause: error }
        );
    }
}

/** A legacy collection: a plain object with `properties`, the shape `defineCollection` returned. */
function isLegacyCollection(value: unknown): boolean {
    if (typeof value !== "object" || value === null || isTableDef(value) || isViewDef(value)) return false;
    if (!("properties" in value) || typeof value.properties !== "object" || value.properties === null) return false;
    return ("slug" in value && typeof value.slug === "string") || ("name" in value && typeof value.name === "string");
}

function legacyLayoutError(what: string, file?: string): SchemaLoadError {
    return new SchemaLoadError(
        `${what}. This runtime reads tables from backend/schema (\`defineTable\`, \`defineAuthTable\`, ` +
        `\`defineView\`); \`defineCollection\` and config/collections are no longer read. To migrate: ` +
        `${LEGACY_LAYOUT_REMEDY}.`,
        file
    );
}

/** Every module file under `dir` other than its index, depth first, sorted, for a stable error order. */
function siblingModules(dir: string): string[] {
    const out: string[] = [];
    const walk = (current: string, top: boolean): void => {
        const entries = fs.readdirSync(current, { withFileTypes: true })
            .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        for (const entry of entries) {
            // Dotfiles are never modules (macOS AppleDouble sidecars `._x.ts`
            // are binary blobs whose names end in .ts).
            if (entry.name.startsWith(".")) continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                if (entry.name === "node_modules" || entry.name === "__tests__") continue;
                walk(full, false);
                continue;
            }
            if (!entry.isFile()) continue;
            if (!MODULE_EXTENSIONS.some(ext => entry.name.endsWith(ext))) continue;
            if (/\.d\.[mc]?ts$/.test(entry.name) || /\.(test|spec)\./.test(entry.name)) continue;
            if (top && (INDEX_FILES as readonly string[]).includes(entry.name)) continue;
            out.push(full);
        }
    };
    walk(dir, true);
    return out;
}

function isDefaultRls(value: unknown): value is DefaultRls {
    return value === "admin-only" || (Array.isArray(value) && value.length > 0);
}

/**
 * Import a project's `backend/schema` directory.
 *
 * - Reads `<dir>/index.(ts|mts|js|mjs)` and collects every export that is a
 *   `defineTable` / `defineAuthTable` / `defineView` result, every
 *   `defineRpc` result (a name declared twice is refused), and `defaultRls`.
 * - The index is authoritative: every other module under `dir` is imported
 *   too, and one defining a table or view the index does not export is
 *   refused. A table with policies generated but no route — or a route with
 *   no policies — is the bug that prevents.
 * - A module that fails to import is a {@link SchemaLoadError} naming the file;
 *   nothing is ever skipped.
 * - A project still on the legacy layout (a `config/collections` directory, or
 *   `defineCollection` results exported) is refused with the codemod to run.
 * - Validates by compiling: every problem with every definition (no `rls`,
 *   `rls: []`, `"inherit"` without `defaultRls`, no primary key, a relation to
 *   a table that is not exported…) is thrown together as one
 *   {@link SchemaDefinitionError}.
 *
 * Returns the definitions, not lowered: see {@link compileLoadedSchema}. A
 * directory that does not exist, or has no index, declares no tables
 * (`defs: []`) — unless a sibling module defines one.
 *
 * @group Schema
 */
export async function loadBackendSchema(dir: string, options: LoadBackendSchemaOptions = {}): Promise<LoadedSchema> {
    const resolved = path.resolve(dir);
    const importModule = options.importModule ?? nativeImport;

    if (resolved.split(path.sep).join("/").endsWith("/config/collections")) {
        throw legacyLayoutError(`${resolved} is a config/collections directory`, resolved);
    }
    if (options.projectRoot !== false) {
        const projectRoot = path.resolve(options.projectRoot ?? path.join(resolved, "..", ".."));
        const legacyDir = path.join(projectRoot, "config", "collections");
        if (fs.existsSync(legacyDir) && fs.statSync(legacyDir).isDirectory()) {
            // With the tables already written, the codemod has run: it leaves
            // config/collections for `--check` until its author deletes it. Telling
            // that author to run the codemod sends them round the loop again.
            if (INDEX_FILES.some(name => fs.existsSync(path.join(resolved, name)))) {
                throw new SchemaLoadError(
                    `The project has ${resolved} and still has ${legacyDir}, which the migration leaves in place ` +
                    "for `rebase migrate collections-to-tables --check`. Remove what Rebase used to read from config/ " +
                    "once you no longer need that check — `git rm -r config/collections`, and config/index.ts, " +
                    "config/resources.ts and config/storage.ts if the migration moved them — then run this again.",
                    legacyDir
                );
            }
            throw legacyLayoutError(`The project still has ${legacyDir}`, legacyDir);
        }
    }

    if (!fs.existsSync(resolved)) {
        return { dir: resolved, indexFile: "", defs: [] };
    }
    if (!fs.statSync(resolved).isDirectory()) {
        throw new SchemaLoadError(
            `${resolved} is a file. The schema is a directory whose index exports the tables: point at backend/schema.`,
            resolved
        );
    }

    const indexName = INDEX_FILES.find(name => fs.existsSync(path.join(resolved, name)));
    const indexFile = indexName ? path.join(resolved, indexName) : "";

    const defs: (AnyTableDef | AnyViewDef)[] = [];
    const rpc: AnyRpcDef[] = [];
    let defaultRls: DefaultRls | undefined;
    if (indexFile) {
        const mod = await importOrThrow(importModule, indexFile, "the schema index");
        for (const [name, value] of Object.entries(mod)) {
            if (isTableDef(value) || isViewDef(value)) {
                if (!defs.includes(value)) defs.push(value);
                continue;
            }
            if (isRpcDef(value)) {
                if (!rpc.includes(value)) rpc.push(value);
                continue;
            }
            if (name === "defaultRls") {
                if (value !== undefined && !isDefaultRls(value)) {
                    throw new SchemaDefinitionError([{
                        table: "defaultRls",
                        message:
                            `exported from ${indexFile} is ${JSON.stringify(value)}. It must be \`"admin-only"\` or a ` +
                            "non-empty list of rules — what every `rls: \"inherit\"` table takes. (`\"inherit\"` and `[]` " +
                            "are not postures a default can have.)"
                    }]);
                }
                if (value !== undefined) defaultRls = value;
                continue;
            }
            if (isLegacyCollection(value) || ((name === "collections" || name === "backendCollections") && Array.isArray(value))) {
                throw legacyLayoutError(`${indexFile} exports \`${name}\`, a collection`, indexFile);
            }
        }
    }

    // The index is authoritative: a definition anywhere else that it does not
    // export is refused, every one of them reported at once.
    const exported = new Set<unknown>([...defs, ...rpc]);
    const exportedNames = new Set([...defs, ...rpc].map(def => `${def.brand}:${def.name}`));
    const problems: SchemaDefinitionProblem[] = rpcNameProblems(rpc);
    for (const file of siblingModules(resolved)) {
        const mod = await importOrThrow(importModule, file, "a schema module");
        const relative = path.relative(resolved, file);
        for (const [name, value] of Object.entries(mod)) {
            if (isLegacyCollection(value)) {
                throw legacyLayoutError(`${file} exports \`${name}\`, a collection (\`defineCollection\`)`, file);
            }
            if (!isTableDef(value) && !isViewDef(value) && !isRpcDef(value)) continue;
            // The same object reached twice through two module instances is
            // still the exported definition; match those by kind and name.
            if (exported.has(value) || exportedNames.has(`${value.brand}:${value.name}`)) continue;
            const kind = isViewDef(value) ? "view" : isRpcDef(value) ? "RPC" : "table";
            problems.push({
                table: isRpcDef(value) ? `rpc ${value.name}` : value.name,
                message:
                    `is a${kind === "RPC" ? "n" : ""} ${kind} defined in ${relative} (export \`${name}\`) that ${indexFile ? path.basename(indexFile) : "no index"} ` +
                    `does not export. Only what backend/schema/index exports is served${kind === "RPC" ? "" : " and protected"}: add ` +
                    `\`export { ${name} } from "./${relative.replace(/\.[mc]?[jt]s$/, "")}";\` to the index, or delete the definition.`
            });
        }
    }
    if (problems.length > 0) throw new SchemaDefinitionError(problems);

    // Fail closed, for every caller: compiling is the validation.
    compileTables(defs, defaultRls !== undefined ? { defaultRls } : {});

    return {
        dir: resolved,
        indexFile,
        defs,
        ...(defaultRls !== undefined ? { defaultRls } : {}),
        ...(rpc.length > 0 ? { rpc } : {})
    };
}

/**
 * Two RPCs under one name would be two answers to one URL, `/api/rpc/<name>`:
 * one problem per name declared more than once.
 */
function rpcNameProblems(rpc: readonly AnyRpcDef[]): SchemaDefinitionProblem[] {
    const seen = new Set<string>();
    const problems: SchemaDefinitionProblem[] = [];
    for (const def of rpc) {
        if (!seen.has(def.name)) {
            seen.add(def.name);
            continue;
        }
        problems.push({
            table: `rpc ${def.name}`,
            message: `is declared more than once. Each RPC is one URL, /api/rpc/${def.name}: keep one \`defineRpc("${def.name}", …)\`.`
        });
    }
    return problems;
}

/**
 * A loaded schema compiled, the same way for every caller.
 *
 * @group Schema
 */
export interface CompiledSchema {
    /**
     * The compiled tables, in definition order: each descriptor with its
     * hooks, field-level hooks and definition. What the data driver runs on.
     */
    tables: CompiledTable[];
    /** The descriptors, in definition order: `tables[i].descriptor`. */
    descriptors: TableDescriptor[];
}

/**
 * Compile table and view definitions to {@link CompiledSchema.tables} and their
 * descriptors. Boot, the runtime and the CLI all compile through this.
 *
 * @group Schema
 */
export function compileSchemaDefs(
    defs: readonly (AnyTableDef | AnyViewDef)[],
    defaultRls?: DefaultRls
): CompiledSchema {
    const options = defaultRls !== undefined ? { defaultRls } : {};
    const tables = compileSchema(defs, options);
    return { tables, descriptors: tables.map(table => table.descriptor) };
}

/**
 * {@link compileSchemaDefs} over what {@link loadBackendSchema} returned.
 *
 * @group Schema
 */
export function compileLoadedSchema(loaded: LoadedSchema): CompiledSchema {
    return compileSchemaDefs(loaded.defs, loaded.defaultRls);
}
