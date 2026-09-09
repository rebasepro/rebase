import { Hono } from "hono";
import { RestApiGenerator } from "../src/api/rest/api-generator";
import { errorHandler } from "../src/api/errors";
import { rowETag, versionProperty } from "../src/api/rest/etag";
import type { DataDriver } from "../../types/src/controllers/data_driver";
import type { CollectionConfig } from "../../types/src/types/collections";

/**
 * Optimistic concurrency: an edit that names the version it was made against.
 *
 * Without it every `PATCH` is last-writer-wins over whatever it did not send.
 * That is fine for one field typed into a form and wrong for the shape the
 * admin, the CMS and every SDK caller actually produce — read the row, change
 * part of it, send the merge back. Two editors doing that a second apart both
 * succeed, and the first one's change is gone with no error anywhere.
 */

/** Stamped by the database on every write, so the tag is the row's version. */
const versioned = {
    slug: "docs",
    name: "Docs",
    singularName: "Doc",
    table: "docs",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        updated_at: { name: "Updated", type: "date", autoValue: "on_update" }
    }
} as unknown as CollectionConfig;

/** No version column: the tag has to come from the row itself. */
const plain = {
    slug: "notes",
    name: "Notes",
    singularName: "Note",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        body: { name: "Body", type: "string" }
    }
} as unknown as CollectionConfig;

function createHarness() {
    const rows = new Map<string, Record<string, unknown>>([
        ["d1", { id: "d1", title: "First", updated_at: "2026-01-01T00:00:00.000Z" }],
        ["n1", { id: "n1", body: "hello" }]
    ]);
    const deleted: string[] = [];

    const driver = {
        key: "postgres",
        initialised: true,
        async fetchOne({ id }: { id: string }) {
            return rows.get(String(id));
        },
        // Present, so the routes take the same read path `GET /:id` takes —
        // which is the whole reason the tag is stable between them.
        restFetchService: {
            async fetchOneForRest(_path: string, id: string) {
                return rows.get(String(id));
            }
        },
        async save({ id, values }: { id?: string; values: Record<string, unknown> }) {
            const next = { ...(rows.get(String(id)) ?? {}), ...values, id };
            rows.set(String(id), next);
            return next;
        },
        async delete({ row }: { row: { id: string } }) {
            deleted.push(String(row.id));
            rows.delete(String(row.id));
        }
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1" });
        await next();
    });
    app.route("/", new RestApiGenerator([versioned, plain], driver).generateRoutes());
    return { app, rows, deleted };
}

const patch = (app: Hono, path: string, body: unknown, headers?: Record<string, string>) =>
    app.request(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify(body)
    });

describe("ETag", () => {
    it("comes back on a read by id", async () => {
        const { app } = createHarness();

        const res = await app.request("/docs/d1");

        expect(res.status).toBe(200);
        expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/);
    });

    it("is the same for two reads of an unchanged row, and different after a write", async () => {
        const { app } = createHarness();

        const before = (await app.request("/docs/d1")).headers.get("ETag");
        expect((await app.request("/docs/d1")).headers.get("ETag")).toBe(before);

        await patch(app, "/docs/d1", { title: "Second", updated_at: "2026-02-02T00:00:00.000Z" });

        expect((await app.request("/docs/d1")).headers.get("ETag")).not.toBe(before);
    });

    it("does not depend on the order the driver returned the columns in", async () => {
        // A row's key order is whatever the SELECT produced, and the two read
        // paths in this file produce different ones. Hashing insertion order
        // would give the same row two tags and make every If-Match a coin toss.
        const a = await rowETag({ id: "x", body: "b", n: 1 }, plain);
        const b = await rowETag({ n: 1, id: "x", body: "b" }, plain);

        expect(a).toBe(b);
    });

    it("is taken from the version column when the collection declares one", async () => {
        expect(versionProperty(versioned)).toBe("updated_at");
        expect(versionProperty(plain)).toBeUndefined();

        // Only the stamp decides it: two rows differing everywhere else but
        // sharing a stamp are the same version of the same row as far as a
        // conditional write is concerned, and the tag is derived from the
        // column precisely so two backends serving one table agree.
        const a = await rowETag({ id: "d1", title: "one", updated_at: "2026-01-01T00:00:00.000Z" }, versioned);
        const b = await rowETag({ id: "d1", title: "two", updated_at: "2026-01-01T00:00:00.000Z" }, versioned);

        expect(a).toBe(b);
    });

    it("falls back per row, not per collection, when the stamp is null", async () => {
        // A collection that gained the column after its rows were written has
        // NULL there; hashing `null` for all of them would hand every such row
        // one tag, so every If-Match would pass against every other row.
        const a = await rowETag({ id: "1", title: "one", updated_at: null }, versioned);
        const b = await rowETag({ id: "2", title: "two", updated_at: null }, versioned);

        expect(a).not.toBe(b);
    });
});

