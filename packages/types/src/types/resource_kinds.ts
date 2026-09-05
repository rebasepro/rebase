/**
 * The kinds Rebase ships, and the constructors a project declares them with.
 *
 * Each kind is registered rather than hardcoded, so a fourth one arrives
 * without editing a manifest schema, a validator and a switch statement. That
 * cost is precisely why databases and buckets ended up declared in different
 * files with different rules — the cheapest thing to do was always to bolt the
 * new kind onto whichever home was nearest.
 *
 * A kind owns its engine list. `custom:<id>` is always accepted, so a build
 * that ships an engine this package has never heard of says so at the call site
 * instead of looking like a typo of one that exists.
 */
import {
    DEFAULT_RESOURCE_KEY,
    declareResource,
    declaredResources,
    amendResourceKind,
    registerResourceKind,
    type DeclareOptions,
    type ResourceDeclaration,
    type ResourceHandle
} from "./resources";
import { DEFAULT_DATA_SOURCE_KEY, type DataSourceDefinition } from "./data_source";
import { DEFAULT_STORAGE_SOURCE_KEY, type StorageSourceDefinition } from "./storage_source";

// ── database ─────────────────────────────────────────────────────────────────

registerResourceKind({
    // FROZEN at the 0.17.3 literal — every published driver up to 0.17.3
    // inlines this package and compares the shared registry's entry against
    // this exact object at load. Corrections go in the amendment below.
    kind: "database",
    engines: ["postgres", "mongodb", "firestore", "sqlite"],
    defaultEngine: "postgres",
    envBases: ["DATABASE_URL", "REBASE_DRIVER", "REBASE_DB_POOL_MAX"],
    optionKeys: ["databaseId", "migrations", "extensions"],
    implicitDefault: true
});
// What a database actually binds from. The 0.17.3 list named two variables
// the resolver never read and omitted five it does (25f1a97e3).
amendResourceKind("database", {
    envBases: [
        "DATABASE_URL",
        "DATABASE_READ_URL",
        "ADMIN_CONNECTION_STRING",
        "REBASE_DRIVER",
        "DB_POOL_MAX",
        "DB_POOL_IDLE_TIMEOUT",
        "DB_POOL_CONNECT_TIMEOUT"
    ]
});

/** Options a database accepts beyond the common ones. */
export interface DatabaseOptions extends DeclareOptions {
    /**
     * The physical database or schema within the engine, when it differs from
     * the engine's own default. Threaded to drivers as `databaseId`.
     */
    databaseId?: string;
    /** Directory of migration files, relative to the config directory. */
    migrations?: string;
    /**
     * Server extensions Rebase may install on this database.
     *
     * A permission, not a request: naming one grants leave to run
     * `CREATE EXTENSION IF NOT EXISTS <name>`, and Rebase issues it only when
     * something in the schema actually needs it. Naming an extension nothing
     * needs installs nothing.
     *
     * It has to be said out loud because installing an extension is a decision
     * with a deployment behind it — the image has to ship the library, the role
     * has to be allowed to install it, and a managed provider has to have it on
     * an allow-list. Rebase cannot see any of that from inside the connection,
     * so the answer comes from whoever chose the database.
     *
     * Today `vector` is the one that matters: a `{ type: "vector" }` property
     * compiles to a `VECTOR(n)` column, which does not exist until pgvector is
     * installed. Without this, Rebase creates the column and lets Postgres
     * refuse, naming the option.
     *
     * ```ts
     * export const main = database({ extensions: ["vector"] });
     * ```
     *
     * `pg_trgm` and `unaccent` are not on this list and need no permission: a
     * `search` block installs them unasked, because they are contrib modules
     * present in every Postgres distribution. pgvector is a separate build that
     * a stock `postgres:18` does not carry.
     */
    extensions?: string[];
}

/** A database handle. Collections point at it via `dataSource`. */
export type DatabaseHandle = ResourceHandle;

