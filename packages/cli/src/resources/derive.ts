/**
 * Deriving the resource graph from a project's backend, and recording it.
 *
 * ## Why the graph is derived rather than authored
 *
 * A resource is declared once, in code. But a host has to know what a project
 * needs *before* it runs anything — that is how a console can say "this project
 * wants a `media` bucket and has none" on a first deploy, and it is the reason
 * storage topology used to be hand-written into `rebase.json` in the first
 * place. A `custom` runtime makes it sharper still: it emits no bundle
 * manifest, so without a committed artifact there is nothing to read at all.
 *
 * So the graph is derived by evaluating `backend/resources.ts` and the tables
 * in `backend/schema`, and written to
 * `rebase.resources.json`, which is committed. Same arrangement as
 * `schema.generated.ts`: authored in one place, generated into another, and a
 * gate fails if the two disagree. The file is an *output*, never an input —
 * which is what removes the old silent merge, because there is no longer a
 * second declaration for anything to be merged with.
 *
 * ## Why evaluation rather than static analysis
 *
 * Encore parses the source and builds the graph from the AST. Rebase already
 * evaluates `backend/schema` to load the tables, and evaluation is exact where a parser
 * is approximate — a resource declared in a loop, or behind a helper, is
 * invisible to a parser and obvious to an interpreter. The cost is running user
 * code at build time, which this project already accepts everywhere else.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import {
    DEFAULT_RESOURCE_KEY,
    buildResourceGraph,
    declareFunction,
    declaredQueueConsumers,
    declaredResources,
    declaredSubscriptions,
    findEnvSuffixCollision,
    isResourceHandle,
    resetDeclaredQueueConsumers,
    resetDeclaredResources,
    resetDeclaredSubscriptions,
    resourceId,
    type ColumnStorage,
    type JsonShape,
    type RebaseBackendAppConfig,
    type ResourceDeclaration,
    type ResourceGraph,
    type TableDescriptor
} from "@rebasepro/types";
import { analyseFunctionsDirectory } from "../function-portability";
import { resolveBackendPaths } from "../manifest";
import { createSchemaModuleImporter } from "../utils/import-schema-module";
import type { ModuleAliases } from "../utils/project-schema";
import type { SchemaModuleImporter } from "@rebasepro/server";
import { cliVersion } from "../utils/version";

/** The committed, generated record of what a project needs. */
export const RESOURCE_GRAPH_FILENAME = "rebase.resources.json";

/** A problem found while deriving, reported with the rest rather than thrown one at a time. */
export interface ResourceIssue {
    path: string;
    message: string;
}

/**
 * Which `@rebasepro/*` package a module error is about, when it is about one.
 *
 * Both directions of a version skew arrive as an error about the *user's* file:
 * `resources.ts  The requested module '@rebasepro/types' does not provide an
 * export named 'queue'`. Nothing in that says which copy of `@rebasepro/types`
 * is installed, what version this CLI is, or that the two disagree — so the
 * reader goes looking for a typo in code they just copied out of the docs.
 *
 * Two shapes, because the two directions produce different errors: a named
 * export the installed copy is too old for, and a package the installed tree
 * does not have at all.
 */
const NAMED_EXPORT_MISSING = /does not provide an export named ['"]([^'"]+)['"]/;
const SPECIFIER = /(@rebasepro\/[a-z0-9-]+)/;

/** The version of a package as resolved from the project, or null. */
function installedVersion(specifier: string, from: string): string | null {
    try {
        const require = createRequire(path.join(from, "noop.js"));
        const manifest = require.resolve(`${specifier}/package.json`);
        const version: unknown = JSON.parse(fs.readFileSync(manifest, "utf-8")).version;
        return typeof version === "string" ? version : null;
    } catch {
        return null;
    }
}

/**
 * The message an issue carries, with the skew named when there is one.
 *
 * `main` runs 497 commits ahead of npm `latest` and the docs site publishes from
 * `main`, so the shape this exists for is routine: a scaffold pinned to the
 * published version, backend code written against today's documentation, and an
 * error about the project's file. The fix is one command and the error named none
 * of it — the same failure as `404 No PUT route on collection 'projects'`, one
 * layer down.
 *
 * Says nothing extra when the two versions agree, or when either is unreadable:
 * a sentence naming one version twice is worse than no sentence.
 */
