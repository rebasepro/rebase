/**
 * E2E: the idempotency key store against a real Postgres.
 *
 * Every other test of this mechanism stands in for the database with a fake
 * `executeSql` that models the semantics rather than executing the statements,
 * and the store swallows its own SQL errors by design — a write must never fail
 * because the bookkeeping around it did. Those two facts together mean a
 * statement Postgres rejects presents as "idempotency quietly does nothing",
 * with every unit test still green and no signal anywhere. Only a real database
 * can tell the difference.
 *
 * What needs the real thing:
 *
 *   1. **The claim.** `INSERT … ON CONFLICT (uid, key) DO UPDATE … WHERE
 *      <expired> RETURNING` is one statement doing three jobs, and its WHERE
 *      references the conflicting row schema-qualified. Whether Postgres
 *      accepts that, and whether it yields a row exactly when the claim
 *      succeeded, is not something a mock can answer.
 *
 *   2. **The two windows.** A claim nobody answered expires in a minute; an
 *      answered one holds its reply for a day. Both branches live in one
 *      predicate, and getting them the wrong way round either strands writes
 *      for 24 hours or replays a batch that was never idempotent.
 *
 *   3. **The upgrade.** The table is created lazily, so a deployment that
 *      already has it from an earlier version keeps it — `CREATE TABLE IF NOT
 *      EXISTS` would not add the fingerprint column, and rows written before it
 *      have none.
 *
 *   4. **Pending vs. a stored `null`.** A JSONB `null` is a legitimate stored
 *      response and SQL NULL means "not answered yet"; node-pg turns both into
 *      JS `null`, so only the `response IS NULL` projection separates them.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { PostgresCollectionRegistry } from "../../src/collections/PostgresCollectionRegistry.js";
import { RealtimeService } from "../../src/services/realtimeService.js";
import {
    createIdempotencyStore,
    requestFingerprint,
    type IdempotencyStore
} from "../../../server/src/api/rest/idempotency.js";

const TABLE = "rebase.idempotency_keys";

/** A caller with a principal to scope keys to; anonymous ones get no keys. */
const UID = "user-1";

