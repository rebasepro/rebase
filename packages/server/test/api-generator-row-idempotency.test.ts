import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * `Idempotency-Key` on the single-row `PATCH` and `DELETE`.
 *
 * The SDK has sent this header on `update()` since the option existed, and
 * these two routes read it off no request at all: the mechanism lived in a
 * closure inside the bulk routes, one scope away, and nothing said so. A
 * `PATCH` is not naturally idempotent — with a field operation it is
 * emphatically not — so a retry after a lost response applied the edit twice.
 * A `DELETE` is worse in the other direction: the replay answers 404, which an
 * offline queue reads as permanent failure for a delete that had succeeded.
 */

/** The store the bulk suite models, kept to the semantics that matter here. */
function createKeyStore() {
    const PENDING = Symbol("pending");
    type Stored = { response: unknown | typeof PENDING; fingerprint: string | null };
    const rows = new Map<string, Stored>();
    const at = (uid: unknown, key: unknown) => `${String(uid)}::${String(key)}`;
    /** Resolves once `nth` claims have been attempted, for the racing test. */
    let claims = 0;
    const waiters: Array<{ nth: number; resolve: () => void }> = [];

    return {
        rows,
        whenClaimed(nth: number): Promise<void> {
            if (claims >= nth) return Promise.resolve();
            return new Promise<void>(resolve => { waiters.push({ nth, resolve }); });
        },
        async executeSql(sql: string, options?: { params?: unknown[] }) {
            const params = options?.params ?? [];
            if (/^\s*INSERT INTO/i.test(sql)) {
                claims += 1;
                for (const waiter of waiters.splice(0)) {
                    if (claims >= waiter.nth) waiter.resolve();
                    else waiters.push(waiter);
                }
                const [key, uid, fingerprint] = params;
                const composite = at(uid, key);
                if (rows.has(composite)) return [];
                rows.set(composite, { response: PENDING, fingerprint: (fingerprint as string) ?? null });
                return [{ claimed: 1 }];
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

const posts = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        views: { name: "Views", type: "number" }
    }
} as unknown as CollectionConfig;

function createHarness(options?: { gateFirstWrite?: boolean; failFirstWrite?: boolean }) {
    const admin = createKeyStore();
    const saves: Record<string, unknown>[] = [];
    const deletes: string[] = [];
    let writes = 0;

    const driver = {
        key: "postgres",
        initialised: true,
        admin,
        async fetchOne({ id }: { id: string }) {
            return deletes.includes(String(id)) ? undefined : { id: String(id), title: "First", views: 1 };
        },
        async save({ id, values }: { id?: string; values: Record<string, unknown> }) {
            writes += 1;
            if (options?.failFirstWrite && writes === 1) throw new Error("connection reset");
            if (options?.gateFirstWrite && writes === 1) await admin.whenClaimed(2);
            const row = { id, ...values, revision: writes };
            saves.push(row);
            return row;
        },
        async delete({ row }: { row: { id: string } }) {
            writes += 1;
            if (options?.gateFirstWrite && writes === 1) await admin.whenClaimed(2);
            deletes.push(String(row.id));
        }
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1" });
        await next();
    });
    app.route("/", new RestApiGenerator([posts], driver).generateRoutes());
    return { app, saves, deletes, writeCount: () => writes };
}

const patch = (app: Hono, body: unknown, key?: string) =>
    app.request("/posts/p1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) },
        body: JSON.stringify(body)
    });

const del = (app: Hono, key?: string, id = "p1") =>
    app.request(`/posts/${id}`, {
        method: "DELETE",
        ...(key ? { headers: { "Idempotency-Key": key } } : {})
    });

describe("PATCH with an Idempotency-Key", () => {
    it("replays the first answer instead of applying the edit again", async () => {
        const { app, saves } = createHarness();

        const first = await patch(app, { title: "Second" }, "mut-1");
        const second = await patch(app, { title: "Second" }, "mut-1");

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(saves).toHaveLength(1);
        expect(await second.json()).toEqual(await first.json());
    });

    it("still applies two edits sent under two keys", async () => {
        const { app, saves } = createHarness();

        await patch(app, { title: "a" }, "mut-1");
        await patch(app, { title: "b" }, "mut-2");

        expect(saves).toHaveLength(2);
    });

    it("refuses a key presented with a different body", async () => {
        // A key names one request. Replaying the first edit's answer for a
        // second, different edit would report a change that never happened.
        const { app, saves } = createHarness();

        await patch(app, { title: "a" }, "mut-1");
        const other = await patch(app, { title: "b" }, "mut-1");

        expect(other.status).toBe(422);
        expect((await other.json() as { error: { code: string } }).error.code)
            .toBe("IDEMPOTENCY_KEY_REUSED");
        expect(saves).toHaveLength(1);
    });

    it("says a key is in progress rather than writing twice", async () => {
        const { app, saves } = createHarness({ gateFirstWrite: true });

        const [a, b] = await Promise.all([
            patch(app, { title: "x" }, "mut-1"),
            patch(app, { title: "x" }, "mut-1")
        ]);

        expect(saves).toHaveLength(1);
        expect([a.status, b.status].sort()).toEqual([200, 409]);
    });

    it("hands the key back when the write fails, so a retry can use it", async () => {
        const { app, saves } = createHarness({ failFirstWrite: true });

        expect((await patch(app, { title: "x" }, "mut-1")).status).toBe(500);
        expect((await patch(app, { title: "x" }, "mut-1")).status).toBe(200);
        expect(saves).toHaveLength(1);
    });

    it("does not deduplicate without a key", async () => {
        const { app, saves } = createHarness();

        await patch(app, { title: "x" });
        await patch(app, { title: "x" });

        expect(saves).toHaveLength(2);
    });
});

describe("DELETE with an Idempotency-Key", () => {
    it("replays the 204 rather than 404ing on the row it just removed", async () => {
        // Without the key the replay reads the row, finds it gone and answers
        // 404 — which the offline queue treats as a permanent failure and
        // surfaces as an error for a delete that in fact succeeded.
        const { app, deletes } = createHarness();

        const first = await del(app, "mut-1");
        const second = await del(app, "mut-1");

        expect(first.status).toBe(204);
        expect(second.status).toBe(204);
        expect(deletes).toEqual(["p1"]);
    });

    it("refuses a key already used for a different row", async () => {
        const { app } = createHarness();

        await del(app, "mut-1", "p1");
        const other = await del(app, "mut-1", "p2");

        expect(other.status).toBe(422);
    });

    it("says a key is in progress rather than deleting twice", async () => {
        const { app, deletes } = createHarness({ gateFirstWrite: true });

        const [a, b] = await Promise.all([del(app, "mut-1"), del(app, "mut-1")]);

        expect(deletes).toEqual(["p1"]);
        expect([a.status, b.status].sort()).toEqual([204, 409]);
    });

    it("404s a second delete sent without a key", async () => {
        const { app } = createHarness();

        expect((await del(app)).status).toBe(204);
        expect((await del(app)).status).toBe(404);
    });
});