export function describeIssue(err: unknown, projectRoot: string, ownVersion = cliVersion()): string {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as { code?: unknown } | null)?.code;
    const missingExport = NAMED_EXPORT_MISSING.exec(message);
    const isSkewShaped = missingExport !== null || code === "ERR_MODULE_NOT_FOUND";
    if (!isSkewShaped) return message;

    const specifier = SPECIFIER.exec(message)?.[1];
    if (!specifier) return message;

    // One line, not two: every caller renders an issue as `path  message` on a
    // single row, so a newline here would land the useful half unindented under
    // the file name.
    const lead = /[.!?]$/.test(message.trim()) ? message.trim() : `${message.trim()}.`;

    const installed = installedVersion(specifier, projectRoot);
    if (installed === null) {
        return `${lead} ${specifier} is not installed in this project; this CLI is ${ownVersion}. `
            + `Run pnpm add ${specifier}@${ownVersion}`;
    }
    if (ownVersion === "unknown" || installed === ownVersion) return message;

    // Which side to move is the question the reader actually has, and it has a
    // right answer: the CLI is what evaluates this file, so the packages follow
    // it — unless the CLI is the older one, in which case following it would
    // move the project backwards.
    const cliIsNewer = compareVersions(ownVersion, installed) > 0;
    return cliIsNewer
        ? `${lead} ${specifier} ${installed} is installed; this CLI is ${ownVersion}. `
            + `Run pnpm add ${specifier}@${ownVersion}`
        : `${lead} ${specifier} ${installed} is installed; this CLI is ${ownVersion}, which is older. `
            + `Update the CLI to ${installed}, or pin ${specifier} back to ${ownVersion}`;
}

/** -1 / 0 / 1 on the numeric parts, ignoring any prerelease tail. */
function compareVersions(a: string, b: string): number {
    const parts = (v: string): number[] => v.split("-")[0].split(".").map(n => Number(n) || 0);
    const [x, y] = [parts(a), parts(b)];
    for (let i = 0; i < 3; i++) {
        if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) < (y[i] ?? 0) ? -1 : 1;
    }
    return 0;
}

/** The spellings of the resources module, tried in order, after its path without extension. */
const RESOURCE_MODULE_SUFFIXES = [".ts", ".mts", ".js", ".mjs", "/index.ts", "/index.js"];

/** The resources module under `base` (a path without extension), or undefined. */
function findResourcesModule(base: string): string | undefined {
    return RESOURCE_MODULE_SUFFIXES.map(suffix => `${base}${suffix}`)
        .find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
}

export interface DeriveOptions {
    /** The project root, absolute: what the importer is rooted at and every recorded path is relative to. */
    projectRoot: string;
    /**
     * The resources module, absolute, without or with its extension:
     * `<root>/backend/resources`. Its `database()` / `bucket()` / `topic()` /
     * `queue()` declarations are the graph's nodes.
     */
    resources?: string;
    /**
     * The schema directory, absolute. Its tables are evaluated too: a table
     * reaches its database and every bucket a storage column stores into, and a
     * bucket may be declared beside the table that stores into it.
     */
    schemaDir?: string;
    /**
     * Absolute path to the crons directory. Each file is evaluated through the
     * same loader the runtime uses, which declares the cron under the same id
     * the scheduler runs it as. Absent, or missing on disk: no crons.
     */
    cronsDir?: string;
    /**
     * Absolute path to the functions directory. Read statically — the
     * bundler's portability analysis — never evaluated: a function's module
     * scope belongs to a running backend, not a build.
     */
    functionsDir?: string;
    /** Module specifiers mapped to files when importing (in-repo runs and tests). */
    moduleAliases?: ModuleAliases;
}

/** The derive options for a backend app, from its manifest entry. */
export function deriveOptionsFor(projectRoot: string, app: RebaseBackendAppConfig): DeriveOptions {
    const paths = resolveBackendPaths(app, projectRoot);
    return {
        projectRoot,
        resources: path.join(projectRoot, paths.resources).replace(/\.[mc]?[jt]s$/, ""),
        schemaDir: path.join(projectRoot, paths.tables),
        cronsDir: path.join(projectRoot, paths.crons),
        functionsDir: path.join(projectRoot, paths.functions)
    };
}

