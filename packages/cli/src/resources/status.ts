/**
 * What a project declared, what the environment binds it to, and whether the
 * two meet.
 *
 * ## Why this exists
 *
 * Every piece of this was already knowable and none of it was visible in one
 * place. `rebase resources` lists what you declared. The environment holds the
 * variables. The resolvers decide whether a source is usable. So the question a
 * developer actually has — *"why does uploading to `media` answer 501"* — could
 * only be answered by knowing the suffix rule, deriving the variable name by
 * hand, and checking it against a `.env` they had to find first.
 *
 * The answer is mechanical, so it should be printed rather than taught.
 *
 * ## Why it calls the resolvers instead of re-deciding
 *
 * The verdict comes from `resolveDataSources` and `resolveStorageBackend` — the
 * same functions that run at boot. A status view that decided for itself what
 * "configured" means would be a second implementation of the rule, and the
 * first time it disagreed it would be reassuring a developer about a deployment
 * that is about to refuse to start.
 *
 * The variable *names* come from each kind's `envBases` and
 * `ACCOUNT_SCOPED_STORAGE_BASES`, both of which are held to those same
 * resolvers by `resource-env-bases.test.ts`.
 */
import {
    DEFAULT_RESOURCE_KEY,
    envBasesForResource,
    resourceEnvSuffix,
    resourceToDataSource,
    type ResourceDeclaration,
    type ResourceGraph
} from "@rebasepro/types";

/** One environment variable a resource reads, and whether it is there. */
export interface ResourceBinding {
    /** The variable this resource reads, suffix included. */
    name: string;
    set: boolean;
    /**
     * The account-scoped name consulted when `name` is unset.
     *
     * Only provider-level bindings have one, and only when the resource named
     * an `account`. Shown because a developer looking at an unset
     * `S3_ACCESS_KEY_ID__MEDIA` needs to know it is not the whole story.
     */
    fallback?: { name: string; set: boolean };
}

/** Whether a declared resource can actually be reached. */
export type ResourceState =
    /** Bound and usable. */
    | "ready"
    /** Nothing set for it. Legal for a bucket, fatal for a database. */
    | "unconfigured"
    /** Set, and set wrongly. The deployment refuses to start. */
    | "broken";

export interface ResourceStatus {
    kind: string;
    key: string;
    engine: string;
    transport: string;
    /** Present when this resource shares another's credentials. */
    account?: string;
    /** True for a resource nobody declared, which exists anyway. */
    implicit: boolean;
    bindings: ResourceBinding[];
    state: ResourceState;
    /** What this means, in the terms the developer will meet it in. */
    detail: string;
}

export type EnvBag = Record<string, string | undefined>;

/** Set, and not set to the empty string — which the resolvers treat as absent. */
function isSet(env: EnvBag, name: string): boolean {
    const value = env[name];
    return typeof value === "string" && value !== "";
}

/**
 * The bindings one declaration reads, in the order a reader should scan them.
 *
 * A `direct`-transport resource gets none: the browser reaches it with a
 * provider SDK and the backend binds nothing for it, so listing variables would
 * invite someone to set variables that are never read.
 */
