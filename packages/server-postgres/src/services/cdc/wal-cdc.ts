/**
 * The provisioning half of WAL change capture: the publication a
 * {@link WalCdcListener} streams.
 *
 * `REALTIME_CDC=wal` swaps the capture triggers for logical decoding. What a
 * trigger did per table — say which tables are captured — a publication does
 * once: `pgoutput` streams the inserts, updates, deletes and truncates of the
 * tables in it, and nothing else.
 *
 * Tables are only ever added. During a rolling deploy two versions provision
 * at once, and an older one that does not know a newer collection must not
 * take its table back out from under the instances streaming it. A table that
 * stops being a collection stays published; its changes reach no subscriber
 * and are dropped as unmapped, as an unmapped trigger's were.
 *
 * A table without a replica identity — no primary key, or `REPLICA IDENTITY
 * NOTHING` — is never added: Postgres refuses every UPDATE and DELETE on a
 * table that publishes them and cannot say which row changed, so publishing it
 * would break writes to it. It is reported and left uncaptured.
 */
import { logger } from "@rebasepro/server";
import type { RawSqlRunner } from "../../security/rls-enforcement";
import { BOOT_LOCK_ATTEMPTS, BOOT_LOCK_TIMEOUT_MS, isLockTimeout, sleep } from "../../schema/boot-ddl";
import type { CdcTableRef } from "./trigger-cdc";

/** The publication WAL capture streams. A plain identifier: it is interpolated into replication commands. */
export const CDC_PUBLICATION = "rebase_cdc";

const quoteIdent = (name: string): string => `"${name.replace(/"/g, "\"\"")}"`;
const quoteLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

/** SQLSTATE 42710: the publication, or the table's membership of it, already exists — another instance got there first. */
function isDuplicateObject(err: unknown): boolean {
    const code = err instanceof Error && "code" in err ? err.code : undefined;
    const causeCode = err instanceof Error && err.cause instanceof Error && "code" in err.cause ? err.cause.code : undefined;
    return code === "42710" || causeCode === "42710";
}

/**
 * Why this database cannot do WAL capture, or `undefined` when it can as far
 * as the server's settings go. Whether the streaming role may replicate is
 * only known when it tries — a host can grant it through role membership
 * (`rds_replication`, `cloudsqlsuperuser`) that no attribute shows.
 */
export async function walCaptureBlocker(run: RawSqlRunner): Promise<string | undefined> {
    const rows = await run("SELECT current_setting('wal_level') AS wal_level, current_setting('server_version_num')::int AS version");
    const walLevel = String(rows[0]?.wal_level ?? "");
    const version = Number(rows[0]?.version ?? 0);
    if (version > 0 && version < 100000) return `Postgres ${Math.floor(version / 10000)} has no pgoutput (10 or later is needed)`;
    if (walLevel !== "logical") return `wal_level is "${walLevel || "unknown"}", and logical decoding needs wal_level=logical (a server restart)`;
    return undefined;
}

export interface WalPublicationResult {
    /** Tables in the publication, including ones an earlier boot added. */
    published: CdcTableRef[];
    skipped: Array<CdcTableRef & { reason: string }>;
}

interface TableState {
    exists: boolean;
    relkind: string;
    replicaIdentity: string;
    hasPrimaryKey: boolean;
    hasIdentityIndex: boolean;
    published: boolean;
}

async function readTableStates(run: RawSqlRunner, tables: CdcTableRef[]): Promise<Map<string, TableState>> {
    const states = new Map<string, TableState>();
    if (tables.length === 0) return states;
    const names = tables.map((t) => quoteLiteral(`${quoteIdent(t.schema)}.${quoteIdent(t.table)}`)).join(", ");
    const rows = await run(
        "SELECT n.name, c.oid IS NOT NULL AS exists, c.relkind::text AS relkind, c.relreplident::text AS replica_identity, " +
        "EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary) AS has_pk, " +
        "EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisreplident) AS has_identity_index, " +
        "EXISTS (SELECT 1 FROM pg_publication_rel r JOIN pg_publication p ON p.oid = r.prpubid " +
        `        WHERE r.prrelid = c.oid AND p.pubname = ${quoteLiteral(CDC_PUBLICATION)}) AS published ` +
        `FROM unnest(ARRAY[${names}]::text[]) AS n(name) LEFT JOIN pg_class c ON c.oid = to_regclass(n.name)`
    );
    for (const row of rows) {
        states.set(String(row.name), {
            exists: row.exists === true,
            relkind: String(row.relkind ?? ""),
            replicaIdentity: String(row.replica_identity ?? ""),
            hasPrimaryKey: row.has_pk === true,
            hasIdentityIndex: row.has_identity_index === true,
            published: row.published === true
        });
    }
    return states;
}

