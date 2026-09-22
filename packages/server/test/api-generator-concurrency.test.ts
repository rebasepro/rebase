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
 *
 * The driver below renders rows the way the Postgres driver does, because the
 * two reads involved do not agree about a row's shape and that disagreement is
 * what broke `If-Match`: `fetchOne` returns the admin view model (`toFlatRow`),
 * where a date is a `{ __type: "date", value }` envelope, while the REST read
 * (`fetchOneForRest`, `toRestRow`) returns the ISO string — narrowed by
 * `?fields=` and widened by `?include=` exactly as asked. A mock serving one
 * shape to both hid that the write routes hashed a different row from the one
 * `GET` had hashed.
 */

/** Stamped by the database on every write, so the tag is the row's version. */
const docs = {
    slug: "docs",
    name: "Docs",
    singularName: "Doc",
    table: "docs",
    softDelete: true,
    properties: {
        id: { name: "ID", type: "string", isId: true },
        title: { name: "Title", type: "string" },
        updated_at: { name: "Updated", type: "date", autoValue: "on_update" },
        notes: {
            name: "Notes",
            type: "relation",
            relation: { kind: "hasMany", target: () => notes, foreignKeyOnTarget: "doc_id" }
        }
    }
} as unknown as CollectionConfig;

/** No version column: the tag has to come from the row itself. */
const notes = {
    slug: "notes",
    name: "Notes",
    singularName: "Note",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        body: { name: "Body", type: "string" },
        doc_id: { name: "Doc", type: "string" }
    }
} as unknown as CollectionConfig;

const collections: Record<string, CollectionConfig> = { docs, notes };

type Stored = Record<string, unknown>;
type ReadOptions = { fields?: string[]; withDeleted?: boolean | "only" };

/** `toFlatRow`: a date comes back as the envelope the admin client revives. */
function flatRow(row: Stored): Stored {
    return Object.fromEntries(Object.entries(row).map(([key, value]) =>
        [key, value instanceof Date ? { __type: "date", value: value.toISOString() } : value]));
}

/** `toRestRow` + `loadIncludes`: a date is its ISO string, the projection and the includes applied. */
function restRow(row: Stored, include: unknown, fields: string[] | undefined): Stored {
    const rendered: Stored = Object.fromEntries(Object.entries(row)
        .filter(([key]) => !fields || key === "id" || fields.includes(key))
        .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]));
    const names = Array.isArray(include) ? include as string[] : Object.keys((include as object | undefined) ?? {});
    for (const name of names) rendered[name] = { id: "related-1", title: "Related" };
    return rendered;
}