describe("If-Match on PATCH", () => {
    it("writes when the tag still describes the row", async () => {
        const { app, rows } = createHarness();
        const etag = (await app.request("/docs/d1")).headers.get("ETag")!;

        const res = await patch(app, "/docs/d1", { title: "Second" }, { "If-Match": etag });

        expect(res.status).toBe(200);
        expect(rows.get("d1")!.title).toBe("Second");
    });

    it("refuses with 412 when the row has moved on, and writes nothing", async () => {
        const { app, rows } = createHarness();
        const stale = (await app.request("/docs/d1")).headers.get("ETag")!;
        // Somebody else's edit, between the read and the write.
        await patch(app, "/docs/d1", { title: "Theirs", updated_at: "2026-03-03T00:00:00.000Z" });

        const res = await patch(app, "/docs/d1", { title: "Mine" }, { "If-Match": stale });

        expect(res.status).toBe(412);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("PRECONDITION_FAILED");
        expect(rows.get("d1")!.title).toBe("Theirs");
    });

    it("works on a collection with no version column", async () => {
        const { app, rows } = createHarness();
        const etag = (await app.request("/notes/n1")).headers.get("ETag")!;

        expect(etag).toBeTruthy();
        expect((await patch(app, "/notes/n1", { body: "edited" }, { "If-Match": etag })).status).toBe(200);
        expect((await patch(app, "/notes/n1", { body: "again" }, { "If-Match": etag })).status).toBe(412);
        expect(rows.get("n1")!.body).toBe("edited");
    });

    it("accepts `*` as `the row must exist`", async () => {
        const { app } = createHarness();

        expect((await patch(app, "/docs/d1", { title: "x" }, { "If-Match": "*" })).status).toBe(200);
    });

    it("404s before the precondition when the row is gone", async () => {
        // A precondition on a row that is not there is not a conflict; the
        // caller's model is wrong in a different way, and 404 says which.
        const { app } = createHarness();

        expect((await patch(app, "/docs/missing", { title: "x" }, { "If-Match": "*" })).status).toBe(404);
    });

    it("is opt-in: no header, no precondition", async () => {
        const { app } = createHarness();

        expect((await patch(app, "/docs/d1", { title: "x" })).status).toBe(200);
    });

    it("accepts a list, as the header is defined to carry one", async () => {
        const { app } = createHarness();
        const etag = (await app.request("/docs/d1")).headers.get("ETag")!;

        const res = await patch(app, "/docs/d1", { title: "x" }, { "If-Match": `"deadbeef", ${etag}` });

        expect(res.status).toBe(200);
    });
});

describe("If-Match on DELETE", () => {
    it("refuses a stale delete and leaves the row", async () => {
        // The case that matters most: "remove the row I read" and "remove
        // whatever is there now" are different instructions, and only the first
        // is safe once somebody has edited it in between.
        const { app, rows, deleted } = createHarness();
        const stale = (await app.request("/docs/d1")).headers.get("ETag")!;
        await patch(app, "/docs/d1", { title: "Theirs", updated_at: "2026-03-03T00:00:00.000Z" });

        const res = await app.request("/docs/d1", { method: "DELETE", headers: { "If-Match": stale } });

        expect(res.status).toBe(412);
        expect(deleted).toEqual([]);
        expect(rows.has("d1")).toBe(true);
    });

    it("deletes when the tag is current", async () => {
        const { app, deleted } = createHarness();
        const etag = (await app.request("/docs/d1")).headers.get("ETag")!;

        const res = await app.request("/docs/d1", { method: "DELETE", headers: { "If-Match": etag } });

        expect(res.status).toBe(204);
        expect(deleted).toEqual(["d1"]);
    });
});
