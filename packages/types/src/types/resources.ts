/**
 * The resource graph: one declaration site for every named thing a project needs.
 *
 * ## The rule
 *
 * **Every named resource is declared with a constructor in config code.** A
 * database, a bucket, a topic and whatever kind comes next are all spelled the
 * same way, so "where do I declare my second one" has one answer instead of one
 * answer per kind.
 *
 * ```ts
 * export const main    = database("main");
 * export const media   = bucket("media", { transport: "direct" });
 * export const signups = topic<SignupEvent>("signups");
 * ```
 *
 * ## Declaration is not binding
 *
 * A declaration says a resource *exists* and what shape it has. It never says
 * how to reach it — that is a property of the environment, not of the project,
 * and it differs between a laptop, a self-hosted box and a tenant in the cloud.
 * Binding lives in `@rebasepro/server`'s boot path, where each kind registers
 * the resolver that reads its environment variables, keyed off the logical
 * name declared here.
 *
 * This split is the whole point. Before it, storage topology was hand-written
 * into `rebase.json` while database topology lived in TypeScript, and the
 * boundary between them was a fact about what the control plane could read
 * before a build — a platform implementation detail that a developer had no way
 * to derive. Worse, storage could be declared in *both* places, and the merge
 * silently kept the JSON's engine and discarded the code's.
 *
 * ## Why a registry rather than a fixed union
 *
 * Kinds register themselves. Adding pub/sub, a cache or a search index must not
 * require editing a manifest schema, a validator and three switch statements —
 * that cost is exactly why the last two kinds ended up in different homes.
 */

/** How a client reaches a resource. */
export type ResourceTransport =
    /** Through the backend. The default, and the only one that needs no client SDK. */
    | "server"
    /** A provider SDK talks to the resource directly; the backend is not in the path. */
    | "direct";

/**
 * A resource kind, as registered.
 *
 * `engines` is an allowlist rather than documentation. An unrecognised engine
 * used to be a free string that passed every check and failed later, further
 * from the typo that caused it — `"s2"` for `"s3"` reached the runtime. Anything
 * genuinely outside the list is spelled `custom:<id>`, which says so at the call
 * site instead of looking like a typo.
 */
export interface ResourceKindSpec {
    /** The kind's name, as it appears in a declaration and in the graph. */
    kind: string;
    /**
     * Which definition of this kind this is. Bump it whenever anything else in
     * the spec changes.
     *
     * Two copies of this package can meet in one process — a published driver
     * inlines it into its dist, and the runtime image ships its own — and the
     * registry is shared between them on purpose. Without a revision the only
     * thing the registry can do with two specs that differ is refuse, and a
     * refusal at driver load is a pod that never boots: every bundle built with
     * a driver older than the change dies on the first image that carries it.
     * With one, the higher revision wins whichever copy loads first, and the
     * older copy is told so. Missing means 0, which is what every copy shipped
     * before revisions existed reports.
     *
     * Only copies that know about revisions honour them. A copy published
     * BEFORE they existed still compares the whole literal and throws, so a
     * kind that has shipped in such a copy cannot change its literal at all —
     * not even to add this field. Correct those kinds with `amendResourceKind`.
     */
    revision?: number;
    /** Engines this kind ships with. `custom:<id>` is always additionally valid. */
    engines: readonly string[];
    /** Used when a declaration names none. */
    defaultEngine: string;
    /**
     * Environment variable base names this kind binds from, in the order a
     * binder should try them. A resource keyed `analytics` reads
     * `<BASE>__ANALYTICS`; the default-keyed resource reads `<BASE>` unsuffixed,
     * so a single-resource project configured the obvious way declares nothing.
     */
    envBases: readonly string[];
    /**
     * The subset of `envBases` that matters for a given engine.
     *
     * The binder reads every base and takes whichever is set — harmless, and it
     * keeps binding tolerant. A GENERATOR cannot be that relaxed: `rebase eject
     * infra` writing S3_BUCKET, GCS_BUCKET, STORAGE_BUCKET and
     * STORAGE_PUBLIC_URL for a `local` bucket hands somebody four variables of
     * which three are noise, and a config file full of irrelevant keys is one
     * nobody reads carefully.
     *
     * Keyed by engine; an engine with no entry falls back to all of them, which
     * is the honest answer for one this package has never heard of.
     */
    envBasesByEngine?: Readonly<Record<string, readonly string[]>>;
    /** Option keys this kind accepts beyond the common ones, for validation. */
    optionKeys?: readonly string[];
    /**
     * Whether a project implicitly has one of these even when it declares
     * nothing. True for databases — a backend without one is not a backend —
     * and false for topics, where zero is the normal number.
     */
    implicitDefault?: boolean;
}

