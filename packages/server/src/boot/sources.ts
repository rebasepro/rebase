import {
    DEFAULT_DATA_SOURCE_KEY,
    DEFAULT_STORAGE_SOURCE_KEY,
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

/**
 * Convert a source key into the suffix used in environment variable names.
 *
 * The default key maps to no suffix at all, which is what keeps every existing
 * single-database deployment working untouched.
 */
export function envSuffixForKey(key: string, defaultKey: string): string {
    if (!key || key === defaultKey) return "";
    const normalized = key
        .replace(/[^A-Za-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .toUpperCase();
    if (!normalized) {
        throw new BundleError(
            `Source key "${key}" cannot be turned into an environment variable name.`,
            "Use a key containing at least one letter or digit."
        );
    }
    return `__${normalized}`;
}

/** Read `<base>` for the default source, `<base>__<KEY>` for a named one. */
function readVar(env: EnvBag, base: string, suffix: string): string | undefined {
    const value = env[`${base}${suffix}`];
    return value === "" ? undefined : value;
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
function assertDistinctSuffixes(
    definitions: { key: string }[],
    defaultKey: string,
    what: string
): void {
    const seen = new Map<string, string>();
    for (const def of definitions) {
        const suffix = envSuffixForKey(def.key, defaultKey);
        const existing = seen.get(suffix);
        if (existing !== undefined && existing !== def.key) {
            throw new BundleError(
                `${what} keys "${existing}" and "${def.key}" both map to the same environment ` +
                `variable suffix "${suffix || "(none)"}".`,
                "Rename one of them so each source has its own configuration."
            );
        }
        seen.set(suffix, def.key);
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
    defaultBasePath: string
): BackendStorageConfig | undefined {
    const suffix = envSuffixForKey(key, DEFAULT_STORAGE_SOURCE_KEY);
    const type = (readVar(env, "STORAGE_TYPE", suffix) || engineHint || "").toLowerCase();

    if (type === "s3") {
        const bucket = readVar(env, "S3_BUCKET", suffix);
        if (!bucket) {
            throw new BundleError(
                `Storage source "${key}" is set to s3 but has no bucket — ` +
                `set ${`S3_BUCKET${suffix}`}.`
            );
        }
        return {
            type: "s3",
            bucket,
            region: readVar(env, "S3_REGION", suffix) || "auto",
            accessKeyId: readVar(env, "S3_ACCESS_KEY_ID", suffix) || "",
            secretAccessKey: readVar(env, "S3_SECRET_ACCESS_KEY", suffix) || "",
            endpoint: readVar(env, "S3_ENDPOINT", suffix),
            forcePathStyle: readBool(env, "S3_FORCE_PATH_STYLE", suffix)
        };
    }

    if (type === "gcs") {
        const bucket = readVar(env, "GCS_BUCKET", suffix);
        if (!bucket) {
            throw new BundleError(
                `Storage source "${key}" is set to gcs but has no bucket — ` +
                `set ${`GCS_BUCKET${suffix}`}.`
            );
        }
        return {
            type: "gcs",
            bucket,
            projectId: readVar(env, "GCS_PROJECT_ID", suffix),
            keyFilename: readVar(env, "GCS_KEY_FILENAME", suffix)
        };
    }

    if (type === "local" || type === "") {
        return {
            type: "local",
            basePath: readVar(env, "STORAGE_PATH", suffix) || defaultBasePath
        };
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
    defaultBasePath: string
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
    const effective: { key: string; engine?: string }[] = declared.length === 0
        ? [{ key: DEFAULT_STORAGE_SOURCE_KEY,
engine: undefined }]
        : serverSide;

    const result: Record<string, BackendStorageConfig> = {};
    for (const definition of effective) {
        const config = resolveStorageBackend(
            env,
            definition.key,
            definition.engine,
            defaultBasePath
        );
        if (config) result[definition.key] = config;
    }

    return Object.keys(result).length > 0 ? result : undefined;
}
