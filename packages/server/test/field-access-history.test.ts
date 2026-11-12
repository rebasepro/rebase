/**
 * History stores the whole row, and history is not admin-only.
 *
 * The route's gate is "can you fetch this entity" — nothing more — so every
 * caller who can open a row can list its history, and every entry carries a
 * snapshot of every column. A field the data API withholds was therefore in
 * each of those snapshots: the read rule with an audit log around it.
 *
 * The entry is not dropped, only its withheld columns. The caller is entitled to
 * know that a version exists, who made it and when; they are not entitled to the
 * salary it recorded.
 */

import { Hono } from "hono";
import { createHistoryRoutes, type HistoryService } from "../src/history/history-routes";
import type { CollectionConfig } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";
import { fakeDataDriver } from "./helpers/server-a-fakes";
import { tablesFromCollections } from "./helpers/tables";

const staff: CollectionConfig = {
    name: "staff",
    slug: "staff",
    history: true,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"] } },
        passwordHash: { name: "Hash", type: "string", columnName: "password_hash", excludeFromApi: true }
    }
};

const snapshot = {
    id: "h1",
    entity_id: "s-1",
    table_name: "staff",
    changed_by: "someone",
    changed_fields: ["name", "salary", "password_hash", "ssn"],
    // `ssn` is a column the table has since dropped: what rules held for it
    // is not known any more.
    values: { id: "s-1", name: "Ada", salary: 90_000, password_hash: "salt:hash", ssn: "123-45-6789" },
    // An update entry stores the row before the write too, read under the
    // writer's viewer — so it carries the same withheld columns.
    previous_values: { id: "s-1", name: "Ada", salary: 80_000, password_hash: "salt:old" }
};

/** What the scoped driver's `serveStoredRows` was handed, call by call. */
let handed: Record<string, unknown>[][] = [];

function mount(roles: string[] | undefined, options: { serveStoredRows?: false } = {}) {
    const historyService: HistoryService = {
        fetchHistory: jest.fn().mockResolvedValue({ data: [snapshot], total: 1 }),
        fetchHistoryEntry: jest.fn().mockResolvedValue(snapshot)
    };

    const registry = { getCollections: () => [staff] };

    handed = [];
    const scopedDriver = fakeDataDriver({
        fetchOne: jest.fn(async () => ({ id: "s-1", name: "Ada" })),
        // The driver's half — its own strip and the afterRead chain — is
        // `history-served-as-read.test.ts`'s, over a real driver. This one
        // serves what it is handed and records it.
        ...(options.serveStoredRows === false ? {} : {
            serveStoredRows: async (_path: string, rows: Record<string, unknown>[]) => {
                handed.push(rows);
                return rows;
            }
        })
    });

    const app = new Hono<HonoEnv>();
    app.use("/*", async (c, next) => {
        c.set("driver", scopedDriver);
        if (roles) c.set("user", { uid: "u-1", roles });
        await next();
    });
    app.route("/api/data", createHistoryRoutes({
        historyService,
        tables: () => tablesFromCollections(registry.getCollections()),
        // Accepted and deliberately not read by these routes: any member reached would throw.
        driver: fakeDataDriver()
    }));
    return app;
}

const list = async (roles: string[] | undefined) => {
    const res = await mount(roles).request("/api/data/staff/s-1/history");
    expect(res.status).toBe(200);
    const body = await res.json() as { data: Array<Record<string, unknown>> };
    return body.data[0];
};

describe("GET /:slug/:id/history", () => {
    it("takes a withheld field out of the stored snapshot", async () => {
        const entry = await list(["staff"]);
        const values = entry.values as Record<string, unknown>;
        expect(values.name).toBe("Ada");
        expect(values).not.toHaveProperty("salary");
    });

    it("takes it out of the previous snapshot as well", async () => {
        // Every update entry carries the row on both sides of the write.
        // Stripping one side served the old salary off the other.
        const entry = await list(["staff"]);
        const previous = entry.previous_values as Record<string, unknown>;
        expect(previous.name).toBe("Ada");
        expect(previous).not.toHaveProperty("salary");
        expect(previous).not.toHaveProperty("password_hash");
    });

    it("keeps the entry itself, with its metadata", async () => {
        const entry = await list(["staff"]);
        expect(entry.id).toBe("h1");
        expect(entry.changed_by).toBe("someone");
    });

    it("serves the field to a caller holding the role", async () => {
        const entry = await list(["hr"]);
        expect(entry.values).toMatchObject({ salary: 90_000 });
        expect(entry.previous_values).toMatchObject({ salary: 80_000 });
    });

    it("serves it to `admin`", async () => {
        expect((await list(["admin"])).values).toMatchObject({ salary: 90_000 });
    });

    it("never serves an `excludeFromApi` column, under its stored spelling", async () => {
        for (const roles of [["staff"], ["hr"], ["admin"]]) {
            const entry = await list(roles);
            expect(entry.values).not.toHaveProperty("password_hash");
            expect(entry.previous_values).not.toHaveProperty("password_hash");
        }
    });

    it("withholds a key the table has no column for, from every caller", async () => {
        for (const roles of [["staff"], ["admin"]]) {
            const entry = await list(roles);
            expect(entry.values).not.toHaveProperty("ssn");
            expect(entry.previous_values).not.toHaveProperty("ssn");
        }
    });

    it("does not name a withheld or unknown column in changed_fields", async () => {
        expect((await list(["staff"])).changed_fields).toEqual(["name"]);
        expect((await list(["hr"])).changed_fields).toEqual(["name", "salary"]);
    });

    it("hands the driver's read chain only what the caller may read", async () => {
        // The driver's `afterRead` runs on each snapshot, so it must not be
        // handed a value the caller is refused: a hook could copy it into a
        // column the caller can read.
        await list(["staff"]);
        expect(handed).toHaveLength(1);
        for (const row of handed[0]) {
            expect(row).not.toHaveProperty("salary");
            expect(row).not.toHaveProperty("password_hash");
        }
    });

    it("refuses to serve history through a driver that cannot run the read rules over stored rows", async () => {
        const res = await mount(["admin"], { serveStoredRows: false }).request("/api/data/staff/s-1/history");
        expect(res.status).toBe(501);
        expect(JSON.stringify(await res.json())).not.toContain("90000");
    });

    it("treats a request with no user as anonymous, not as the trusted plane", async () => {
        // The auth middleware sets a driver but no `user` for an unauthenticated
        // request. Reading that as "no viewer" would hand every column to
        // whoever did not sign in.
        const entry = await list(undefined);
        expect(entry.values).not.toHaveProperty("salary");
        expect(entry.previous_values).not.toHaveProperty("salary");
    });
});