/** The key a resource takes when a project declares only one of its kind. */
export const DEFAULT_RESOURCE_KEY = "(default)";

/** A declared resource, as it appears in the graph. */
export interface ResourceDeclaration {
    kind: string;
    /** Unique within its kind. What a binder looks up and what an env suffix is built from. */
    key: string;
    engine: string;
    transport: ResourceTransport;
    label?: string;
    /** Kind-specific options, validated against the kind's `optionKeys`. */
    options: Readonly<Record<string, unknown>>;
    /**
     * What in the project reaches this resource, as `<what>:<name>` — a
     * `collection:posts` routed to a database, a `property:posts.cover` stored
     * in a bucket, a `function:report` importing a handle.
     *
     * Recorded by the derive step, never by a constructor: a declaration says
     * a resource exists, and only a reader that has evaluated the rest of the
     * project can say who uses it. It is the map a host needs to split a
     * monolith into units later, and the map a console needs to answer "what
     * breaks if I remove this". Absent when nothing was recorded, which is
     * different from an empty list.
     */
    usedBy?: readonly string[];
}

/**
 * The value a constructor returns.
 *
 * Carries its own declaration so config code can hold it and pass it around,
 * and stringifies to its key so it drops into the places that still take one.
 * Collections name a data source by string today; a handle works there without
 * the collection API having to change, which keeps this a config redesign
 * rather than a rewrite of the data layer.
 */
export interface ResourceHandle extends ResourceDeclaration {
    toString(): string;
}

const BRAND = Symbol.for("@rebasepro/types.resource");

/** Whether a value is a resource handle rather than a plain string key. */
export function isResourceHandle(value: unknown): value is ResourceHandle {
    return typeof value === "object" && value !== null && BRAND in value;
}

/**
 * A reference to a resource where a key is expected: the handle a constructor
 * returned, or the key spelled as a string.
 *
 * The handle is the point. `dataSource: analytics` is the same name spelled
 * once — rename the export and every use follows, jump-to-definition lands on
 * the declaration, and the derive step can record who uses what. The string
 * form stays because a key has to survive serialisation: the runtime and the
 * admin UI read collections as plain data, where a handle cannot travel.
 */
export type ResourceRef = string | ResourceHandle;

/** The key a resource reference names, whether it is a handle or already a key. */
export function resourceKeyOf(ref: ResourceRef): string {
    return isResourceHandle(ref) ? ref.key : ref;
}

/**
 * Replace every resource handle inside a value with its key, deeply.
 *
 * Applied where authored config becomes data: `defineCollection`, the
 * collection loaders, the derive step. Past that point a collection is plain
 * data that serialises, compares with `===` and reaches the admin UI over the
 * wire, so a handle must not survive into it. Plain objects and arrays are
 * walked; anything else — a function, a Date, a class instance — is a leaf and
 * is returned as it is, which is what keeps callbacks and validators intact.
 */