function createHarness(options: { restRead?: boolean } = {}) {
    // The database's clock: every write stamps `updated_at` with the next tick,
    // as `autoValue: "on_update"` does. A caller never sends it.
    let clock = Date.parse("2026-01-01T00:00:00.000Z");
    const tick = () => new Date(clock += 60_000);

    const tables: Record<string, Map<string, Stored>> = {
        docs: new Map([["d1", { id: "d1", title: "First", updated_at: tick(), deletedAt: null }]]),
        notes: new Map([["n1", { id: "n1", body: "hello", doc_id: "d1" }]])
    };
    const deleted: string[] = [];

    /** The table a path reaches, and the row, scoped to its parent when nested. */
    const locate = (path: string, id: string, withDeleted?: boolean | "only") => {
        const segments = path.split("/").filter(Boolean);
        const slug = segments.length === 1 ? segments[0] : segments[segments.length - 1];
        const row = tables[slug]?.get(String(id));
        if (!row) return { slug, row: undefined };
        if (segments.length === 3 && row.doc_id !== segments[1]) return { slug, row: undefined };
        const trashed = row.deletedAt !== undefined && row.deletedAt !== null;
        if (trashed && !withDeleted) return { slug, row: undefined };
        if (!trashed && withDeleted === "only") return { slug, row: undefined };
        return { slug, row };
    };

    const restFetchService = {
        async fetchOneForRest(path: string, id: string, include?: unknown, _databaseId?: string, read?: ReadOptions) {
            const { row } = locate(path, id, read?.withDeleted);
            return row ? restRow(row, include, read?.fields) : null;
        }
    };

    const driver = {
        key: "postgres",
        initialised: true,
        async fetchOne({ path, id, withDeleted }: { path: string; id: string; withDeleted?: boolean | "only" }) {
            const { row } = locate(path, id, withDeleted);
            return row ? flatRow(row) : undefined;
        },
        ...(options.restRead === false ? {} : { restFetchService }),
        async save({ path, id, values }: { path: string; id?: string; values: Record<string, unknown> }) {
            const { slug, row } = locate(path, String(id));
            const next: Stored = { ...(row ?? {}), ...values, id };
            if (versionProperty(collections[slug])) next.updated_at = tick();
            tables[slug].set(String(id), next);
            return flatRow(next);
        },
        async delete({ row, hard }: { row: { id: string; path: string }; hard?: boolean }) {
            const { slug } = locate(row.path, row.id, true);
            deleted.push(String(row.id));
            if (collections[slug].softDelete && !hard) {
                tables[slug].set(row.id, { ...tables[slug].get(row.id), deletedAt: tick() });
            } else {
                tables[slug].delete(row.id);
            }
        }
    } as unknown as DataDriver;

    const app = new Hono();
    app.onError(errorHandler);
    app.use("/*", async (c, next) => {
        c.set("driver", driver);
        c.set("user", { uid: "user-1" });
        await next();
    });
    app.route("/", new RestApiGenerator([docs, notes], driver).generateRoutes());
    return { app, tables, deleted };
}

const patch = (app: Hono, path: string, body: unknown, headers?: Record<string, string>) =>
    app.request(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(headers ?? {}) },
        body: JSON.stringify(body)
    });

const etagOf = async (app: Hono, path: string) => {
    const res = await app.request(path);
    expect(res.status).toBe(200);
    return res.headers.get("ETag")!;
};