describe("Idempotency key store (E2E)", () => {
    let container: PgContainer;
    let pool: pg.Pool;
    let inspector: pg.Client;
    let store: IdempotencyStore;

    /** A fresh store, as a restarted pod would build it. */
    function makeStore(): IdempotencyStore {
        const db = drizzle(pool);
        const registry = new PostgresCollectionRegistry();
        const realtime = new RealtimeService(db as never, registry);
        const driver = new PostgresBackendDriver(db as never, realtime as never, registry);
        realtime.setDataDriver(driver);
        const created = createIdempotencyStore(driver);
        if (!created) throw new Error("Expected the Postgres driver to expose a SQL admin");
        return created;
    }

    /** Pretend the claim was taken this long ago, without waiting for it. */
    async function backdate(key: string, interval: string): Promise<void> {
        await inspector.query(
            `UPDATE ${TABLE} SET created_at = NOW() - INTERVAL '${interval}' WHERE uid = $1 AND key = $2`,
            [UID, key]
        );
    }

    const fingerprintOf = (body: unknown) => requestFingerprint("POST", "/data/posts", body);

    beforeAll(async () => {
        container = await startPgContainer();
        pool = new pg.Pool({ connectionString: container.connectionString });
        inspector = new pg.Client({ connectionString: container.connectionString });
        await inspector.connect();
        store = makeStore();
    }, 180_000);

    afterAll(async () => {
        await inspector?.end().catch(() => undefined);
        await pool?.end().catch(() => undefined);
        if (container) await stopPgContainer(container.containerName);
    });

    beforeEach(async () => {
        // The table is created lazily by the first keyed request, so it may not
        // exist yet on the very first case.
        await inspector.query(`TRUNCATE ${TABLE}`).catch(() => undefined);
    });

    it("claims a free key, refuses the second claimant, and replays once it has answered", async () => {
        const fingerprint = fingerprintOf({ title: "hello" });

        expect(await store.claim("mut-1", UID, fingerprint)).toEqual({ status: "claimed" });
        // The claim is the whole mechanism: the loser must not write.
        expect(await store.claim("mut-1", UID, fingerprint)).toEqual({ status: "in-flight" });

        await store.complete("mut-1", UID, { id: 7, title: "hello" });
        expect(await store.claim("mut-1", UID, fingerprint)).toEqual({
            status: "replay",
            response: { id: 7, title: "hello" }
        });
    });

    it("separates a stored null body from a claim that has not answered", async () => {
        const fingerprint = fingerprintOf({ title: "null-body" });
        await store.claim("mut-null", UID, fingerprint);
        await store.complete("mut-null", UID, null);

        // Both arrive as JS `null`; only `response IS NULL` tells them apart,
        // and reading this as pending would answer a completed key with a 409.
        expect(await store.claim("mut-null", UID, fingerprint)).toEqual({
            status: "replay",
            response: null
        });
    });

    it("hands a claim nobody answered to the next request once its lease expires", async () => {
        // The failure the lease exists for: the process holding the key was
        // killed between the write and the answer, so no release ever runs and
        // the row was never written. Before the lease, every retry was refused
        // for the full 24-hour replay window.
        const fingerprint = fingerprintOf({ title: "hello" });
        await store.claim("mut-crashed", UID, fingerprint);

        await backdate("mut-crashed", "30 seconds");
        expect(await store.claim("mut-crashed", UID, fingerprint)).toEqual({ status: "in-flight" });

        await backdate("mut-crashed", "2 minutes");
        expect(await store.claim("mut-crashed", UID, fingerprint)).toEqual({ status: "claimed" });
    });

    it("keeps replaying an answered key for the full replay window, not the lease", async () => {
        const fingerprint = fingerprintOf({ title: "hello" });
        await store.claim("mut-answered", UID, fingerprint);
        await store.complete("mut-answered", UID, { id: 1 });

        // Long past the pending lease, well inside the 24-hour TTL: an offline
        // client reconnecting an hour later must be replayed, not rewritten.
        await backdate("mut-answered", "6 hours");
        expect(await store.claim("mut-answered", UID, fingerprint)).toEqual({
            status: "replay",
            response: { id: 1 }
        });

        await backdate("mut-answered", "25 hours");
        expect(await store.claim("mut-answered", UID, fingerprint)).toEqual({ status: "claimed" });
    });

    it("refuses a live key presented for a different request", async () => {
        await store.claim("import-7", UID, fingerprintOf({ rows: [1, 2] }));
        await store.complete("import-7", UID, { written: 2 });

        // A different route or a different body under the same key is a reused
        // key, not a replay — answering it with the stored body reports a write
        // that never happened.
        expect(await store.claim("import-7", UID, requestFingerprint("POST", "/data/posts/bulk/delete", { ids: [1] })))
            .toEqual({ status: "mismatch" });
        expect(await store.claim("import-7", UID, fingerprintOf({ rows: [1, 2, 3] })))
            .toEqual({ status: "mismatch" });
        // The identical request still replays.
        expect(await store.claim("import-7", UID, fingerprintOf({ rows: [1, 2] })))
            .toEqual({ status: "replay", response: { written: 2 } });
    });

    it("scopes a key to its principal", async () => {
        const fingerprint = fingerprintOf({ title: "mine" });
        await store.claim("shared", UID, fingerprint);
        await store.complete("shared", UID, { id: 1, title: "mine" });

        // Mutation ids are generated on the client, so a key alone is
        // guessable: another user must get their own write, not this row.
        expect(await store.claim("shared", "user-2", fingerprint)).toEqual({ status: "claimed" });
    });

    it("ignores a key from an unauthenticated caller instead of pooling them all", async () => {
        const fingerprint = fingerprintOf({ message: "hi" });
        expect(await store.claim("submission-1", undefined, fingerprint)).toEqual({ status: "claimed" });
        await store.complete("submission-1", undefined, { id: 1 });
        // Nothing is stored, so the next anonymous caller to send that key
        // cannot be handed this response.
        expect(await store.claim("submission-1", undefined, fingerprint)).toEqual({ status: "claimed" });

        const { rows } = await inspector.query(`SELECT count(*)::int AS n FROM ${TABLE} WHERE key = 'submission-1'`);
        expect(rows[0].n).toBe(0);
    });

    it("releases an unanswered claim and leaves an answered one alone", async () => {
        const fingerprint = fingerprintOf({ title: "hello" });

        await store.claim("mut-failed", UID, fingerprint);
        await store.release("mut-failed", UID);
        // A transient failure must not burn the key for the rest of the lease.
        expect(await store.claim("mut-failed", UID, fingerprint)).toEqual({ status: "claimed" });

        await store.complete("mut-failed", UID, { id: 3 });
        await store.release("mut-failed", UID);
        // A later failure must not erase a reply that is still owed.
        expect(await store.claim("mut-failed", UID, fingerprint)).toEqual({
            status: "replay",
            response: { id: 3 }
        });
    });

    it("adds the fingerprint column to a table an earlier version created", async () => {
        // The lazy create is `IF NOT EXISTS`, so an existing deployment keeps
        // its table and would never gain the column. A row written before the
        // upgrade carries no fingerprint and must still replay rather than
        // failing every retry that spans the deploy.
        await inspector.query(`DROP TABLE IF EXISTS ${TABLE}`);
        await inspector.query(`
            CREATE TABLE ${TABLE} (
                key TEXT NOT NULL,
                uid TEXT NOT NULL,
                response JSONB,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                PRIMARY KEY (uid, key)
            )
        `);
        await inspector.query(
            `INSERT INTO ${TABLE} (key, uid, response) VALUES ('legacy', $1, '{"id":1}'::jsonb)`,
            [UID]
        );

        const upgraded = makeStore();
        expect(await upgraded.claim("legacy", UID, fingerprintOf({ anything: true }))).toEqual({
            status: "replay",
            response: { id: 1 }
        });

        const { rows } = await inspector.query(
            `SELECT column_name FROM information_schema.columns
             WHERE table_schema = 'rebase' AND table_name = 'idempotency_keys' AND column_name = 'fingerprint'`
        );
        expect(rows).toHaveLength(1);
    });

    it("lets exactly one of many concurrent claimants through", async () => {
        // The case the mechanism exists for: a shared offline queue replayed by
        // several tabs, or several pods answering the same retry.
        const fingerprint = fingerprintOf({ title: "race" });
        const claims = await Promise.all(
            Array.from({ length: 8 }, () => makeStore().claim("mut-race", UID, fingerprint))
        );

        expect(claims.filter(c => c.status === "claimed")).toHaveLength(1);
        expect(claims.filter(c => c.status === "in-flight")).toHaveLength(7);
    });
});
