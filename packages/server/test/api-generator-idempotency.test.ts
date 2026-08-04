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
describe("create with an Idempotency-Key", () => {
    /**
     * Stands in for the `rebase.idempotency_keys` table, modelling the
     * semantics the real SQL relies on rather than matching its text: a row is
     * claimed before the write runs, a claim with no response yet is in
     * flight, and only the first claimant of a key gets to proceed.
     */
    function createStore() {
        const PENDING = Symbol("pending");
        const rows = new Map<string, { response: unknown | typeof PENDING }>();
        const at = (uid: unknown, key: unknown) => `${String(uid)}::${String(key)}`;

        return {
            rows,
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                const params = options?.params ?? [];
                // claim: INSERT … ON CONFLICT DO UPDATE … RETURNING
                if (/^\s*INSERT INTO/i.test(sql)) {
                    const composite = at(params[1], params[0]);
                    if (rows.has(composite)) return [];      // fresh row: not claimed
                    rows.set(composite, { response: PENDING });
                    return [{ claimed: 1 }];
                }
                if (/^\s*SELECT response/i.test(sql)) {
                    const row = rows.get(at(params[0], params[1]));
                    if (!row) return [];
                    return [{
                        response: row.response === PENDING ? null : row.response,
                        pending: row.response === PENDING
                    }];
                }
                if (/^\s*UPDATE/i.test(sql)) {
                    const composite = at(params[0], params[1]);
                    if (rows.has(composite)) rows.set(composite, { response: JSON.parse(String(params[2])) });
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

    function createHarness(options?: { failFirstSave?: boolean; uid?: () => string }) {
        let nextId = 1;
        let saveAttempts = 0;
        const saved: Record<string, unknown>[] = [];
        const admin = createStore();

        const driver = {
            key: "postgres",
            initialised: true,
            admin,
            async save({ values }: { values: Record<string, unknown> }) {
                saveAttempts += 1;
                if (options?.failFirstSave && saveAttempts === 1) {
                    throw new Error("connection reset");
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
            c.set("user", { uid: options?.uid ? options.uid() : "user-1" });
            await next();
        });
        app.route("/", new RestApiGenerator(collections, driver).generateRoutes());
        return { app, saved, attempts: () => saveAttempts };
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

    it("lets a retry through after the write it claimed the key for failed", async () => {
        // Claiming before writing introduces a way to strand a key: if the write
        // throws, an unreleased claim would answer every retry with 409 until
        // the row aged out, turning one transient failure into a day of them.
        const { app, saved, attempts } = createHarness({ failFirstSave: true });

        const failed = await post(app, { title: "hello" }, "mut-1");
        expect(failed.status).toBeGreaterThanOrEqual(400);

        const retried = await post(app, { title: "hello" }, "mut-1");
        expect(retried.status).toBe(201);
        expect(attempts()).toBe(2);
        expect(saved).toHaveLength(1);
    });
});
