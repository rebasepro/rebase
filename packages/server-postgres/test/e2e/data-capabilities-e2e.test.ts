/**
 * E2E: what an app used to drop to raw SQL for, through the SDK and REST
 * vocabulary instead — on a provisioned schema, as the service identity under
 * row-level security, and as a user whose policies narrow every answer.
 *
 * - Array columns: `array-contains-all` (`@>`) and `array-contained-by`
 *   (`<@`), and the distinct elements of an array as `groupBy: unnest(tags)`.
 * - Aggregates: `countDistinct`, `mode`, `percentile`, `distinct`, and groups
 *   by `lower`/`day` of a column.
 * - `fingerprint()`: changes on insert, update and delete, and not otherwise.
 * - `updateMany` with a value per row: one statement, every row answered, a
 *   missing id still named.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";

const songs: CollectionConfig = {
    name: "Songs",
    slug: "songs",
    table: "songs",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" },
        { name: "owner_update", operation: "update", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        artist: { name: "Artist", type: "string" },
        lang: { name: "Lang", type: "string" },
        fame: { name: "Fame", type: "number" },
        plays: { name: "Plays", type: "number", defaultValue: 0 },
        tags: { name: "Tags", type: "array", columnType: "text[]", of: { name: "Tag", type: "string" } },
        playedAt: { name: "Played", type: "date" },
        updatedAt: { name: "Updated", type: "date", autoValue: "on_update" }
    }
};

/** Round trips sent by any pooled client while counting. */
let counting = false;
let roundTrips = 0;
const originalQuery = pg.Client.prototype.query;
// The prototype every pooled client shares, seen as the one method this file wraps.
const clientPrototype: { query: unknown } = pg.Client.prototype;
clientPrototype.query = function (this: unknown, ...args: unknown[]) {
    if (counting) roundTrips += 1;
    return (originalQuery as (...a: unknown[]) => unknown).apply(this, args);
};

