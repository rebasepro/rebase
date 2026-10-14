import fs from "fs";
import path from "path";
import {
    DEFAULT_DATA_SOURCE_KEY,
    DEFAULT_STORAGE_SOURCE_KEY,
    parseEnvBoolean,
    resourceEnvSuffix,
    storageEnvSuffix,
    type DataSourceDefinition,
    type StorageSourceDefinition
} from "@rebasepro/types";
import type { BackendStorageConfig } from "../storage/types";
import { storageBucketVariable } from "../storage/source-variables";
import { localStorageForced } from "../init/storage";
import { BundleError } from "./bundle";
import { logger } from "../utils/logger";

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
 * Every spelling of a key's suffix the runtime reads, the preferred first.
 *
 * Two encoders of `<BASE>__<KEY>` exist: `resourceEnvSuffix`, which the CLI and
 * the control plane write a database's variables with, and `storageEnvSuffix`,
 * which this reader was built on and the control plane writes storage variables
 * with. They agree on every key whose uppercase is letter-for-letter, and differ
 * on the rest — `straße` is `__STRASSE` to the first and `__STRA_E` to the
 * second. Both are shipped names, so both are read: the written one first, then
 * the one this reader always used. Neither is renamed.
 */
function envSuffixFormsForKey(key: string, defaultKey: string): string[] {
    const own = envSuffixForKey(key, defaultKey);
    if (!own) return [own];
    const written = resourceEnvSuffix(key);
    return written && written !== "__" && written !== own ? [written, own] : [own];
}

/**
 * Read `<base>` for the default source, `<base>__<KEY>` for a named one — under
 * each spelling in `suffixes`, the first set one winning.
 *
 * Blank — empty or whitespace only — is unset. An emptied variable is how a
 * console "removes" one, and a value of three spaces is not a bucket name;
 * treating it as one reports storage as configured for a project that has
 * none. Values with content are returned as they are: a secret's trailing
 * space is the secret's business.
 */
function readVar(env: EnvBag, base: string, suffixes: readonly string[]): string | undefined {
    for (const suffix of suffixes) {
        const value = env[`${base}${suffix}`];
        if (value !== undefined && value.trim() !== "") return value;
    }
    return undefined;
}

/** `/storage/uploads/` → `/storage/uploads`, so a suffix lands beside it, not inside. */
function withoutTrailingSeparator(dir: string): string {
    return dir.replace(/[\\/]+$/, "") || dir;
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
    suffixes: readonly string[],
    accountSuffixes: readonly string[] | undefined
): string | undefined {
    const own = readVar(env, base, suffixes);
    if (own !== undefined || accountSuffixes === undefined) return own;
    return readVar(env, base, accountSuffixes);
}

/**
 * A boolean binding, spelled the way every other variable is.
 *
 * `undefined` when unset or unrecognised, which the S3 controller reads as
 * "decide from the endpoint". An exact `=== "true"` used to turn `=1` into an
 * explicit `false`, switching path-style off for a MinIO endpoint whose
 * default would have switched it on.
 */
function readAccountBool(
    env: EnvBag,
    base: string,
    suffixes: readonly string[],
    accountSuffixes: readonly string[] | undefined
): boolean | undefined {
    return parseEnvBoolean(readAccountVar(env, base, suffixes, accountSuffixes));
}

/** Two distinct keys sharing any spelling of their suffix, or `null`. */
function findSuffixCollision(
    keys: string[],
    defaultKey: string
): { a: string; b: string; suffix: string } | null {
    const seen = new Map<string, string>();
    for (const key of keys) {
        for (const suffix of envSuffixFormsForKey(key, defaultKey)) {
            const existing = seen.get(suffix);
            if (existing !== undefined && existing !== key) return { a: existing, b: key, suffix };
            seen.set(suffix, key);
        }
    }
    return null;
}

/**
 * Guard against two distinct keys collapsing onto the same variable name.
 *
 * `media-cdn` and `media_cdn` are different source keys but the same suffix, and
 * without this check one of them would silently read the other's configuration.
 * Every spelling a key is read under counts (see `envSuffixFormsForKey`).
 */