/**
 * Declare a database.
 *
 * ```ts
 * export const main      = database();                          // the default one
 * export const analytics = database("analytics");               // reads DATABASE_URL__ANALYTICS
 * export const withPgv   = database({ extensions: ["vector"] }); // the default one, configured
 * ```
 *
 * The third form exists because the default database has no name to pass, and
 * the alternative was `database("(default)", { … })` — writing out an internal
 * sentinel to reach the options. A key is a string and options are an object,
 * so the two can never be confused for one another.
 */
export function database(options?: DatabaseOptions): DatabaseHandle;
export function database(key?: string, options?: DatabaseOptions): DatabaseHandle;
export function database(
    keyOrOptions: string | DatabaseOptions = DEFAULT_RESOURCE_KEY,
    options: DatabaseOptions = {}
): DatabaseHandle {
    return typeof keyOrOptions === "string"
        ? declareResource("database", keyOrOptions, options)
        : declareResource("database", DEFAULT_RESOURCE_KEY, keyOrOptions);
}

/**
 * The extensions the project's databases gave Rebase leave to install.
 *
 * A flat union rather than a per-database answer, because the surfaces that ask
 * — `rebase db push` and the boot schema-ensure — drive one connection and
 * generate one `schema.sql` for every collection regardless of `dataSource`.
 * Splitting the permission by data source would be a distinction the rest of
 * that pipeline does not make, and a false precision is worse than none.
 *
 * Empty for a project that declared nothing, which is every project that has
 * not opted in — so this reads as a refusal by default, on purpose.
 */
export function declaredDatabaseExtensions(): readonly string[] {
    const names = new Set<string>();
    for (const declaration of declaredResources("database")) {
        const declared = declaration.options.extensions;
        if (!Array.isArray(declared)) continue;
        for (const name of declared) {
            if (typeof name === "string" && name.trim()) names.add(name.trim());
        }
    }
    return [...names].sort();
}

// ── bucket ───────────────────────────────────────────────────────────────────