/** Why a table cannot join the publication, or `undefined` when it can. */
function unpublishable(state: TableState | undefined, version: number): string | undefined {
    if (!state?.exists) return "the table does not exist — is it migrated?";
    if (state.relkind === "p" && version < 130000) return "a partitioned table is published through its root from Postgres 13";
    if (state.relkind !== "r" && state.relkind !== "p") return "only tables can be published, and this is a view or a foreign table";
    if (state.replicaIdentity === "n" ||
        (state.replicaIdentity === "d" && !state.hasPrimaryKey) ||
        (state.replicaIdentity === "i" && !state.hasIdentityIndex)) {
        return "it has no primary key or replica identity, and Postgres refuses every UPDATE and DELETE on a published table " +
            "that cannot say which row changed — add a primary key, or set REPLICA IDENTITY FULL";
    }
    return undefined;
}

async function withLockBudget(run: RawSqlRunner, statement: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
        try {
            await run(`SET LOCAL lock_timeout = '${BOOT_LOCK_TIMEOUT_MS}ms';\n${statement}`);
            return;
        } catch (err) {
            if (!isLockTimeout(err) || attempt >= BOOT_LOCK_ATTEMPTS) throw err;
            await sleep(500 * attempt * (1 + Math.random()));
        }
    }
}

/**
 * Create the publication if it is missing and add every table it lacks.
 *
 * Throws when the publication cannot be created or read at all (no
 * privilege), which the caller treats as "WAL capture is unavailable". A
 * single table that cannot be added is reported in `skipped` instead, so one
 * of them cannot turn capture off for the rest.
 */
export async function provisionWalPublication(run: RawSqlRunner, tables: CdcTableRef[]): Promise<WalPublicationResult> {
    const versionRows = await run("SELECT current_setting('server_version_num')::int AS version");
    const version = Number(versionRows[0]?.version ?? 0);

    const existing = await run(`SELECT 1 FROM pg_publication WHERE pubname = ${quoteLiteral(CDC_PUBLICATION)}`);
    if (existing.length === 0) {
        // Through the root, so a partitioned collection's changes arrive under
        // the table its collection names rather than under each partition.
        const options = "publish = 'insert, update, delete, truncate'" + (version >= 130000 ? ", publish_via_partition_root = true" : "");
        try {
            await run(`CREATE PUBLICATION ${quoteIdent(CDC_PUBLICATION)} WITH (${options})`);
        } catch (err) {
            if (!isDuplicateObject(err)) throw err;
        }
    }

    const byTable = new Map<string, CdcTableRef>();
    for (const ref of tables) byTable.set(`${quoteIdent(ref.schema)}.${quoteIdent(ref.table)}`, ref);
    const states = await readTableStates(run, [...byTable.values()]);

    const published: CdcTableRef[] = [];
    const skipped: WalPublicationResult["skipped"] = [];
    for (const [qualified, ref] of byTable) {
        const state = states.get(qualified);
        if (state?.published) {
            published.push(ref);
            continue;
        }
        const reason = unpublishable(state, version);
        if (reason) {
            skipped.push({ ...ref, reason });
            continue;
        }
        try {
            await withLockBudget(run, `ALTER PUBLICATION ${quoteIdent(CDC_PUBLICATION)} ADD TABLE ${qualified}`);
            published.push(ref);
        } catch (err) {
            if (isDuplicateObject(err)) {
                published.push(ref);
            } else {
                skipped.push({ ...ref, reason: err instanceof Error ? err.message : String(err) });
            }
        }
    }
    return { published, skipped };
}

/** One line per table the publication could not take: its writes reach realtime only through this server. */
export function reportUnpublishedTables(result: WalPublicationResult): void {
    for (const table of result.skipped) {
        logger.warn(`⚠️ [CDC] "${table.schema}.${table.table}" is not captured from the WAL — ${table.reason}.`);
    }
}
