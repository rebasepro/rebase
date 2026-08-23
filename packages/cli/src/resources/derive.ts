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
import { pathToFileURL } from "url";
import {
    buildResourceGraph,
    findEnvSuffixCollision,
    declaredSubscriptions,
    resetDeclaredResources,
    resetDeclaredSubscriptions,
    type ResourceGraph
} from "@rebasepro/types";

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
 * Import a module for its side effects.
 *
 * Plain `import()` so tsx's loader hooks resolve `.ts` and workspace
 * specifiers, exactly as the collection loader does.
 */
async function evaluate(filePath: string): Promise<void> {
    await import(pathToFileURL(filePath).href);
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
}

/**
 * Evaluate a project's config and return the graph it declares.
 *
 * Clears any previously registered declarations first, so deriving twice in one
 * process — a watch mode, a test — describes the project rather than the union
 * of every project seen so far.
 */
export async function deriveResourceGraph(options: DeriveOptions): Promise<{ graph: ResourceGraph; issues: ResourceIssue[] }> {
    const { configDir, includeCollections = true } = options;
    // Both, and the subscriptions are the easy one to forget: they live in a
    // separate list, so resetting only the resources leaves one project's
    // handlers attached while its topics are gone — every one of them then
    // reads as orphaned against the *next* project. Caught by deriving twice
    // in one process, which is what a watch mode does.
    resetDeclaredResources();
    resetDeclaredSubscriptions();

    const issues: ResourceIssue[] = [];
    const entries: string[] = [];

    for (const name of RESOURCE_ENTRY_NAMES) {
        const candidate = path.join(configDir, name);
        if (fs.existsSync(candidate)) { entries.push(candidate); break; }
    }
    if (includeCollections) entries.push(...collectionFiles(configDir));

    for (const entry of entries) {
        try {
            await evaluate(entry);
        } catch (err) {
            // Named individually: "could not derive the graph" with no file in
            // it sends somebody reading every module in the directory.
            issues.push({
                path: path.relative(configDir, entry),
                message: err instanceof Error ? err.message : String(err)
            });
        }
    }

    const graph = buildResourceGraph();

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
        ...(Object.keys(r.options).length > 0 ? { options: r.options } : {})
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
    return { version: 1, resources: (raw.resources ?? []) as ResourceGraph["resources"] };
}
