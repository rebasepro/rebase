/**
 * Deriving the resource graph from a project's config, and recording it.
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
 * So the graph is derived by evaluating the config and written to
 * `rebase.resources.json`, which is committed. Same arrangement as
 * `schema.generated.ts`: authored in one place, generated into another, and a
 * gate fails if the two disagree. The file is an *output*, never an input —
 * which is what removes the old silent merge, because there is no longer a
 * second declaration for anything to be merged with.
 *
 * ## Why evaluation rather than static analysis
 *
 * Encore parses the source and builds the graph from the AST. Rebase already
 * evaluates config to load collections, and evaluation is exact where a parser
 * is approximate — a resource declared in a loop, or behind a helper, is
 * invisible to a parser and obvious to an interpreter. The cost is running user
 * code at build time, which this project already accepts everywhere else.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { pathToFileURL } from "url";
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
    resolveResourceRefs,
    resourceId,
    resourceKeyOf,
    type CollectionConfig,
    type RebaseBackendAppConfig,
    type ResourceDeclaration,
    type ResourceGraph
} from "@rebasepro/types";
import { analyseFunctionsDirectory } from "../function-portability";
import { resolveBackendPaths } from "../manifest";

/** The committed, generated record of what a project needs. */
export const RESOURCE_GRAPH_FILENAME = "rebase.resources.json";

/** A problem found while deriving, reported with the rest rather than thrown one at a time. */
export interface ResourceIssue {
    path: string;
    message: string;
}

/** Files that declare resources, in the order they are loaded. */
const RESOURCE_ENTRY_NAMES = ["resources.ts", "resources.js", "resources/index.ts", "resources/index.js"];

/** Collection files, which may also declare a resource beside the collection using it. */
function collectionFiles(configDir: string): string[] {
    const dir = path.join(configDir, "collections");
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return [];
    return fs.readdirSync(dir)
        .filter(f => /\.(ts|js|mts|mjs)$/.test(f) && !/\.(test|spec|d)\./.test(f))
        .sort()
        .map(f => path.join(dir, f));
}

/**
 * Make the project's own TypeScript loader active in this process.
 *
 * `import()` below relies on tsx's resolver, and nothing had registered it:
 * `rebase build` runs from `node_modules/.bin/rebase`, which is plain Node.
 * On a modern Node that *looks* like it works — native type stripping imports
 * `collections/index.ts` happily — right up to the first relative specifier
 * inside it. The scaffolded template writes `import posts from "./posts.js"`,
 * which is the correct thing for TypeScript to emit and which native stripping
 * does not remap back to `posts.ts`. So `rebase build` failed on every
 * scaffolded project with `Cannot find module …/posts.js`, and the failure
 * looked like a broken template rather than a missing loader.
 *
 * Resolved from the project, not from this package, exactly as `resolveTsx`
 * does for the schema-generation subprocess: tsx is the project's dependency
 * (the scaffold declares it), and taking it from anywhere else would mean
 * evaluating a project's config with a loader it did not choose.
 *
 * Best-effort by design. A project with no tsx keeps the previous behaviour —
 * which is correct for one whose config is plain JavaScript, or whose imports
 * carry no extension — rather than failing on a dependency it never needed.
 * Registered once per process; `register` is cheap but not free, and deriving
 * twice in one process is an ordinary thing for a watch mode to do.
 */
let tsxRegistered = false;

async function registerProjectTsx(configDir: string): Promise<void> {
    if (tsxRegistered) return;
    tsxRegistered = true;

    // Where tsx might be, in the order most likely to find it. The scaffold
    // declares tsx in the *backend* workspace, and pnpm's isolated layout puts
    // it in `backend/node_modules` rather than hoisting it — so resolving only
    // from the config directory finds nothing on exactly the project shape this
    // exists to serve.
    const projectRoot = path.dirname(configDir);
    const bases = [configDir, projectRoot, path.join(projectRoot, "backend")];

    for (const base of bases) {
        try {
            // Resolved against a file *inside* the project so Node walks that
            // project's `node_modules`, not this package's.
            const requireFromProject = createRequire(path.join(base, "noop.js"));
            const api = await import(pathToFileURL(requireFromProject.resolve("tsx/esm/api")).href) as
                { register?: () => unknown; default?: { register?: () => unknown } };

            // tsx's own `register`, not `module.register`. `tsx/esm/api` is the
            // API module; the loader is `tsx/esm`. Handing the API module to
            // `module.register` registers something with no hooks and reports
            // success — a worse failure than throwing, because the import below
            // then resolves exactly as it did before and the bug looks unfixed.
            const register = api.register ?? api.default?.register;
            if (typeof register === "function") {
                register();
                return;
            }
        } catch {
            // Not here. Try the next base.
        }
    }

    // No tsx anywhere in the project. The import below still runs; it simply
    // resolves the way Node alone would, which is correct for a config written
    // in plain JavaScript or whose imports carry no extension.
}

