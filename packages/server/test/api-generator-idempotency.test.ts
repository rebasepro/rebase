import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * A replayed create must not insert a second row.
 *
 * The offline queue re-sends a mutation whenever it did not see the response,
 * which includes every write that committed and then lost its ACK. Where the
 * client picks the row id the replay collides and can be recognised; where the
 * server assigns one — `isId: "increment"`, which is what the scaffold's own
 * collections use — nothing distinguishes the replay from a new write, so it
 * inserts a duplicate. The key is the only thing that can tell them apart.
 */
/**
 * Stands in for the `rebase.idempotency_keys` table.
 *
 * It models the semantics rather than matching the statement text — but the
 * two predicates that decide whether a key can be taken over are read *out of
 * the SQL the store actually sends*, so a change to either window (or to the
 * shape of the predicate that carries it) is visible here instead of passing
 * silently. Nothing in this file executes real SQL: only the Postgres e2e can
 * catch a statement Postgres rejects, and this store swallows exactly that.
 */
function createKeyStore(clock: { now: number }) {
    const PENDING = Symbol("pending");
    type Stored = { response: unknown | typeof PENDING; fingerprint: string | null; createdAt: number };
    const rows = new Map<string, Stored>();
    const at = (uid: unknown, key: unknown) => `${String(uid)}::${String(key)}`;

    /** The `INTERVAL 'N unit'` guarding one branch of the takeover predicate. */
    const windowMs = (sql: string, guard: string, unit: "seconds" | "hours"): number => {
        const found = new RegExp(`${guard}[\\s\\S]*?INTERVAL '(\\d+) ${unit}'`).exec(sql);
        if (!found) throw new Error(`claim SQL no longer bounds \`${guard}\` by an INTERVAL in ${unit}`);
        return Number(found[1]) * (unit === "seconds" ? 1_000 : 3_600_000);
    };

    return {
        rows,
        async executeSql(sql: string, options?: { params?: unknown[] }) {
            const params = options?.params ?? [];
            // claim: INSERT … ON CONFLICT DO UPDATE … WHERE <expired> RETURNING
            if (/^\s*INSERT INTO/i.test(sql)) {
                const [key, uid, fingerprint] = params;
                const composite = at(uid, key);
                const claim = () => {
                    rows.set(composite, {
                        response: PENDING,
                        fingerprint: (fingerprint as string) ?? null,
                        createdAt: clock.now
                    });
                    return [{ claimed: 1 }];
                };
                const existing = rows.get(composite);
                if (!existing) return claim();
                const age = clock.now - existing.createdAt;
                const expired = existing.response === PENDING
                    ? age >= windowMs(sql, "response IS NULL", "seconds")
                    : age >= windowMs(sql, "response IS NOT NULL", "hours");
                return expired ? claim() : [];
            }
            if (/^\s*SELECT response/i.test(sql)) {
                const row = rows.get(at(params[0], params[1]));
                if (!row) return [];
                return [{
                    response: row.response === PENDING ? null : row.response,
                    pending: row.response === PENDING,
                    fingerprint: row.fingerprint
                }];
            }
            if (/^\s*UPDATE/i.test(sql)) {
                const composite = at(params[0], params[1]);
                const row = rows.get(composite);
                if (row) rows.set(composite, { ...row, response: JSON.parse(String(params[2])) });
                return [];
            }
            if (/^\s*DELETE FROM/i.test(sql) && /response IS NULL/i.test(sql)) {
                const composite = at(params[0], params[1]);
                if (rows.get(composite)?.response === PENDING) rows.delete(composite);
                return [];
            }
            return [];
        }
    };
}

