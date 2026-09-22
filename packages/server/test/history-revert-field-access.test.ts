/**
 * A revert is a write, and a field closed to the caller stays closed through it.
 *
 * Every door that sets a row's values checks `access.write` and
 * `excludeFromApi` — create, PATCH, bulk, `_batch`, upsert, field ops and the
 * socket's SAVE. The revert route did not. It took the stored snapshot straight
 * to `driver.save`, so a caller refused `PATCH { discountPercent: 50 }` could
 * set the same value by reverting to any version that happened to carry it —
 * and every server-owned column in the snapshot went back with it.
 *
 * The snapshot is not a request body, though: it is the whole row, so it names
 * every restricted field whether the version changed it or not. Refusing on the
 * mere presence of one would make every revert on such a collection a 400 for
 * anyone without the role. So the rule is the one the PATCH applies, asked of
 * what the revert would actually change:
 *
 *  - a closed field whose stored value differs from the row's current one
 *    refuses the revert, with the PATCH's own error;
 *  - a closed field whose value is unchanged is left out of the write;
 *  - a field the caller cannot even read is left as it is — the history list
 *    never showed it to them, so it is not part of the version they chose.
 */

import { Hono } from "hono";
import { createHistoryRoutes, type HistoryService } from "../src/history/history-routes";
import type { BackendCollectionRegistry } from "../src/collections/BackendCollectionRegistry";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";

const orders = {
    name: "orders",
    slug: "orders",
    history: true,
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string" },
        discountPercent: { name: "Discount", type: "number", access: { write: ["admin"] } },
        terms: { name: "Terms", type: "map", access: { write: ["admin"] } },
        approvedAt: { name: "Approved", type: "date", access: { write: ["admin"] } },
        internalNote: { name: "Note", type: "string", access: { read: ["admin"], write: ["admin"] } },
        stripeIntent: { name: "Intent", type: "string", columnName: "stripe_intent", excludeFromApi: true }
    }
} as unknown as CollectionConfig;

const APPROVED = new Date("2026-09-01T10:00:00.000Z");

/** The row as it is now, before the read strip. */
const CURRENT = {
    id: "o1",
    title: "current title",
    discountPercent: 0,
    // `jsonb` hands an object back in its own key order, not the written one.
    terms: { net: 30, currency: "EUR" },
    approvedAt: APPROVED,
    internalNote: "current note",
    stripe_intent: "pi_current"
};

/** A stored version, as it came back out of `jsonb`. */
function snapshot(overrides: Record<string, unknown> = {}) {
    return {
        id: "h1",
        entity_id: "o1",
        table_name: "orders",
        values: {
            id: "o1",
            title: "old title",
            discountPercent: 0,
            terms: { currency: "EUR", net: 30 },
            approvedAt: APPROVED.toISOString(),
            internalNote: "old note",
            stripe_intent: "pi_old",
            ...overrides
        }
    };
}

/**
 * The scoped driver serves the row with the caller's read rules applied, which
 * is what the Postgres row pipeline does: `internalNote` only to `admin`, the
 * `excludeFromApi` column to nobody.
 */
function mount(roles: string[] | undefined, entry = snapshot()) {
    const historyService: HistoryService = {
        fetchHistory: jest.fn().mockResolvedValue({ data: [], total: 0 }),
        fetchHistoryEntry: jest.fn().mockResolvedValue(entry)
    };
    const registry = { getCollections: () => [orders] } as unknown as BackendCollectionRegistry;

    const fetchOne = jest.fn(async () => {
        const { stripe_intent: _excluded, internalNote, ...row } = CURRENT;
        return roles?.includes("admin") ? { ...row, internalNote } : row;
    });
    const save = jest.fn(async ({ values }: { values: Record<string, unknown> }) => values);
    const scopedDriver = { fetchOne, save } as unknown as DataDriver;

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
    return { app, save };
}

async function revert(roles: string[] | undefined, entry = snapshot()) {
    const { app, save } = mount(roles, entry);
    const res = await app.request("/api/data/orders/o1/history/h1/revert", { method: "POST" });
    const body = await res.json() as { error?: { code?: string; message?: string; details?: { fields?: string[] } } };
    const written = save.mock.calls[0]?.[0] as { values: Record<string, unknown> } | undefined;
    return { status: res.status, body, save, written: written?.values };
}

describe("POST /:slug/:id/history/:historyId/revert — field write rules", () => {
    it("refuses a revert that would set a field the caller cannot write", async () => {
        // The finding: PATCH { discountPercent: 50 } is a 400 for this caller,
        // and reverting to a version holding 50 wrote it.
        const { status, body, save } = await revert(["user"], snapshot({ discountPercent: 50 }));

        expect(status).toBe(400);
        expect(body.error?.code).toBe("FIELD_NOT_WRITABLE");
        expect(body.error?.details?.fields).toEqual(["discountPercent"]);
        expect(save).not.toHaveBeenCalled();
    });

    it("treats a request with no user as anonymous, not as the trusted plane", async () => {
        const { status, save } = await revert(undefined, snapshot({ discountPercent: 50 }));

        expect(status).toBe(400);
        expect(save).not.toHaveBeenCalled();
    });

    it("reverts when every closed field is unchanged, and leaves them out of the write", async () => {
        // The snapshot names every restricted field whether the version changed
        // it or not. Same value in a different spelling — a Date against its ISO
        // string, an object in jsonb's key order — is the same value.
        const { status, written } = await revert(["user"]);

        expect(status).toBe(200);
        expect(written).toEqual({ id: "o1", title: "old title" });
    });

    it("lets a caller holding the role restore the field", async () => {
        const { status, written } = await revert(["admin"], snapshot({ discountPercent: 50 }));

        expect(status).toBe(200);
        expect(written).toMatchObject({ title: "old title", discountPercent: 50, internalNote: "old note" });
    });

    it("never writes an `excludeFromApi` column back, for any caller", async () => {
        // The server's own column. Restoring it is the PATCH the API refuses
        // everyone — a password hash on a user row would be a password the
        // caller once knew.
        for (const roles of [["user"], ["admin"]]) {
            const { status, written } = await revert(roles);
            expect(status).toBe(200);
            expect(written).not.toHaveProperty("stripe_intent");
            expect(written).not.toHaveProperty("stripeIntent");
        }
    });

    it("leaves a field the caller cannot read as it is", async () => {
        // The history list stripped `internalNote` from this caller's view of
        // the version, so it is not part of what they chose to restore.
        const { status, written } = await revert(["user"]);

        expect(status).toBe(200);
        expect(written).not.toHaveProperty("internalNote");
    });
});