describe("data capabilities (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;
    const quiet: Array<{ mockRestore(): void }> = [];
    type Data = OpenedRebase["dataAsAdmin"];
    let songsOf: (data: Data) => Data[string];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined)
        );
        const conn = createPostgresDatabaseConnection(container.connectionString);
        try {
            const bootstrapper = createPostgresBootstrapper({ connectionString: container.connectionString, connection: conn.db });
            const driverResult = await bootstrapper.initializeDriver({ collections: [songs], realtime: { subscribe: false, provision: false } });
            await bootstrapper.ensureCollectionSchema!([songs], driverResult);
            await bootstrapper.ensureRlsRuntime!(driverResult);
            await bootstrapper.ensureCollectionPolicies!([songs], driverResult);
            await bootstrapper.finalizeSecurityPosture!(driverResult);
        } finally {
            await conn.pool.end();
        }
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [songs] });
        songsOf = data => data.songs;
        await songsOf(rebase.dataAsAdmin).createMany([
            { ownerId: "ada", artist: "Rosalía", lang: "es", fame: 90, tags: ["pop", "flamenco"], playedAt: "2026-11-01T23:30:00Z" },
            { ownerId: "ada", artist: "ROSALÍA", lang: "es", fame: 70, tags: ["pop"], playedAt: "2026-11-01T10:00:00Z" },
            { ownerId: "ada", artist: "Björk", lang: "en", fame: 50, tags: ["electronic", "pop"], playedAt: "2026-11-02T10:00:00Z" },
            { ownerId: "bob", artist: "Muse", lang: "en", fame: 30, tags: ["rock"], playedAt: "2026-11-02T11:00:00Z" },
            { ownerId: "bob", artist: "Bad Bunny", lang: "es", fame: 10, tags: [], playedAt: "2026-11-03T11:00:00Z" }
        ]);
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await rebase?.close();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    const titles = (rows: Record<string, unknown>[]) => rows.map(row => String(row.artist)).sort();

    describe("array operators", () => {
        it("array-contains-all matches rows holding every listed element", async () => {
            const { data } = await songsOf(rebase.dataAsAdmin).find({ where: { tags: ["array-contains-all", ["pop", "flamenco"]] }, count: "none" });
            expect(titles(data)).toEqual(["Rosalía"]);
        });

        it("array-contained-by matches rows holding nothing outside the list, the empty array included", async () => {
            const { data } = await songsOf(rebase.dataAsAdmin).find({ where: { tags: ["array-contained-by", ["pop", "rock"]] }, count: "none" });
            expect(titles(data)).toEqual(["Bad Bunny", "Muse", "ROSALÍA"]);
        });

        it("both are served by a GIN index", async () => {
            await rebase.sql("CREATE INDEX IF NOT EXISTS songs_tags_gin ON public.songs USING gin (tags)");
            await rebase.sql("SET enable_seqscan = off");
            const plan = await rebase.sql("EXPLAIN SELECT id FROM public.songs WHERE tags @> ARRAY['pop'] AND tags <@ ARRAY['pop', 'rock']") as { "QUERY PLAN": string }[];
            expect(plan.map(row => row["QUERY PLAN"]).join("\n")).toMatch(/songs_tags_gin/);
        });
    });

    describe("aggregates", () => {
        it("lists an array's distinct elements with the rows holding each: groupBy unnest", async () => {
            const rows = await songsOf(rebase.dataAsAdmin).aggregate({
                select: [{ fn: "count" }],
                groupBy: [{ field: "tags", transform: "unnest" }],
                orderBy: ["unnest_tags", "asc"]
            });
            expect(rows.map(row => [row.unnest_tags, row.count])).toEqual([
                ["electronic", 1], ["flamenco", 1], ["pop", 3], ["rock", 1]
            ]);
        });

        it("groups by lower(artist), with the mode, distinct count and distinct values beside it", async () => {
            const rows = await songsOf(rebase.dataAsAdmin).aggregate({
                select: [{ fn: "mode", field: "lang" }, { fn: "countDistinct", field: "artist" }, { fn: "distinct", field: "artist" }],
                groupBy: [{ field: "artist", transform: "lower" }],
                where: { artist: ["ilike", "ros%"] }
            });
            expect(rows).toEqual([{ lower_artist: "rosalía", mode_lang: "es", count_distinct_artist: 2, distinct_artist: ["ROSALÍA", "Rosalía"] }]);
        });

        it("groups by day in UTC, and computes a percentile", async () => {
            const rows = await songsOf(rebase.dataAsAdmin).aggregate({
                select: [{ fn: "count" }, { fn: "percentile", field: "fame", p: 0.5 }],
                groupBy: [{ field: "playedAt", transform: "day" }],
                orderBy: ["day_playedAt", "asc"]
            });
            expect(rows).toEqual([
                { day_playedAt: "2026-11-01", count: 2, p50_fame: 80 },
                { day_playedAt: "2026-11-02", count: 2, p50_fame: 40 },
                { day_playedAt: "2026-11-03", count: 1, p50_fame: 10 }
            ]);
        });

        it("answers a user with only the rows their policies show", async () => {
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            const [row] = await songsOf(ada.data).aggregate({ select: [{ fn: "countDistinct", field: "lang" }, { fn: "count" }] });
            expect(row).toEqual({ count_distinct_lang: 2, count: 3 });
        });

        it("serves the same over REST's spelling", async () => {
            const { parseAggregateSelect, parseGroupBy } = await import("../../../server/src/api/rest/query-parser.js");
            expect(parseAggregateSelect("count(),percentile(fame,0.95),countDistinct(lang)")).toEqual([
                { fn: "count", alias: "count" },
                { fn: "percentile", field: "fame", p: 0.95, alias: "p95_fame" },
                { fn: "countDistinct", field: "lang", alias: "count_distinct_lang" }
            ]);
            expect(parseGroupBy("lang,unnest(tags)")).toEqual(["lang", { field: "tags", transform: "unnest", key: "unnest_tags" }]);
        });
    });

    describe("fingerprint", () => {
        const fingerprint = async (data: Data = rebase.dataAsAdmin) =>
            (await songsOf(data).aggregate({ select: [{ fn: "fingerprint" }] }))[0].fingerprint as string;

        it("stays put while nothing changes, moves on insert, update and delete, and comes back with the same rows", async () => {
            const start = await fingerprint();
            expect(await fingerprint()).toBe(start);

            const created = await songsOf(rebase.dataAsAdmin).create({ ownerId: "ada", artist: "New", tags: [] });
            const afterInsert = await fingerprint();
            expect(afterInsert).not.toBe(start);

            await songsOf(rebase.dataAsAdmin).update(Number(created.id), { fame: 1 });
            const afterUpdate = await fingerprint();
            expect(afterUpdate).not.toBe(afterInsert);

            await songsOf(rebase.dataAsAdmin).delete(Number(created.id));
            const afterDelete = await fingerprint();
            expect(afterDelete).not.toBe(afterUpdate);
            // The row it added is gone again: the rows are the ones it started with.
            expect(afterDelete).toBe(start);

            await rebase.sql("DELETE FROM public.songs WHERE artist = 'Bad Bunny'");
            expect(await fingerprint()).not.toBe(start);
            await songsOf(rebase.dataAsAdmin).create({ ownerId: "bob", artist: "Bad Bunny", lang: "es", fame: 10, tags: [], playedAt: "2026-11-03T11:00:00Z" });
        });

        it("covers only what the caller can see: another owner's write leaves it alone", async () => {
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            const before = await fingerprint(ada.data);
            await rebase.sql("UPDATE public.songs SET fame = fame + 1 WHERE owner_id = 'bob'");
            expect(await fingerprint(ada.data)).toBe(before);
            await rebase.sql("UPDATE public.songs SET fame = fame + 1 WHERE owner_id = 'ada' AND artist = 'Björk'");
            expect(await fingerprint(ada.data)).not.toBe(before);
        });
    });

    describe("updateMany with a value per row", () => {
        it("updates every row in one statement, stamped, and answers each", async () => {
            const { data } = await songsOf(rebase.dataAsAdmin).find({ orderBy: ["id", "asc"], count: "none" });
            const updates = data.map((row, i) => ({ id: Number(row.id), data: { plays: 100 + i, lang: `l${i}` } }));
            roundTrips = 0;
            counting = true;
            let answered;
            try {
                answered = await songsOf(rebase.dataAsAdmin).updateMany(updates);
            } finally {
                counting = false;
            }
            expect(roundTrips).toBe(2);
            expect(answered.map(row => [row.plays, row.lang])).toEqual(updates.map(update => [update.data.plays, update.data.lang]));
            expect(typeof answered[0].updatedAt).toBe("string");
            const stored = await rebase.sql("SELECT plays::int AS plays FROM public.songs ORDER BY id") as { plays: number }[];
            expect(stored.map(row => row.plays)).toEqual(updates.map(update => update.data.plays));
        });

        it("still names the entry whose id matches no row, and writes none of them", async () => {
            const [first] = (await songsOf(rebase.dataAsAdmin).find({ orderBy: ["id", "asc"], limit: 1, count: "none" })).data;
            await expect(songsOf(rebase.dataAsAdmin).updateMany([
                { id: Number(first.id), data: { plays: 1 } },
                { id: 99999, data: { plays: 2 } }
            ])).rejects.toThrow(/^Update 1 of 2 \(id 99999\) failed/);
            expect(await rebase.sql("SELECT plays::int AS plays FROM public.songs WHERE id = $1", { params: [first.id] })).toEqual([{ plays: 100 }]);
        });

        it("refuses a user's update of a row their policies hide, by entry", async () => {
            const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
            const mine = (await songsOf(ada.data).find({ count: "none" })).data[0];
            const bobs = (await rebase.sql("SELECT id FROM public.songs WHERE owner_id = 'bob' LIMIT 1") as { id: number }[])[0];
            await expect(songsOf(ada.data).updateMany([
                { id: Number(mine.id), data: { plays: 7 } },
                { id: bobs.id, data: { plays: 7 } }
            ])).rejects.toThrow(/^Update 1 of 2/);
            expect(await rebase.sql("SELECT count(*)::int AS n FROM public.songs WHERE plays = 7")).toEqual([{ n: 0 }]);
        });
    });
});
