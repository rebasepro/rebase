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
 * The variable *names* come from each kind's `envBases`, and the verdicts from
 * the resolver `@rebasepro/server` registers per kind — one object per kind,
 * held to `envBases` by `resource-env-bases.test.ts`. A kind this view has
 * never heard of is judged by whatever resolver its package registered.
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
    /** Set when a local directory stands in for this engine, in development. */
    standsIn?: string;
    /** What in the project reaches this resource, from the graph. */
    usedBy?: readonly string[];
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
 * The resolver-side of status, as `@rebasepro/server` registers it per kind.
 *
 * Passed in rather than imported so this module stays testable without a
 * server, and so a kind registered by a plugin is judged by the resolver the
 * plugin brought with it rather than by a switch here.
 */
/**
 * What the managed development database covers, when a project is on it.
 *
 * `rebase init` leaves `DATABASE_URL` commented out on purpose and the managed
 * PGlite fills the vacuum — the documented first-run state. Judging that state
 * by the environment alone produced `○ (default) postgres · DATABASE_URL not
 * set` and the remedy "set DATABASE_URL", at the same moment `rebase db url`
 * was printing a working connection string for the same project and
 * `rebase dev` was serving from it. The status view was reading the one place
 * the answer deliberately is not.
 *
 * Resolved by the caller, because deciding it needs the project's `.env`, its
 * branch pointer and its compose file, and this module stays free of all three.
 */
export interface ManagedDatabaseStatus {
    /**
     * The daemon's connection string, or null when it is not running.
     *
     * Null is not an error: the managed database exists per project and starts
     * on demand. It only means there is nothing to run the whole-set check
     * against, and the row says so rather than implying a misconfiguration.
     */
    url: string | null;
}

export interface StatusResolvers {
    /** `resourceResolver(kind)` from `@rebasepro/server`. */
    resolverFor: (kind: string) => {
        accountScoped?: readonly string[];
        resolve: (
            declaration: ResourceDeclaration,
            env: EnvBag,
            context: { production: boolean; defaultBasePath: string }
        ) => { state: "ready" | "unbound" | "blocked" | "code"; detail?: string; standsIn?: string };
    } | undefined;
    /** `resolveDataSources` from `@rebasepro/server`, for the whole-set check. */
    resolveDataSources: (env: EnvBag, definitions: unknown) => unknown;
    /** Whether the process being judged is production. Status judges for development by default. */
    production?: boolean;
    /**
     * Set when this project runs on the managed development database.
     *
     * Absent for a project that named its own connection string, and absent in
     * production — where an unset `DATABASE_URL` is the failure it has always
     * been.
     */
    managedDatabase?: ManagedDatabaseStatus;
}

/**
 * The environment plus the managed database's URL, for the whole-set check.
 *
 * A copy: the bindings a reader sees are computed against the real `.env`, so
 * nothing here can make the view claim a variable is set that is not. This is
 * only what `resolveDataSources` is handed, and it is handed it so the check
 * judges the environment the runtime would actually get rather than throwing
 * "Data source "(default)" has no connection string" about a database that is
 * running and reachable.
 */
function withManagedUrls(env: EnvBag, graph: ResourceGraph, url: string): EnvBag {
    const filled: EnvBag = { ...env };
    const keys = [
        DEFAULT_RESOURCE_KEY,
        ...graph.resources.filter(r => r.kind === "database").map(r => r.key)
    ];
    for (const key of keys) {
        const name = `DATABASE_URL${resourceEnvSuffix(key)}`;
        if (!isSet(filled, name)) filled[name] = url;
    }

    return filled;
}

/**
 * Resolve every declared resource against an environment.
 *
 * Each kind's verdict comes from the resolver `@rebasepro/server` registered
 * for it — the same one boot calls — so this view cannot say "ready" about a
 * binding boot would refuse. A kind with no resolver is reported as such
 * rather than skipped: a resource nobody shows is one nobody remembers to
 * configure, and a kind this runtime cannot bind is exactly what boot will
 * refuse by name.
 *
 * `resolveDataSources` is then run once over the whole set, so anything it
 * would refuse across sources (a driver package it cannot resolve for a custom
 * engine) is reported rather than missed by a view that only looked per row.
 */