registerResourceKind({
    // FROZEN at the 0.17.3 literal, for the reason given on `database`.
    kind: "bucket",
    engines: ["local", "s3", "gcs", "azure", "firebase"],
    defaultEngine: "local",
    envBases: ["S3_BUCKET", "GCS_BUCKET", "STORAGE_BUCKET", "STORAGE_PUBLIC_URL"],
    envBasesByEngine: {
        local: ["STORAGE_BUCKET"],
        s3: ["S3_BUCKET", "STORAGE_ENDPOINT", "STORAGE_REGION", "STORAGE_PUBLIC_URL"],
        gcs: ["GCS_BUCKET", "STORAGE_PUBLIC_URL"],
        azure: ["STORAGE_BUCKET", "STORAGE_PUBLIC_URL"],
        firebase: ["STORAGE_BUCKET", "STORAGE_PUBLIC_URL"]
    },
    optionKeys: ["publicRead", "prefix", "account"],
    implicitDefault: false
});
// What a bucket actually binds from, per engine (25f1a97e3).
amendResourceKind("bucket", {
    envBases: [
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
    envBasesByEngine: {
        local: ["STORAGE_TYPE", "STORAGE_PATH"],
        s3: [
            "STORAGE_TYPE",
            "S3_BUCKET",
            "S3_REGION",
            "S3_ACCESS_KEY_ID",
            "S3_SECRET_ACCESS_KEY",
            "S3_ENDPOINT",
            "S3_FORCE_PATH_STYLE"
        ],
        gcs: ["STORAGE_TYPE", "GCS_BUCKET", "GCS_PROJECT_ID", "GCS_KEY_FILENAME"],
        azure: [],
        firebase: []
    }
});

/** Options a bucket accepts beyond the common ones. */
export interface BucketOptions extends DeclareOptions {
    /**
     * Whether objects are world-readable by default.
     *
     * Declared rather than inferred from the engine, because the two have
     * disagreed before: a private object served through a cacheable public URL
     * is a data leak that nothing errors on.
     */
    publicRead?: boolean;
    /** Key prefix within the bucket, for sharing one bucket between sources. */
    prefix?: string;
    /**
     * The credential set this bucket signs with, when several share one.
     *
     * `bucket("media", { engine: "s3", account: "minio" })` keeps reading its own
     * `S3_BUCKET__MEDIA` — the bucket name is what distinguishes one source from
     * another and never falls back — while the provider-level variables
     * (`S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_ENDPOINT`, `S3_REGION`,
     * `S3_FORCE_PATH_STYLE`) fall back to `__MINIO` when no per-key value is set.
     *
     * Fifteen buckets on one install go from ninety variables to eighteen, and
     * rotating the key becomes one edit. A per-bucket value still wins, so a
     * single source can move to another provider without breaking the rest off
     * their shared account.
     */
    account?: string;
}

/** A bucket handle. Storage properties point at it via `storageSource`. */
export type BucketHandle = ResourceHandle;

/**
 * Declare a bucket.
 *
 * ```ts
 * export const uploads = bucket({ engine: "s3" });               // the default one
 * export const media   = bucket("media", { transport: "direct" });
 * ```
 *
 * `transport: "direct"` means a provider SDK talks to the bucket and the
 * backend is not in the upload path.
 *
 * The options-only form exists for the same reason `database`'s does: the
 * default bucket has no name to pass, and without it the only way to configure
 * one was `bucket("(default)", { … })` — writing out an internal sentinel to
 * reach the options. Passing options where a key belongs used to throw "a
 * bucket needs a non-empty key", which names neither the mistake nor the fix.
 */
export function bucket(options?: BucketOptions): BucketHandle;
export function bucket(key?: string, options?: BucketOptions): BucketHandle;
export function bucket(
    keyOrOptions: string | BucketOptions = DEFAULT_RESOURCE_KEY,
    options: BucketOptions = {}
): BucketHandle {
    return typeof keyOrOptions === "string"
        ? declareResource("bucket", keyOrOptions, options)
        : declareResource("bucket", DEFAULT_RESOURCE_KEY, keyOrOptions);
}

// ── topic ────────────────────────────────────────────────────────────────────

registerResourceKind({
    // FROZEN at the 0.17.3 literal, for the reason given on `database`.
    kind: "topic",
    // `jobs` is the durable local implementation: a topic fans out to one job
    // row per subscription, so each subscriber retries on its own schedule and
    // a failure is a row somebody can look at rather than a lost message.
    engines: ["jobs"],
    defaultEngine: "jobs",
    envBases: ["REBASE_TOPIC_URL"],
    optionKeys: ["delivery", "maxAttempts"],
    implicitDefault: false
});
// Nothing. A topic on the `jobs` engine is rows in the project's own database
// and binds from no variable of its own. The literal above says
// `REBASE_TOPIC_URL` — a name nothing in either repository read, which
// `rebase status` then printed as a variable somebody could set — and it has to
// keep saying it, because a driver ≤ 0.17.3 compares that object and throws.
// The gate in `resource-env-bases.test.ts` covers every registered kind through
// the amended view, so a phantom name fails a build rather than reaching a
// developer.
amendResourceKind("topic", { envBases: [] });

/**
 * How hard the runtime tries to deliver.
 *
 * Only `at-least-once` is implemented, and it is the honest name for what a
 * retrying queue does: a handler must tolerate seeing the same event twice.
 * `at-most-once` is listed so a future transport can offer it without the
 * option changing shape, and is refused today rather than silently upgraded.
 */
export type TopicDelivery = "at-least-once" | "at-most-once";

/** Options a topic accepts beyond the common ones. */
export interface TopicOptions extends DeclareOptions {
    delivery?: TopicDelivery;
    /** Attempts per subscription before a message is left failed. Default 5. */
    maxAttempts?: number;
}

/**
 * What a subscription does with an event.
 *
 * `attempt` counts from 1. Worth branching on: the first delivery and the
 * fourth are the same call, but the fourth is where it is worth logging loudly.
 */
export type TopicHandler<T> = (event: T, context: { attempt: number; topic: string; subscription: string }) => Promise<void> | void;

/** A declared subscription, as recorded in the graph and wired at boot. */
export interface TopicSubscription<T = unknown> {
    topic: string;
    name: string;
    handler: TopicHandler<T>;
    maxAttempts?: number;
}

/**
 * What a topic publishes through.
 *
 * Installed by `@rebasepro/server` at boot. Absent — in the CLI evaluating
 * config to derive the graph, or in a unit test — publishing throws a message
 * naming the cause, rather than resolving and dropping the event. A publish
 * that silently does nothing is the failure mode a queue exists to prevent.
 */
export interface TopicRuntime {
    publish(topic: string, event: unknown): Promise<void>;
}

const runtimeHolder: { current: TopicRuntime | null } = { current: null };

/** Install the transport topics publish through. Called by the server at boot. */
export function setTopicRuntime(runtime: TopicRuntime | null): void {
    runtimeHolder.current = runtime;
}

const subscriptions: TopicSubscription[] = [];

/** Every declared subscription, for the worker to wire and the graph to record. */
export function declaredSubscriptions(topic?: string): TopicSubscription[] {
    return topic ? subscriptions.filter(s => s.topic === topic) : subscriptions.slice();
}

/** Forget declared subscriptions. For tests, alongside `resetDeclaredResources`. */
export function resetDeclaredSubscriptions(): void {
    subscriptions.length = 0;
}

/** A topic handle, carrying its payload type. */
export interface TopicHandle<T> extends ResourceHandle {
    /**
     * Publish an event.
     *
     * Resolves once the event is durably recorded for every subscription, not
     * once they have run. Enqueued inside a transaction that rolls back, it was
     * never published.
     */
    publish(event: T): Promise<void>;
    /**
     * Declare a subscription.
     *
     * The name is its identity: it is what the job row records, what a retry
     * counts against, and what a second subscription must not collide with.
     */
    subscription(name: string, handler: TopicHandler<T>, options?: { maxAttempts?: number }): void;
}

/**
 * Declare a topic.
 *
 * ```ts
 * export const signups = topic<{ userId: string }>("signups");
 * signups.subscription("send-welcome", async (event) => { … });
 * await signups.publish({ userId });
 * ```
 */
export function topic<T = unknown>(key: string, options: TopicOptions = {}): TopicHandle<T> {
    if (options.delivery === "at-most-once") {
        throw new Error(
            `Topic "${key}" asks for at-most-once delivery, which no shipped transport implements. ` +
            "The durable queue behind topics retries, so it is at-least-once and a handler must " +
            "tolerate seeing an event twice. Refused rather than quietly given the other guarantee."
        );
    }
    const handle = declareResource("topic", key, options);

    return {
        ...handle,
        toString() { return key; },
        async publish(event: T): Promise<void> {
            const runtime = runtimeHolder.current;
            if (!runtime) {
                throw new Error(
                    `Cannot publish to topic "${key}": no topic runtime is installed. ` +
                    "Publishing works inside a running Rebase backend; this looks like config " +
                    "being evaluated outside one (a build, a script, or a test without a harness)."
                );
            }
            await runtime.publish(key, event);
        },
        subscription(name: string, handler: TopicHandler<T>, subOptions: { maxAttempts?: number } = {}): void {
            if (!name || name.trim() === "") {
                throw new Error(`A subscription on topic "${key}" needs a non-empty name.`);
            }
            if (subscriptions.some(s => s.topic === key && s.name === name)) {
                throw new Error(
                    `Topic "${key}" already has a subscription named "${name}". ` +
                    "The name is what a job row records and what a retry counts against, so two " +
                    "cannot share one."
                );
            }
            subscriptions.push({
                topic: key,
                name,
                handler: handler as TopicHandler<unknown>,
                ...(subOptions.maxAttempts !== undefined ? { maxAttempts: subOptions.maxAttempts } : {})
            });
        }
    } as TopicHandle<T>;
}

// ── cron ─────────────────────────────────────────────────────────────────────

registerResourceKind({
    kind: "cron",
    // The in-process scheduler, claiming each slot in `rebase.cron_claims` so
    // several instances of one deployment run a slot once. It is the only
    // engine because it is the only one that exists; an external scheduler
    // (a platform's cron, a Kubernetes CronJob) would be a second engine that
    // triggers the same handler over HTTP, and it can register itself.
    engines: ["scheduler"],
    defaultEngine: "scheduler",
    // Code, not configuration: a cron binds from no variable. It is in the
    // graph so a host knows a project's schedules BEFORE running it, which is
    // what lets a console show them and a placement decision read them.
    envBases: [],
    optionKeys: ["schedule", "timezone", "description", "enabled", "timeoutSeconds", "catchUpWindowSeconds"],
    implicitDefault: false
});

/** What a cron declaration records, beyond its handler. */
export interface CronResourceOptions extends DeclareOptions {
    /** Five-field cron expression, e.g. `0 3 * * *`. */
    schedule: string;
    /**
     * IANA zone the schedule is read in, e.g. `Europe/Madrid`.
     *
     * Without it the schedule is read in the process's own zone, which is
     * whatever the host happens to be set to — UTC in nearly every container,
     * the developer's own on a laptop. "3 AM" then means two different hours
     * either side of a deploy. Naming the zone makes the declaration mean one
     * thing everywhere.
     */
    timezone?: string;
    description?: string;
    enabled?: boolean;
    timeoutSeconds?: number;
    catchUpWindowSeconds?: number;
}

/**
 * Declare a cron, as the scheduler's `defineCron` does on its way through.
 *
 * Projects do not call this: `defineCron` in `@rebasepro/server` does, so a
 * cron file is both the handler and the declaration — one file, one name, and
 * the graph derived from it says what a host needs to know without evaluating
 * the handler. Exported so the derive step and the scheduler spell the
 * declaration identically.
 */
export function declareCron(name: string, options: CronResourceOptions): ResourceHandle {
    if (typeof options.schedule !== "string" || options.schedule.trim() === "") {
        throw new Error(`Cron "${name}" needs a schedule — a five-field cron expression such as "0 3 * * *".`);
    }
    return declareResource("cron", name, options);
}

// ── function ─────────────────────────────────────────────────────────────────

registerResourceKind({
    kind: "function",
    // Mounted by this runtime at `/api/functions/<name>`. A host that runs a
    // function elsewhere — an edge runtime, say — is a second engine, and the
    // bundle's `portable` analysis already says which ones could move.
    engines: ["http"],
    defaultEngine: "http",
    envBases: [],
    optionKeys: ["portable", "requires", "file"],
    implicitDefault: false
});

/**
 * What a function declaration records.
 *
 * Recorded by the derive step from the bundler's static analysis rather than
 * by evaluating the function module: a function's handler is a Hono app that
 * only needs to exist at request time, and evaluating it at build time would
 * run its module-scope code in a process with none of its environment.
 */
export interface FunctionResourceOptions extends DeclareOptions {
    /** Path inside the project, so a host can point at the file. */
    file?: string;
    /** `false` when the source imports a Node built-in or a package that needs one. */
    portable?: boolean;
    /** Why it is not portable — one short phrase per reason. */
    requires?: string[];
}

/** Declare a function. Called by the derive step, not by projects. */
export function declareFunction(name: string, options: FunctionResourceOptions = {}): ResourceHandle {
    return declareResource("function", name, options);
}

// ── queue ────────────────────────────────────────────────────────────────────

registerResourceKind({
    kind: "queue",
    // Same durable queue topics ride on: a row per job, claimed with
    // `FOR UPDATE SKIP LOCKED`, retried on a backoff, kept when it gives up.
    engines: ["jobs"],
    defaultEngine: "jobs",
    envBases: [],
    optionKeys: ["maxAttempts"],
    implicitDefault: false
});

/** Options a queue accepts beyond the common ones. */
export interface QueueOptions extends DeclareOptions {
    /** Attempts before a job is left failed. Default 5. */
    maxAttempts?: number;
}

/** What a queue's handler receives. `attempt` counts from 1. */
export type QueueHandler<T> = (
    payload: T,
    context: { attempt: number; queue: string; jobId: string }
) => Promise<void> | void;

/** Per-job options at enqueue time. */
export interface QueueEnqueueOptions {
    /** Earliest time the job may run. Defaults to now. */
    runAt?: Date;
    /** Attempts for this job, overriding the queue's. */
    maxAttempts?: number;
}

/**
 * What a queue enqueues through.
 *
 * Installed by `@rebasepro/server` at boot, alongside the topic runtime.
 * Absent — config evaluated by the CLI, a unit test — enqueueing throws with
 * the cause named, rather than resolving and dropping the job.
 */
export interface QueueRuntime {
    enqueue(queue: string, payload: unknown, options?: QueueEnqueueOptions): Promise<{ id: string }>;
}

const queueRuntimeHolder: { current: QueueRuntime | null } = { current: null };

/** Install the transport queues enqueue through. Called by the server at boot. */
export function setQueueRuntime(runtime: QueueRuntime | null): void {
    queueRuntimeHolder.current = runtime;
}

/** A queue's handler, as recorded for the worker to wire. */
export interface QueueConsumer<T = unknown> {
    queue: string;
    handler: QueueHandler<T>;
}

const queueConsumers = new Map<string, QueueConsumer>();

/** Every declared queue handler, for the worker to wire. */
export function declaredQueueConsumers(): QueueConsumer[] {
    return [...queueConsumers.values()];
}

/** Forget declared queue handlers. For tests, alongside `resetDeclaredResources`. */
export function resetDeclaredQueueConsumers(): void {
    queueConsumers.clear();
}

/** A queue handle, carrying its payload type. */
export interface QueueHandle<T> extends ResourceHandle {
    /**
     * Put a job on the queue.
     *
     * Resolves once the job is durably recorded, not once it has run. A row
     * insert, so enqueued inside a transaction that rolls back it was never
     * enqueued.
     */
    enqueue(payload: T, options?: QueueEnqueueOptions): Promise<{ id: string }>;
    /**
     * Declare the handler.
     *
     * One per queue: a queue is a work list with one consumer, which is what
     * separates it from a topic. Work that several things must react to is a
     * topic with several subscriptions.
     */
    handler(fn: QueueHandler<T>): void;
}

/**
 * Declare a queue.
 *
 * ```ts
 * export const thumbnails = queue<{ key: string }>("thumbnails");
 * thumbnails.handler(async ({ key }) => { … });
 * await thumbnails.enqueue({ key }, { runAt: new Date(Date.now() + 60_000) });
 * ```
 *
 * The difference from a topic is the number of consumers: a queue has one, a
 * topic fans out to every subscription. Both ride on the durable job queue, so
 * declaring either turns it on.
 */
export function queue<T = unknown>(key: string, options: QueueOptions = {}): QueueHandle<T> {
    const handle = declareResource("queue", key, options);

    return {
        ...handle,
        toString() { return key; },
        async enqueue(payload: T, enqueueOptions?: QueueEnqueueOptions): Promise<{ id: string }> {
            const runtime = queueRuntimeHolder.current;
            if (!runtime) {
                throw new Error(
                    `Cannot enqueue on queue "${key}": no queue runtime is installed. ` +
                    "Enqueueing works inside a running Rebase backend; this looks like config " +
                    "being evaluated outside one (a build, a script, or a test without a harness)."
                );
            }
            return runtime.enqueue(key, payload, enqueueOptions);
        },
        handler(fn: QueueHandler<T>): void {
            if (queueConsumers.has(key)) {
                throw new Error(
                    `Queue "${key}" already has a handler. A queue has exactly one consumer; ` +
                    "work that several things react to is a topic with several subscriptions."
                );
            }
            queueConsumers.set(key, { queue: key, handler: fn as QueueHandler<unknown> });
        }
    } as QueueHandle<T>;
}

// ── Handing declarations to the readers ──────────────────────────────────────

/**
 * One declaration, as the data layer's definition.
 *
 * There is exactly one of these per kind, and everything that needs a
 * definition goes through it — the frontend, the managed runtime's boot path,
 * and an ejected project's own entrypoint. That is not tidiness: the mapping
 * used to exist twice, once here and once in `@rebasepro/server`'s
 * `graphToStorageSources`, and the two disagreed. The server's copy carried a
 * bucket's `account`; this one dropped it, so a bucket declared with shared
 * credentials resolved them on the managed runtime and resolved *nothing* in an
 * ejected backend — the source was skipped and every upload to it answered 501.
 *
 * A field-by-field map is one line away from that failure at all times, so
 * there is now one line to keep right instead of two to keep equal.
 */
export function resourceToDataSource(declaration: ResourceDeclaration): DataSourceDefinition {
    return {
        // The graph and the data layer spell "the unnamed one" identically
        // today, but they are separate constants and nothing stops them
        // drifting. Mapped explicitly so a divergence is a compile error rather
        // than a default database that silently fails to bind.
        key: declaration.key === DEFAULT_RESOURCE_KEY ? DEFAULT_DATA_SOURCE_KEY : declaration.key,
        engine: declaration.engine,
        transport: declaration.transport,
        ...(typeof declaration.options.databaseId === "string"
            ? { databaseId: declaration.options.databaseId }
            : {}),
        ...(declaration.label !== undefined ? { label: declaration.label } : {})
    };
}

/** One declaration, as the storage layer's definition. See {@link resourceToDataSource}. */
export function resourceToStorageSource(declaration: ResourceDeclaration): StorageSourceDefinition {
    return {
        key: declaration.key === DEFAULT_RESOURCE_KEY ? DEFAULT_STORAGE_SOURCE_KEY : declaration.key,
        engine: declaration.engine,
        transport: declaration.transport,
        // Carried, or the declaration's `account` is accepted at the call site
        // and lost on the way to the reader — a declared option that does
        // nothing, which is the exact failure this whole model exists to remove.
        ...(typeof declaration.options.account === "string"
            ? { account: declaration.options.account }
            : {}),
        ...(declaration.label !== undefined ? { label: declaration.label } : {})
    };
}

/**
 * The declared databases, as definitions.
 *
 * Both the frontend and a project's own backend entrypoint read this. The
 * frontend needs to know which sources exist and how they are reached — a
 * `direct`-transport source is one the browser talks to itself — and it imports
 * the same config package the backend does. Without these it would mean writing
 * the list a second time, by hand, next to the declarations, which is precisely
 * the two-homes problem this model removed everywhere else.
 *
 * ```tsx
 * import "../config/resources";                 // registers them
 * import { declaredDataSources, declaredStorageSources } from "@rebasepro/types";
 *
 * <Rebase dataSources={declaredDataSources()} storageSources={declaredStorageSources()} />
 * ```
 *
 * The import is what registers them, so a bundler that drops an unused module
 * would leave this empty — hence the side-effect import above rather than a
 * bare re-export.
 */
export function declaredDataSources(): DataSourceDefinition[] {
    return declaredResources("database").map(resourceToDataSource);
}

/** The declared buckets, as definitions. */
export function declaredStorageSources(): StorageSourceDefinition[] {
    return declaredResources("bucket").map(resourceToStorageSource);
}
