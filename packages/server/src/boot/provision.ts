import { createDataSourceRegistry, resolveDataSource } from "@rebasepro/common";
import { DEFAULT_DATA_SOURCE_KEY } from "@rebasepro/types";
import type { BackendBootstrapper, CollectionConfig, DataDriver, InitializedDriver } from "@rebasepro/types";

import { createIdempotencyStore } from "../api/rest/idempotency";
import { resolveRateLimitStoreKind } from "../auth/resolve-rate-limit-store";
import { createSqlRateLimitStore } from "../auth/sql-rate-limit-store";
import { createCronStore } from "../cron/cron-store";
import { loadCollectionsFromDirectory } from "../collections/loader";
import { logger } from "../utils/logger";
import { schemaRecoveryGuidance } from "./version-skew";

/**
 * Boot-time provisioning of collection tables and their RLS policies.
 *
 * This lives outside both boot paths on purpose. It used to live inside
 * `bootFromBundle`, which meant it ran for managed tenants and for nobody else:
 * an app that ships its own image (`runtimeMode: custom`) boots by calling
 * `initializeRebaseBackend` directly and never passes through the bundle path,
 * so its collection tables were never created. That app came up serving sign-in
 * — auth bootstraps its own tables — and 500ing every `/api/data/*` route, with
 * a green deploy and no failing check anywhere. It stayed that way for weeks.
 *
 * The fix is structural rather than a second copy of the logic in the other
 * path: `createRebaseBackend` is the one function every path goes through —
 * `initializeRebaseBackend` and the bundle boot are compositions of it — so
 * provisioning belongs there, under its `provision` option, and this module is
 * what it calls.
 */

/** How the process-wide provisioning attempt turned out. */
export type ProvisionOutcome =
    /** The hook ran. `applied` counts the statements it executed. */
    | { status: "applied"; applied: number }
    /** A gate declined, with the reason already logged. */
    | { status: "skipped"; reason: string };

/**
 * What ran, in this process, before the driver looked at the database.
 *
 * Handed to `initializeDriver` so a driver's drift check can say something true
 * about why tables are missing. Without it the Postgres driver could only guess,
 * and it guessed wrong in the one case that mattered: its warning told operators
 * to "redeploy with REBASE_MIGRATE_ON_BOOT unset" and to suspect a stale driver,
 * when the real answer was that no provisioning step existed in that boot path
 * at all. Both suggestions were unactionable, and the second sent an
 * investigation after a driver that was current.
 */
export interface SchemaProvisioningReport {
    /** Whether the table-creation hook was invoked at all this boot. */
    attempted: boolean;
    /** Why it was not, when it was not — phrased to be printed verbatim. */
    reason?: string;
}

/** The subset of a bootstrapper this module needs, from either boot path. */
export interface ProvisionTarget {
    /**
     * The driver's package name, when the caller resolved one.
     *
     * Undefined for an adapter an application constructed itself: there is no
     * package to name, and inventing one misdirects — the reader would go
     * looking for a dependency to bump when the object in question was built in
     * their own source file.
     */
    driverPackage?: string;
    engine: string;
    driverVersion?: string;
    runtimeVersion?: string;
    bootstrapper: Pick<
        BackendBootstrapper,
        | "verifyConnection"
        | "ensureCollectionSchema"
        | "ensureCollectionPolicies"
        | "ensureRlsRuntime"
        | "readCollectionsSchemaVersion"
        | "stampCollectionsSchemaVersion"
    >;
    /** The data-source key this target provisions for. `(default)` for the primary. */
    key?: string;
    /** Whether this is the default source — the one auth lives on. */
    isDefault?: boolean;
    /**
     * The handle the hooks read (`internals.db`), or `undefined` to let the
     * adapter fall back to the connection it was constructed with.
     *
     * The bundle path has one because the coordinator opened the connection
     * itself; an app calling `initializeRebaseBackend` directly passed its
     * connection into the adapter and the framework never sees it.
     */
    driverResult?: InitializedDriver;
}

/**
 * Name the object that is missing a method, in a way that points somewhere.
 *
 * What is missing is the method on the ADAPTER — the only object this module
 * ever sees — which is not the same as the driver package lacking the code. So
 * a resolved package name is quoted as the adapter's *origin*, and an adapter
 * the application built itself is described as exactly that, with no package
 * name attached for the reader to go and bump.
 */