/** Every storage setting in a JSON shape, with its dotted path below the column. */
function jsonStorage(shape: JsonShape, prefix: string): Array<[string, ColumnStorage]> {
    switch (shape.kind) {
        case "string":
            return shape.storage ? [[prefix, shape.storage]] : [];
        case "object":
            return Object.entries(shape.fields).flatMap(([name, field]) => jsonStorage(field, `${prefix}.${name}`));
        case "array":
            return jsonStorage(shape.of, prefix);
        case "oneOf":
            return Object.entries(shape.variants).flatMap(([name, variant]) => jsonStorage(variant, `${prefix}.${name}`));
        default:
            return [];
    }
}

/**
 * Every storage setting a table's columns carry, keyed by the dotted path to
 * it: a storage column, the items of a storage array, a file inside a JSON
 * document.
 */
function tableStorage(table: TableDescriptor): Array<[string, ColumnStorage]> {
    return table.columns.flatMap((column): Array<[string, ColumnStorage]> => [
        ...(column.storage ? [[column.key, column.storage] satisfies [string, ColumnStorage]] : []),
        ...(column.element?.storage ? [[column.key, column.element.storage] satisfies [string, ColumnStorage]] : []),
        ...(column.json ? jsonStorage(column.json, column.key) : [])
    ]);
}

/**
 * The resources a table reaches: its database, and every bucket a storage
 * column stores into. Only resources the graph declares get an edge — the
 * implicit default database is not in the graph, so a table that names no
 * `database` records nothing.
 *
 * The ids are `table:<slug>` and `column:<slug>.<path>`; a host's topology
 * view parses them.
 */
function tableEdges(table: TableDescriptor, declared: Set<string>): Array<[string, string]> {
    const edges: Array<[string, string]> = [];
    const databaseId = resourceId("database", table.database ?? DEFAULT_RESOURCE_KEY);
    if (declared.has(databaseId)) edges.push([databaseId, `table:${table.slug}`]);
    for (const [where, storage] of tableStorage(table)) {
        const bucketId = resourceId("bucket", storage.source ?? DEFAULT_RESOURCE_KEY);
        if (declared.has(bucketId)) edges.push([bucketId, `column:${table.slug}.${where}`]);
    }
    return edges;
}

/**
 * A cron file that would not import, said in terms somebody can act on.
 *
 * The graph is derived by evaluating each cron module, in a process with none
 * of the deployment's environment — so a cron that reaches a module validating
 * `DATABASE_URL` at import fails here and works perfectly at boot. The raw
 * message is a Zod error about a variable, which reads as "the environment is
 * wrong" when the environment is not the point.
 */
function cronLoadIssue(problem: string): string {
    return `${summariseCronProblem(problem)}\n` +
        "    `rebase resources` evaluates each cron file to read its schedule, and it is a build " +
        "step: no .env, no secrets. Move work that needs the deployment's environment inside the " +
        "handler — `const { x } = await import(\"…\")` — so the module scope imports nothing that " +
        "reads configuration.";
}

/**
 * The cron loader's `<file> (threw: <message>)`, as one line.
 *
 * The message is whatever the module threw, and the common case is a schema
 * validator: `loadEnv()` at module scope with no `.env` present throws a
 * `ZodError`, whose `.message` is the JSON array of its issues. That arrived
 * here verbatim — ten lines of `{ "expected": "string", "code":
 * "invalid_type", … }` — with the sentence that says what to do underneath it,
 * so the reader met "Invalid input: expected string, received undefined" twice
 * before reaching the explanation.
 *
 * A validator's own sentences are the useful half of that object, so they are
 * kept and the serialisation is dropped.
 */
function summariseCronProblem(problem: string): string {
    const match = problem.match(/^(.*) \(threw: ([\s\S]*)\)$/);
    if (!match) return problem.split("\n")[0];
    const [, file, thrown] = match;
    return `${file}: ${summariseThrownMessage(thrown)}`;
}

