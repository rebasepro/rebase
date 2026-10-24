/**
 * `openRebase` — a project's data from a script, a REPL or a test, with no
 * server around it.
 *
 * The same vocabulary a function gets from the server (`dataAsAdmin`, `sql`),
 * one call to act as a user under row-level security, and `close()`. Nothing
 * else: no HTTP, no schema changes, no environment variables read, no realtime,
 * no timers and no process listeners. What the server's boot adds on top of
 * this is the boot's business.
 */
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { Pool } from "pg";
import {
    DEFAULT_DATA_SOURCE_KEY,
    isSQLAdmin,
    resourceKeyOf,
    type CollectionConfig,
    type RebaseSdkData,
    type RebaseServerClient,
    type RegisteredDatabase,
    type User
} from "@rebasepro/types";
import { buildSdkData, createAccessorSlugResolver } from "@rebasepro/common";
import { logger } from "@rebasepro/server";
import { deepestErrorMessage, parseHostInfo } from "./cli-errors";
import { extractPgError } from "./utils/pg-error-utils";
import { createPostgresDatabaseConnection, type PostgresPoolConfig } from "./connection";
import { openPostgresDriver } from "./PostgresBootstrapper";
import { HistoryService } from "./history/HistoryService";
import { historyUnavailableReason, readHistoryTableState } from "./history/ensure-history-table";

/** Who a request runs as: what row-level security policies read. */
export interface RebaseIdentity {
    uid: string;
    roles?: string[];
    /** A guest — an anonymous sign-in — rather than an account. */
    isAnonymous?: boolean;
    /** Custom token claims, as `rebase.jwt()` reads them in a policy. */
    claims?: Record<string, unknown>;
}

export interface OpenRebaseOptions {
    /**
     * The database to open. `openRebase` creates the pool and `close()` ends
     * it. One of this and `connection`.
     */
    databaseUrl?: string;
    /**
     * A connection you already hold — `createPostgresDatabaseConnection(…).db`.
     * It stays yours: `close()` leaves it open.
     */
    connection?: NodePgDatabase<Record<string, unknown>> & { $client: Pool };
    /**
     * The project's collections — what the server is configured with. Empty
     * reads them from the database instead, the way a server with no
     * collection files does.
     */
    collections: CollectionConfig[];
    /** Pool tuning, when `databaseUrl` is given. */
    pool?: PostgresPoolConfig;
    /** The data source these collections are served from. Defaults to `(default)`. */
    dataSourceKey?: string;
}

/**
 * An open project. `dataAsAdmin` and `sql` are the accessors of the same name
 * a server-side function gets (`RebaseServerClient`).
 *
 * Typed by `DB`, which defaults to the `Database` the project registered
 * (`rebase generate-sdk --register`, see `Register` in `@rebasepro/types`) —
 * the type a function's `rebase.dataAsAdmin` has — and is untyped when it
 * registered none.
 */
export interface OpenedRebase<DB = RegisteredDatabase> extends Pick<RebaseServerClient<DB>, "dataAsAdmin" | "sql"> {
    /**
     * The data as `user` sees it: every read and write runs as them, filtered
     * by the collections' row-level security policies — the scoping an HTTP
     * request from that user gets. Named after the driver method it uses.
     */
    withAuth(user: RebaseIdentity): Promise<{ data: RebaseSdkData<DB> }>;
    /** The collections this was opened with, or the ones the database described. */
    readonly collections: CollectionConfig[];
    /** End the pool `openRebase` created. Safe to call twice; a `connection` you passed stays open. */
    close(): Promise<void>;
}

/**
 * The identity `dataAsAdmin` is scoped as — the server's `SERVICE_IDENTITY`, so
 * it reads and writes what a function's `rebase.dataAsAdmin` does: admin, and
 * still evaluated by policies.
 */
const SERVICE_IDENTITY: RebaseIdentity = { uid: "service", roles: ["admin"] };

/** The `User` the driver's `withAuth` takes, for an identity with no account details. */
function userFor(identity: RebaseIdentity): User {
    return {
        uid: identity.uid,
        roles: identity.roles ?? [],
        isAnonymous: identity.isAnonymous === true,
        displayName: null,
        email: null,
        photoURL: null,
        providerId: "script",
        ...(identity.claims ? { claims: identity.claims } : {})
    };
}

/**
 * Open a project's database the way its server would serve it, from code.
 *
 * ```ts
 * const rebase = await openRebase({ databaseUrl, collections });
 * const posts = await rebase.dataAsAdmin.posts.find({ limit: 10 });
 * const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
 * const hers = await ada.data.posts.find();
 * await rebase.close();
 * ```
 *
 * Opening changes nothing in the database: no table, role, trigger or
 * function is created. A write to a `history: true` collection records its
 * entry as a server write does, on the write's transaction; on a database no
 * backend with history has provisioned, such writes are refused with
 * `HISTORY_UNAVAILABLE` (reads are not) rather than made without their audit
 * entry. A `withAuth` request on a connection that bypasses row-level
 * security runs as the restricted role a server boot provisions; against a
 * database no server has booted on, it fails rather than run unfiltered.
 *
 * Its accessors are typed from the `Database` the project registered, as a
 * function's are; `openRebase<Database>(…)` names one for this call instead.
 */