export function bindingsFor(
    declaration: ResourceDeclaration,
    env: EnvBag,
    accountScopedBases: readonly string[]
): ResourceBinding[] {
    if (declaration.transport !== "server") return [];

    const suffix = resourceEnvSuffix(declaration.key);
    const account = typeof declaration.options.account === "string"
        ? resourceEnvSuffix(declaration.options.account)
        : undefined;

    return envBasesForResource(declaration).map((base) => {
        const name = `${base}${suffix}`;
        const binding: ResourceBinding = { name, set: isSet(env, name) };

        // Only the provider-level bindings fall back, and only for a resource
        // that named an account. The bucket name never does — it is what
        // distinguishes one source from another.
        if (account !== undefined && !binding.set && accountScopedBases.includes(base)) {
            binding.fallback = { name: `${base}${account}`, set: isSet(env, `${base}${account}`) };
        }
        return binding;
    });
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
 * Resolve every declared resource against an environment.
 *
 * `resolveStorageBackend` is called per bucket because it already answers per
 * bucket, and its three outcomes are exactly the three states worth showing:
 * a config (ready), `undefined` (nothing set — legal, and the reason an upload
 * answers 501), or a throw (set and set wrongly — the deployment refuses).
 *
 * Databases are simpler and stricter: a declared one with no connection string
 * is fatal at boot, because collections routed to it would otherwise fall back
 * to the default database and land their rows somewhere nobody named. The
 * connection string is the whole rule, so it is read off the binding — and
 * `resolveDataSources` is then run once over the whole set, so anything else it
 * would refuse (a driver package it cannot resolve for a custom engine) is
 * reported rather than missed by a view that only looked for URLs.
 */
export function computeStatus(
    graph: ResourceGraph,
    env: EnvBag,
    resolvers: {
        accountScopedBases: readonly string[];
        resolveStorageBackend: (
            env: EnvBag, key: string, engine: string | undefined, basePath: string, account?: string
        ) => unknown;
        resolveDataSources: (env: EnvBag, definitions: unknown) => unknown;
    }
): { resources: ResourceStatus[]; blocked?: string } {
    const resources: ResourceStatus[] = [];

    for (const { declaration, implicit } of withImplicitDefaults(graph)) {
        const bindings = bindingsFor(declaration, env, resolvers.accountScopedBases);
        const base: Omit<ResourceStatus, "state" | "detail"> = {
            kind: declaration.kind,
            key: declaration.key,
            engine: declaration.engine,
            transport: declaration.transport,
            ...(typeof declaration.options.account === "string"
                ? { account: declaration.options.account }
                : {}),
            implicit,
            bindings
        };

        if (declaration.transport !== "server") {
            resources.push({
                ...base,
                state: "ready",
                detail: "reached by a provider SDK in the browser; the backend binds nothing"
            });
            continue;
        }

        if (declaration.kind === "bucket") {
            try {
                const config = resolvers.resolveStorageBackend(
                    env, declaration.key, declaration.engine, "uploads",
                    typeof declaration.options.account === "string" ? declaration.options.account : undefined
                );
                const resolvedType = (config as { type?: string } | undefined)?.type;
                resources.push(config
                    ? {
                        ...base,
                        state: "ready",
                        // A green tick on a local bucket would be the exact
                        // false reassurance this view exists to remove:
                        // production DROPS a local backend, because a
                        // container's filesystem is erased on every restart, so
                        // uploads that succeed here fail there — and the
                        // deployment still looks healthy.
                        detail: resolvedType === "local"
                            ? "local disk — fine for development, dropped in production unless a durable "
                              + "volume is mounted and FORCE_LOCAL_STORAGE=true"
                            : ""
                    }
                    : {
                        ...base,
                        state: "unconfigured",
                        detail: "declared, not configured — uploads here answer 501 STORAGE_SOURCE_NOT_CONFIGURED"
                    });
            } catch (err) {
                resources.push({
                    ...base,
                    state: "broken",
                    detail: err instanceof Error ? err.message : String(err)
                });
            }
            continue;
        }

        if (declaration.kind === "database") {
            const url = bindings.find(b => b.name.startsWith("DATABASE_URL"));
            resources.push(url?.set
                ? { ...base, state: "ready", detail: "" }
                : {
                    ...base,
                    state: "unconfigured",
                    detail: implicit
                        ? "no connection string — the backend cannot start without one"
                        : "declared with no connection string — boot refuses, because collections "
                          + "routed here would otherwise use the default database"
                });
            continue;
        }

        // A kind this build does not model the binding of — a topic today, a
        // cache tomorrow. Listed rather than hidden: a resource nobody shows is
        // one nobody remembers to configure.
        resources.push({
            ...base,
            state: "ready",
            detail: bindings.length === 0 ? "needs no environment configuration" : ""
        });
    }

    // Only asked when every row already looks fine. Its failures overlap with
    // the per-resource ones, and a banner repeating a line printed two rows
    // above teaches nothing — what it is here for is the failure no row models,
    // such as a custom engine whose driver package cannot be resolved.
    let blocked: string | undefined;
    if (resources.every(r => r.state === "ready")) {
        try {
            resolvers.resolveDataSources(
                env,
                graph.resources.filter(r => r.kind === "database").map(resourceToDataSource)
            );
        } catch (err) {
            blocked = err instanceof Error ? err.message : String(err);
        }
    }

    return { resources, ...(blocked !== undefined ? { blocked } : {}) };
}
