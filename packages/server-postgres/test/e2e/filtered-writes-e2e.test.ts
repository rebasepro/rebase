/**
 * E2E: writes that a filter addresses (`updateWhere`, `deleteWhere`) and
 * upserts that a conflict rule shapes (`where`, `ignoreDuplicates`), through
 * `openRebase`'s in-process SDK.
 *
 * What is pinned:
 *
 * - a filtered update or delete is one statement in one round trip, matches
 *   nothing without an error, and is a compare-and-set when its filter names
 *   the version it expects;
 * - a filter with no condition, a key in the values and a path through a
 *   relation are refused before anything runs;
 * - row-level security narrows a filtered write as it narrows any write;
 * - a collection with per-row work (a hook) is written row by row, through
 *   the hook, in one transaction;
 * - an upsert's `where` keeps a stored row that does not match, and
 *   `ignoreDuplicates` keeps every stored row; neither answers a row it kept.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { tablesFromCollections } from "../helpers/tables.js";

const scores: CollectionConfig = {
    name: "Scores",
    slug: "scores",
    table: "scores",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
        { name: "owner_update", operation: "update", ownerField: "ownerId" },
        { name: "owner_delete", operation: "delete", ownerField: "ownerId" }
    ],
    properties: {
        day: { name: "Day", type: "string", isId: true },
        sid: { name: "Sid", type: "string", isId: true },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        hype: { name: "Hype", type: "number" },
        rev: { name: "Revision", type: "number" },
        updatedAt: { name: "Updated", type: "date", autoValue: "on_update" }
    }
};

const audited: string[] = [];
const notes: CollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        title: { name: "Title", type: "string" },
        kind: { name: "Kind", type: "string" }
    },
    callbacks: {
        afterSave: ({ id }) => { audited.push(`save ${id}`); },
        afterDelete: ({ id }) => { audited.push(`delete ${id}`); }
    }
};

let counting = false;
let roundTrips = 0;
const originalQuery = pg.Client.prototype.query;
Object.defineProperty(pg.Client.prototype, "query", {
    value: function (this: pg.Client, ...args: Parameters<pg.Client["query"]>) {
        if (counting) roundTrips += 1;
        return Reflect.apply(originalQuery, this, args);
    },
    writable: true,
    configurable: true
});

async function tripsOf<T>(run: () => Promise<T>): Promise<{ result: T; trips: number }> {
    roundTrips = 0;
    counting = true;
    try {
        return { result: await run(), trips: roundTrips };
    } finally {
        counting = false;
    }
}

async function provision(url: string): Promise<void> {
    const conn = createPostgresDatabaseConnection(url);
    try {
        const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
        const driverResult = await bootstrapper.initializeDriver({ collections: [scores, notes], tables: tablesFromCollections([scores, notes]).tables, realtime: { subscribe: false, provision: false } });
        await bootstrapper.ensureCollectionSchema!([scores, notes], driverResult);
        await bootstrapper.ensureRlsRuntime!(driverResult);
        await bootstrapper.ensureCollectionPolicies!([scores, notes], driverResult);
        await bootstrapper.finalizeSecurityPosture!(driverResult);
    } finally {
        await conn.pool.end();
    }
}

describe("filtered writes and conflict rules (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;
    const quiet: Array<{ mockRestore(): void }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined)
        );
        await provision(container.connectionString);
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [scores, notes], tables: tablesFromCollections([scores, notes]).tables, pool: { max: 2 } });
        await rebase.sql(`INSERT INTO public.scores (day, sid, owner_id, hype, rev) VALUES
            ('d1', 'a', 'ada', 10, 1), ('d1', 'b', 'ada', 20, 1), ('d1', 'c', 'bob', 30, 1), ('d2', 'a', 'ada', 40, 1)`);
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await rebase?.close();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    describe("updateWhere", () => {
        it("updates every row the filter matches in one round trip, and answers them", async () => {
            const { result, trips } = await tripsOf(() => rebase.dataAsAdmin.scores.updateWhere(
                { where: { day: ["==", "d1"], hype: ["<", 25] } },
                { hype: { $inc: 1 } }
            ));
            expect(trips).toBe(1);
            expect(result.map(row => [row.sid, row.hype]).sort()).toEqual([["a", 11], ["b", 21]]);
            expect(typeof result[0].updatedAt).toBe("string");
        });

        it("is a compare-and-set: a filter naming a version that moved on updates nothing", async () => {
            const first = await rebase.dataAsAdmin.scores.updateWhere(
                { where: { day: ["==", "d2"], sid: ["==", "a"], rev: ["==", 1] } },
                { hype: 41, rev: { $inc: 1 } }
            );
            expect(first).toHaveLength(1);
            const second = await rebase.dataAsAdmin.scores.updateWhere(
                { where: { day: ["==", "d2"], sid: ["==", "a"], rev: ["==", 1] } },
                { hype: 99, rev: { $inc: 1 } }
            );
            expect(second).toEqual([]);
            expect(await rebase.sql("SELECT hype::int AS hype, rev::int AS rev FROM public.scores WHERE day = 'd2' AND sid = 'a'")).toEqual([{ hype: 41, rev: 2 }]);
        });

        it("takes a logical group beside where", async () => {
            const rows = await rebase.dataAsAdmin.scores.updateWhere(
                { where: { day: ["==", "d1"] }, logical: { type: "or", conditions: [{ column: "sid", operator: "==", value: "a" }, { column: "sid", operator: "==", value: "c" }] } },
                { rev: 5 }
            );
            expect(rows.map(row => row.sid).sort()).toEqual(["a", "c"]);
        });

        it("refuses a filter with no condition, a key in the values, and an unknown field", async () => {
            await expect(rebase.dataAsAdmin.scores.updateWhere({}, { hype: 0 })).rejects.toMatchObject({ code: "FILTER_REQUIRED" });
            await expect(rebase.dataAsAdmin.scores.updateWhere({ where: {} }, { hype: 0 })).rejects.toMatchObject({ code: "FILTER_REQUIRED" });
            await expect(rebase.dataAsAdmin.scores.updateWhere({ where: { day: ["==", "d1"] } }, { sid: "z" })).rejects.toMatchObject({ code: "KEY_IMMUTABLE" });
            // Untyped on purpose: a field the collection does not have.
            const scores = rebase.dataAsAdmin.scores;
            await expect(Reflect.apply(scores.updateWhere, scores, [{ where: { nope: ["==", 1] } }, { hype: 0 }])).rejects.toMatchObject({ statusCode: 400 });
            expect(await rebase.sql("SELECT count(*)::int AS n FROM public.scores WHERE hype = 0")).toEqual([{ n: 0 }]);
        });

        it("reaches only the rows the caller's policies let them update", async () => {
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            const rows = await ada.data.scores.updateWhere({ where: { day: ["==", "d1"] } }, { rev: 7 });
            expect(rows.map(row => row.sid).sort()).toEqual(["a", "b"]);
            expect(await rebase.sql("SELECT rev::int AS rev FROM public.scores WHERE sid = 'c'")).toEqual([{ rev: 5 }]);
        });

        it("runs a collection's hooks for each row, in one transaction", async () => {
            const created = await rebase.dataAsAdmin.notes.createMany([{ title: "x", kind: "a" }, { title: "y", kind: "a" }, { title: "z", kind: "b" }]);
            audited.length = 0;
            const rows = await rebase.dataAsAdmin.notes.updateWhere({ where: { kind: ["==", "a"] } }, { title: "edited" });
            expect(rows.map(row => row.title)).toEqual(["edited", "edited"]);
            expect(audited.sort()).toEqual([`save ${created[0].id}`, `save ${created[1].id}`].sort());
        });
    });

    describe("deleteWhere", () => {
        it("deletes every row the filter matches in one round trip, and counts them", async () => {
            await rebase.sql("INSERT INTO public.scores (day, sid, owner_id, hype, rev) VALUES ('d9', 'a', 'ada', 1, 1), ('d9', 'b', 'ada', 2, 1)");
            const { result, trips } = await tripsOf(() => rebase.dataAsAdmin.scores.deleteWhere({ where: { day: ["==", "d9"] } }));
            expect(trips).toBe(1);
            expect(result).toBe(2);
            expect(await rebase.dataAsAdmin.scores.deleteWhere({ where: { day: ["==", "d9"] } })).toBe(0);
        });

        it("reaches only the caller's rows, and refuses an empty filter", async () => {
            await rebase.sql("INSERT INTO public.scores (day, sid, owner_id, hype, rev) VALUES ('d8', 'a', 'ada', 1, 1), ('d8', 'b', 'bob', 2, 1)");
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            expect(await ada.data.scores.deleteWhere({ where: { day: ["==", "d8"] } })).toBe(1);
            expect(await rebase.sql("SELECT sid FROM public.scores WHERE day = 'd8'")).toEqual([{ sid: "b" }]);
            await expect(ada.data.scores.deleteWhere({})).rejects.toMatchObject({ code: "FILTER_REQUIRED" });
        });

        it("runs afterDelete for each row of a collection with hooks", async () => {
            audited.length = 0;
            const count = await rebase.dataAsAdmin.notes.deleteWhere({ where: { title: ["==", "edited"] } });
            expect(count).toBe(2);
            expect(audited.filter(entry => entry.startsWith("delete"))).toHaveLength(2);
        });
    });

    describe("conflict rules", () => {
        it("keeps a stored row that does not match `where`, and answers nothing for it", async () => {
            await rebase.sql("INSERT INTO public.scores (day, sid, owner_id, hype, rev) VALUES ('d7', 'a', 'ada', 50, 1)");
            const kept = await tripsOf(() => rebase.dataAsAdmin.scores.upsert(
                { day: "d7", sid: "a", ownerId: "ada", hype: 40 },
                { where: { hype: ["<", 40] } }
            ));
            expect(kept.result).toBeUndefined();
            expect(kept.trips).toBe(1);
            const replaced = await rebase.dataAsAdmin.scores.upsert(
                { day: "d7", sid: "a", ownerId: "ada", hype: 60 },
                { where: { hype: ["<", 60] } }
            );
            expect(replaced?.hype).toBe(60);
            const inserted = await rebase.dataAsAdmin.scores.upsert(
                { day: "d7", sid: "b", ownerId: "ada", hype: 1 },
                { where: { hype: ["<", 1] } }
            );
            expect(inserted?.hype).toBe(1);
            expect(await rebase.sql("SELECT sid, hype::int AS hype FROM public.scores WHERE day = 'd7' ORDER BY sid")).toEqual([{ sid: "a", hype: 60 }, { sid: "b", hype: 1 }]);
        });

        it("leaves every stored row alone with ignoreDuplicates, and answers only the rows it inserted", async () => {
            const written = await rebase.dataAsAdmin.scores.createMany([
                { day: "d7", sid: "a", ownerId: "ada", hype: 0 },
                { day: "d7", sid: "c", ownerId: "ada", hype: 3 }
            ], { upsert: true, ignoreDuplicates: true });
            expect(written.map(row => row.sid)).toEqual(["c"]);
            expect(await rebase.dataAsAdmin.scores.upsert({ day: "d7", sid: "c", ownerId: "ada", hype: 9 }, { ignoreDuplicates: true })).toBeUndefined();
            expect(await rebase.sql("SELECT sid, hype::int AS hype FROM public.scores WHERE day = 'd7' ORDER BY sid")).toEqual([
                { sid: "a", hype: 60 }, { sid: "b", hype: 1 }, { sid: "c", hype: 3 }
            ]);
        });

        it("applies `where` row by row in a batch, keeping what it does not match", async () => {
            const written = await rebase.dataAsAdmin.scores.createMany([
                { day: "d7", sid: "a", ownerId: "ada", hype: 59 },
                { day: "d7", sid: "b", ownerId: "ada", hype: 2 }
            ], { upsert: true, where: { hype: ["<", 10] } });
            expect(written.map(row => [row.sid, row.hype])).toEqual([["b", 2]]);
        });

        it("refuses a conflict rule without upsert, and the two rules together", async () => {
            await expect(rebase.dataAsAdmin.scores.createMany([{ day: "d6", sid: "a", ownerId: "ada" }], { ignoreDuplicates: true }))
                .rejects.toMatchObject({ code: "INVALID_CONFLICT_RULE" });
            await expect(rebase.dataAsAdmin.scores.createMany([{ day: "d6", sid: "a", ownerId: "ada" }], { upsert: true, ignoreDuplicates: true, where: { hype: ["<", 1] } }))
                .rejects.toMatchObject({ code: "INVALID_CONFLICT_RULE" });
        });
    });
});