export async function openRebase<DB = RegisteredDatabase>(options: OpenRebaseOptions): Promise<OpenedRebase<DB>> {
    if (!options.databaseUrl && !options.connection) {
        throw new Error("openRebase needs a `databaseUrl` or a `connection`.");
    }
    if (options.databaseUrl && options.connection) {
        throw new Error("openRebase takes a `databaseUrl` or a `connection`, not both.");
    }

    // The pool size is what was asked for: `{}` keeps the environment's
    // `REBASE_DB_POOL_MAX` ceiling out of it.
    const owned = options.databaseUrl
        ? createPostgresDatabaseConnection(options.databaseUrl, undefined, options.pool, {})
        : undefined;
    const db = owned?.db ?? options.connection;
    const connectionString = owned?.connectionString ?? options.connection?.$client.options.connectionString;

    // Asked first, and answered by the error alone. Opening the driver on a
    // database it cannot reach logs the server boot's banner and then throws
    // the same diagnosis, so a caller that prints what it caught — `rebase
    // console` does — said it twice, under an empty `❌ [ERROR]` line.
    const pool = owned?.pool ?? options.connection?.$client;
    try {
        await pool?.query("SELECT 1");
    } catch (error) {
        await owned?.pool.end().catch(() => undefined);
        // With Postgres' hint, where it gave one: the managed development
        // database's refusal for want of a free connection says what to do in it.
        const hint = extractPgError(error)?.hint;
        throw new Error(
            `Cannot connect to PostgreSQL at ${parseHostInfo(connectionString ?? "")}: ` +
            `${deepestErrorMessage(error) ?? "the connection failed"}.${hint ? ` ${hint}` : ""}`,
            { cause: error }
        );
    }

    const ownKey = options.dataSourceKey ?? DEFAULT_DATA_SOURCE_KEY;
    let opened: Awaited<ReturnType<typeof openPostgresDriver>>;
    try {
        opened = await openPostgresDriver({ connection: db, connectionString }, {
            collections: options.collections,
            dataSourceKey: ownKey,
            introspectCollections: options.collections.length === 0,
            provision: false,
            realtime: false,
            schemaProvisioning: {
                attempted: false,
                reason: "openRebase never changes the schema — apply it with `rebase db push`, or by booting the server."
            }
        });
    } catch (error) {
        await owned?.pool.end().catch(() => undefined);
        throw error;
    }

    const driver = opened.internals.driver;
    const registry = opened.internals.registry;
    // The server boot announces this at info. A script's stdout is its own
    // output — `tsx script.ts > out.json` — so here it is there only for a
    // reader who asked for debug.
    if (opened.internals.rlsEnforcement) logger.debug(opened.internals.rlsEnforcement);

    // A `history: true` collection is audited from a script exactly as from
    // the server: the same service, the entry on the write's transaction,
    // recorded as whoever the write runs as. Nothing is created for it — the
    // table and its function are read — and where an earlier boot never made
    // them, writes to those collections are refused up front instead of going
    // unaudited. Reads are unaffected. Entries are not pruned here: the
    // retention is the server's setting, which a script does not know, and
    // pruning to the default could delete entries the server keeps.
    const collections = opened.collections ?? options.collections;
    if (collections.some(collection => collection.history)) {
        try {
            const state = await readHistoryTableState(opened.internals.db);
            driver.historyService = new HistoryService(opened.internals.db, undefined, {
                inTransaction: state.inTransaction,
                entryFormat: state.entryFormat,
                unavailable: historyUnavailableReason(state, { requireTransaction: true }),
                pruneOnRecord: false
            });
        } catch (error) {
            await owned?.pool.end().catch(() => undefined);
            throw error;
        }
    }
    const resolveAccessor = createAccessorSlugResolver(() => registry.getCollections());
    const dataAs = async (identity: RebaseIdentity): Promise<RebaseSdkData<DB>> =>
        buildSdkData<DB>(await driver.withAuth(userFor(identity)), { resolveAccessor });

    const dataAsAdmin = await dataAs(SERVICE_IDENTITY);
    const admin = driver.admin;
    let closed = false;

    return {
        dataAsAdmin,
        collections,
        async sql(query, sqlOptions) {
            if (!isSQLAdmin(admin)) throw new Error("This driver cannot run raw SQL.");
            // `{ database }` names a data source, as on the server. This opened
            // exactly one, so any other key is refused by name: it used to be
            // passed on as a Postgres database name, running the query on
            // `<this host>/<key>` — another database, or this one, silently.
            if (sqlOptions?.database !== undefined) {
                const asked = resourceKeyOf(sqlOptions.database);
                if (asked !== ownKey) {
                    throw new Error(
                        `openRebase opened the "${ownKey}" data source only, so it cannot run SQL on "${asked}". ` +
                        `Open that one with its own openRebase({ databaseUrl, dataSourceKey: "${asked}" }).`
                    );
                }
            }
            return admin.executeSql(query, sqlOptions && {
                role: sqlOptions.role,
                params: sqlOptions.params
            });
        },
        async withAuth(user) {
            return { data: await dataAs(user) };
        },
        async close() {
            if (closed) return;
            closed = true;
            await owned?.pool.end();
        }
    };
}
