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
    /** Stands in for the `rebase.idempotency_keys` table. */
    function createHarness() {
        const keys = new Map<string, unknown>();
        let nextId = 1;
        const saved: Record<string, unknown>[] = [];

        const admin = {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                const params = options?.params ?? [];
                if (/^\s*SELECT response/i.test(sql)) {
                    const stored = keys.get(`${String(params[0])}::${String(params[1])}`);
                    return stored === undefined ? [] : [{ response: stored }];
                }
                if (/^\s*INSERT INTO/i.test(sql)) {
                    const composite = `${String(params[1])}::${String(params[0])}`;
                    // ON CONFLICT DO NOTHING — first writer wins.
                    if (!keys.has(composite)) keys.set(composite, JSON.parse(String(params[2])));
                    return [];
                }
                return [];
            }
        };

        const driver = {
            key: "postgres",
            initialised: true,
            admin,
            async save({ values }: { values: Record<string, unknown> }) {
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
            c.set("user", { uid: "user-1" });
            await next();
        });
        app.route("/", new RestApiGenerator(collections, driver).generateRoutes());
        return { app, saved };
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
        const keys = new Map<string, unknown>();
        let nextId = 1;
        const saved: Record<string, unknown>[] = [];
        const admin = {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                const params = options?.params ?? [];
                if (/^\s*SELECT response/i.test(sql)) {
                    const stored = keys.get(`${String(params[0])}::${String(params[1])}`);
                    return stored === undefined ? [] : [{ response: stored }];
                }
                if (/^\s*INSERT INTO/i.test(sql)) {
                    const composite = `${String(params[1])}::${String(params[0])}`;
                    if (!keys.has(composite)) keys.set(composite, JSON.parse(String(params[2])));
                }
                return [];
            }
        };
        const driver = {
            key: "postgres", initialised: true, admin,
            async save({ values }: { values: Record<string, unknown> }) {
                const row = { ...values, id: nextId++ };
                saved.push(row);
                return row;
            }
        } as unknown as DataDriver;
        const collections = [{
            slug: "posts", name: "Posts", singularName: "Post", properties: {}
        }] as unknown as CollectionConfig[];

        let uid = "user-1";
        const app = new Hono();
        app.onError(errorHandler);
        app.use("/*", async (c, next) => {
            c.set("driver", driver);
            c.set("user", { uid });
            await next();
        });
        app.route("/", new RestApiGenerator(collections, driver).generateRoutes());

        await post(app, { title: "mine" }, "shared-key");
        uid = "user-2";
        const other = await post(app, { title: "theirs" }, "shared-key");

        expect(saved).toHaveLength(2);
        expect(await other.json()).toMatchObject({ title: "theirs" });
    });
});