export function computeStatus(
    graph: ResourceGraph,
    env: EnvBag,
    resolvers: StatusResolvers
): { resources: ResourceStatus[]; blocked?: string } {
    const resources: ResourceStatus[] = [];
    const production = resolvers.production ?? false;
    const managed = resolvers.managedDatabase;
    /** Database rows the managed database answered for, so `blocked` can skip them. */
    let managedCovered = 0;

    for (const { declaration, implicit } of withImplicitDefaults(graph)) {
        const resolver = resolvers.resolverFor(declaration.kind);
        const bindings = bindingsFor(declaration, env, resolver?.accountScoped ?? []);
        const base: Omit<ResourceStatus, "state" | "detail"> = {
            kind: declaration.kind,
            key: declaration.key,
            engine: declaration.engine,
            transport: declaration.transport,
            ...(typeof declaration.options.account === "string"
                ? { account: declaration.options.account }
                : {}),
            implicit,
            bindings,
            ...(declaration.usedBy && declaration.usedBy.length > 0 ? { usedBy: declaration.usedBy } : {})
        };

        if (!resolver) {
            resources.push({
                ...base,
                state: "broken",
                detail: `this runtime has no resolver for a "${declaration.kind}" — boot refuses it by name. ` +
                    "Upgrade @rebasepro/server, or remove the declaration."
            });
            continue;
        }

        // Answered before the resolver, because the resolver reads the
        // environment and the whole point of the managed database is that the
        // environment is deliberately empty. Only for a database nobody bound:
        // a developer who set `DATABASE_URL__ANALYTICS` to a warehouse of their
        // own has said which database that is, and the managed one fills a
        // vacuum, never a choice.
        if (managed && declaration.kind === "database" && bindings.every(b => !b.set && !b.fallback?.set)) {
            managedCovered += 1;
            resources.push({
                ...base,
                state: "ready",
                detail: managed.url
                    ? "the managed development database (PGlite), this project only"
                    : "the managed development database (PGlite), this project only — "
                        + "not running; start it with `rebase dev`"
            });
            continue;
        }

        const verdict = resolver.resolve(declaration, env, { production, defaultBasePath: "uploads" });
        switch (verdict.state) {
            case "ready":
                resources.push({
                    ...base,
                    state: "ready",
                    ...(verdict.standsIn ? { standsIn: verdict.standsIn } : {}),
                    detail: verdict.detail ?? ""
                });
                break;
            case "code":
                resources.push({ ...base, state: "ready", detail: verdict.detail ?? "needs no environment configuration" });
                break;
            case "unbound":
                resources.push({ ...base, state: "unconfigured", detail: verdict.detail ?? "declared, not configured" });
                break;
            case "blocked":
                resources.push({
                    ...base,
                    // A database the environment names nothing for is the
                    // ordinary first-run state, and reads as unconfigured; a
                    // binding that is set and set wrongly is broken.
                    state: implicit || bindings.every(b => !b.set && !b.fallback?.set) ? "unconfigured" : "broken",
                    detail: verdict.detail ?? "boot refuses this binding"
                });
                break;
        }
    }

    // Only asked when every row already looks fine. Its failures overlap with
    // the per-resource ones, and a banner repeating a line printed two rows
    // above teaches nothing — what it is here for is the failure no row models,
    // such as a custom engine whose driver package cannot be resolved.
    let blocked: string | undefined;
    // Not run when the managed database answered for a row and is not running:
    // there is no connection string to check the set against, and inventing one
    // to keep the check formally "run" is how a green tick gets printed for
    // work nobody did. The row says the daemon is down; that is the finding.
    const managedSetUnknown = managedCovered > 0 && !managed?.url;
    if (resources.every(r => r.state === "ready") && !managedSetUnknown) {
        try {
            resolvers.resolveDataSources(
                // The managed URL for the rows it answered for, so the whole-set
                // check judges the same environment the runtime would get.
                managed?.url ? withManagedUrls(env, graph, managed.url) : env,
                graph.resources.filter(r => r.kind === "database").map(resourceToDataSource)
            );
        } catch (err) {
            blocked = err instanceof Error ? err.message : String(err);
        }
    }

    return { resources, ...(blocked !== undefined ? { blocked } : {}) };
}
