/**
 * Does the schema in the database match the collections this process was built
 * from?
 *
 * A split deployment can run several processes from one bundle, and — once a
 * deployment can pin them to *different* bundles — from more than one. They all
 * share one database, and only one of them provisions it. So a process can come
 * up perfectly, pass every probe, and query a column the schema owner has not
 * created yet, or rely on a policy it has not applied. Neither fails in a way
 * anybody sees: the first is a SQL error on one route, the second is a 200 with
 * zero rows.
 *
 * The check is a stamp. The process that provisions writes the version of the
 * collections it just applied into the database; every process compares its own
 * against what it finds. Same table, same shape and the same "unstamped is not
 * an error" rule as the auth schema version, which exists for exactly this class
 * of failure one subsystem over.
 *
 * ## Why the database and not the api
 *
 * The obvious design is an HTTP call to the api's `/api/meta/schema-version`.
 * It is worse in three ways. It needs the api's address configured on every
 * other process, so it adds a variable whose absence disables the check
 * silently. It makes booting depend on another process already being up, which
 * turns a rollout ordering problem into a boot failure. And it asks the wrong
 * question: what breaks is the *database* not matching, and two processes can
 * agree with each other while both disagree with it.
 *
 * The database is also the only answer that works for a `worker`, which has no
 * reason to know any URL, and for a single `all` deployment scaled to three,
 * where there is no api to ask.
 *
 * ## Why both sides compute rather than read
 *
 * Both the stamp and the comparison are computed from the collections the
 * process actually loaded, never from the `schemaVersion` a bundle manifest
 * declares. A declared value is not evidence: `/api/meta/schema-version` returns
 * the manifest's own number verbatim when the bundle has one, which is why
 * comparing that endpoint to that manifest is a check that passes on a bundle
 * whose declared version is nonsense — verified, once, on a fixture corrupted to
 * `v1:deadbeefdeadbeef`. Computing on both sides means the comparison is between
 * two things that were derived, so agreeing means something.
 *
 * ## A driver that predates this
 *
 * The image supplies `@rebasepro/server`; the *driver* comes from the bundle,
 * pinned to whatever the project's package.json asked npm for. So a current
 * runtime routinely runs against a driver older than itself, and that driver has
 * neither hook. Absence is treated as "this driver does not record a version" —
 * the same answer as a driver that never will — and the check silently does
 * nothing rather than failing a boot over a capability the deployment cannot
 * supply. It starts working when the project's driver is next updated. See
 * `version-skew.ts` for the general shape of this problem.
 */
import { computeSchemaVersion, type CollectionConfig } from "@rebasepro/types";

import { logger } from "../utils/logger";

/** What the comparison found. */
export type SchemaStampVerdict =
    /** The database was stamped by a build with these same collections. */
    | { status: "match"; version: string }
    /**
     * Nothing has ever stamped this database.
     *
     * Not an error, and it must never become one: every database provisioned
     * before this check existed is unstamped, and so is every fresh one until
     * its first provisioning boot finishes.
     */
    | { status: "unstamped" }
    /** The database describes a different set of collections than this process. */
    | { status: "mismatch"; database: string; process: string }
    /** No comparison was possible, with the reason. */
    | { status: "skipped"; reason: string };

/** Everything the decision needs. Pure, so the decision can be tested without a database. */
export interface SchemaStampInput {
    /** The version computed from the collections this process loaded. */
    processVersion: string;
    /** What the database carries, or `null` when it has never been stamped. */
    databaseVersion: string | null;
    /**
     * Whether this process derived its collections from the database itself.
     *
     * In that mode the collections *are* the database, so the two can never
     * meaningfully disagree — and a mismatch would only ever mean two
     * introspecting processes read the schema at different moments.
     */
    introspecting?: boolean;
    /** Whether the driver can read a stamp at all. */
    supported?: boolean;
}

/**
 * Compare, without acting.
 *
 * Separated from {@link enforceSchemaStamp} because the decision is the part
 * worth testing and the part that is wrong in a way nobody sees. Every branch
 * here has a test.
 */
export function decideSchemaStamp(input: SchemaStampInput): SchemaStampVerdict {
    if (input.supported === false) {
        return { status: "skipped", reason: "this driver does not record a collections schema version" };
    }
    if (input.introspecting) {
        return {
            status: "skipped",
            reason: "collections are derived from the database, so they cannot disagree with it"
        };
    }
    if (input.databaseVersion === null) {
        return { status: "unstamped" };
    }
    if (input.databaseVersion === input.processVersion) {
        return { status: "match", version: input.processVersion };
    }
    return { status: "mismatch", database: input.databaseVersion, process: input.processVersion };
}

/**
 * A refusal to serve against a schema this process does not match.
 *
 * Its own class so the boot paths can present it as a configuration problem
 * rather than a crash, matching `RoleConfigurationError`.
 */
export class SchemaVersionMismatchError extends Error {
    constructor(readonly databaseVersion: string, readonly processVersion: string, message: string) {
        super(message);
        this.name = "SchemaVersionMismatchError";
    }
}

/** How loudly a mismatch is treated. */
export type SchemaMismatchPolicy = "warn" | "refuse";