describe("create with an Idempotency-Key", () => {
    function createHarness(options?: {
        failFirstSave?: boolean;
        /** First save never settles: the request that claimed the key is gone. */
        hangFirstSave?: boolean;
        uid?: () => string | undefined;
    }) {
        let nextId = 1;
        let saveAttempts = 0;
        const saved: Record<string, unknown>[] = [];
        const clock = { now: Date.UTC(2026, 0, 1) };
        const admin = createKeyStore(clock);

        const driver = {
            key: "postgres",
            initialised: true,
            admin,
            async save({ values }: { values: Record<string, unknown> }) {
                saveAttempts += 1;
                if (options?.failFirstSave && saveAttempts === 1) {
                    throw new Error("connection reset");
                }
                if (options?.hangFirstSave && saveAttempts === 1) {
                    // Never settles, and never throws: the pod was killed
                    // between the claim and the answer, so no release runs.
                    return new Promise<never>(() => undefined);
                }
                // A serial column: the server assigns the id and ignores any the
                // client invented. This is what makes a replay undetectable
                // without a key.
                const row = { ...values, id: nextId++ };
                saved.push(row);
                return row;
            }
        } as unknown as DataDriver;

        const collections = [{
            slug: "posts", name: "Posts", singularName: "Post", properties: {}
        }] as unknown as CollectionConfig[];

        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", driver);
            const uid = options?.uid ? options.uid() : "user-1";
            if (uid !== undefined) c.set("user", { uid });
            await next();
        });
        app.route("/", new RestApiGenerator(collections, driver).generateRoutes());
        return {
            app,
            saved,
            attempts: () => saveAttempts,
            /** Move the store's clock on, without waiting for the wall clock. */
            advance: (ms: number) => { clock.now += ms; }
        };
    }

    const post = (app: Hono, body: unknown, key?: string) =>
        app.request("/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
            body: JSON.stringify(body)
        });

    it("answers the replay from the first result instead of inserting again", async () => {
        const { app, saved } = createHarness();

        const first = await post(app, { title: "hello" }, "mut-1");
        const second = await post(app, { title: "hello" }, "mut-1");

        expect(first.status).toBe(201);
        expect(second.status).toBe(201);
        // The row is written once, and the replay gets the same id back — not a
        // second row with a second id, which is what the offline queue produced
        // for every lost ACK on a serial-id table.
        expect(saved).toHaveLength(1);
        expect(await second.json()).toEqual(await first.json());
    });

    it("treats a different key as a different write", async () => {
        const { app, saved } = createHarness();

        await post(app, { title: "one" }, "mut-1");
        await post(app, { title: "two" }, "mut-2");

        expect(saved).toHaveLength(2);
    });

    it("does not deduplicate when no key is sent", async () => {
        const { app, saved } = createHarness();

        await post(app, { title: "a" });
        await post(app, { title: "a" });

        // Two deliberate identical writes are two rows. Only a key makes a
        // repeat a replay.
        expect(saved).toHaveLength(2);
    });

    it("does not hand one user's stored response to another", async () => {
        // Mutation ids are generated on the client, so a key alone is guessable.
        // Scoping to the principal is what stops a write endpoint being used to
        // read somebody else's row back.
        let uid = "user-1";
        const { app, saved } = createHarness({ uid: () => uid });

        await post(app, { title: "mine" }, "shared-key");
        uid = "user-2";
        const other = await post(app, { title: "theirs" }, "shared-key");

        expect(saved).toHaveLength(2);
        expect(await other.json()).toMatchObject({ title: "theirs" });
    });

    it("writes one row when two requests race on the same key", async () => {
        // The queue is shared across tabs, so two tabs coming back online
        // replay it together — the case the store's own comment anticipates.
        // Recalling and then writing is not atomic: both requests missed the
        // recall, both wrote, and the second insert into the key table was the
        // only thing `ON CONFLICT DO NOTHING` protected.
        const { app, saved } = createHarness();

        const [first, second] = await Promise.all([
            post(app, { title: "hello" }, "mut-1"),
            post(app, { title: "hello" }, "mut-1")
        ]);

        expect(saved).toHaveLength(1);
        const statuses = [first.status, second.status].sort();
        expect(statuses).toEqual([201, 409]);
    });

    it("says a key is in progress rather than reporting a conflicting row", async () => {
        const { app } = createHarness();

        const [a, b] = await Promise.all([
            post(app, { title: "hello" }, "mut-1"),
            post(app, { title: "hello" }, "mut-1")
        ]);
        const losing = a.status === 409 ? a : b;

        expect(await losing.json()).toMatchObject({
            error: expect.objectContaining({ code: "IDEMPOTENCY_KEY_IN_PROGRESS" })
        });
    });

    it("lets a retry through once the claim of a request that never answered expires", async () => {
        // The failure this exists for: the process holding the key is killed
        // between the claim and the answer, so nothing releases it and the row
        // was never written. Reusing the 24-hour replay window as the lease
        // meant every retry of that key was refused for a day — a write plain
        // retrying would have completed, lost for good.
        const { app, saved, advance } = createHarness({ hangFirstSave: true });

        void post(app, { title: "hello" }, "mut-1"); // never answers

        // While the claim could still be a request in flight, it is refused.
        const early = await post(app, { title: "hello" }, "mut-1");
        expect(early.status).toBe(409);

        advance(61_000);
        const retried = await post(app, { title: "hello" }, "mut-1");
        expect(retried.status).toBe(201);
        expect(saved).toHaveLength(1);
    });

    it("still replays an answered key long after the pending lease would have expired", async () => {
        // The lease covers claims nobody came back for. A key that answered
        // keeps its reply for the full replay window, or an offline client
        // reconnecting an hour later would write its row a second time.
        const { app, saved, advance } = createHarness();

        const first = await post(app, { title: "hello" }, "mut-1");
        advance(6 * 3_600_000);
        const later = await post(app, { title: "hello" }, "mut-1");

        expect(later.status).toBe(201);
        expect(await later.json()).toEqual(await first.json());
        expect(saved).toHaveLength(1);
    });

    it("refuses a key that was claimed for a different request instead of replaying it", async () => {
        // A key names one request. Answering a second, different one with the
        // first one's stored body reports a write that never happened — and on
        // a delete under a create's key, reports rows gone that are still there.
        const { app, saved } = createHarness();

        await post(app, { title: "first" }, "order-42");
        const reused = await post(app, { title: "corrected" }, "order-42");

        expect(reused.status).toBe(422);
        expect(await reused.json()).toMatchObject({
            error: expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" })
        });
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ title: "first" });
    });

    it("recognises the same body written in a different key order as the same request", async () => {
        // The fingerprint has to survive re-encoding, or a legitimate retry of
        // one write would be refused as a reused key.
        const { app, saved } = createHarness();

        const first = await post(app, { title: "hello", draft: true }, "mut-1");
        const second = await post(app, { draft: true, title: "hello" }, "mut-1");

        expect(second.status).toBe(201);
        expect(await second.json()).toEqual(await first.json());
        expect(saved).toHaveLength(1);
    });

    it("ignores the key for an unauthenticated caller rather than sharing one namespace", async () => {
        // Every anonymous request would otherwise share a single principal, so
        // the second visitor to send `submission-1` is handed the first one's
        // stored response — their row, through a write endpoint. Ignoring the
        // key leaves them with the duplicate they had before it existed, which
        // is the lesser of the two.
        const { app, saved } = createHarness({ uid: () => undefined });

        const first = await post(app, { title: "mine" }, "submission-1");
        const second = await post(app, { title: "theirs" }, "submission-1");

        expect([first.status, second.status]).toEqual([201, 201]);
        expect(saved).toHaveLength(2);
        expect(await second.json()).toMatchObject({ title: "theirs" });
    });

    it("lets a retry through after the write it claimed the key for failed", async () => {
        // Claiming before writing introduces a way to strand a key: if the write
        // throws, an unreleased claim would answer every retry with 409 until
        // the row aged out, turning one transient failure into a day of them.
        const { app, saved, attempts } = createHarness({ failFirstSave: true });

        const failed = await post(app, { title: "hello" }, "mut-1");
        expect(failed.status).toBe(500);

        const retried = await post(app, { title: "hello" }, "mut-1");
        expect(retried.status).toBe(201);
        expect(attempts()).toBe(2);
        expect(saved).toHaveLength(1);
    });
});