function describeAdapter(target: ProvisionTarget): string {
    return target.driverPackage
        ? `the adapter from "${target.driverPackage}" (engine "${target.engine}")`
        : `this project's "${target.engine}" adapter`;
}

/**
 * How one call to a provisioning function is run.
 *
 * `provision` is a different question from `REBASE_MIGRATE_ON_BOOT`, and both
 * are checked. That variable says whether this *deployment* provisions its own
 * schema at boot; `provision` says whether this *process* is the one that does
 * it — which only becomes a question once a deployment boots the same bundle
 * more than once (see `REBASE_ROLE`).
 */
export interface ProvisionRunOptions {
    introspecting?: boolean;
    env?: { REBASE_MIGRATE_ON_BOOT?: string };
    /** Default `true`. `false` leaves every DDL statement to another process. */
    provision?: boolean;
    /**
     * Why `provision` is `false`, when it is — phrased to follow "skipped —".
     * Defaults to the split-deployment reason, which is the only one that
     * existed before a backend could be told to provision nothing at all.
     */
    skipReason?: string;
}

/** `REBASE_MIGRATE_ON_BOOT=none` opts a deployment out of both phases. */
export function provisioningDisabled(env: { REBASE_MIGRATE_ON_BOOT?: string } = process.env): boolean {
    return (env.REBASE_MIGRATE_ON_BOOT || "ensure") === "none";
}

/**
 * `REBASE_PROVISION`: whether this deployment may change its own database.
 *
 * `false` is the answer for a database whose schema changes only through a
 * change process somebody else runs. The backend is then built with
 * `provision: false`: no table, column, index, type, function, trigger,
 * policy, role or grant is created or altered — at boot, or later by a request
 * that would have created a table on first use — and none of the bookkeeping
 * writes a provisioning boot makes (the first admin account, version stamps)
 * happens either. What the database lacks is reported, by name, instead.
 *
 * Wider than `REBASE_MIGRATE_ON_BOOT=none`, and deliberately a second
 * variable rather than a new meaning for that one. `none` has only ever turned
 * off the *collection* schema; the framework's own tables stayed current on
 * every boot, and deployments rely on that — the chart's migration-Job
 * topology runs every api pod with `none`. Widening `none` would stop those
 * pods keeping `rebase.*` current on the next upgrade, silently.
 *
 * A blank value is unset, for the same reason as `REBASE_PROVISION_ONLY`: a
 * compose file writes `${REBASE_PROVISION}` with nothing behind it all the
 * time. Anything else that is not a yes or a no is refused rather than
 * guessed at — read as `true`, a typo would leave a change-managed database
 * being changed.
 */
export function resolveProvisionEnv(env: { REBASE_PROVISION?: string } = process.env): boolean {
    // The same two spellings the boot environment's schema accepts, so a value
    // means one thing whichever entry point reads it.
    const raw = (env.REBASE_PROVISION ?? "").trim();
    if (raw === "" || raw === "true") return true;
    if (raw === "false") return false;
    throw new Error(
        `REBASE_PROVISION must be "true" or "false" (got "${env.REBASE_PROVISION}"). ` +
        "`false` keeps every schema change out of this backend's boot."
    );
}

/**
 * Create, now, the tables a serving process would otherwise create on first
 * use: the idempotency keys every keyed write needs, the cron tables the
 * hourly sweeps claim their slots in, and the shared rate-limit counters when
 * `REBASE_RATE_LIMIT_STORE=sql` asks for them.
 *
 * What a provisioning run calls. A deployment whose serving processes run with
 * `REBASE_PROVISION=false` never creates anything, so this run is the only
 * place those tables can come from — and its recorded SQL is only the whole
 * schema those processes need if it made them.
 */
export async function provisionFirstUseTables(
    driver: DataDriver,
    env: { REBASE_RATE_LIMIT_STORE?: string } = process.env
): Promise<void> {
    // The token and history sweeps claim an hourly slot here on any backend
    // with auth, crons or not.
    await createCronStore(driver)?.ensureTable();
    const idempotency = createIdempotencyStore(driver);
    if (idempotency && !(await idempotency.ensureTable())) {
        logger.warn("Provisioning: the idempotency-key table could not be created; see the error above.");
    }
    if (resolveRateLimitStoreKind(env) === "sql") {
        const rateLimits = createSqlRateLimitStore(driver);
        if (rateLimits && !(await rateLimits.ensureTable())) {
            logger.warn("Provisioning: the shared rate-limit table could not be created; see the error above.");
        }
    }
}