describe("ETag", () => {
    it("comes back on a read by id", async () => {
        const { app } = createHarness();

        const res = await app.request("/docs/d1");

        expect(res.status).toBe(200);
        expect(res.headers.get("ETag")).toMatch(/^"[0-9a-f]{64}"$/);
    });

    it("is the same for two reads of an unchanged row, and different after a write", async () => {
        const { app } = createHarness();

        const before = await etagOf(app, "/docs/d1");
        expect(await etagOf(app, "/docs/d1")).toBe(before);

        await patch(app, "/docs/d1", { title: "Second" });

        expect(await etagOf(app, "/docs/d1")).not.toBe(before);
    });

    it("names the row, not the projection or the relations a read asked for", async () => {
        // A write compares `If-Match` against the row itself. A tag hashed
        // after `?fields=` dropped the version column, or after `?include=`
        // added a relation, matched nothing a write would ever compute.
        const { app } = createHarness();

        const doc = await etagOf(app, "/docs/d1");
        expect(await etagOf(app, "/docs/d1?fields=title")).toBe(doc);
        expect(await etagOf(app, "/docs/d1?include=notes")).toBe(doc);

        const note = await etagOf(app, "/notes/n1");
        expect(await etagOf(app, "/notes/n1?fields=body")).toBe(note);
        expect(await etagOf(app, "/notes/n1?include=doc")).toBe(note);
    });

    it("still serves the projection and the relations the read asked for", async () => {
        const { app } = createHarness();

        expect(await (await app.request("/docs/d1?fields=title")).json()).toEqual({ id: "d1", title: "First" });
        expect(await (await app.request("/notes/n1?include=doc")).json())
            .toEqual({ id: "n1", body: "hello", doc_id: "d1", doc: { id: "related-1", title: "Related" } });
    });

    it("comes back on a nested read, the same as on the row's own address", async () => {
        const { app } = createHarness();

        const nested = (await app.request("/docs/d1/notes/n1")).headers.get("ETag");

        expect(nested).toMatch(/^"[0-9a-f]{64}"$/);
        expect(nested).toBe(await etagOf(app, "/notes/n1"));
        expect(await etagOf(app, "/docs/d1/notes/n1?fields=body")).toBe(nested);
    });

    it("does not depend on the order the driver returned the columns in", async () => {
        // A row's key order is whatever the SELECT produced, and the two read
        // paths in this file produce different ones. Hashing insertion order
        // would give the same row two tags and make every If-Match a coin toss.
        const a = await rowETag({ id: "x", body: "b", n: 1 }, notes);
        const b = await rowETag({ n: 1, id: "x", body: "b" }, notes);

        expect(a).toBe(b);
    });

    it("is taken from the version column when the collection declares one", async () => {
        expect(versionProperty(docs)).toBe("updated_at");
        expect(versionProperty(notes)).toBeUndefined();

        // Only the stamp decides it: two rows differing everywhere else but
        // sharing a stamp are the same version of the same row as far as a
        // conditional write is concerned, and the tag is derived from the
        // column precisely so two backends serving one table agree.
        const a = await rowETag({ id: "d1", title: "one", updated_at: "2026-01-01T00:00:00.000Z" }, docs);
        const b = await rowETag({ id: "d1", title: "two", updated_at: "2026-01-01T00:00:00.000Z" }, docs);

        expect(a).toBe(b);
    });

    it("tells two versions apart whatever shape the version value has", async () => {
        // `String()` of an object is `[object Object]` whatever it holds, so a
        // version read as an object gave every version of the row one tag — a
        // stale `If-Match` then matched, and the write it should have refused
        // went through.
        const v1 = await rowETag({ id: "d1", updated_at: { __type: "date", value: "2026-01-01T00:00:00.000Z" } }, docs);
        const v2 = await rowETag({ id: "d1", updated_at: { __type: "date", value: "2026-02-02T00:00:00.000Z" } }, docs);

        expect(v1).not.toBe(v2);
    });

    it("falls back per row, not per collection, when the stamp is null", async () => {
        // A collection that gained the column after its rows were written has
        // NULL there; hashing `null` for all of them would hand every such row
        // one tag, so every If-Match would pass against every other row.
        const a = await rowETag({ id: "1", title: "one", updated_at: null }, docs);
        const b = await rowETag({ id: "2", title: "two", updated_at: null }, docs);

        expect(a).not.toBe(b);
    });
});

