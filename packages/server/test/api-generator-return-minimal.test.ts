import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * `Prefer: return=minimal` (RFC 7240).
 *
 * Every write here answers with the full row, which is the right default — it
 * carries what the *server* decided: a serial id, an `autoValue` stamp,
 * whatever `beforeSave` rewrote. It is the wrong default for an import, where
 * it is a row serialisation and, on Postgres, a read-back per written row, all
 * discarded on arrival.
 *
 * A single write then answers `204`. A bulk or batch write answers `200`
 * carrying the ids, not `204` — on a create the id is the one thing the caller
 * cannot compute, and a batch that discarded them would have to re-read the
 * table by some natural key to learn what it had just written.
 */

const posts = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    properties: {
        id: { name: "ID", type: "number", isId: "serial" },
        title: { name: "Title", type: "string" }
    }
} as unknown as CollectionConfig;

/** Two key columns, so the composite answer is exercised rather than assumed. */
const memberships = {
    slug: "memberships",
    name: "Memberships",
    singularName: "Membership",
    table: "memberships",
    properties: {
        user_id: { name: "User", type: "string", isId: true },
        role_id: { name: "Role", type: "string", isId: true },
        note: { name: "Note", type: "string" }
    }
} as unknown as CollectionConfig;

function createHarness() {
    let nextId = 1;
    const driver = {
        key: "postgres",
        initialised: true,
        async fetchOne({ id }: { id: string }) {
            return { id: String(id), title: "x" };
        },
        async save({ id, values }: { id?: string; values: Record<string, unknown> }) {
            return { id: id ?? nextId++, ...values };
        },
        async saveMany({ rows }: { rows: Record<string, unknown>[] }) {
            return rows.map((row) => ({ id: nextId++, ...row }));
        },
        async updateMany({ updates }: { updates: { id: string | number; values: Record<string, unknown> }[] }) {
            return updates.map((u) => ({ id: u.id, ...u.values }));
        }
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1" });
        await next();
    });
    app.route("/", new RestApiGenerator([posts, memberships], driver).generateRoutes());
    return { app };
}

const minimal = { "Content-Type": "application/json", Prefer: "return=minimal" };

describe("Prefer: return=minimal", () => {
    it("answers a create with 204 and no body", async () => {
        const { app } = createHarness();

        const res = await app.request("/posts", {
            method: "POST", headers: minimal, body: JSON.stringify({ title: "x" })
        });

        expect(res.status).toBe(204);
        expect(res.headers.get("Preference-Applied")).toBe("return=minimal");
        expect(await res.text()).toBe("");
    });

    it("answers an update with 204", async () => {
        const { app } = createHarness();

        const res = await app.request("/posts/1", {
            method: "PATCH", headers: minimal, body: JSON.stringify({ title: "y" })
        });

        expect(res.status).toBe(204);
    });

    it("sends the rows when the header is absent", async () => {
        const { app } = createHarness();

        const res = await app.request("/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "x" })
        });

        expect(res.status).toBe(201);
        expect(await res.json()).toMatchObject({ title: "x" });
        expect(res.headers.get("Preference-Applied")).toBeNull();
    });

    it("ignores a preference it does not implement", async () => {
        const { app } = createHarness();

        const res = await app.request("/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "respond-async" },
            body: JSON.stringify({ title: "x" })
        });

        expect(res.status).toBe(201);
    });

    it("reads the token out of a list of preferences", async () => {
        const { app } = createHarness();

        const res = await app.request("/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json", Prefer: "respond-async, return=minimal" },
            body: JSON.stringify({ title: "x" })
        });

        expect(res.status).toBe(204);
    });

    it("answers a bulk create with the ids and the count", async () => {
        const { app } = createHarness();

        const res = await app.request("/posts/bulk", {
            method: "POST", headers: minimal, body: JSON.stringify({ rows: [{ title: "a" }, { title: "b" }] })
        });

        expect(res.status).toBe(200);
        expect(res.headers.get("Preference-Applied")).toBe("return=minimal");
        expect(await res.json()).toEqual({ data: [1, 2], meta: { written: 2 } });
    });

    it("answers a bulk update with the ids", async () => {
        const { app } = createHarness();

        const res = await app.request("/posts/bulk", {
            method: "PATCH",
            headers: minimal,
            body: JSON.stringify({ updates: [{ id: 7, data: { title: "a" } }] })
        });

        expect(await res.json()).toEqual({ data: [7], meta: { written: 1 } });
    });

    it("sends a composite key as an object, since it cannot be flattened", async () => {
        const { app } = createHarness();

        const res = await app.request("/memberships/bulk", {
            method: "POST",
            headers: minimal,
            body: JSON.stringify({ rows: [{ user_id: "u", role_id: "r", note: "n" }] })
        });

        expect(await res.json()).toEqual({
            data: [{ user_id: "u", role_id: "r" }],
            meta: { written: 1 }
        });
    });
});
