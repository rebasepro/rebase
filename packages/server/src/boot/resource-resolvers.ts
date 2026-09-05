/**
 * How each resource kind is bound, registered per kind.
 *
 * `@rebasepro/types` registers what a kind *is* — its engines, its options,
 * the variable bases it binds from. This is the other half: what the runtime
 * does with those variables. Keeping it a registry rather than a switch is
 * what makes the next kind an afternoon: a `cache` arrives as a spec in
 * `@rebasepro/types`, a resolver here, and a driver — and nothing else in the
 * boot path, `rebase status` or the gate that holds the two halves together
 * has to learn its name.
 *
 * Two readers, one answer. Boot calls a resolver to bind; `rebase status`
 * calls the same resolver to say whether a binding would succeed. The first
 * time those two disagreed, status would be reassuring somebody about a
 * deployment that was about to refuse to start — which is why status has no
 * resolver of its own.
 *
 * ## Every declared kind must be bindable
 *
 * A graph entry whose kind has no resolver used to be dropped: the adapters
 * filtered by the kinds they knew and the rest went nowhere, so a bundle from
 * a newer CLI declaring a kind this runtime had never heard of booted with the
 * declaration ignored. {@link assertEveryKindBindable} refuses that at boot,
 * by name, which is the same rule the CLI applies to an unknown engine.
 */
import {
    DEFAULT_RESOURCE_KEY,
    resourceEnvSuffix,
    resourceKind,
    resourceKinds,
    resourceToDataSource,
    resourceToStorageSource,
    type ResourceDeclaration,
    type ResourceGraph
} from "@rebasepro/types";
import { BundleError } from "./bundle.js";
import {
    ACCOUNT_SCOPED_STORAGE_BASES,
    resolveDataSources,
    resolveStorageBackend,
    type EnvBag
} from "./sources.js";

/** What a resolver knows about the process it resolves for. */
export interface ResolveContext {
    /** Whether this is a production process. Decides whether a local stand-in is allowed. */
    production: boolean;
    /** Where a local storage source lives when nothing names a path. */
    defaultBasePath: string;
}

/**
 * One resource's binding verdict.
 *
 * - `ready`: bound, or standing in — `standsIn` names the engine a local
 *   directory is standing in for in development.
 * - `unbound`: declared and not configured. Not fatal: the resource is
 *   skipped, and whatever uses it answers 501.
 * - `blocked`: boot refuses. The detail is the resolver's own message.
 * - `code`: binds from nothing. A cron, a function, a topic: the declaration
 *   is the whole configuration.
 */
export type ResourceResolution =
    | { state: "ready"; detail?: string; standsIn?: string }
    | { state: "unbound"; detail: string }
    | { state: "blocked"; detail: string }
    | { state: "code"; detail?: string };

export interface ResourceResolver {
    kind: string;
    /**
     * The variable bases this resolver reads, exactly. Held to the kind's
     * `envBases` by `resource-env-bases.test.ts`, so a base one side names and
     * the other never consults — a variable somebody sets and nothing reads —
     * fails a build instead of reaching a developer.
     */
    reads: readonly string[];
    /** The subset of `reads` that falls back to `<BASE>__<ACCOUNT>`. */
    accountScoped?: readonly string[];
    resolve(declaration: ResourceDeclaration, env: EnvBag, context: ResolveContext): ResourceResolution;
}

const resolvers = new Map<string, ResourceResolver>();

/** Register a kind's resolver. Idempotent for the same object; a second, different one throws. */
export function registerResourceResolver(resolver: ResourceResolver): void {
    const existing = resolvers.get(resolver.kind);
    if (existing && existing !== resolver) {
        throw new Error(`A resolver for resource kind "${resolver.kind}" is already registered.`);
    }
    resolvers.set(resolver.kind, resolver);
}

/** The resolver for a kind, or undefined when this runtime cannot bind it. */
export function resourceResolver(kind: string): ResourceResolver | undefined {
    return resolvers.get(kind);
}

/** Every registered resolver, for the gate and for `rebase doctor`. */
export function resourceResolvers(): ResourceResolver[] {
    return [...resolvers.values()];
}

/**
 * Refuse a graph that declares a kind this runtime has no resolver for.
 *
 * Throws with every offending kind at once, because they arrive together — a
 * newer CLI that added two kinds is the usual cause — and a message naming one
 * of two sends somebody back through the same failure twice.
 */
export function assertEveryKindBindable(graph: ResourceGraph): void {
    const unknown = [...new Set(graph.resources.map(r => r.kind))].filter(kind => !resolvers.has(kind));
    if (unknown.length === 0) return;
    const known = [...resolvers.keys()].sort().join(", ");
    throw new BundleError(
        `This runtime cannot bind resource kind(s) ${unknown.map(k => `"${k}"`).join(", ")}. ` +
            `It binds: ${known}.`,
        "The project was built by a newer Rebase than this runtime. Upgrade @rebasepro/server, " +
            "or remove the declaration. Refused rather than ignored: a declaration this process " +
            "cannot honour would otherwise boot as if it were not there."
    );
}