/**
 * A replayed **batch** must not insert the batch again.
 *
 * `POST /<collection>/bulk` had no idempotency handling at all, and it is the
 * route where the consequence is largest: the same lost ACK that duplicates one
 * row through `create` duplicates every row in the batch here — up to
 * `maxBulkRows`, 1000 by default. The offline queue replays `createMany` on
 * exactly this path.
 *
 * `upsert: true` hid it for the callers who set it, since a conflicting insert
 * became an update. Nothing covered the callers who did not, and the docs
 * recommend `upsert` for re-runnable imports rather than for crash recovery.
 */
describe("createMany with an Idempotency-Key", () => {
    function createHarness(options?: { failFirstSave?: boolean }) {
        let nextId = 1;
        let saveManyAttempts = 0;
        const saved: Record<string, unknown>[] = [];
        const deleted: (string | number)[] = [];
        const clock = { now: Date.UTC(2026, 0, 1) };
        const admin = createKeyStore(clock);

        const driver = {
            key: "postgres",
            initialised: true,
            admin,
            async saveMany({ rows }: { rows: Record<string, unknown>[] }) {
                saveManyAttempts += 1;
                if (options?.failFirstSave && saveManyAttempts === 1) {
                    throw new Error("connection reset");
                }
                // Server-assigned ids, as with `save` above: this is what makes
                // a replay indistinguishable from a fresh import without a key.
                const written = rows.map(values => ({ ...values, id: nextId++ }));
                saved.push(...written);
                return written;
            },
            async deleteMany({ ids }: { ids: (string | number)[] }) {
                deleted.push(...ids);
            }
        } as unknown as DataDriver;

        const collections = [{
            slug: "posts", name: "Posts", singularName: "Post", properties: {}
        }] as unknown as CollectionConfig[];

        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", driver);
            c.set("user", { uid: "user-1" });
            await next();
        });
        app.route("/", new RestApiGenerator(collections, driver).generateRoutes());
        return { app, saved, deleted, attempts: () => saveManyAttempts };
    }

    const bulk = (app: Hono, rows: unknown[], key?: string) =>
        app.request("/posts/bulk", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
            body: JSON.stringify({ rows })
        });

    const bulkDelete = (app: Hono, ids: unknown[], key?: string) =>
        app.request("/posts/bulk/delete", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
            body: JSON.stringify({ ids })
        });

    const twoRows = [{ title: "a" }, { title: "b" }];

    it("replays the first result instead of writing the batch again", async () => {
        const { app, saved, attempts } = createHarness();

        const first = await bulk(app, twoRows, "batch-1");
        const second = await bulk(app, twoRows, "batch-1");

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(await second.json()).toEqual(await first.json());
        // The assertion that matters: two rows total, not four.
        expect(saved).toHaveLength(2);
        expect(attempts()).toBe(1);
    });

    it("writes the batch twice without a key — the behaviour the key exists to fix", async () => {
        const { app, saved } = createHarness();

        await bulk(app, twoRows);
        await bulk(app, twoRows);

        expect(saved).toHaveLength(4);
    });

    it("treats a different key as a different batch", async () => {
        const { app, saved } = createHarness();

        await bulk(app, twoRows, "batch-1");
        await bulk(app, twoRows, "batch-2");

        expect(saved).toHaveLength(4);
    });

    it("refuses a delete sent under the key of an earlier create", async () => {
        // The documented pattern was one business `importId` for a whole job:
        // `createMany` under it, then `deleteMany` of the stale rows under the
        // same key. The delete was answered with the create's `200` body — a
        // response shape from another endpoint — `deleteMany` returns `void`,
        // so nothing looked wrong, and the rows were still there.
        const { app, saved, deleted } = createHarness();

        await bulk(app, twoRows, "import-7");
        const dropped = await bulkDelete(app, ["old-1", "old-2"], "import-7");

        expect(dropped.status).toBe(422);
        expect(await dropped.json()).toMatchObject({
            error: expect.objectContaining({ code: "IDEMPOTENCY_KEY_REUSED" })
        });
        expect(saved).toHaveLength(2);
        expect(deleted).toHaveLength(0);
    });

    it("refuses a re-run of the same import carrying corrected rows", async () => {
        // Same key, different rows: the corrected batch is not a retry of the
        // first one, and answering it with the first one's rows discards the
        // correction while reporting success.
        const { app, saved, attempts } = createHarness();

        await bulk(app, twoRows, "import-7");
        const corrected = await bulk(app, [{ title: "a" }, { title: "b-fixed" }], "import-7");

        expect(corrected.status).toBe(422);
        expect(attempts()).toBe(1);
        expect(saved).toHaveLength(2);
    });

    it("releases the key when the write fails, so the retry is allowed through", async () => {
        // A transient failure must not burn the key: refusing every retry of it
        // until the row ages out would turn one dropped connection into a batch
        // that can never be sent.
        const { app, saved } = createHarness({ failFirstSave: true });

        const failed = await bulk(app, twoRows, "batch-1");
        expect(failed.status).toBe(500);
        expect(saved).toHaveLength(0);

        const retried = await bulk(app, twoRows, "batch-1");
        expect(retried.status).toBe(200);
        expect(saved).toHaveLength(2);
    });
});