/**
 * Read the policy from the environment.
 *
 * Warning is the default because refusing would fail a rollout *mid-flight*: for
 * the whole window between the schema owner rolling and the last unit following,
 * the units that have not rolled yet legitimately disagree. That window is
 * normal, and a deployment that turns it into a crash loop has traded a silent
 * problem for a loud outage.
 *
 * `refuse` is for the deployment that would rather not serve at all than serve
 * wrong — and for CI, where the window does not exist.
 */
export function resolveSchemaMismatchPolicy(
    env: { REBASE_REQUIRE_SCHEMA_MATCH?: string } = process.env
): SchemaMismatchPolicy {
    const raw = (env.REBASE_REQUIRE_SCHEMA_MATCH ?? "").trim().toLowerCase();
    // Blank is unset, not false: `REBASE_REQUIRE_SCHEMA_MATCH=${SOMETHING}` with
    // SOMETHING undefined is the ordinary way to write a compose file, and it is
    // how the platform neutralises a tenant's own variable.
    return raw === "true" || raw === "1" ? "refuse" : "warn";
}

/**
 * The message a mismatch prints, or throws.
 *
 * One function so the warning and the refusal say exactly the same thing — an
 * operator who raises the policy from `warn` to `refuse` should not have to
 * learn a second description of the same fact.
 */
export function describeMismatch(databaseVersion: string, processVersion: string): string {
    return (
        `The database was last provisioned from a different set of collections than this process was built from ` +
        `(database ${databaseVersion}, this process ${processVersion}).\n` +
        `  A process running ahead of the schema queries columns that do not exist yet, and relies on RLS ` +
        `policies that have not been applied —\n` +
        `  the first is a SQL error on one route, the second is an empty result with a 200. A process running ` +
        `behind is normal during a rollout.\n` +
        `  Roll the process that owns the schema first (REBASE_ROLE=api, or the migration Job), then the rest. ` +
        `Set REBASE_REQUIRE_SCHEMA_MATCH=true to refuse the boot instead of warning.`
    );
}

/** What {@link enforceSchemaStamp} needs to do its work. */
export interface EnforceSchemaStampOptions {
    /** The collections this process will serve. */
    collections: CollectionConfig[];
    /** Reads the stamp. Absent when the driver cannot. */
    read?: () => Promise<string | null>;
    /** Writes the stamp. Only called when this process provisioned the schema. */
    stamp?: (version: string) => Promise<void>;
    /** Whether this process is the one that just applied the schema. */
    provisioned: boolean;
    /** Whether the collections came from the database. */
    introspecting?: boolean;
    /** What a mismatch does. */
    policy?: SchemaMismatchPolicy;
}

/**
 * Stamp, or compare and report.
 *
 * The provisioning process writes; everyone else reads. A process that both
 * provisions and would compare has nothing to compare against — it is the
 * authority — so it stamps and returns.
 *
 * Every failure to read or write is swallowed with a warning rather than
 * propagated. This check exists to make a silent problem visible; letting it
 * take down a boot it was only supposed to describe would be a strictly worse
 * trade, and a database that refuses one small write is already telling the
 * operator something through other channels.
 */
export async function enforceSchemaStamp(options: EnforceSchemaStampOptions): Promise<SchemaStampVerdict> {
    const { collections, read, stamp, provisioned, introspecting } = options;

    if (introspecting) {
        return { status: "skipped", reason: "collections are derived from the database, so they cannot disagree with it" };
    }
    if (!read && !stamp) {
        return { status: "skipped", reason: "this driver does not record a collections schema version" };
    }

    const processVersion = computeSchemaVersion(collections);

    if (provisioned) {
        if (!stamp) return { status: "skipped", reason: "this driver cannot record a collections schema version" };
        try {
            await stamp(processVersion);
            logger.debug(`🔖 [schema] Stamped the collections schema version: ${processVersion}`);
        } catch (error) {
            logger.warn(
                "⚠️ [schema] Could not record the collections schema version. Other processes cannot check " +
                "themselves against this database until one boots that can.",
                { error }
            );
        }
        return { status: "match", version: processVersion };
    }

    if (!read) return { status: "skipped", reason: "this driver cannot read a collections schema version" };

    let databaseVersion: string | null;
    try {
        databaseVersion = await read();
    } catch (error) {
        logger.warn("⚠️ [schema] Could not read the collections schema version from the database.", { error });
        return { status: "skipped", reason: "the stamp could not be read" };
    }

    const verdict = decideSchemaStamp({ processVersion, databaseVersion, introspecting });

    if (verdict.status === "unstamped") {
        // Worth one line and no more. Every database predating this check reads
        // this way, and so does every fresh one until the schema owner's first
        // boot finishes — neither is a problem, and a warning on both would
        // train people to ignore the one that matters.
        logger.debug(
            "🔖 [schema] This database carries no collections schema version yet — it will be stamped by the " +
            "process that provisions it."
        );
    } else if (verdict.status === "mismatch") {
        const message = describeMismatch(verdict.database, verdict.process);
        if ((options.policy ?? "warn") === "refuse") {
            throw new SchemaVersionMismatchError(verdict.database, verdict.process, message);
        }
        logger.warn(`⚠️ [schema] ${message}`);
    }

    return verdict;
}