/**
 * Import a module for its side effects.
 *
 * Plain `import()` so tsx's loader hooks resolve `.ts` and workspace
 * specifiers, exactly as the collection loader does.
 */
async function evaluate(filePath: string): Promise<Record<string, unknown>> {
    return await import(pathToFileURL(filePath).href) as Record<string, unknown>;
}

export interface DeriveOptions {
    /** Absolute path to the project's config directory. */
    configDir: string;
    /**
     * Whether to evaluate collection files too. Resources are conventionally
     * declared in `resources.ts`, but nothing stops a bucket being declared
     * beside the collection that stores into it, and a graph that missed it
     * would under-report what the project needs.
     */
    includeCollections?: boolean;
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
    /** The project root, for the paths a graph records. Defaults to the config directory's parent. */
    projectRoot?: string;
}

/** The derive options for a backend app, from its manifest entry. */
export function deriveOptionsFor(projectRoot: string, app: RebaseBackendAppConfig): DeriveOptions {
    const paths = resolveBackendPaths(app, projectRoot);
    return {
        projectRoot,
        configDir: path.join(projectRoot, paths.config),
        cronsDir: path.join(projectRoot, paths.crons),
        functionsDir: path.join(projectRoot, paths.functions)
    };
}

/** Whether a module's default export looks like a collection. */
function isCollectionLike(value: unknown): value is CollectionConfig {
    return typeof value === "object" && value !== null
        && typeof (value as { slug?: unknown }).slug === "string"
        && typeof (value as { properties?: unknown }).properties === "object";
}

/**
 * The resources a collection reaches: its database, and every bucket a
 * storage property stores into. Only resources the graph declares get an
 * edge — the implicit default database is not in the graph, so a collection
 * that names no `dataSource` records nothing.
 */
function collectionEdges(collection: CollectionConfig, declared: Set<string>): Array<[string, string]> {
    const edges: Array<[string, string]> = [];
    const from = `collection:${collection.slug}`;
    const databaseId = resourceId("database", collection.dataSource ?? DEFAULT_RESOURCE_KEY);
    if (declared.has(databaseId)) edges.push([databaseId, from]);

    const walk = (properties: Record<string, unknown> | undefined, prefix: string): void => {
        for (const [name, raw] of Object.entries(properties ?? {})) {
            const property = raw as {
                storage?: { storageSource?: unknown };
                of?: unknown;
                properties?: Record<string, unknown>;
            };
            if (!property || typeof property !== "object") continue;
            if (property.storage) {
                const key = property.storage.storageSource === undefined
                    ? DEFAULT_RESOURCE_KEY
                    : resourceKeyOf(property.storage.storageSource as string);
                const bucketId = resourceId("bucket", key);
                if (declared.has(bucketId)) edges.push([bucketId, `property:${collection.slug}.${prefix}${name}`]);
            }
            if (property.properties) walk(property.properties, `${prefix}${name}.`);
            if (property.of && typeof property.of === "object") walk({ [name]: property.of }, `${prefix}`);
        }
    };
    walk(collection.properties as Record<string, unknown>, "");
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
    return `${problem}\n` +
        "    `rebase resources` evaluates each cron file to read its schedule, and it is a build " +
        "step: no .env, no secrets. Move work that needs the deployment's environment inside the " +
        "handler — `const { x } = await import(\"…\")` — so the module scope imports nothing that " +
        "reads configuration.";
}

/**
 * Evaluate a project's config and return the graph it declares.
 *
 * Clears any previously registered declarations first, so deriving twice in one
 * process — a watch mode, a test — describes the project rather than the union
 * of every project seen so far.
 */