/** The one line a backend that provisions nothing says about it, at boot. */
export const PROVISIONING_OFF_NOTICE =
    "Provisioning is off: this backend changes nothing in its database — no tables, columns, indexes, " +
    "functions, triggers, policies, roles or grants. What the database lacks is reported below, by name.";

/** Why each provisioning step skips on such a backend, phrased to follow "skipped —". */
export const PROVISIONING_OFF_SKIP_REASON =
    "this backend changes nothing in its database (provisioning is off), so the schema is left to whatever manages it.";

/**
 * Ask the database whether it is there, before boot's first real query.
 *
 * Ordering is the whole point. Provisioning is the first thing in boot that
 * talks to the database — earlier than `initializeDriver`, which is where the
 * Postgres adapter's connection diagnosis lives — so a developer whose database
 * was not running got Drizzle's wrapper and nothing else: `Failed query:
 * [redacted]`, a stack through drizzle internals, no host, no port, no
 * `ECONNREFUSED`, and no suggestion to start the database. The diagnosis existed
 * the whole time; nothing reached it.
 *
 * A driver that cannot probe (no `verifyConnection`) is not an error: this is a
 * better first message, not a new requirement. And a probe that throws is fatal
 * for the same reason provisioning is — every path after this needs the database.
 */
export async function verifyProvisioningConnection(target: ProvisionTarget): Promise<void> {
    if (!target.bootstrapper.verifyConnection) return;
    await target.bootstrapper.verifyConnection(target.driverResult);
}

/**
 * Create any collection tables the database is missing, before serving.
 *
 * Additive only: the driver may create missing tables, columns and enum types,
 * and may never drop or rewrite. Destructive changes stay a deliberate
 * migration, because this runs unattended with nobody reading a diff.
 *
 * Every path out of here says why, at info or louder. Guaranteeing the tables
 * exist is this function's entire job, so "it declined, and said nothing" is the
 * one outcome it must never produce: a deployment that skips comes up answering
 * sign-in and 500ing every `/api/data/*` route, and the operator's only evidence
 * is what these lines print.
 *
 * Note that silence is still possible one level up — if nothing CALLS this, no
 * line is printed and the absence is the only signal. That is precisely the bug
 * this module was extracted to make structurally impossible, and it is why the
 * outcome is reported back to the driver rather than only logged.
 *
 * Failure is fatal on purpose. Booting anyway would produce exactly the state
 * this exists to prevent, and a crash-looping pod with the DDL error in its logs
 * is a far better signal than a running one that silently cannot serve.
 */
export async function provisionCollectionTables(
    collections: CollectionConfig[],
    target: ProvisionTarget,
    options: ProvisionRunOptions = {}
): Promise<ProvisionOutcome> {
    const skip = (reason: string, level: "info" | "warn" = "info"): ProvisionOutcome => {
        logger[level](`Collection schema: skipped — ${reason}`);
        return { status: "skipped",
reason };
    };

    // Checked before the mode, because it answers a different question and the
    // reader deserves the more specific reason: `REBASE_MIGRATE_ON_BOOT=none`
    // says this deployment provisions nothing, while this says this process is
    // not the one that does it.
    if (options.provision === false) {
        return skip(options.skipReason
            ?? "this process does not provision the schema — another process in this deployment owns it.");
    }
    if (provisioningDisabled(options.env ?? process.env)) {
        return skip("REBASE_MIGRATE_ON_BOOT=none, leaving the database schema untouched.");
    }
    // A project that declared no collections reads them FROM the database, so
    // there is nothing to create and creating anything would push a schema into
    // a database it was only meant to read.
    if (options.introspecting) {
        return skip("this project declares no collections, so they are read from the database rather than from code.");
    }
    if (collections.length === 0) {
        return skip("no collections resolved for this data source.");
    }
    if (!target.bootstrapper.ensureCollectionSchema) {
        // What is missing is the method on the ADAPTER — the only object boot
        // ever sees — which is not the same as the driver package lacking the
        // code. Three unrelated causes collapse into this symptom: a schemaless
        // driver, a driver too old to have it, and a driver that implements it
        // on a class the adapter never forwards. Only the middle one is a
        // version problem, so naming versions points at the wrong suspect two
        // times in three.
        return skip(
            `${describeAdapter(target)} does not expose collection-table creation. ` +
                "The driver package may well implement it on a class the adapter does not forward, so check the adapter's shape before blaming its version. " +
                "Collection tables will NOT be created, so every /api/data route will fail on a missing relation.\n" +
                schemaRecoveryGuidance(),
            "warn"
        );
    }

    const { applied } = await target.bootstrapper.ensureCollectionSchema(
        collections,
        target.driverResult as InitializedDriver,
        message => logger.debug(`schema: ${message}`)
    );
    // Only the change is news. "Up to date" is the overwhelmingly common outcome
    // and says nothing a developer can act on; at `debug` it is still there for
    // anyone diagnosing a boot.
    if (applied > 0) {
        logger.info(`Applied ${applied} additive schema change(s) before boot.`);
    } else {
        logger.debug("Collection schema is up to date.");
    }
    return { status: "applied",
applied };
}

