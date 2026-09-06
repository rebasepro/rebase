import {
    DEFAULT_DATA_SOURCE_KEY,
    DEFAULT_STORAGE_SOURCE_KEY,
    findStorageSuffixCollision,
    storageEnvSuffix,
    type DataSourceDefinition,
    type StorageSourceDefinition
} from "@rebasepro/types";
import type { BackendStorageConfig } from "../storage/types";
import { BundleError } from "./bundle";

/**
 * Resolving *named* data and storage sources from the environment.
 *
 * A project is not required to have one database and one bucket. Collections
 * already route by `collection.dataSource`, storage properties already route by
 * `storageSource`, and the backend already registers one driver per source key —
 * so the only piece missing was a way to *configure* the second, third and fourth
 * of each without hand-writing an entrypoint.
 *
 * The naming rule is mechanical, and deliberately derives the variable name from
 * the declared key rather than trying to discover keys by scanning the
 * environment. Scanning would have to guess how `DATABASE_URL_READ_REPLICA` splits
 * into a key; deriving cannot be ambiguous, and a typo shows up as a missing
 * source at boot instead of a silently ignored variable.
 *
 * ```
 *   <BASE>            the default source        DATABASE_URL, S3_BUCKET
 *   <BASE>__<KEY>     a named source            DATABASE_URL__ANALYTICS, S3_BUCKET__MEDIA
 * ```
 *
 * The double underscore matters: single-underscore suffixes collide with real
 * variable names (`S3_BUCKET_NAME` would parse as bucket "name").
 */

/** Environment lookup, injectable so tests need not mutate `process.env`. */
export type EnvBag = Record<string, string | undefined>;

/** What the resolver needs to know about the process it resolves for. */
export interface ResolveStorageOptions {
    /**
     * Whether this is a production process. `false` lets a declared object
     * store nothing bound stand in as a local directory; `true` or unknown
     * leaves it unbound. Unknown is treated as production on purpose — a
     * process that has not said it is development must not be handed a disk.
     */
    production?: boolean;
}

/**
 * Convert a source key into the suffix used in environment variable names.
 *
 * The default key maps to no suffix at all, which is what keeps every existing
 * single-database deployment working untouched.
 *
 * The rule itself lives in `@rebasepro/types` so the CLI and any control plane
 * derive identical names from identical keys; this wrapper exists only to raise
 * it as a `BundleError`, which is what the rest of boot reports failures as.
 */
export function envSuffixForKey(key: string, defaultKey: string): string {
    try {
        return storageEnvSuffix(key, defaultKey);
    } catch (err) {
        throw new BundleError(
            `Source key "${key}" cannot be turned into an environment variable name.`,
            "Use a key containing at least one letter or digit."
        );
    }
}

/**
 * Read `<base>` for the default source, `<base>__<KEY>` for a named one.
 *
 * Blank — empty or whitespace only — is unset. An emptied variable is how a
 * console "removes" one, and a value of three spaces is not a bucket name;
 * treating it as one reports storage as configured for a project that has
 * none. Values with content are returned as they are: a secret's trailing
 * space is the secret's business.
 */
function readVar(env: EnvBag, base: string, suffix: string): string | undefined {
    const value = env[`${base}${suffix}`];
    return value === undefined || value.trim() === "" ? undefined : value;
}

/**
 * Read a binding that may be shared across sources on one account.
 *
 * Two forms, in order: this source's own `<BASE>__<KEY>`, then the account's
 * `<BASE>__<ACCOUNT>`. There is deliberately no third form falling through to
 * the bare `<BASE>` — that variable belongs to the *default* source, and a named
 * bucket inheriting it would mean a typo'd key silently signs with another
 * source's credentials.
 *
 * A source that named no account gets exactly one lookup, so every project that
 * predates this reads the same variables it always did.
 */
function readAccountVar(
    env: EnvBag,
    base: string,
    suffix: string,
    accountSuffix: string | undefined
): string | undefined {
    const own = readVar(env, base, suffix);
    if (own !== undefined || accountSuffix === undefined) return own;
    return readVar(env, base, accountSuffix);
}

function readAccountBool(
    env: EnvBag,
    base: string,
    suffix: string,
    accountSuffix: string | undefined
): boolean | undefined {
    const raw = readAccountVar(env, base, suffix, accountSuffix);
    if (raw === undefined) return undefined;
    return raw === "true";
}

function readBool(env: EnvBag, base: string, suffix: string): boolean | undefined {
    const raw = readVar(env, base, suffix);
    if (raw === undefined) return undefined;
    return raw === "true";
}