/** One sentence out of a thrown message, whatever shape it arrived in. */
function summariseThrownMessage(message: string): string {
    const trimmed = message.trim();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            const issues = Array.isArray(parsed) ? parsed : [parsed];
            const sentences = [...new Set(
                issues
                    .map(issue => (issue as { message?: unknown } | null)?.message)
                    .filter((m): m is string => typeof m === "string" && m.length > 0)
            )];
            if (sentences.length > 0) return sentences.join("; ");
        } catch {
            // Not JSON after all — fall through to the first line.
        }
    }
    return trimmed.split("\n")[0];
}

/**
 * Evaluate a project's resources and tables and return the graph they declare.
 *
 * Clears any previously registered declarations first, so deriving twice in one
 * process — a watch mode, a test — describes the project rather than the union
 * of every project seen so far.
 */
export async function deriveResourceGraph(options: DeriveOptions): Promise<{ graph: ResourceGraph; issues: ResourceIssue[] }> {
    const { projectRoot, cronsDir, functionsDir } = options;
    // One importer for everything evaluated here: the resources module, the
    // tables that import its handles and the crons see one copy of each module,
    // so a handle a table imports is the handle the graph declared. A new
    // importer reads every file as it is now, so deriving again in one process
    // evaluates the declarations again. Created on first use: a project with
    // nothing to evaluate pays nothing for it.
    let importer: SchemaModuleImporter | undefined;
    const importModule: SchemaModuleImporter = async (file) => {
        importer ??= await createSchemaModuleImporter(projectRoot, options.moduleAliases);
        return importer(file);
    };

    // All three registries, and the side lists are the easy ones to forget:
    // resetting only the resources leaves one project's handlers attached
    // while its topics are gone — every one of them then reads as orphaned
    // against the *next* project. Caught by deriving twice in one process,
    // which is what a watch mode does.
    resetDeclaredResources();
    resetDeclaredSubscriptions();
    resetDeclaredQueueConsumers();

    const issues: ResourceIssue[] = [];
    const usedBy = new Map<string, string[]>();
    // `recordUse`, not `use`: React 19 made `use` a hook name, and
    // `react-hooks/rules-of-hooks` refuses a call to one from a plain function
    // — a lint error on a file with no React in it.
    const recordUse = (resource: string, by: string): void => {
        const list = usedBy.get(resource) ?? [];
        if (!list.includes(by)) list.push(by);
        usedBy.set(resource, list);
    };

    // ── Declarations ─────────────────────────────────────────────────────
    // Which export name is which resource, so a function's `import { media }`
    // can be recorded as reaching `bucket:media` without evaluating the
    // function. The export name and the key are usually the same word and
    // nothing requires them to be.
    const handleExports = new Map<string, string>();
    const resourcesModule = options.resources ? findResourcesModule(options.resources.replace(/\.[mc]?[jt]s$/, "")) : undefined;
    if (resourcesModule) {
        try {
            const mod = await importModule(resourcesModule);
            for (const [exportName, value] of Object.entries(mod)) {
                if (isResourceHandle(value)) handleExports.set(exportName, resourceId(value.kind, value.key));
            }
        } catch (err) {
            issues.push({ path: path.relative(projectRoot, resourcesModule), message: describeIssue(err, projectRoot) });
        }
    }

    // ── Tables ───────────────────────────────────────────────────────────
    // Through the loader the runtime boots from, so a table that would not
    // load at boot is an issue here too, named by its file and table.
    let tables: TableDescriptor[] = [];
    if (options.schemaDir) {
        try {
            const { loadBackendSchema, compileLoadedSchema } = await import("@rebasepro/server");
            const loaded = await loadBackendSchema(options.schemaDir, { projectRoot, importModule });
            tables = compileLoadedSchema(loaded).descriptors;
        } catch (err) {
            // Imported here: `@rebasepro/common` is the whole compiler, and a
            // derivation that never reads a schema has no use for it.
            const { isSchemaDefinitionError } = await import("@rebasepro/common");
            if (isSchemaDefinitionError(err)) {
                for (const problem of err.problems) {
                    issues.push({
                        path: `table.${problem.key ? `${problem.table}.${problem.key}` : problem.table}`,
                        message: problem.message
                    });
                }
            } else {
                const file = typeof err === "object" && err !== null && "file" in err && typeof err.file === "string"
                    ? err.file
                    : options.schemaDir;
                issues.push({ path: path.relative(projectRoot, file), message: describeIssue(err, projectRoot) });
            }
        }
    }

    // ── Crons ────────────────────────────────────────────────────────────
    // Through the runtime's own loader, so the id the graph records is the id
    // the scheduler runs — the filename — and a cron that would not load at
    // boot does not load here either.
    //
    // Which means the module is EVALUATED, in a build step that has none of the
    // deployment's environment. A cron whose module scope reaches something that
    // validates `DATABASE_URL` at import therefore derives on a laptop with a
    // `.env` and nowhere else. That is worth an explicit sentence rather than a
    // stack, so `cronLoadIssue` adds one.
    if (cronsDir && fs.existsSync(cronsDir)) {
        // The runtime's loader logs each job as it loads, to stdout, as JSON
        // — which is also where `rebase resources --json` writes the graph.
        // Its problems come back as a list, so the log adds nothing here.
        const previousLevel = process.env.LOG_LEVEL;
        process.env.LOG_LEVEL = "error";
        try {
            const { loadCrons, declareCrons } = await import("@rebasepro/server");
            const reportProblem = (problem: string) => {
                issues.push({ path: path.relative(projectRoot, cronsDir), message: cronLoadIssue(problem) });
            };
            // The importer above, not the loader's `new Function` import: plain
            // Node cannot import TypeScript, and a test runner's module sandbox
            // answers that one with "a dynamic import callback was not
            // specified" — the same trap the split-roles e2e records.
            const crons = await loadCrons(cronsDir, {
                importModule: url => importModule(url.startsWith("file:") ? fileURLToPath(url) : url),
                onSkip: reportProblem
            });
            // One at a time, so a cron the graph refuses is reported by name
            // and the others are still declared.
            for (const [id, definition] of Object.entries(crons)) {
                try {
                    declareCrons({ [id]: definition });
                } catch (err) {
                    reportProblem(`${id} (threw: ${err instanceof Error ? err.message : String(err)})`);
                }
            }
        } catch (err) {
            issues.push({
                path: path.relative(projectRoot, cronsDir),
                message: cronLoadIssue(err instanceof Error ? err.message : String(err))
            });
        } finally {
            if (previousLevel === undefined) delete process.env.LOG_LEVEL;
            else process.env.LOG_LEVEL = previousLevel;
        }
    }

    // ── Functions ────────────────────────────────────────────────────────
    if (functionsDir && fs.existsSync(functionsDir)) {
        for (const report of analyseFunctionsDirectory(functionsDir, projectRoot)) {
            const requires = [...new Set(
                report.issues
                    .filter(issue => issue.kind === "node-builtin" || issue.kind === "node-only-package")
                    .map(issue => issue.message)
            )];
            try {
                declareFunction(report.name, {
                    file: report.file,
                    portable: report.portable,
                    ...(requires.length > 0 ? { requires } : {})
                });
            } catch (err) {
                issues.push({ path: report.file, message: describeIssue(err, projectRoot) });
            }
            for (const imported of report.resourceImports) {
                const resource = handleExports.get(imported);
                if (resource) recordUse(resource, `function:${report.name}`);
            }
        }
    }

    // ── Edges ────────────────────────────────────────────────────────────
    const declared = new Set(declaredResources().map(r => resourceId(r.kind, r.key)));
    for (const table of tables) {
        for (const [resource, by] of tableEdges(table, declared)) recordUse(resource, by);
    }
    for (const sub of declaredSubscriptions()) {
        const id = resourceId("topic", sub.topic);
        if (declared.has(id)) recordUse(id, `subscription:${sub.topic}.${sub.name}`);
    }
    for (const consumer of declaredQueueConsumers()) {
        const id = resourceId("queue", consumer.queue);
        if (declared.has(id)) recordUse(id, `handler:${consumer.queue}`);
    }

    const graph = buildResourceGraph(usedBy);

    // Two resources of a kind whose env suffixes collide would silently read
    // each other's configuration, which is indistinguishable from a
    // misconfigured deployment.
    const byKind = new Map<string, string[]>();
    for (const r of graph.resources) {
        byKind.set(r.kind, [...(byKind.get(r.kind) ?? []), r.key]);
    }
    for (const [kind, keys] of byKind) {
        const collision = findEnvSuffixCollision(keys);
        if (collision) {
            issues.push({
                path: `${kind}.${collision.b}`,
                message:
                    `"${collision.a}" and "${collision.b}" both bind from ${collision.suffix}, so one would ` +
                    "read the other's configuration. Rename one."
            });
        }
    }

    // A subscription on a topic nobody declared is a handler that will never
    // run, and nothing else would ever say so.
    const topics = new Set(graph.resources.filter(r => r.kind === "topic").map(r => r.key));
    for (const sub of declaredSubscriptions()) {
        if (!topics.has(sub.topic)) {
            issues.push({
                path: `topic.${sub.topic}`,
                message:
                    `Subscription "${sub.name}" is declared on topic "${sub.topic}", which nothing declares. ` +
                    "The handler would never run."
            });
        }
    }

    // A table routed to a database nothing declares boots into a refusal, and
    // a column stored in a bucket nothing declares answers 501 on its first
    // upload. Both are cheaper to hear about here.
    const databases = new Set(graph.resources.filter(r => r.kind === "database").map(r => r.key));
    const buckets = new Set(graph.resources.filter(r => r.kind === "bucket").map(r => r.key));
    for (const table of tables) {
        if (table.database && table.database !== DEFAULT_RESOURCE_KEY && !databases.has(table.database)) {
            issues.push({
                path: `table.${table.slug}`,
                message:
                    `lives in database "${table.database}", which nothing declares. ` +
                    `Add database("${table.database}") to backend/resources.ts, or import the handle and use it here.`
            });
        }
        for (const [where, storage] of tableStorage(table)) {
            const key = storage.source;
            if (key !== undefined && key !== DEFAULT_RESOURCE_KEY && buckets.size > 0 && !buckets.has(key)) {
                issues.push({
                    path: `table.${table.slug}.${where}`,
                    message: `stores into bucket "${key}", which nothing declares. Add bucket("${key}") to backend/resources.ts.`
                });
            }
        }
    }

    return { graph, issues };
}