export async function deriveResourceGraph(options: DeriveOptions): Promise<{ graph: ResourceGraph; issues: ResourceIssue[] }> {
    const { configDir, includeCollections = true, cronsDir, functionsDir } = options;
    const projectRoot = options.projectRoot ?? path.dirname(configDir);
    // Before anything is evaluated: the loader has to be in place for the very
    // first import, and the first import is a collection file.
    await registerProjectTsx(configDir);

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
    for (const name of RESOURCE_ENTRY_NAMES) {
        const candidate = path.join(configDir, name);
        if (!fs.existsSync(candidate)) continue;
        try {
            const mod = await evaluate(candidate);
            for (const [exportName, value] of Object.entries(mod)) {
                if (isResourceHandle(value)) handleExports.set(exportName, resourceId(value.kind, value.key));
            }
        } catch (err) {
            issues.push({ path: path.relative(configDir, candidate), message: err instanceof Error ? err.message : String(err) });
        }
        break;
    }

    // ── Collections ──────────────────────────────────────────────────────
    const collections: CollectionConfig[] = [];
    if (includeCollections) {
        for (const entry of collectionFiles(configDir)) {
            try {
                const mod = await evaluate(entry);
                // As the loader sees it at boot: a handle written where a key
                // belongs is its key here too.
                if (isCollectionLike(mod.default)) collections.push(resolveResourceRefs(mod.default));
            } catch (err) {
                // Named individually: "could not derive the graph" with no file in
                // it sends somebody reading every module in the directory.
                issues.push({
                    path: path.relative(configDir, entry),
                    message: err instanceof Error ? err.message : String(err)
                });
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
            const { loadCronJobsWithDiagnostics } = await import("@rebasepro/server");
            // This process's own `import()`, not the loader's `new Function`
            // one: tsx's hooks are registered here, and a test runner's module
            // sandbox answers the other with "a dynamic import callback was
            // not specified" — the same trap the split-roles e2e records.
            const { problems } = await loadCronJobsWithDiagnostics(cronsDir, url => import(url));
            for (const problem of problems) {
                issues.push({ path: path.relative(projectRoot, cronsDir), message: cronLoadIssue(problem) });
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
                issues.push({ path: report.file, message: err instanceof Error ? err.message : String(err) });
            }
            for (const imported of report.resourceImports) {
                const resource = handleExports.get(imported);
                if (resource) recordUse(resource, `function:${report.name}`);
            }
        }
    }

    // ── Edges ────────────────────────────────────────────────────────────
    const declared = new Set(declaredResources().map(r => resourceId(r.kind, r.key)));
    for (const collection of collections) {
        for (const [resource, by] of collectionEdges(collection, declared)) recordUse(resource, by);
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

    // A collection routed to a database nothing declares boots into a
    // refusal, and a property stored in a bucket nothing declares answers 501
    // on its first upload. Both are cheaper to hear about here.
    const databases = new Set(graph.resources.filter(r => r.kind === "database").map(r => r.key));
    const buckets = new Set(graph.resources.filter(r => r.kind === "bucket").map(r => r.key));
    for (const collection of collections) {
        if (collection.dataSource && collection.dataSource !== DEFAULT_RESOURCE_KEY && !databases.has(collection.dataSource)) {
            issues.push({
                path: `collection.${collection.slug}`,
                message:
                    `routes to dataSource "${collection.dataSource}", which nothing declares. ` +
                    `Add database("${collection.dataSource}") to resources.ts, or import the handle and use it here.`
            });
        }
        for (const [name, raw] of Object.entries(collection.properties ?? {})) {
            const key = (raw as { storage?: { storageSource?: unknown } })?.storage?.storageSource;
            if (typeof key === "string" && key !== DEFAULT_RESOURCE_KEY && buckets.size > 0 && !buckets.has(key)) {
                issues.push({
                    path: `collection.${collection.slug}.${name}`,
                    message: `stores into bucket "${key}", which nothing declares. Add bucket("${key}") to resources.ts.`
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
        $generated: `Generated from config by \`rebase resources\`. Edit the declarations, not this file.`,
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
 * graph disagrees with its config has a host reading one thing and a runtime
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
 */
export function withImplicitDefaults(graph: ResourceGraph): {
    declaration: ResourceDeclaration;
    implicit: boolean;
}[] {
    const entries = graph.resources.map(declaration => ({ declaration, implicit: false }));
    const has = (kind: string) => graph.resources.some(r => r.kind === kind);

    if (!has("database")) {
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
    if (!has("bucket")) {
        entries.push({
            declaration: {
                kind: "bucket",
                key: DEFAULT_RESOURCE_KEY,
                // `local` is what an unconfigured default source resolves to,
                // and naming it here keeps the row honest about what a project
                // with no S3 variables actually gets: a directory that a
                // container erases on restart, which production then drops.
                engine: "local",
                transport: "server",
                options: {}
            },
            implicit: true
        });
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