/**
 * Apply the collections' RLS policies — the companion to
 * {@link provisionCollectionTables}, which creates the tables this makes
 * servable.
 *
 * Runs after auth is initialized, not alongside table creation: the generated
 * policies call the `auth.*` helper functions and `CREATE POLICY` validates
 * those exist. Tables without policies are not servable either — authenticated
 * requests run as a restricted role, so a read with no policy returns nothing.
 *
 * The benign gates return quietly here rather than logging the same reason
 * twice: table provisioning already ran on this same boot and explained itself.
 * The one thing this does say out loud is a driver that created tables but
 * cannot apply policies — that is the difference between a served collection and
 * a 401, and it must not pass in silence.
 */
export async function provisionCollectionPolicies(
    collections: CollectionConfig[],
    target: ProvisionTarget,
    options: ProvisionRunOptions = {}
): Promise<ProvisionOutcome> {
    if (options.provision === false) {
        // Said out loud, unlike this function's other early returns. A missing
        // policy is not a missing table: routes answer 200 with zero rows rather
        // than 500, so nothing else in the logs will point here.
        logger.info(options.skipReason
            ? `Collection RLS policies: not applied — ${options.skipReason}`
            : "Collection RLS policies: not applied by this process — another process in this deployment owns them.");
        return { status: "skipped", reason: options.skipReason ?? "another process provisions" };
    }
    if (provisioningDisabled(options.env ?? process.env)) {
        return { status: "skipped", reason: "REBASE_MIGRATE_ON_BOOT=none" };
    }
    if (options.introspecting) return { status: "skipped", reason: "collections are introspected" };
    if (collections.length === 0) return { status: "skipped", reason: "no collections" };

    if (!target.bootstrapper.ensureCollectionPolicies) {
        // Whether "no RLS" means denied or exposed depends on the driver, so the
        // wording does not promise either.
        const reason = `${describeAdapter(target)} does not apply RLS policies at boot`;
        logger.warn(
            `Collection policies: skipped — ${reason}. ` +
                "Collections are not row-secured until policies are applied — depending on the " +
                "driver's grants that means reads are denied or that they are unfiltered. " +
                "Do not serve traffic until this is resolved.\n" +
                schemaRecoveryGuidance()
        );
        return { status: "skipped",
reason };
    }

    const { applied } = await target.bootstrapper.ensureCollectionPolicies(
        collections,
        target.driverResult as InitializedDriver,
        message => logger.debug(`policies: ${message}`)
    );
    if (applied > 0) {
        logger.info(`Applied ${applied} RLS policy statement(s) before serving.`);
    } else {
        logger.debug("RLS policies are up to date.");
    }
    return { status: "applied",
applied };
}

/**
 * The collections one data source is the store for.
 *
 * A project's collections directory holds *every* collection it declares,
 * whatever source serves it — that is the point of `dataSource` routing. What
 * it is not is a list of tables for the primary to create. This used to
 * filter by *engine*, so a collection routed to a second Postgres database
 * was handed to the default one: its table was created where nothing would
 * ever read it, and the database it was routed to never got one. Every query
 * against `database("analytics")` then failed on a missing relation behind a
 * boot that had reported the schema up to date.
 *
 * So: a collection belongs to the source its `dataSource` names, or to the
 * default when it names none. The engine check stays as a guard — a
 * collection that declares an `engine` other than this source's is never its
 * table, whatever key it names — and a source of a different engine still
 * gets nothing that is not explicitly its own.
 *
 * Takes the shapes it actually reads rather than an `InitializedDataSource`, so
 * the path that has data sources and the path that has only an adapter can share
 * one implementation instead of growing a second one that drifts.
 */