/** The graph as it is written to disk: stable key order, trailing newline. */
export function serializeResourceGraph(graph: ResourceGraph): string {
    const resources = graph.resources.map(r => ({
        kind: r.kind,
        key: r.key,
        engine: r.engine,
        transport: r.transport,
        ...(r.label !== undefined ? { label: r.label } : {}),
        ...(Object.keys(r.options).length > 0 ? { options: r.options } : {}),
        ...(r.usedBy && r.usedBy.length > 0 ? { usedBy: r.usedBy } : {})
    }));
    return JSON.stringify({
        $generated: `Generated from backend/resources.ts and backend/schema by \`rebase resources\`. Edit the declarations, not this file.`,
        version: graph.version,
        resources
    }, null, 4) + "\n";
}

/** Read the committed graph, or null when a project has none yet. */
export function readResourceGraphFile(projectRoot: string): string | null {
    const file = path.join(projectRoot, RESOURCE_GRAPH_FILENAME);
    return fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
}

/**
 * Write the graph, and say whether the file changed.
 *
 * The boolean is what a `--check` mode reports on: a project whose committed
 * graph disagrees with its declarations has a host reading one thing and a runtime
 * doing another.
 */
export function writeResourceGraphFile(projectRoot: string, graph: ResourceGraph): { changed: boolean; file: string } {
    const file = path.join(projectRoot, RESOURCE_GRAPH_FILENAME);
    const next = serializeResourceGraph(graph);
    const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf-8") : null;
    if (previous === next) return { changed: false, file };
    fs.writeFileSync(file, next);
    return { changed: true, file };
}