/**
 * Guard against two distinct keys collapsing onto the same variable name.
 *
 * `media-cdn` and `media_cdn` are different source keys but the same suffix, and
 * without this check one of them would silently read the other's configuration.
 */
export function assertDistinctSuffixes(
    definitions: { key: string }[],
    defaultKey: string,
    what: string
): void {
    const collision = findStorageSuffixCollision(definitions.map(d => d.key), defaultKey);
    if (collision) {
        throw new BundleError(
            `${what} keys "${collision.a}" and "${collision.b}" both map to the same environment ` +
            `variable suffix "${collision.suffix || "(none)"}".`,
            "Rename one of them so each source has its own configuration."
        );
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Data sources
// ─────────────────────────────────────────────────────────────────────────────

/** Which driver package backs a given engine, before env overrides. */
const ENGINE_DRIVERS: Record<string, string> = {
    postgres: "@rebasepro/server-postgres",
    postgresql: "@rebasepro/server-postgres",
    mongodb: "@rebasepro/server-mongo",
    mongo: "@rebasepro/server-mongo"
};

/** A data source resolved to everything needed to build a driver for it. */
export interface ResolvedDataSourceConfig {
    /** Data-source key — becomes the driver-registry id collections route by. */
    key: string;
    engine: string;
    /** npm package implementing the driver. */
    driverPackage: string;
    connectionString: string;
    adminConnectionString?: string;
    readConnectionString?: string;
    isDefault: boolean;
    poolConfig?: Record<string, number>;
}

/**
 * Resolve every server-transport data source to a connection.
 *
 * `direct` and `custom` transports are skipped: the client talks to those
 * itself, so the backend holds no connection for them and must not demand one.
 *
 * A declared source with no connection string is an error rather than a warning.
 * The alternative — starting without it — means every collection routed to that
 * source silently falls back to the default database, which is data landing in
 * the wrong place with a healthy-looking server in front of it.
 */
export function resolveDataSources(
    env: EnvBag,
    definitions: DataSourceDefinition[] | undefined
): ResolvedDataSourceConfig[] {
    const declared = definitions ?? [];
    assertDistinctSuffixes(declared, DEFAULT_DATA_SOURCE_KEY, "Data source");

    // A project that declares nothing still has one database: the default.
    const hasDefault = declared.some(d => d.key === DEFAULT_DATA_SOURCE_KEY);
    const serverSide = declared.filter(d => (d.transport ?? "server") === "server");
    const effective: DataSourceDefinition[] = hasDefault
        ? serverSide
        : [{ key: DEFAULT_DATA_SOURCE_KEY,
engine: "postgres" }, ...serverSide];

    const resolved: ResolvedDataSourceConfig[] = [];

    for (const definition of effective) {
        const suffix = envSuffixForKey(definition.key, DEFAULT_DATA_SOURCE_KEY);
        const connectionString = readVar(env, "DATABASE_URL", suffix);

        if (!connectionString) {
            throw new BundleError(
                `Data source "${definition.key}" has no connection string — ` +
                `set ${`DATABASE_URL${suffix}`}.`,
                "Every declared server-transport data source needs its own connection; " +
                "collections routed to it would otherwise silently use the default database."
            );
        }

        const engine = definition.engine || "postgres";
        const driverPackage =
            readVar(env, "REBASE_DRIVER", suffix) ||
            ENGINE_DRIVERS[engine.toLowerCase()];

        if (!driverPackage) {
            throw new BundleError(
                `No driver package is known for engine "${engine}" (data source "${definition.key}") — ` +
                `set ${`REBASE_DRIVER${suffix}`} to the npm package implementing it.`
            );
        }

        const poolConfig = resolvePoolConfig(env, suffix);

        resolved.push({
            key: definition.key,
            engine,
            driverPackage,
            connectionString,
            adminConnectionString: readVar(env, "ADMIN_CONNECTION_STRING", suffix),
            readConnectionString: readVar(env, "DATABASE_READ_URL", suffix),
            isDefault: definition.key === DEFAULT_DATA_SOURCE_KEY,
            poolConfig
        });
    }

    if (!resolved.some(r => r.isDefault)) {
        // A default declared as `direct` still fails here, and must: the driver
        // registry promotes whatever driver it has to be the default, so a
        // project in that shape would route every collection that names no data
        // source into some *other* project database. Refusing is the only
        // outcome that cannot silently write to the wrong place.
        const directDefault = declared.some(
            d => d.key === DEFAULT_DATA_SOURCE_KEY && (d.transport ?? "server") !== "server"
        );
        throw new BundleError(
            directDefault
                ? `The default data source is declared with a non-server transport, so the backend ` +
                  "holds no connection for it — but collections that name no data source still need one."
                : "No default data source is configured.",
            directDefault
                ? `Give "${DEFAULT_DATA_SOURCE_KEY}" a server transport and set DATABASE_URL, or point ` +
                  "every collection at an explicit dataSource."
                : `Declare a data source with key "${DEFAULT_DATA_SOURCE_KEY}", or set DATABASE_URL.`
        );
    }

    return resolved;
}

function resolvePoolConfig(env: EnvBag, suffix: string): Record<string, number> | undefined {
    const entries: Record<string, number> = {};
    const max = readVar(env, "DB_POOL_MAX", suffix);
    const idle = readVar(env, "DB_POOL_IDLE_TIMEOUT", suffix);
    const connect = readVar(env, "DB_POOL_CONNECT_TIMEOUT", suffix);

    if (max !== undefined) entries.max = Number(max);
    if (idle !== undefined) entries.idleTimeoutMillis = Number(idle);
    if (connect !== undefined) entries.connectionTimeoutMillis = Number(connect);

    for (const [name, value] of Object.entries(entries)) {
        if (!Number.isFinite(value)) {
            throw new BundleError(`Pool setting "${name}" for suffix "${suffix || "(default)"}" is not a number.`);
        }
    }

    return Object.keys(entries).length > 0 ? entries : undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage sources
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The storage bindings that describe the PROVIDER rather than the bucket.
 *
 * These are the ones a source's `account` lets it share: naming an account
 * makes them fall back to `<BASE>__<ACCOUNT>` when no per-key value is set.
 * `S3_BUCKET` and `GCS_BUCKET` are deliberately absent — the bucket name is
 * what distinguishes one source from another and must never fall back — and so
 * are `STORAGE_TYPE` and `STORAGE_PATH`, which describe this source alone.
 *
 * Exported because `rebase status` has to tell a developer *which* variable a
 * bucket is actually waiting on, and deriving that list a second time is how it
 * would come to disagree with the resolver below. `resource-env-bases.test.ts`
 * holds it to the reader each base is passed to.
 */
export const ACCOUNT_SCOPED_STORAGE_BASES = [
    "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY",
    "S3_REGION",
    "S3_ENDPOINT",
    "S3_FORCE_PATH_STYLE",
    "GCS_PROJECT_ID",
    "GCS_KEY_FILENAME"
] as const;

/**
 * Build one storage configuration from the variables for a single source.
 *
 * Returns `undefined` when the source has no configuration at all, so an
 * optional bucket that was never set does not fail a boot. The production
 * "local storage is off" rule deliberately does *not* live here — it is enforced
 * once, in `initializeStorage`, which logs precisely why storage is disabled.
 * Duplicating it would mean two places to keep in agreement.
 */
export function resolveStorageBackend(
    env: EnvBag,
    key: string,
    engineHint: string | undefined,
    defaultBasePath: string,
    /**
     * The credential set this source shares, from its declaration. Only the
     * account-scoped bindings — the ones describing the provider rather than the
     * bucket — consult it. See `StorageSourceDefinition.account`.
     */
    accountHint?: string,
    options: ResolveStorageOptions = {}
): BackendStorageConfig | undefined {
    const suffix = envSuffixForKey(key, DEFAULT_STORAGE_SOURCE_KEY);
    // Every local source gets a directory of its own. Two sources sharing
    // `defaultBasePath` shared one namespace — a file uploaded to `media` was
    // readable through the default source, and the only sign was that it
    // worked. The default keeps the plain path, so nothing an existing
    // deployment wrote moves; a named source appends its key the way its
    // variables do: `uploads__media`.
    const localBasePath = readVar(env, "STORAGE_PATH", suffix)
        || (suffix ? `${defaultBasePath}${suffix.toLowerCase()}` : defaultBasePath);
    // An object store the project declared and the environment did not bind.
    // In production that is "not configured" and stays so — the console's
    // "declared, not configured" state, and a 501 rather than a file written
    // to a disk about to be erased. In development it is the first five
    // minutes of a project, and demanding MinIO to upload one file is the
    // second step this model exists to remove: the source resolves to a local
    // directory and says which engine it is standing in for.
    const standIn = (engine: string): BackendStorageConfig | undefined =>
        options.production === false
            ? { type: "local", basePath: localBasePath, standsInFor: engine }
            : undefined;
    // The account's own suffix, derived by the same rule as a source key's, so
    // `account: "minio"` reads `S3_ACCESS_KEY_ID__MINIO`. Undefined when the
    // source named no account, which switches the fallback off entirely.
    const accountSuffix = accountHint
        ? envSuffixForKey(accountHint, DEFAULT_STORAGE_SOURCE_KEY)
        : undefined;
    const declaredType = readVar(env, "STORAGE_TYPE", suffix);
    const type = (declaredType || engineHint || "").trim().toLowerCase();
    // Whether the *environment* named this backend, as opposed to inheriting it
    // from a declaration. It decides what a missing bucket means:
    //
    //   STORAGE_TYPE__MEDIA=s3 with no bucket  → someone configured this and got
    //                                            it wrong. Refuse.
    //   `rebase.json` declares media: s3, and
    //   the environment says nothing            → the bucket has not been
    //                                            attached yet. Not an error.
    //
    // Declaring a source is how a project states its topology, often long before
    // anyone attaches a bucket to it — the console's whole "declared, not
    // configured" state. Treating that as a fatal misconfiguration would make
    // the act of declaring a bucket crash-loop the backend until someone
    // configured it, which is precisely the unreadable failure the manifest
    // declaration exists to prevent.
    const explicit = Boolean(declaredType);

    if (type === "s3") {
        const bucket = readVar(env, "S3_BUCKET", suffix);
        if (!bucket) {
            if (!explicit) return standIn("s3");
            throw new BundleError(
                `Storage source "${key}" is set to s3 but has no bucket — ` +
                `set ${`S3_BUCKET${suffix}`}.`
            );
        }
        // Account-scoped: the credentials describe the PROVIDER, not the bucket.
        // Fifteen buckets on one MinIO install shared one access key and copied
        // it fifteen times before this existed.
        const accessKeyId = readAccountVar(env, "S3_ACCESS_KEY_ID", suffix, accountSuffix);
        const secretAccessKey = readAccountVar(env, "S3_SECRET_ACCESS_KEY", suffix, accountSuffix);
        // A bucket with no credentials cannot work, and failing here is far
        // clearer than what it does otherwise: `S3StorageController` passes an
        // explicit `credentials: { accessKeyId: "", secretAccessKey: "" }` to the
        // AWS SDK, which suppresses the SDK's own credential chain — so this
        // never silently falls back to an instance profile or IRSA. It signs
        // every request with nothing and fails each one separately, at upload
        // time, with an opaque signing error.
        //
        // Same rule the control plane applies when it classifies a tenant's
        // environment for the build log, so the log and the runtime agree on
        // what this configuration is.
        if (!accessKeyId || !secretAccessKey) {
            if (!explicit) return standIn("s3");
            // Names the account form too when the source declared one, because
            // that is the variable the reader would actually have accepted — an
            // error naming only the per-key name would send someone to set the
            // one they were deliberately trying not to repeat.
            const nameFor = (base: string) =>
                accountSuffix ? `${base}${suffix} or ${base}${accountSuffix}` : `${base}${suffix}`;
            const missing = [
                !accessKeyId && nameFor("S3_ACCESS_KEY_ID"),
                !secretAccessKey && nameFor("S3_SECRET_ACCESS_KEY")
            ].filter(Boolean).join(" and ");
            throw new BundleError(
                `Storage source "${key}" is set to s3 with a bucket but no credentials — set ${missing}.`,
                "A bucket without credentials cannot be reached: every upload fails when the request is signed."
            );
        }

        return {
            type: "s3",
            bucket,
            region: readAccountVar(env, "S3_REGION", suffix, accountSuffix) || "auto",
            accessKeyId,
            secretAccessKey,
            endpoint: readAccountVar(env, "S3_ENDPOINT", suffix, accountSuffix),
            forcePathStyle: readAccountBool(env, "S3_FORCE_PATH_STYLE", suffix, accountSuffix)
        };
    }

    if (type === "gcs") {
        const bucket = readVar(env, "GCS_BUCKET", suffix);
        if (!bucket) {
            if (!explicit) return standIn("gcs");
            throw new BundleError(
                `Storage source "${key}" is set to gcs but has no bucket — ` +
                `set ${`GCS_BUCKET${suffix}`}.`
            );
        }
        return {
            type: "gcs",
            bucket,
            // Account-scoped for the same reason as the S3 credentials: the
            // GCP project and the service-account key file describe who is
            // calling, not which bucket. Both stay optional — on GKE the
            // ambient workload identity supplies them and neither is set.
            projectId: readAccountVar(env, "GCS_PROJECT_ID", suffix, accountSuffix),
            keyFilename: readAccountVar(env, "GCS_KEY_FILENAME", suffix, accountSuffix)
        };
    }

    if (type === "local" || type === "") {
        return { type: "local", basePath: localBasePath };
    }

    throw new BundleError(
        `Storage source "${key}" has unsupported type "${type}".`,
        "Supported types are local, s3 and gcs. For anything else, pass a StorageController."
    );
}

/**
 * Resolve every server-transport storage source into a controller config map.
 *
 * The returned shape is the `Record<key, config>` the backend already accepts,
 * so multiple buckets need nothing new downstream — they were always supported,
 * they just had no way to be configured from the environment.
 */
export function resolveStorageSources(
    env: EnvBag,
    definitions: StorageSourceDefinition[] | undefined,
    defaultBasePath: string,
    options: ResolveStorageOptions = {}
): Record<string, BackendStorageConfig> | undefined {
    const declared = definitions ?? [];
    assertDistinctSuffixes(declared, DEFAULT_STORAGE_SOURCE_KEY, "Storage source");

    const serverSide = declared.filter(d => (d.transport ?? "server") === "server");

    // Synthesize the default bucket only when the project declared *nothing*.
    //
    // Inventing one alongside explicitly declared sources is actively harmful.
    // The synthesized default falls through to local disk; production drops local
    // backends (files written there die with the container); the storage registry
    // then promotes whichever backend remains to be the default. So a project
    // declaring only a "media" bucket would put its default uploads on local disk
    // in development and in the media bucket in production. Two different
    // destinations either side of a deploy is worse than having no default
    // bucket, which at least fails the same way in both.
    const effective: { key: string; engine?: string; account?: string; default?: boolean }[] = declared.length === 0
        ? [{ key: DEFAULT_STORAGE_SOURCE_KEY, engine: undefined }]
        : serverSide;

    // ── Which bucket receives an unqualified upload? ─────────────────────────
    //
    // The author's decision, and boot refuses without one. The registry used to
    // take it: no `(default)` storage meant "promote whichever came first", with
    // a warning. That is where a user's files land, chosen by declaration order
    // — and it gave *different answers either side of a deploy*, because a
    // synthesized local default is dropped in production and the promotion was
    // not. A project declaring only `bucket("media")` wrote to local disk in
    // development and into the media bucket in production, and nothing failed.
    //
    // Only when this process actually serves storage: a project whose buckets
    // are all `transport: "direct"` has nothing here to be the default of.
    const claimants = serverSide.filter(d => d.default === true);
    if (claimants.length > 1) {
        throw new BundleError(
            `${claimants.length} storage sources declare \`default: true\`: ` +
            `${claimants.map(d => `"${d.key}"`).join(", ")}.`,
            "Exactly one bucket serves uploads that name no `storageSource`. Remove the flag from all but one."
        );
    }
    if (serverSide.length > 0
        && claimants.length === 0
        && !serverSide.some(d => d.key === DEFAULT_STORAGE_SOURCE_KEY)) {
        const named = serverSide.map(d => `"${d.key}"`).join(", ");
        throw new BundleError(
            `This project declares ${named}, and none of them is the default bucket — so an upload ` +
            "from a storage property that names no `storageSource` has nowhere to go.",
            "In `config/resources.ts`, either mark one of them — " +
            `bucket("${serverSide[0].key}", { default: true }) — or declare the default bucket ` +
            "alongside them: export const uploads = bucket();"
        );
    }

    const result: Record<string, BackendStorageConfig> = {};
    for (const definition of effective) {
        const config = resolveStorageBackend(
            env,
            definition.key,
            definition.engine,
            defaultBasePath,
            definition.account,
            options
        );
        if (!config) continue;
        result[definition.key] = config;
        // `default: true` binds the same backend under the default key as well,
        // so an unqualified upload reaches it. Registered rather than renamed:
        // the source keeps its own key, its own `__SUFFIX` variables and its own
        // place in the graph, and only gains a second name.
        if (definition.default === true && definition.key !== DEFAULT_STORAGE_SOURCE_KEY) {
            result[DEFAULT_STORAGE_SOURCE_KEY] = config;
        }
    }

    return Object.keys(result).length > 0 ? result : undefined;
}
