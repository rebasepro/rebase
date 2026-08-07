/**
 * Reverting an entity to a stored version.
 *
 * The interesting part is not the revert itself but its guard: the history id
 * arrives in the URL alongside the entity it is supposed to belong to, and
 * nothing else ties the two together. A history entry carries the full values of
 * some row at some point in time, so accepting one that belongs to a different
 * row — or to a different table that happens to use the same id space — writes
 * that row's contents over the target. The route checks both halves, and this
 * file is what makes the check load-bearing: with `||` mutated to `&&` (reject
 * only when BOTH mismatch) the rest of the suite stayed green.
 */

import { Hono } from "hono";
import { createHistoryRoutes, type HistoryService } from "../src/history/history-routes";
import type { BackendCollectionRegistry } from "../src/collections/BackendCollectionRegistry";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import type { HonoEnv } from "../src/api/types";

function collection(slug: string, history = true): CollectionConfig {
    return {
        name: slug,
        slug,
        history,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

type Entry = {
    id: string;
    entity_id: string;
    table_name: string;
    values: Record<string, unknown>;
};

function mount(entry: Entry | null) {
    const save = jest.fn().mockResolvedValue({ id: "post-1", title: "old title" });

    const historyService: HistoryService = {
        fetchHistory: jest.fn().mockResolvedValue({ data: [], total: 0 }),
        fetchHistoryEntry: jest.fn().mockResolvedValue(entry)
    };

    const registry = {
        getCollections: () => [collection("posts"), collection("comments")]
    } as unknown as BackendCollectionRegistry;

    // The request-scoped, RLS-bound driver every request to this router carries
    // — the auth middleware sets it before the route is ever reached. The route
    // reads the target row through it to decide whether this caller may see the
    // row's history at all; here that caller can see `post-1`, so these tests
    // are about the guard *after* authorization. See
    // `history-routes-authorization.test.ts` for the guard itself.
    const scopedDriver = {
        fetchOne: jest.fn(async ({ id }: { id: string | number }) =>
            (String(id) === "post-1" ? { id, title: "current title" } : undefined)),
        save
    } as unknown as DataDriver;

    const app = new Hono<HonoEnv>();
    app.use("/*", async (c, next) => {
        c.set("driver", scopedDriver);
        await next();
    });
    app.route("/api/data", createHistoryRoutes({
        historyService,
        registry,
        driver: { save: jest.fn() } as unknown as DataDriver
    }));

    return { app, save };
}

const revert = (app: Hono<HonoEnv>, path: string) => app.request(path, { method: "POST" });

describe("POST /:slug/:id/history/:historyId/revert", () => {
    it("reverts when the entry belongs to this entity in this table", async () => {
        const { app, save } = mount({
            id: "h1",
            entity_id: "post-1",
            table_name: "posts",
            values: { title: "old title" }
        });

        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");

        expect(res.status).toBe(200);
        const body = await res.json() as { meta: { reverted_from: string } };
        expect(body.meta.reverted_from).toBe("h1");
        expect(save).toHaveBeenCalledWith(expect.objectContaining({
            path: "posts",
            id: "post-1",
            values: { title: "old title" },
            status: "existing"
        }));
    });

    it("refuses an entry recorded against a different row", async () => {
        // Same table, someone else's row: reverting would copy that row's
        // values over post-1.
        const { app, save } = mount({
            id: "h1",
            entity_id: "post-999",
            table_name: "posts",
            values: { title: "another author's draft" }
        });

        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");

        expect(res.status).toBe(400);
        expect((await res.json() as { error: { message: string } }).error.message)
            .toBe("History entry does not belong to this entity");
        expect(save).not.toHaveBeenCalled();
    });

    it("refuses an entry recorded against a different table", async () => {
        // Ids collide across tables far more often than they collide within
        // one — sequential integers, or the same uuid copied around during a
        // migration — so the table name is the half that actually gets hit.
        const { app, save } = mount({
            id: "h1",
            entity_id: "post-1",
            table_name: "comments",
            values: { body: "a comment, about to become a post" }
        });

        const res = await revert(app, "/api/data/posts/post-1/history/h1/revert");

        expect(res.status).toBe(400);
        expect(save).not.toHaveBeenCalled();
    });

    it("404s for a history id that does not exist", async () => {
        const { app, save } = mount(null);

        const res = await revert(app, "/api/data/posts/post-1/history/nope/revert");

        expect(res.status).toBe(404);
        expect(save).not.toHaveBeenCalled();
    });
});