/** Parse a committed graph file, tolerating the `$generated` banner. */
export function parseResourceGraph(contents: string): ResourceGraph {
    const raw = JSON.parse(contents) as { version?: number; resources?: unknown };
    if (raw.version !== 1) {
        throw new Error(
            `Unsupported resource graph version ${String(raw.version)}. ` +
            "This project was generated by a newer Rebase; upgrade rather than provisioning half of it."
        );
    }
    const entries = Array.isArray(raw.resources) ? raw.resources as Record<string, unknown>[] : [];
    // `options` is omitted from the file when empty; a reader of the graph
    // expects it present, so it is restored here.
    return { version: 1, resources: entries.map(r => ({ options: {}, ...r })) as ResourceGraph["resources"] };
}

/**
 * Add the resources a project has without declaring them.
 *
 * A backend has a database whether or not anyone said so, and a project that
 * declares no buckets still gets one default storage source from the plain
 * unsuffixed variables. Both are load-bearing defaults and both are invisible
 * in the graph, so a status view built only from declarations would show an
 * empty screen to the majority of projects — the ones that most need to be told
 * which variable their one database reads.
 *
 * Declaring a *named* one leaves the default where it is, as the server does
 * (`resolveDataSources` and `resolveStorageSources` in `@rebasepro/server`):
 * `bucket("media")` adds a source and never moves the files the default holds,
 * so both are listed. The default is displaced only by declaring it — or, for a
 * bucket, by marking exactly one server-side bucket `default: true`, which then
 * serves the uploads that name no `storageSource`. This used to drop the
 * default once a bucket was declared, and `rebase status` and `rebase
 * resources` stopped listing a source the server was still serving.
 */
