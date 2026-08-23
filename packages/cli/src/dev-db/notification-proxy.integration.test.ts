/**
 * Realtime against the managed database — the case the notification proxy
 * exists for.
 *
 * Kept apart from the proxy's unit tests because these start real databases:
 * they are slow, they are CPU-hungry, and running them beside the fast suite
 * starves it. The parser tests next door are the ones that run on every save;
 * these are the ones that prove the feature.
 *
 * The shape under test is the realtime engine's exact shape — a dedicated
 * connection issuing `LISTEN`, with writes arriving on a different connection.
 * That combination was silently broken before the proxy: every query succeeded
 * and the events simply never came.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import pg from "pg";

import { MANAGED_POOL_MAX } from "./constraints";
import { ensureManagedDatabase, stopManagedDatabase } from "./daemon";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI_ENTRY = path.join(HERE, "__fixtures__", "cli-entry.ts");
const BOOT_TIMEOUT = 90_000;

describe("realtime against the managed database", () => {
    let root: string;
    const pools: pg.Pool[] = [];
    const clients: pg.Client[] = [];

    beforeEach(() => {
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-rt-")));
    });

    afterEach(async () => {
        await Promise.all(clients.splice(0).map((c) => c.end().catch(() => undefined)));
        await Promise.all(pools.splice(0).map((p) => p.end().catch(() => undefined)));
        await stopManagedDatabase(root).catch(() => undefined);
        fs.rmSync(root, { recursive: true, force: true });
    });

    it("delivers trigger-fired CDC to a dedicated listener", { timeout: BOOT_TIMEOUT }, async () => {
        // The realtime engine's exact shape, and the case that was broken:
        // LISTEN on its own connection, writes arriving on another.
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        const listener = new pg.Client({ connectionString: database.url });
        clients.push(listener);
        await listener.connect();
        const received: string[] = [];
        listener.on("notification", (message) => received.push(`${message.channel}:${message.payload}`));
        await listener.query("LISTEN rebase_cdc");

        const pool = new pg.Pool({ connectionString: database.url, max: MANAGED_POOL_MAX });
        pools.push(pool);
        await pool.query("CREATE TABLE orders (id int primary key)");
        await pool.query(
            "CREATE FUNCTION notify_change() RETURNS trigger AS $$ BEGIN " +
            "PERFORM pg_notify('rebase_cdc', TG_TABLE_NAME || ':' || NEW.id); RETURN NEW; END $$ LANGUAGE plpgsql"
        );
        await pool.query(
            "CREATE TRIGGER orders_changed AFTER INSERT ON orders FOR EACH ROW EXECUTE FUNCTION notify_change()"
        );

        await pool.query("INSERT INTO orders VALUES (1)");
        await new Promise((resolve) => setTimeout(resolve, 800));

        expect(received).toEqual(["rebase_cdc:orders:1"]);
    });

    it("delivers every event in a burst, in order", { timeout: BOOT_TIMEOUT }, async () => {
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        const listener = new pg.Client({ connectionString: database.url });
        clients.push(listener);
        await listener.connect();
        const received: string[] = [];
        listener.on("notification", (message) => received.push(String(message.payload)));
        await listener.query("LISTEN burst");

        const pool = new pg.Pool({ connectionString: database.url, max: MANAGED_POOL_MAX });
        pools.push(pool);
        for (let i = 0; i < 10; i += 1) await pool.query("SELECT pg_notify('burst', $1)", [String(i)]);
        await new Promise((resolve) => setTimeout(resolve, 1000));

        expect(received).toEqual(["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"]);
    });

    it("does not deliver a notification from a rolled-back transaction", { timeout: BOOT_TIMEOUT }, async () => {
        // Postgres queues NOTIFY until commit. A proxy that invented delivery
        // rather than forwarding real frames would get this wrong, and realtime
        // would show rows that do not exist.
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });

        const listener = new pg.Client({ connectionString: database.url });
        clients.push(listener);
        await listener.connect();
        const received: string[] = [];
        listener.on("notification", (message) => received.push(String(message.payload)));
        await listener.query("LISTEN rolled_back");

        const pool = new pg.Pool({ connectionString: database.url, max: MANAGED_POOL_MAX });
        pools.push(pool);
        const client = await pool.connect();
        await client.query("BEGIN");
        await client.query("SELECT pg_notify('rolled_back', 'should-not-arrive')");
        await client.query("ROLLBACK");
        client.release();
        await new Promise((resolve) => setTimeout(resolve, 800));

        expect(received).toEqual([]);
    });

    it("leaves ordinary queries working through the proxy", { timeout: BOOT_TIMEOUT }, async () => {
        const database = await ensureManagedDatabase(root, { entry: CLI_ENTRY, quiet: true });
        const pool = new pg.Pool({ connectionString: database.url, max: MANAGED_POOL_MAX });
        pools.push(pool);

        await pool.query("CREATE TABLE t (id int primary key, v text)");
        for (let i = 0; i < 25; i += 1) await pool.query("INSERT INTO t VALUES ($1, $2)", [i, `row-${i}`]);

        const { rows } = await pool.query<{ c: number }>("select count(*)::int c from t");
        expect(rows[0].c).toBe(25);
    });
});