export function assertDistinctSuffixes(
    definitions: { key: string }[],
    defaultKey: string,
    what: string
): void {
    const collision = findSuffixCollision(definitions.map(d => d.key), defaultKey);
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
    /** The source's direct (non-pooled) URL, for the connections that hold a `LISTEN`. */
    directConnectionString?: string;
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
        const suffixes = envSuffixFormsForKey(definition.key, DEFAULT_DATA_SOURCE_KEY);
        // Named in errors: the spelling the CLI and the control plane write.
        const suffix = suffixes[0];
        const connectionString = readVar(env, "DATABASE_URL", suffixes);

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
            readVar(env, "REBASE_DRIVER", suffixes) ||
            ENGINE_DRIVERS[engine.toLowerCase()];

        if (!driverPackage) {
            throw new BundleError(
                `No driver package is known for engine "${engine}" (data source "${definition.key}") — ` +
                `set ${`REBASE_DRIVER${suffix}`} to the npm package implementing it.`
            );
        }

        const poolConfig = resolvePoolConfig(env, suffixes);

        resolved.push({
            key: definition.key,
            engine,
            driverPackage,
            connectionString,
            adminConnectionString: readVar(env, "ADMIN_CONNECTION_STRING", suffixes),
            readConnectionString: readVar(env, "DATABASE_READ_URL", suffixes),
            directConnectionString: readVar(env, "DATABASE_DIRECT_URL", suffixes),
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

function resolvePoolConfig(env: EnvBag, suffixes: readonly string[]): Record<string, number> | undefined {
    const entries: Record<string, number> = {};
    const max = readVar(env, "DB_POOL_MAX", suffixes);
    const idle = readVar(env, "DB_POOL_IDLE_TIMEOUT", suffixes);
    const connect = readVar(env, "DB_POOL_CONNECT_TIMEOUT", suffixes);

    if (max !== undefined) entries.max = Number(max);
    if (idle !== undefined) entries.idleTimeoutMillis = Number(idle);
    if (connect !== undefined) entries.connectionTimeoutMillis = Number(connect);

    for (const [name, value] of Object.entries(entries)) {
        if (!Number.isFinite(value)) {
            throw new BundleError(`Pool setting "${name}" for suffix "${suffixes[0] || "(default)"}" is not a number.`);
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
 * `STORAGE_MAX_FILE_SIZE[__KEY]`: a whole number of bytes, at least 1, or
 * unset. Refused at boot otherwise — `10MB` or `0` taken as a number would be
 * a limit nobody chose, discovered on the first upload.
 */
function readMaxFileSize(env: EnvBag, suffixes: readonly string[], suffix: string): number | undefined {
    const raw = readVar(env, "STORAGE_MAX_FILE_SIZE", suffixes);
    if (raw === undefined) return undefined;
    const trimmed = raw.trim();
    const value = /^\d+$/.test(trimmed) ? Number(trimmed) : NaN;
    if (!Number.isSafeInteger(value) || value < 1) {
        throw new BundleError(
            `STORAGE_MAX_FILE_SIZE${suffix} must be a whole number of bytes, got "${raw}".`,
            "For example 209715200 for 200 MB. Unset, a source accepts files up to 50 MB."
        );
    }
    return value;
}

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
    const suffixes = envSuffixFormsForKey(key, DEFAULT_STORAGE_SOURCE_KEY);
    // This reader's own spelling. It names the local directory below, which
    // holds files already written, so it is never re-derived another way.
    const suffix = envSuffixForKey(key, DEFAULT_STORAGE_SOURCE_KEY);
    // Every local source gets a directory of its own. Two sources sharing
    // `defaultBasePath` shared one namespace — a file uploaded to `media` was
    // readable through the default source, and the only sign was that it
    // worked. The default keeps the plain path, so nothing an existing
    // deployment wrote moves; a named source appends its key the way its
    // variables do: `uploads__media`.
    //
    // Beside the directory the default actually uses, which is `STORAGE_PATH`
    // when that is set. Derived from `defaultBasePath` instead, a named source
    // ignored `STORAGE_PATH` and landed in the runtime's bundle directory —
    // the container's own filesystem in the self-host compose file, and
    // emptied by every `rebase build` — while the default sat on the volume.
    // Beside it, one volume mounted over their parent holds every source.
    const defaultDirectory = withoutTrailingSeparator(readVar(env, "STORAGE_PATH", [""]) ?? defaultBasePath);
    const localBasePath = readVar(env, "STORAGE_PATH", suffixes)
        || (suffix ? `${defaultDirectory}${suffix.toLowerCase()}` : defaultBasePath);
    // An object store the project declared and the environment did not bind.
    // In production that is "not configured" and stays so — the console's
    // "declared, not configured" state, and a 501 rather than a file written
    // to a disk about to be erased. In development it is the first five
    // minutes of a project, and demanding MinIO to upload one file is the
    // second step this model exists to remove: the source resolves to a local
    // directory and says which engine it is standing in for.
    const standIn = (engine: string): BackendStorageConfig | undefined =>
        options.production === false
            ? withLimit({ type: "local", basePath: localBasePath, standsInFor: engine })
            : undefined;
    // The account's own suffix, derived by the same rule as a source key's, so
    // `account: "minio"` reads `S3_ACCESS_KEY_ID__MINIO`. Undefined when the
    // source named no account, which switches the fallback off entirely.
    const accountSuffix = accountHint
        ? envSuffixForKey(accountHint, DEFAULT_STORAGE_SOURCE_KEY)
        : undefined;
    const accountSuffixes = accountHint
        ? envSuffixFormsForKey(accountHint, DEFAULT_STORAGE_SOURCE_KEY)
        : undefined;
    const declaredType = readVar(env, "STORAGE_TYPE", suffixes);
    const type = (declaredType || engineHint || "").trim().toLowerCase();
    // The largest file this source accepts. Per source, like everything else
    // here, and never inherited by a named source from the default one: a
    // media bucket for video and an avatar bucket want different numbers.
    // Every upload door reads it — see `StorageController.maxFileSize`.
    const maxFileSize = readMaxFileSize(env, suffixes, suffix);
    const withLimit = <T extends BackendStorageConfig>(config: T): T =>
        maxFileSize === undefined ? config : { ...config, maxFileSize };
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
        const bucket = readVar(env, "S3_BUCKET", suffixes);
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
        const accessKeyId = readAccountVar(env, "S3_ACCESS_KEY_ID", suffixes, accountSuffixes);
        const secretAccessKey = readAccountVar(env, "S3_SECRET_ACCESS_KEY", suffixes, accountSuffixes);
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

        return withLimit({
            type: "s3",
            bucket,
            region: readAccountVar(env, "S3_REGION", suffixes, accountSuffixes) || "auto",
            accessKeyId,
            secretAccessKey,
            endpoint: readAccountVar(env, "S3_ENDPOINT", suffixes, accountSuffixes),
            forcePathStyle: readAccountBool(env, "S3_FORCE_PATH_STYLE", suffixes, accountSuffixes)
        });
    }

    if (type === "gcs") {
        const bucket = readVar(env, "GCS_BUCKET", suffixes);
        if (!bucket) {
            if (!explicit) return standIn("gcs");
            throw new BundleError(
                `Storage source "${key}" is set to gcs but has no bucket — ` +
                `set ${`GCS_BUCKET${suffix}`}.`
            );
        }
        return withLimit({
            type: "gcs",
            bucket,
            // Account-scoped for the same reason as the S3 credentials: the
            // GCP project and the service-account key file describe who is
            // calling, not which bucket. Both stay optional — on GKE the
            // ambient workload identity supplies them and neither is set.
            projectId: readAccountVar(env, "GCS_PROJECT_ID", suffixes, accountSuffixes),
            keyFilename: readAccountVar(env, "GCS_KEY_FILENAME", suffixes, accountSuffixes)
        });
    }

    if (type === "local") {
        return withLimit({ type: "local", basePath: localBasePath });
    }
    if (type === "") {
        return withLimit({ type: "local", basePath: localBasePath, implicit: true });
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
 *
 * The default source — where an upload naming no `storageSource` goes — reads
 * its own configuration whatever else is declared: `STORAGE_TYPE`,
 * `STORAGE_PATH` (else `defaultBasePath`) and the unsuffixed `S3_*` / `GCS_*`.
 * Declaring `bucket("media")` adds a source; it never moves the files the
 * default already holds. Only the author re-points the default, by declaring
 * it or by marking one named bucket `default: true`.
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

    // Which bucket receives an unqualified upload is the author's decision,
    // made with `default: true`. Two claimants is a contradiction and refuses.
    const claimants = serverSide.filter(d => d.default === true);
    if (claimants.length > 1) {
        throw new BundleError(
            `${claimants.length} storage sources declare \`default: true\`: ` +
            `${claimants.map(d => `"${d.key}"`).join(", ")}.`,
            "Exactly one bucket serves uploads that name no `storageSource`. Remove the flag from all but one."
        );
    }

    // The default source is synthesized from its own variables unless the
    // project declared it (like any transport: a `direct` default is one this
    // backend does not serve) or handed its key to a named bucket. In
    // production an unbound default resolves to local disk and is dropped like
    // any other, so its uploads answer 501 — the same verdict it had before a
    // named bucket existed, and the one the control plane's build log reads
    // from the same unsuffixed variables.
    const declaresDefault = declared.some(d => d.key === DEFAULT_STORAGE_SOURCE_KEY);
    const effective: { key: string; engine?: string; account?: string; default?: boolean }[] =
        declaresDefault || claimants.length === 1
            ? serverSide
            : [{ key: DEFAULT_STORAGE_SOURCE_KEY, engine: undefined }, ...serverSide];

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
        if (!config) {
            // Declared, and nothing on this deployment binds it. Said at boot,
            // naming the variable: the first sign used to be a 501 on the first
            // upload, whose message did not name it either.
            logger.warn(
                `Storage source "${definition.key}" is declared but not configured on this deployment, ` +
                `so every request to it answers 501. Set ${storageBucketVariable(definition.key, definition.engine)} ` +
                "(and its credentials) and redeploy."
            );
            continue;
        }
        result[definition.key] = config;
        warnOnLeftBehindDirectory(env, definition.key, config, defaultBasePath);
        // `default: true` binds the same backend under the default key as well,
        // so an unqualified upload reaches it. Registered rather than renamed:
        // the source keeps its own key, its own `__SUFFIX` variables and its own
        // place in the graph, and only gains a second name.
        if (definition.default === true && definition.key !== DEFAULT_STORAGE_SOURCE_KEY) {
            result[DEFAULT_STORAGE_SOURCE_KEY] = config;
        }
    }

    assertNoSharedLocation(result, env, options);

    return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Where a resolved source keeps its files, as one comparable string, or
 * `undefined` for one that will not serve in this process.
 *
 * A local directory is compared by its resolved path, and also matches any
 * directory inside it: `{basePath}/{bucket}/{key}` is the layout, so a source
 * nested in another's directory is one of its buckets. An object store is its
 * bucket on its endpoint — the same name on two providers is two buckets.
 */
function storageLocation(
    config: BackendStorageConfig,
    env: EnvBag,
    options: ResolveStorageOptions
): { describe: string; variable: string; local?: string; remote?: string } | undefined {
    if (config.type === "local") {
        // Production drops a local backend unless a durable volume is
        // acknowledged, so two such configurations share nothing at runtime.
        if (options.production !== false && !localStorageForced(env)) return undefined;
        const resolved = path.resolve(config.basePath);
        return { describe: resolved, variable: "STORAGE_PATH", local: resolved };
    }
    if (config.type === "s3") {
        const endpoint = (config.endpoint ?? "").trim().replace(/\/+$/, "").toLowerCase();
        return {
            describe: `s3 bucket "${config.bucket}"${endpoint ? ` at ${endpoint}` : ""}`,
            variable: "S3_BUCKET",
            remote: `s3|${endpoint}|${config.bucket}`
        };
    }
    if (config.type === "gcs") {
        return { describe: `gcs bucket "${config.bucket}"`, variable: "GCS_BUCKET", remote: `gcs|${config.bucket}` };
    }
    return undefined;
}

function isSameOrInside(a: string, b: string): boolean {
    return a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}

/**
 * Refuse two sources that would keep their files in one place.
 *
 * Two sources over one directory or one bucket are one namespace under two
 * names: a file uploaded to `media` is listed, served and deletable through
 * the default, and `rebase storage move` between them copies a directory onto
 * itself. Nothing fails, so nothing would tell the developer. A source aliased
 * with `default: true` is one backend with a second name, not two, and is
 * skipped.
 */
function assertNoSharedLocation(
    resolved: Record<string, BackendStorageConfig>,
    env: EnvBag,
    options: ResolveStorageOptions
): void {
    const seen: { key: string; config: BackendStorageConfig; location: NonNullable<ReturnType<typeof storageLocation>> }[] = [];
    for (const [key, config] of Object.entries(resolved)) {
        const location = storageLocation(config, env, options);
        if (!location) continue;
        const other = seen.find(entry => entry.config !== config && (
            location.local !== undefined && entry.location.local !== undefined
                ? isSameOrInside(location.local, entry.location.local)
                : location.remote !== undefined && location.remote === entry.location.remote
        ));
        if (other) {
            // Name the named source first: the default's location is the one
            // with files in it already, so the other is the one to move.
            const [moved, kept] = key === DEFAULT_STORAGE_SOURCE_KEY ? [other.key, key] : [key, other.key];
            const movedLocation = moved === key ? location : other.location;
            const variable = `${movedLocation.variable}${envSuffixForKey(moved, DEFAULT_STORAGE_SOURCE_KEY)}`;
            throw new BundleError(
                `Storage sources "${moved}" and "${kept}" would both store files in ${movedLocation.describe}, ` +
                "so each would list, serve and delete the other's files.",
                `Give "${moved}" a ${movedLocation.local !== undefined ? "directory" : "bucket"} of its own ` +
                `with ${variable}.` +
                (kept === DEFAULT_STORAGE_SOURCE_KEY
                    ? ` If uploads that name no \`storageSource\` belong in "${moved}", mark it instead — ` +
                      `bucket("${moved}", { default: true }).`
                    : "")
            );
        }
        seen.push({ key, config, location });
    }
}

/**
 * Say where a named local source's files went, when they did not come along.
 *
 * Such a source once derived its directory from `defaultBasePath` even when
 * `STORAGE_PATH` moved the default elsewhere; it now sits beside the default.
 * Where the two differ and the old directory holds files, those files are no
 * longer served. Nothing deletes them, and nothing else would say where they are.
 */
function warnOnLeftBehindDirectory(
    env: EnvBag,
    key: string,
    config: BackendStorageConfig,
    defaultBasePath: string
): void {
    if (config.type !== "local" || key === DEFAULT_STORAGE_SOURCE_KEY) return;
    if (readVar(env, "STORAGE_PATH", [""]) === undefined) return;
    if (readVar(env, "STORAGE_PATH", envSuffixFormsForKey(key, DEFAULT_STORAGE_SOURCE_KEY)) !== undefined) return;
    const suffix = envSuffixForKey(key, DEFAULT_STORAGE_SOURCE_KEY);
    const before = path.resolve(`${defaultBasePath}${suffix.toLowerCase()}`);
    const now = path.resolve(config.basePath);
    // Compared as real paths: `/var` and `/private/var` are one directory.
    const real = (dir: string): string | undefined => {
        try {
            return fs.realpathSync(dir);
        } catch {
            return undefined;
        }
    };
    const realBefore = real(before);
    if (realBefore === undefined || realBefore === real(now)) return;
    try {
        if (fs.readdirSync(realBefore).length === 0) return;
    } catch {
        return;
    }
    logger.warn(
        `Storage source "${key}" now keeps its files in ${now}, beside STORAGE_PATH, and ${before} ` +
        "still holds files an earlier version wrote there, which are no longer served. Move them into " +
        `${now}, or set STORAGE_PATH${suffix}=${before} to keep serving them from where they are.`
    );
}
