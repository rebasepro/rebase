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
    type User
} from "@rebasepro/types";
import { buildSdkData, createAccessorSlugResolver } from "@rebasepro/common";
import { createPostgresDatabaseConnection, type PostgresPoolConfig } from "./connection";
import { openPostgresDriver } from "./PostgresBootstrapper";

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
 */
export interface OpenedRebase extends Pick<RebaseServerClient<unknown>, "dataAsAdmin" | "sql"> {
    /**
     * The data as `user` sees it: every read and write runs as them, filtered
     * by the collections' row-level security policies — the scoping an HTTP
     * request from that user gets. Named after the driver method it uses.
     */
    withAuth(user: RebaseIdentity): Promise<{ data: RebaseSdkData }>;
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
 * function is created. A `withAuth` request on a connection that bypasses
 * row-level security runs as the restricted role a server boot provisions;
 * against a database no server has booted on, it fails rather than run
 * unfiltered.
 */
export async function openRebase(options: OpenRebaseOptions): Promise<OpenedRebase> {
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

    let opened: Awaited<ReturnType<typeof openPostgresDriver>>;
    try {
        opened = await openPostgresDriver({ connection: db, connectionString }, {
            collections: options.collections,
            dataSourceKey: options.dataSourceKey ?? DEFAULT_DATA_SOURCE_KEY,
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
    const resolveAccessor = createAccessorSlugResolver(() => registry.getCollections());
    const dataAs = async (identity: RebaseIdentity): Promise<RebaseSdkData> =>
        buildSdkData(await driver.withAuth(userFor(identity)), { resolveAccessor });

    const dataAsAdmin = await dataAs(SERVICE_IDENTITY);
    const admin = driver.admin;
    let closed = false;

    return {
        dataAsAdmin,
        collections: opened.collections ?? options.collections,
        async sql(query, sqlOptions) {
            if (!isSQLAdmin(admin)) throw new Error("This driver cannot run raw SQL.");
            return admin.executeSql(query, sqlOptions && {
                role: sqlOptions.role,
                params: sqlOptions.params,
                ...(sqlOptions.database !== undefined ? { database: resourceKeyOf(sqlOptions.database) } : {})
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
