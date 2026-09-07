import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { logger } from "@rebasepro/server";
import { guardPoolAgainstDirtyRelease, pinSearchPath, cappedPoolMax } from "./connection";

export class DatabasePoolManager {
    private pools: Map<string, Pool> = new Map();
    private drizzleInstances: Map<string, NodePgDatabase> = new Map();
    public readonly defaultDatabaseName: string;
    private readonly rootConnectionString: string;

    constructor(adminConnectionString: string) {
        this.rootConnectionString = adminConnectionString;
        try {
            const url = new URL(adminConnectionString);
            this.defaultDatabaseName = url.pathname.slice(1);
        } catch (e) {
            throw new Error(`Invalid adminConnectionString provided: ${e}`);
        }
    }

    public getDrizzle(databaseName: string): NodePgDatabase<Record<string, never>> {
        const existing = this.drizzleInstances.get(databaseName);
        if (existing) {
            return existing;
        }

        const pool = this.getPool(databaseName);
        const db = drizzle(pool);
        this.drizzleInstances.set(databaseName, db);
        return db;
    }

    public getPool(databaseName: string): Pool {
        if (this.pools.has(databaseName)) {
            return this.pools.get(databaseName)!;
        }

        const url = new URL(this.rootConnectionString);
        url.pathname = `/${databaseName}`;

        const pool = new Pool({
            // Same pin as the primary pool: these are branch/multi-database
            // connections to the *same* server, so they inherit the same
            // `"$user"` hazard. See `pinSearchPath`.
            connectionString: pinSearchPath(url.toString()),
            // Capped by REBASE_DB_POOL_MAX, which the managed development
            // database sets to 1: PGlite multiplexes onto a single session and
            // overlapping transactions deadlock there.
            max: cappedPoolMax(10),
            idleTimeoutMillis: 10000, // Reduced from 30000 for aggressive cleanup
            allowExitOnIdle: true // Prevent idle clients from hanging the Node.js process
        });

        // Prevent idle client errors from crashing the Node.js process
        pool.on("error", (err) => {
            logger.error(`[DatabasePoolManager] Unexpected error on idle client for db ${databaseName}`, { error: err });
        });
        guardPoolAgainstDirtyRelease(pool, `pg-pool:${databaseName}`);

        this.pools.set(databaseName, pool);
        return pool;
    }

    /**
     * Disconnect and remove the pool for a specific database.
     * Required before `CREATE DATABASE ... TEMPLATE` or `DROP DATABASE`,
     * which need exclusive access to the target database.
     */
    public async disconnectDatabase(databaseName: string): Promise<void> {
        const pool = this.pools.get(databaseName);
        if (pool) {
            await pool.end();
            this.pools.delete(databaseName);
            this.drizzleInstances.delete(databaseName);
        }
    }

    /** Check if a pool exists for a given database name. */
    public hasPool(databaseName: string): boolean {
        return this.pools.has(databaseName);
    }

    /**
     * Does this server serve exactly one database?
     *
     * The managed development database is PGlite, and PGlite serves exactly
     * one. `CREATE DATABASE "rb_feature" TEMPLATE "postgres"` there writes a
     * `pg_database` catalogue row and nothing else: nothing errors, the row is
     * listable, `pg_database_size` answers — and connecting to the "branch"
     * lands you in the parent. Every write made in the belief that it is
     * sandboxed goes to the developer's real development database.
     *
     * The CLI already refuses `rebase db branch` on this ground, but it does it
     * by parsing argv, so Studio — which reaches `BranchService` over the
     * websocket — walked straight past it. The connection is the only thing
     * both callers share, so the answer belongs here.
     *
     * Measured, not assumed: `select version()` over the PGlite socket returns
     * `PostgreSQL 18.3 (PGlite 0.5.6) on wasm32-…`, which is how a wasm build
     * announces itself and what `dev-db/constraints.ts` documents. A real
     * Postgres never carries `(PGlite `.
     *
     * Cached, because a live connection cannot change engine underneath us, and
     * a `PostgresBackendDriver` — which builds a `BranchService` — is
     * constructed per transaction.
     */
    public servesOneDatabase(): Promise<boolean> {
        this.oneDatabaseProbe ??= this.probeOneDatabase();
        return this.oneDatabaseProbe;
    }

    private oneDatabaseProbe?: Promise<boolean>;

    private async probeOneDatabase(): Promise<boolean> {
        try {
            const result = await this.getPool(this.defaultDatabaseName)
                .query<{ version: string }>("SELECT version() AS version");
            return /\(PGlite\b/i.test(result.rows[0]?.version ?? "");
        } catch (err) {
            // Fail open, and do not cache the failure. The cost of a wrong
            // "yes" is refusing branching on a real Postgres that momentarily
            // could not answer; the cost of a wrong "no" is one fake branch,
            // which is what this exists to prevent — but a server that cannot
            // run `select version()` is not one we can conclude anything about.
            this.oneDatabaseProbe = undefined;
            logger.warn("[DatabasePoolManager] Could not read the server version", { error: err });
            return false;
        }
    }

    public async shutdown(): Promise<void> {
        const promises = [];
        for (const [dbName, pool] of this.pools.entries()) {
            logger.info(`[DatabasePoolManager] Shutting down pool for ${dbName}`);
            promises.push(pool.end());
        }
        await Promise.all(promises);
        this.pools.clear();
        this.drizzleInstances.clear();
    }
}