export function withImplicitDefaults(graph: ResourceGraph): {
    declaration: ResourceDeclaration;
    implicit: boolean;
}[] {
    const entries = graph.resources.map(declaration => ({ declaration, implicit: false }));
    const declaresDefault = (kind: string) => graph.resources.some(r => r.kind === kind && r.key === DEFAULT_RESOURCE_KEY);
    const markedDefault = graph.resources.filter(r =>
        r.kind === "bucket" && (r.transport ?? "server") === "server" && r.options.default === true);

    if (!declaresDefault("database")) {
        entries.unshift({
            declaration: {
                kind: "database",
                key: DEFAULT_RESOURCE_KEY,
                engine: "postgres",
                transport: "server",
                options: {}
            },
            implicit: true
        });
    }
    if (!declaresDefault("bucket") && markedDefault.length !== 1) {
        const implicitBucket = {
            declaration: {
                kind: "bucket",
                key: DEFAULT_RESOURCE_KEY,
                // `local` is what an unconfigured default source resolves to,
                // and naming it here keeps the row honest about what a project
                // with no S3 variables actually gets: a directory that a
                // container erases on restart, which production then drops.
                engine: "local",
                transport: "server" as const,
                options: {}
            },
            implicit: true
        };
        // First among the buckets, as the database default is first among the
        // databases; last when there are none.
        const firstBucket = entries.findIndex(entry => entry.declaration.kind === "bucket");
        if (firstBucket === -1) entries.push(implicitBucket);
        else entries.splice(firstBucket, 0, implicitBucket);
    }
    return entries;
}

/**
 * The resources a project *has*, which is what a person is asking about.
 *
 * One projection, because two of them disagreed. `rebase status` built its
 * rows from {@link withImplicitDefaults} and listed `buckets ✓ (default) local
 * · implicit`; `rebase resources` and `rebase resources --json` built theirs
 * from the raw graph and listed only the database and the function. Two
 * commands whose whole job is to answer "what does this project need", on the
 * same stock scaffold, giving different answers.
 *
 * The implicit entries are marked rather than hidden, because the distinction
 * is real and load-bearing: a declared resource is recorded in
 * `rebase.resources.json` for a host to provision, and an implicit one is a
 * default the runtime supplies whether or not anyone wrote it down. That file
 * still holds declarations only — it is a wire contract a host reads, and
 * putting defaults in it would ask for something to be provisioned that
 * nobody declared.
 */
export type ProjectedResource = ResourceDeclaration & { implicit?: true };

export function projectResourceGraph(graph: ResourceGraph): ProjectedResource[] {
    return withImplicitDefaults(graph).map(({ declaration, implicit }) =>
        (implicit ? { ...declaration, implicit: true as const } : declaration));
}