export function resolveResourceRefs<T>(value: T): T {
    if (isResourceHandle(value)) return value.key as unknown as T;
    // Identity-preserving: a value with no handle inside comes back as the
    // same object, not a copy. Collections point at each other through
    // `target: () => authors`, and a loader that cloned every collection would
    // leave those closures returning the originals while everything else
    // held the copies. A collection that `defineCollection` already
    // normalised passes through here untouched.
    if (Array.isArray(value)) {
        let changed = false;
        const out = value.map(item => {
            const next = resolveResourceRefs(item);
            if (next !== item) changed = true;
            return next;
        });
        return (changed ? out : value) as T;
    }
    if (value !== null && typeof value === "object") {
        const proto = Object.getPrototypeOf(value);
        if (proto === Object.prototype || proto === null) {
            let changed = false;
            const out: Record<string, unknown> = {};
            for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
                const next = resolveResourceRefs(v);
                if (next !== v) changed = true;
                out[k] = next;
            }
            return (changed ? out : value) as T;
        }
    }
    return value;
}

/**
 * The process-wide registry.
 *
 * Keyed off `globalThis` through a shared symbol rather than held in a module
 * local, because a module local is per *copy* of this package. A project that
 * ends up with two copies of `@rebasepro/types` — which a partially-linked
 * `node_modules` produces, and which has already caused a phantom
 * "JWT secret not configured" bug in this repo — would otherwise register into
 * one registry and read from the other, and see an empty graph with nothing
 * anywhere to explain it.
 */
interface Registry {
    kinds: Map<string, ResourceKindSpec>;
    declarations: Map<string, ResourceDeclaration>;
}

const GLOBAL_KEY = Symbol.for("@rebasepro/types.resourceRegistry");

function registry(): Registry {
    const g = globalThis as unknown as Record<symbol, Registry | undefined>;
    let existing = g[GLOBAL_KEY];
    if (!existing) {
        existing = { kinds: new Map(), declarations: new Map() };
        g[GLOBAL_KEY] = existing;
    }
    return existing;
}

/**
 * Corrections this copy applies on top of a registered kind.
 *
 * Deliberately a module local — per COPY of this package — where the registry
 * above is deliberately shared. A published driver inlines this package into
 * its dist, and the copy it carries compares the shared registry's entry for a
 * kind against its own literal by `JSON.stringify` and throws if they differ
 * (see `registerResourceKind` before revisions existed). That code is in the
 * field and cannot be changed, so the registered literal of any kind that has
 * ever shipped is frozen: change one enumerable key and every bundle built with
 * an older driver dies at driver load on the next image. What a kind actually
 * binds can still be corrected — here, read through `resourceKind()` and
 * everything built on it, invisible to the older copy, which keeps binding the
 * way it did when it was published.
 */
type KindAmendment = Partial<Pick<ResourceKindSpec, "envBases" | "envBasesByEngine" | "optionKeys">>;
const amendments = new Map<string, KindAmendment>();

/**
 * Correct a registered kind without touching its registered literal.
 *
 * Use this, never an edit to the literal, for a kind that has shipped in a
 * published package. The amendment applies to reads through this copy only.
 */
export function amendResourceKind(kind: string, amendment: KindAmendment): void {
    amendments.set(kind, { ...amendments.get(kind), ...amendment });
}

/** A registered kind as this copy sees it: the shared literal plus this copy's amendments. */
function effectiveKind(spec: ResourceKindSpec): ResourceKindSpec {
    const amendment = amendments.get(spec.kind);
    return amendment ? { ...spec, ...amendment } : spec;
}

/** `kind:key`, the graph's primary key. */
function declarationId(kind: string, key: string): string {
    return `${kind}:${key}`;
}

/**
 * Register a resource kind.
 *
 * Idempotent for an identical spec. When a spec for the same kind is already
 * registered and differs, the `revision` decides: the higher one is kept and
 * the other copy is warned about, in either load order — the case where an
 * older inlined copy of this package (a driver built before the kind changed)
 * meets the runtime's current one. Two different specs at the SAME revision
 * are a genuine conflict — two packages defining one kind, or a change that
 * forgot to bump — and still throw.
 */
