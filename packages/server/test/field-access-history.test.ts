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
import type { BackendCollectionRegistry } from "../src/collections/BackendCollectionRegistry";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";

const staff = {
    name: "staff",
    slug: "staff",
    history: true,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"] } },
        passwordHash: { name: "Hash", type: "string", columnName: "password_hash", excludeFromApi: true }
    }
} as unknown as CollectionConfig;

const snapshot = {
    id: "h1",
    entity_id: "s-1",
    table_name: "staff",
    changed_by: "someone",
    values: { id: "s-1", name: "Ada", salary: 90_000, password_hash: "salt:hash" }
};

function mount(roles: string[] | undefined) {
    const historyService: HistoryService = {
        fetchHistory: jest.fn().mockResolvedValue({ data: [snapshot], total: 1 }),
        fetchHistoryEntry: jest.fn().mockResolvedValue(snapshot)
    };

    const registry = { getCollections: () => [staff] } as unknown as BackendCollectionRegistry;

    const scopedDriver = {
        fetchOne: jest.fn(async () => ({ id: "s-1", name: "Ada" }))
    } as unknown as DataDriver;

    const app = new Hono<HonoEnv>();
    app.use("/*", async (c, next) => {
        c.set("driver", scopedDriver);
        if (roles) c.set("user", { uid: "u-1", roles } as never);
        await next();
    });
    app.route("/api/data", createHistoryRoutes({
        historyService,
        registry,
        driver: {} as unknown as DataDriver
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

    it("keeps the entry itself, with its metadata", async () => {
        const entry = await list(["staff"]);
        expect(entry.id).toBe("h1");
        expect(entry.changed_by).toBe("someone");
    });

    it("serves the field to a caller holding the role", async () => {
        expect((await list(["hr"])).values).toMatchObject({ salary: 90_000 });
    });

    it("serves it to `admin`", async () => {
        expect((await list(["admin"])).values).toMatchObject({ salary: 90_000 });
    });

    it("never serves an `excludeFromApi` column, under its stored spelling", async () => {
        for (const roles of [["staff"], ["hr"], ["admin"]]) {
            expect((await list(roles)).values).not.toHaveProperty("password_hash");
        }
    });

    it("treats a request with no user as anonymous, not as the trusted plane", async () => {
        // The auth middleware sets a driver but no `user` for an unauthenticated
        // request. Reading that as "no viewer" would hand every column to
        // whoever did not sign in.
        expect((await list(undefined)).values).not.toHaveProperty("salary");
    });
});
