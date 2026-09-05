import { createDataSourceRegistry, resolveDataSource } from "@rebasepro/common";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

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
 * path: `initializeRebaseBackend` is the one function BOTH paths go through, so
 * provisioning belongs there, and this module is what it calls.
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
        | "readCollectionsSchemaVersion"
        | "stampCollectionsSchemaVersion"
    >;
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

/** `REBASE_MIGRATE_ON_BOOT=none` opts a deployment out of both phases. */
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
}

export function provisioningDisabled(env: { REBASE_MIGRATE_ON_BOOT?: string } = process.env): boolean {
    return (env.REBASE_MIGRATE_ON_BOOT || "ensure") === "none";
}

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
        return skip("this process does not provision the schema — another process in this deployment owns it.");
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
        logger.info(
            "Collection RLS policies: not applied by this process — another process in this deployment owns them."
        );
        return { status: "skipped", reason: "another process provisions" };
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
 * The collections a data source's engine is the store for.
 *
 * A project's collections directory holds *every* collection it declares,
 * whatever engine serves it — that is the point of `dataSource` routing. What it
 * is not is a list of tables to create: handing the whole directory to the
 * primary source's bootstrapper made a Firestore collection declared alongside
 * the Postgres ones arrive as an empty Postgres table, with RLS policies, while
 * the app went on reading its documents from Firestore.
 *
 * Excluding is deliberately conservative. A collection that names neither an
 * `engine` nor a `dataSource` belongs to whichever source is primary — the
 * "postgres" that `resolveDataSource` falls back to there is a default, not a
 * declaration, and must not exclude anything on its own. Only a collection that
 * explicitly routes to a *different* engine is dropped, so a project running two
 * sources on the same engine is unaffected.
 *
 * Takes the shapes it actually reads rather than an `InitializedDataSource`, so
 * the path that has data sources and the path that has only an adapter can share
 * one implementation instead of growing a second one that drifts.
 */
export function collectionsStoredBy(
    collections: CollectionConfig[],
    primary: { engine: string },
    dataSources: Array<{ key: string; engine: string }>
): CollectionConfig[] {
    const registry = createDataSourceRegistry(
        dataSources.map(source => ({ key: source.key, engine: source.engine }))
    );
    return collections.filter(collection => {
        // The collection's own `engine` is read first, and `resolveDataSource`
        // is not asked to settle it: that function lets a registered definition
        // override the collection's engine, which is the right precedence for
        // *routing* and the wrong one here — a collection declaring
        // `engine: "firestore"` and no `dataSource` would come back as the
        // default source's "postgres" and be provisioned as a table.
        const declared = collection.engine
            ?? (collection.dataSource ? resolveDataSource(collection, registry).engine : undefined);
        if (!declared) return true;
        return declared === primary.engine;
    });
}

/** Say what was routed elsewhere, so a missing table is never a silent one. */
export function logForeignCollections(
    all: CollectionConfig[],
    stored: CollectionConfig[],
    primary: { engine: string }
): void {
    if (stored.length === all.length) return;
    const foreign = all.filter(c => !stored.includes(c)).map(c => c.slug);
    logger.info(
        `Skipping ${foreign.length} collection(s) served by another engine, not "${primary.engine}": ${foreign.join(", ")}. ` +
            "Their storage is not managed by this data source."
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
        driverResult
    };
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