export function registerResourceKind(spec: ResourceKindSpec): void {
    const kinds = registry().kinds;
    const existing = kinds.get(spec.kind);
    if (!existing) {
        kinds.set(spec.kind, spec);
        return;
    }
    if (JSON.stringify(existing) === JSON.stringify(spec)) return;

    const have = existing.revision ?? 0;
    const incoming = spec.revision ?? 0;
    if (have === incoming) {
        throw new Error(
            `Resource kind "${spec.kind}" is already registered with a different definition at revision ${have}. ` +
            "Two packages cannot define the same kind; a newer definition of the same kind must carry a higher `revision`."
        );
    }
    const [kept, dropped] = incoming > have ? [spec, existing] : [existing, spec];
    if (kept === spec) kinds.set(spec.kind, spec);
    // No logger below @rebasepro/server, and this runs in browsers too.
    console.warn(
        `[resources] Resource kind "${spec.kind}" is registered twice, at revisions ${dropped.revision ?? 0} and ` +
        `${kept.revision ?? 0}; keeping revision ${kept.revision ?? 0}. The older copy is usually @rebasepro/types ` +
        "inlined in a driver built before the kind changed — rebuild the project with a current driver to remove it."
    );
}

/** Every registered kind, for validators and for `rebase doctor`. */
export function resourceKinds(): ResourceKindSpec[] {
    return [...registry().kinds.values()].map(effectiveKind);
}

/** One registered kind, or undefined. */
export function resourceKind(kind: string): ResourceKindSpec | undefined {
    const spec = registry().kinds.get(kind);
    return spec && effectiveKind(spec);
}

/** Options every kind accepts. */
export interface DeclareOptions {
    engine?: string;
    transport?: ResourceTransport;
    label?: string;
    [option: string]: unknown;
}

const COMMON_OPTION_KEYS = ["engine", "transport", "label"] as const;

/** Whether an engine is one the kind knows, or an explicit `custom:` opt-out. */
export function isValidEngine(spec: ResourceKindSpec, engine: string): boolean {
    return engine.startsWith("custom:") || spec.engines.includes(engine);
}

/**
 * Declare a resource. The primitive every kind's constructor is built from.
 *
 * Redeclaring the same `kind:key` with a *different* shape throws rather than
 * merging. Merging is what the old storage path did, and it silently discarded
 * one of the two engines — a declaration accepted and then ignored, which is
 * the failure this whole model exists to remove. Redeclaring it identically is
 * fine: a config module evaluated twice must not be an error.
 */
export function declareResource(
    kind: string,
    key: string = DEFAULT_RESOURCE_KEY,
    options: DeclareOptions = {}
): ResourceHandle {
    const spec = resourceKind(kind);
    if (!spec) {
        const known = [...registry().kinds.keys()].sort().join(", ") || "none";
        throw new Error(
            `Unknown resource kind "${kind}". Registered kinds: ${known}. ` +
            "Call registerResourceKind() before declaring one."
        );
    }

    if (!key || typeof key !== "string" || key.trim() === "") {
        throw new Error(`A ${kind} needs a non-empty key.`);
    }

    const engine = options.engine ?? spec.defaultEngine;
    if (!isValidEngine(spec, engine)) {
        throw new Error(
            `Unknown ${kind} engine "${engine}" for "${key}". ` +
            `Known engines: ${spec.engines.join(", ")}. ` +
            `An engine this build does not ship is spelled "custom:${engine}", ` +
            "which says so at the call site rather than failing later."
        );
    }

    const allowed = new Set<string>([...COMMON_OPTION_KEYS, ...(spec.optionKeys ?? [])]);
    const unknown = Object.keys(options).filter(k => !allowed.has(k));
    if (unknown.length > 0) {
        throw new Error(
            `Unknown option(s) on ${kind} "${key}": ${unknown.join(", ")}. ` +
            `A ${kind} accepts: ${[...allowed].sort().join(", ")}.`
        );
    }

    const extra: Record<string, unknown> = {};
    for (const k of spec.optionKeys ?? []) {
        if (options[k] !== undefined) extra[k] = options[k];
    }

    const declaration: ResourceDeclaration = {
        kind,
        key,
        engine,
        transport: options.transport ?? "server",
        ...(options.label !== undefined ? { label: options.label } : {}),
        options: Object.freeze(extra)
    };

    const id = declarationId(kind, key);
    const previous = registry().declarations.get(id);
    if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(declaration)) {
            throw new Error(
                `${kind} "${key}" is declared twice with different configuration. ` +
                "Declare it once and export it — two declarations of one resource is " +
                "the ambiguity this model exists to remove, so it is refused rather " +
                "than merged."
            );
        }
    } else {
        registry().declarations.set(id, declaration);
    }

    const handle = {
        ...declaration,
        toString() { return key; },
        [BRAND]: true as const
    };
    return handle as ResourceHandle;
}

