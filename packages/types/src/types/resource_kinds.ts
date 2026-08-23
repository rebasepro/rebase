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
    registerResourceKind,
    type DeclareOptions,
    type ResourceHandle
} from "./resources";

// ── database ─────────────────────────────────────────────────────────────────

registerResourceKind({
    kind: "database",
    engines: ["postgres", "mongodb", "firestore", "sqlite"],
    defaultEngine: "postgres",
    // REBASE_DRIVER overrides the engine's default driver package; the pool
    // ceiling is per-source because one source can be a single-session PGlite
    // and another a real server.
    envBases: ["DATABASE_URL", "REBASE_DRIVER", "REBASE_DB_POOL_MAX"],
    // No per-engine narrowing: every engine binds from the same three, and the
    // driver package that differs between them is named by REBASE_DRIVER either
    // way.
    optionKeys: ["databaseId", "migrations"],
    // A backend without a database is not a backend, so one exists whether or
    // not a project says so.
    implicitDefault: true
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
}

/** A database handle. Collections point at it via `dataSource`. */
export type DatabaseHandle = ResourceHandle;

/**
 * Declare a database.
 *
 * ```ts
 * export const main      = database();               // the default one
 * export const analytics = database("analytics");    // reads DATABASE_URL__ANALYTICS
 * ```
 */
export function database(key: string = DEFAULT_RESOURCE_KEY, options: DatabaseOptions = {}): DatabaseHandle {
    return declareResource("database", key, options);
}

// ── bucket ───────────────────────────────────────────────────────────────────

registerResourceKind({
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
    optionKeys: ["publicRead", "prefix"],
    // Storage is genuinely optional: plenty of projects store nothing.
    implicitDefault: false
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
}

/** A bucket handle. Storage properties point at it via `storageSource`. */
export type BucketHandle = ResourceHandle;

/**
 * Declare a bucket.
 *
 * ```ts
 * export const media = bucket("media", { transport: "direct" });
 * ```
 *
 * `transport: "direct"` means a provider SDK talks to the bucket and the
 * backend is not in the upload path.
 */
export function bucket(key: string = DEFAULT_RESOURCE_KEY, options: BucketOptions = {}): BucketHandle {
    return declareResource("bucket", key, options);
}

// ── topic ────────────────────────────────────────────────────────────────────

registerResourceKind({
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