describe("If-Match on PATCH", () => {
    it("writes when the tag still describes the row", async () => {
        const { app, tables } = createHarness();
        const etag = await etagOf(app, "/docs/d1");

        const res = await patch(app, "/docs/d1", { title: "Second" }, { "If-Match": etag });

        expect(res.status).toBe(200);
        expect(tables.docs.get("d1")!.title).toBe("Second");
    });

    it("writes with the tag a projected or included read handed out", async () => {
        const { app, tables } = createHarness();

        const projected = await etagOf(app, "/docs/d1?fields=title");
        expect((await patch(app, "/docs/d1", { title: "Second" }, { "If-Match": projected })).status).toBe(200);

        const included = await etagOf(app, "/notes/n1?include=doc");
        expect((await patch(app, "/notes/n1", { body: "edited" }, { "If-Match": included })).status).toBe(200);

        expect(tables.docs.get("d1")!.title).toBe("Second");
        expect(tables.notes.get("n1")!.body).toBe("edited");
    });

    it("refuses with 412 when the row has moved on, and writes nothing", async () => {
        const { app, tables } = createHarness();
        const stale = await etagOf(app, "/docs/d1");
        // Somebody else's edit, between the read and the write.
        await patch(app, "/docs/d1", { title: "Theirs" });

        const res = await patch(app, "/docs/d1", { title: "Mine" }, { "If-Match": stale });

        expect(res.status).toBe(412);
        expect((await res.json() as { error: { code: string } }).error.code).toBe("PRECONDITION_FAILED");
        expect(tables.docs.get("d1")!.title).toBe("Theirs");
    });

    it("reports the current tag in a 412, and it is the one a read of the row hands out", async () => {
        // `details.current` is what a client retries with. It used to hash
        // `[object Object]` — one value for every version of every row — so a
        // retry with it passed however far the row had moved on since.
        const { app } = createHarness();
        const stale = await etagOf(app, "/docs/d1");
        await patch(app, "/docs/d1", { title: "Theirs" });

        const first = await patch(app, "/docs/d1", { title: "Mine" }, { "If-Match": stale });
        const current = (await first.json() as { error: { details: { current: string } } }).error.details.current;

        expect(current).toBe(await etagOf(app, "/docs/d1"));
        expect(current).not.toBe(stale);

        // The row moves on again: the tag from the 412 is stale in its turn.
        await patch(app, "/docs/d1", { title: "Theirs again" });
        expect((await patch(app, "/docs/d1", { title: "Mine" }, { "If-Match": current })).status).toBe(412);
    });

    it("works on a collection with no version column", async () => {
        const { app, tables } = createHarness();
        const etag = await etagOf(app, "/notes/n1");

        expect((await patch(app, "/notes/n1", { body: "edited" }, { "If-Match": etag })).status).toBe(200);
        expect((await patch(app, "/notes/n1", { body: "again" }, { "If-Match": etag })).status).toBe(412);
        expect(tables.notes.get("n1")!.body).toBe("edited");
    });

    it("works on a driver with no REST read, where both sides read `fetchOne`", async () => {
        const { app, tables } = createHarness({ restRead: false });
        const etag = await etagOf(app, "/docs/d1");

        expect((await patch(app, "/docs/d1", { title: "Second" }, { "If-Match": etag })).status).toBe(200);
        expect((await patch(app, "/docs/d1", { title: "Third" }, { "If-Match": etag })).status).toBe(412);
        expect(tables.docs.get("d1")!.title).toBe("Second");
    });

    it("works through a parent, with the tag the nested read handed out", async () => {
        const { app, tables } = createHarness();
        const etag = await etagOf(app, "/docs/d1/notes/n1");

        expect((await patch(app, "/docs/d1/notes/n1", { body: "edited" }, { "If-Match": etag })).status).toBe(200);
        expect((await patch(app, "/docs/d1/notes/n1", { body: "again" }, { "If-Match": etag })).status).toBe(412);
        expect(tables.notes.get("n1")!.body).toBe("edited");
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
        const etag = await etagOf(app, "/docs/d1");

        const res = await patch(app, "/docs/d1", { title: "x" }, { "If-Match": `"deadbeef", ${etag}` });

        expect(res.status).toBe(200);
    });
});

describe("If-Match on DELETE", () => {
    it("refuses a stale delete and leaves the row", async () => {
        // The case that matters most: "remove the row I read" and "remove
        // whatever is there now" are different instructions, and only the first
        // is safe once somebody has edited it in between.
        const { app, tables, deleted } = createHarness();
        const stale = await etagOf(app, "/docs/d1");
        await patch(app, "/docs/d1", { title: "Theirs" });

        const res = await app.request("/docs/d1", { method: "DELETE", headers: { "If-Match": stale } });

        expect(res.status).toBe(412);
        expect(deleted).toEqual([]);
        expect(tables.docs.has("d1")).toBe(true);
    });

    it("deletes when the tag is current", async () => {
        const { app, deleted } = createHarness();
        const etag = await etagOf(app, "/docs/d1");

        const res = await app.request("/docs/d1", { method: "DELETE", headers: { "If-Match": etag } });

        expect(res.status).toBe(204);
        expect(deleted).toEqual(["d1"]);
    });

    it("purges a trashed row with the tag the trash listing's read handed out", async () => {
        // `?hard=true` reads the row with its soft-deleted ones included — the
        // "empty trash" operation removes exactly the rows the default read
        // hides. The row the tag was compared against has to be read the same
        // way, or it is absent, and every conditional purge was a 412.
        const { app, tables } = createHarness();
        expect((await app.request("/docs/d1", { method: "DELETE" })).status).toBe(204);
        const etag = await etagOf(app, "/docs/d1?deleted=include");

        const res = await app.request("/docs/d1?hard=true", { method: "DELETE", headers: { "If-Match": etag } });

        expect(res.status).toBe(204);
        expect(tables.docs.has("d1")).toBe(false);
    });
});