export function collectionsStoredBy(
    collections: CollectionConfig[],
    source: { key: string; engine: string },
    dataSources: Array<{ key: string; engine: string }>
): CollectionConfig[] {
    const registry = createDataSourceRegistry(
        dataSources.map(s => ({ key: s.key, engine: s.engine }))
    );
    return collections.filter(collection => {
        const routedTo = collection.dataSource ?? DEFAULT_DATA_SOURCE_KEY;
        if (routedTo !== source.key) return false;
        // The collection's own `engine` is read first, and `resolveDataSource`
        // is not asked to settle it: that function lets a registered definition
        // override the collection's engine, which is the right precedence for
        // *routing* and the wrong one here — a collection declaring
        // `engine: "firestore"` and no `dataSource` would come back as the
        // default source's "postgres" and be provisioned as a table.
        const declared = collection.engine
            ?? (collection.dataSource ? resolveDataSource(collection, registry).engine : undefined);
        if (!declared) return true;
        return declared === source.engine;
    });
}

/**
 * Say what no source provisions, so a missing table is never a silent one.
 *
 * Every collection should be stored by exactly one of the sources handed in.
 * One that none claims — routed to a key no source has, or declaring an
 * engine none of them runs — is logged here by name rather than left to fail
 * on its first request.
 */
export function logUnprovisionedCollections(
    all: CollectionConfig[],
    storedBySome: Set<CollectionConfig>,
    sources: Array<{ key: string; engine: string }>
): void {
    const orphans = all.filter(c => !storedBySome.has(c));
    if (orphans.length === 0) return;
    logger.warn(
        `${orphans.length} collection(s) are stored by none of the data sources this process opened ` +
            `(${sources.map(s => `${s.key}: ${s.engine}`).join(", ")}): ` +
            `${orphans.map(c => `${c.slug}${c.dataSource ? ` → ${c.dataSource}` : ""}`).join(", ")}. ` +
            "No table is created for them here; a source reached by a provider SDK manages its own."
    );
}

/**
 * Which bootstrapper provisions, and what to call it in a message.
 *
 * The default source is the one that stores this project's collections, so it
 * is the one asked to create them; `dataSources[0]` is the bundle path's
 * equivalent of the same choice.
 *
 * `driverResult` is deliberately left undefined here. The hooks run BEFORE
 * `initializeDriver`, so there is no driver result to pass, and unlike the
 * bundle path — where the coordinator opens the connection itself — an app that
 * built its own adapter never handed the framework a connection handle. The
 * adapter has one: it was constructed with it. So the contract is that an
 * adapter falls back to its own connection when no result is supplied, which is
 * the only shape that works for both paths.
 */
export function provisionTargetFor(
    bootstrappers: BackendBootstrapper[],
    adapter?: { type: string },
    driverResult?: InitializedDriver
): ProvisionTarget {
    const primary = bootstrappers.find(b => b.isDefault) ?? bootstrappers[0];
    const engine = primary?.type ?? adapter?.type ?? "unknown";
    return {
        // Left undefined on purpose: this path is handed a constructed adapter,
        // not a resolved dependency, so there is no package name that would be
        // true. `describeAdapter` says so rather than guessing one.
        driverPackage: undefined,
        engine,
        bootstrapper: primary ?? {},
        driverResult,
        key: primary?.id ?? DEFAULT_DATA_SOURCE_KEY,
        isDefault: true
    };
}

/**
 * One provisioning target per data source, the default first.
 *
 * The default keeps the pre-init handle the bundle path supplies; every other
 * source is provisioned through its own adapter's connection, which is the
 * contract `ensureCollectionSchema` already honours when handed no result.
 */
export function provisionTargetsFor(
    bootstrappers: BackendBootstrapper[],
    adapter?: { type: string },
    driverResult?: InitializedDriver
): ProvisionTarget[] {
    const primary = provisionTargetFor(bootstrappers, adapter, driverResult);
    const others = bootstrappers
        .filter(b => b !== primary.bootstrapper)
        .map((b): ProvisionTarget => ({
            driverPackage: undefined,
            engine: b.type,
            bootstrapper: b,
            driverResult: undefined,
            key: b.id ?? b.type,
            isDefault: false
        }));
    return [primary, ...others];
}

/** Load collections for provisioning when only a directory is known. */
export async function collectionsForProvisioning(
    declared: CollectionConfig[],
    collectionsDir: string | undefined
): Promise<CollectionConfig[]> {
    if (declared.length > 0) return declared;
    if (!collectionsDir) return [];
    return loadCollectionsFromDirectory(collectionsDir);
}