/** A boot refusal as one line: the message, and the hint that says why. */
function describeRefusal(err: unknown): string {
    if (err instanceof BundleError) return err.hint ? `${err.message} ${err.hint}` : err.message;
    return err instanceof Error ? err.message : String(err);
}

// ── The kinds this runtime binds ─────────────────────────────────────────────

const databaseResolver: ResourceResolver = {
    kind: "database",
    reads: [
        "DATABASE_URL",
        "DATABASE_READ_URL",
        "ADMIN_CONNECTION_STRING",
        "REBASE_DRIVER",
        "DB_POOL_MAX",
        "DB_POOL_IDLE_TIMEOUT",
        "DB_POOL_CONNECT_TIMEOUT"
    ],
    resolve(declaration, env) {
        if (declaration.transport !== "server") {
            return { state: "code", detail: "reached by a provider SDK; the backend binds nothing for it" };
        }
        try {
            resolveDataSources(env, [resourceToDataSource(declaration)]);
            return { state: "ready" };
        } catch (err) {
            // The resolver's own message, which names the variable to set,
            // and its hint, which says why the boot refuses rather than warns.
            return { state: "blocked", detail: describeRefusal(err) };
        }
    }
};

const bucketResolver: ResourceResolver = {
    kind: "bucket",
    reads: [
        "STORAGE_TYPE",
        "STORAGE_PATH",
        "S3_BUCKET",
        "S3_REGION",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "S3_ENDPOINT",
        "S3_FORCE_PATH_STYLE",
        "GCS_BUCKET",
        "GCS_PROJECT_ID",
        "GCS_KEY_FILENAME"
    ],
    accountScoped: ACCOUNT_SCOPED_STORAGE_BASES,
    resolve(declaration, env, context) {
        if (declaration.transport !== "server") {
            return { state: "code", detail: "reached by a provider SDK; the backend binds nothing for it" };
        }
        const source = resourceToStorageSource(declaration);
        let config: ReturnType<typeof resolveStorageBackend>;
        try {
            config = resolveStorageBackend(
                env,
                source.key,
                source.engine,
                context.defaultBasePath,
                source.account,
                { production: context.production }
            );
        } catch (err) {
            return { state: "blocked", detail: describeRefusal(err) };
        }
        const suffix = resourceEnvSuffix(declaration.key);
        if (!config) {
            const bucketVar = `${declaration.engine === "gcs" ? "GCS" : "S3"}_BUCKET${suffix}`;
            return {
                state: "unbound",
                detail: `declared, not configured — uploads here answer 501. Set ${bucketVar}.`
            };
        }
        if (config.type === "local" && config.standsInFor) {
            return {
                state: "ready",
                standsIn: config.standsInFor,
                detail: `${config.standsInFor} declared and unbound; a local directory stands in, in development only`
            };
        }
        if (config.type === "local") {
            return context.production && !env.FORCE_LOCAL_STORAGE
                ? {
                    state: "unbound",
                    detail: "local storage is dropped in production — a container's filesystem is erased " +
                        "on restart. Bind an object store, or set FORCE_LOCAL_STORAGE=true on a durable volume."
                }
                : { state: "ready", detail: `local directory ${config.basePath}` };
        }
        return { state: "ready" };
    }
};

/** A kind that is configuration by declaration alone. */
function codeOnly(kind: string, detail: string): ResourceResolver {
    return {
        kind,
        reads: [],
        resolve: () => ({ state: "code", detail })
    };
}

registerResourceResolver(databaseResolver);
registerResourceResolver(bucketResolver);
registerResourceResolver(codeOnly("topic", "rows on the durable job queue in this project's database"));
registerResourceResolver(codeOnly("queue", "rows on the durable job queue in this project's database"));
registerResourceResolver(codeOnly("cron", "scheduled in-process; each slot claimed once per deployment"));
registerResourceResolver(codeOnly("function", "mounted at /api/functions/<name>"));

/**
 * Every kind `@rebasepro/types` registers that this runtime cannot bind.
 *
 * Empty in a consistent build. Non-empty means the two packages disagree —
 * a kind was added to one and not the other — which the gate reports and
 * `rebase doctor` can show.
 */
export function unbindableKinds(): string[] {
    return resourceKinds().map(k => k.kind).filter(kind => !resolvers.has(kind));
}

/** The default-keyed declaration of a kind, synthesised for kinds that have one implicitly. */
export function implicitDeclaration(kind: string): ResourceDeclaration | undefined {
    const spec = resourceKind(kind);
    if (!spec?.implicitDefault) return undefined;
    return {
        kind,
        key: DEFAULT_RESOURCE_KEY,
        engine: spec.defaultEngine,
        transport: "server",
        options: Object.freeze({})
    };
}