/** Every declared resource, in declaration order, optionally filtered by kind. */
export function declaredResources(kind?: string): ResourceDeclaration[] {
    const all = [...registry().declarations.values()];
    return kind ? all.filter(r => r.kind === kind) : all;
}

/**
 * Forget every declaration, keeping registered kinds.
 *
 * For tests and for a CLI that evaluates more than one project in a process.
 * Kinds survive because they are registered by module import, which will not
 * happen a second time.
 */
export function resetDeclaredResources(): void {
    registry().declarations.clear();
}

/**
 * The env-var suffix a resource's bindings use: `__ANALYTICS` for `analytics`,
 * and nothing at all for the default-keyed one.
 *
 * The default takes no suffix so that a project with one database configured
 * through plain `DATABASE_URL` keeps working having declared nothing — the
 * overwhelmingly common project must not have to say so.
 */
export function resourceEnvSuffix(key: string): string {
    if (key === DEFAULT_RESOURCE_KEY) return "";
    return `__${key.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;
}

/**
 * Two resources of a kind whose keys differ but whose env suffixes do not.
 *
 * `media-files` and `media_files` both become `__MEDIA_FILES`, so one would
 * silently read the other's configuration. Returned rather than thrown so the
 * caller can report it with the rest of a validation pass.
 */
export function findEnvSuffixCollision(keys: readonly string[]): { a: string; b: string; suffix: string } | null {
    const seen = new Map<string, string>();
    for (const key of keys) {
        const suffix = resourceEnvSuffix(key);
        const previous = seen.get(suffix);
        if (previous !== undefined && previous !== key) return { a: previous, b: key, suffix };
        seen.set(suffix, key);
    }
    return null;
}

/**
 * The whole graph, as recorded in a manifest and read by a host.
 *
 * `version` is the graph format, not the project's. A host reading a graph it
 * does not understand must say so rather than provision half of it.
 */
export interface ResourceGraph {
    version: 1;
    resources: ResourceDeclaration[];
}

/** The current graph format version. */
export const RESOURCE_GRAPH_VERSION = 1 as const;

/**
 * Build a graph from the current declarations, sorted for a stable diff.
 *
 * `usedBy` maps a `kind:key` id to the things that reach it. The derive step
 * supplies it after evaluating collections; a runtime building the graph at
 * boot passes nothing and gets declarations alone, which is all it binds from.
 */
export function buildResourceGraph(usedBy?: ReadonlyMap<string, readonly string[]>): ResourceGraph {
    const resources = declaredResources().slice().sort(
        (a, b) => a.kind.localeCompare(b.kind) || a.key.localeCompare(b.key)
    ).map(r => {
        const users = usedBy?.get(declarationId(r.kind, r.key));
        return users && users.length > 0 ? { ...r, usedBy: [...users].sort() } : r;
    });
    return { version: RESOURCE_GRAPH_VERSION, resources };
}

/** `kind:key`, the id `usedBy` maps are keyed by. Exported for the derive step. */
export function resourceId(kind: string, key: string): string {
    return declarationId(kind, key);
}

/**
 * The environment variables worth writing for a resource, given its engine.
 *
 * Falls back to every base the kind reads when the engine is unknown — a
 * `custom:` engine gets the full list rather than an empty one, because
 * guessing narrow would silently omit the variable it actually needs.
 */
export function envBasesForResource(declaration: ResourceDeclaration): readonly string[] {
    const spec = resourceKind(declaration.kind);
    if (!spec) return [];
    return spec.envBasesByEngine?.[declaration.engine] ?? spec.envBases;
}
