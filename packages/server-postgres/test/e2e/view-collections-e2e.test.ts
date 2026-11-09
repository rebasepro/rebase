/**
 * E2E: collections that serve a SQL view (`view`) — created by the boot's
 * schema step from the collection config, read through the SDK under the same
 * row-level security as a table, refused every write, and for a materialized
 * view, served only to its roles and refreshed on demand.
 *
 * What is pinned:
 *
 * - a plain view runs as the caller (`security_invoker`): a user sees the
 *   view of their own rows, which the base table's policies decide;
 * - a materialized view is served whole to `view.roles` and refused to
 *   anyone else, and `refresh()` recomputes it — concurrently too, which needs
 *   the unique index on its id column;
 * - every write to a view collection is a 405;
 * - the schema step leaves an up-to-date view alone (rows and all), recreates
 *   one whose query changed, and refuses to replace a table of the same name.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import pg from "pg";
import type { CollectionConfig } from "@rebasepro/types";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { ensureCollectionTables } from "../../src/schema/ensure-collection-tables.js";

const songs: CollectionConfig = {
    name: "Songs",
    slug: "songs",
    table: "songs",
    securityRules: [
        { name: "owner_select", operation: "select", ownerField: "ownerId" },
        { name: "owner_insert", operation: "insert", ownerField: "ownerId" }
    ],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        ownerId: { name: "Owner", type: "string", columnName: "owner_id", validation: { required: true } },
        artist: { name: "Artist", type: "string" },
        lang: { name: "Lang", type: "string" }
    }
};

const artists = (query = "SELECT lower(artist) AS artist, count(*)::int AS songs FROM songs GROUP BY 1"): CollectionConfig => ({
    name: "Artists",
    slug: "artists",
    table: "artist_stats",
    view: { query },
    properties: {
        artist: { name: "Artist", type: "string", isId: true },
        songs: { name: "Songs", type: "number" }
    }
});

const langs = (roles?: string[]): CollectionConfig => ({
    name: "Languages",
    slug: "langs",
    table: "lang_stats",
    view: { query: "SELECT lang, count(*)::int AS songs FROM songs GROUP BY lang", materialized: true, ...(roles ? { roles } : {}) },
    properties: {
        lang: { name: "Lang", type: "string", isId: true },
        songs: { name: "Songs", type: "number" }
    }
});

async function provision(url: string, collections: CollectionConfig[]): Promise<void> {
    const conn = createPostgresDatabaseConnection(url);
    try {
        const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
        const driverResult = await bootstrapper.initializeDriver({ collections, realtime: { subscribe: false, provision: false } });
        await bootstrapper.ensureCollectionSchema!(collections, driverResult);
        await bootstrapper.ensureRlsRuntime!(driverResult);
        await bootstrapper.ensureCollectionPolicies!(collections, driverResult);
        await bootstrapper.finalizeSecurityPosture!(driverResult);
    } finally {
        await conn.pool.end();
    }
}

describe("view collections (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;
    let admin: pg.Client;
    const quiet: Array<{ mockRestore(): void }> = [];
    type Data = OpenedRebase["dataAsAdmin"];
    const of = (data: Data, slug: string) => data[slug];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined),
            vi.spyOn(console, "warn").mockImplementation(() => undefined)
        );
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();
        // The base table first, with rows, so the materialized view is born with data.
        await provision(container.connectionString, [songs]);
        await admin.query(`INSERT INTO public.songs (owner_id, artist, lang) VALUES
            ('ada', 'Rosalía', 'es'), ('ada', 'ROSALÍA', 'es'), ('ada', 'Björk', 'en'), ('bob', 'Muse', 'en')`);
        await provision(container.connectionString, [songs, artists(), langs()]);
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [songs, artists(), langs()] });
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await rebase?.close();
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    const rowsOf = async (data: Data, slug: string) =>
        (await of(data, slug).find({ orderBy: [slug === "artists" ? "artist" : "lang", "asc"], count: "none" })).data
            .map(row => ({ ...row }));

    it("serves a plain view through the SDK, filtered by the base table's policies for a user", async () => {
        expect(await rowsOf(rebase.dataAsAdmin, "artists")).toEqual([
            { artist: "björk", songs: 1 }, { artist: "muse", songs: 1 }, { artist: "rosalía", songs: 2 }
        ]);
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        expect(await rowsOf(ada.data, "artists")).toEqual([{ artist: "björk", songs: 1 }, { artist: "rosalía", songs: 2 }]);
        expect(await of(ada.data, "artists").findById("rosalía")).toMatchObject({ songs: 2 });
        const [aggregate] = await of(ada.data, "artists").aggregate({ select: [{ fn: "sum", field: "songs" }] });
        expect(aggregate).toEqual({ sum_songs: 3 });
    });

    it("created the plain view as security_invoker, and commented it with its plan", async () => {
        const { rows } = await admin.query(
            "SELECT c.reloptions, obj_description(c.oid, 'pg_class') AS note FROM pg_class c WHERE c.relname = 'artist_stats'"
        );
        expect(rows[0].reloptions).toContain("security_invoker=true");
        expect(rows[0].note).toMatch(/^rebase:view:[0-9a-f]{16}$/);
    });

    it("serves a materialized view to its roles only", async () => {
        expect(await rowsOf(rebase.dataAsAdmin, "langs")).toEqual([{ lang: "en", songs: 2 }, { lang: "es", songs: 2 }]);
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        await expect(of(ada.data, "langs").find({ count: "none" })).rejects.toMatchObject({ code: "VIEW_NOT_READABLE" });
        await expect(of(ada.data, "langs").refresh()).rejects.toMatchObject({ code: "VIEW_NOT_READABLE" });
    });

    it("keeps a materialized view's rows from SQL run as a caller without its roles", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        // The gate serves nothing to a caller outside `view.roles`…
        expect(await ada.sql("SELECT * FROM lang_stats")).toEqual([]);
        // …and the stored rows behind it are the owner's alone.
        await expect(ada.sql("SELECT * FROM lang_stats_rebase_rows")).rejects.toMatchObject({ cause: { code: "42501" } });
        const admin = await rebase.withAuth({ uid: "root", roles: ["admin"] });
        expect((await admin.sql("SELECT lang FROM lang_stats ORDER BY lang")).map(row => row.lang)).toEqual(["en", "es"]);
        // A plain view's rows are its base tables', so policies decide them as before.
        expect((await ada.sql("SELECT artist FROM artist_stats ORDER BY artist")).map(row => row.artist)).toEqual(["björk", "rosalía"]);
    });

    it("refreshes a materialized view, concurrently or not", async () => {
        await admin.query("INSERT INTO public.songs (owner_id, artist, lang) VALUES ('bob', 'Stromae', 'fr')");
        expect(await rowsOf(rebase.dataAsAdmin, "langs")).toHaveLength(2);
        await of(rebase.dataAsAdmin, "langs").refresh({ concurrently: true });
        expect(await rowsOf(rebase.dataAsAdmin, "langs")).toEqual([{ lang: "en", songs: 2 }, { lang: "es", songs: 2 }, { lang: "fr", songs: 1 }]);
        await admin.query("DELETE FROM public.songs WHERE artist = 'Stromae'");
        await of(rebase.dataAsAdmin, "langs").refresh();
        expect(await rowsOf(rebase.dataAsAdmin, "langs")).toHaveLength(2);
        await expect(of(rebase.dataAsAdmin, "artists").refresh()).rejects.toMatchObject({ code: "NOT_A_MATERIALIZED_VIEW" });
    });

    it("fingerprints a materialized view and refuses to fingerprint a plain one", async () => {
        const [row] = await of(rebase.dataAsAdmin, "langs").aggregate({ select: [{ fn: "fingerprint" }] });
        expect(typeof row.fingerprint).toBe("string");
        await expect(of(rebase.dataAsAdmin, "artists").aggregate({ select: [{ fn: "fingerprint" }] }))
            .rejects.toMatchObject({ code: "INVALID_AGGREGATE_SELECT" });
    });

    it("refuses every write to a view collection", async () => {
        const artistsData = of(rebase.dataAsAdmin, "artists");
        await expect(artistsData.create({ artist: "x", songs: 1 })).rejects.toMatchObject({ statusCode: 405, code: "COLLECTION_READ_ONLY" });
        await expect(artistsData.update("muse", { songs: 9 })).rejects.toMatchObject({ statusCode: 405 });
        await expect(artistsData.createMany([{ artist: "a" }, { artist: "b" }])).rejects.toMatchObject({ statusCode: 405 });
        await expect(artistsData.delete("muse")).rejects.toMatchObject({ statusCode: 405 });
        await expect(of(rebase.dataAsAdmin, "langs").updateMany([{ id: "en", data: { songs: 0 } }])).rejects.toMatchObject({ statusCode: 405 });
    });

    it("leaves an up-to-date view alone, rows and all, and recreates one whose query changed", async () => {
        const client = { query: <T>(text: string) => admin.query(text) as unknown as Promise<{ rows: T[] }> };
        await admin.query("INSERT INTO public.songs (owner_id, artist, lang) VALUES ('bob', 'Stromae', 'fr')");
        await ensureCollectionTables(client, [songs, artists(), langs()]);
        // Not recreated, so not recomputed: still the rows of its last refresh.
        expect((await admin.query("SELECT lang FROM public.lang_stats ORDER BY lang")).rows.map(r => r.lang)).toEqual(["en", "es"]);

        await ensureCollectionTables(client, [songs, artists("SELECT upper(artist) AS artist, count(*)::int AS songs FROM songs GROUP BY 1"), langs()]);
        expect((await admin.query("SELECT artist FROM public.artist_stats ORDER BY artist")).rows.map(r => r.artist))
            .toEqual(["BJÖRK", "MUSE", "ROSALÍA", "STROMAE"]);
        await admin.query("DELETE FROM public.songs WHERE artist = 'Stromae'");
        await ensureCollectionTables(client, [songs, artists(), langs()]);
    });

    it("refuses to replace a table with a view", async () => {
        const client = { query: <T>(text: string) => admin.query(text) as unknown as Promise<{ rows: T[] }> };
        await admin.query("CREATE TABLE public.occupied (id int primary key)");
        const occupying = { ...artists(), slug: "occupying", table: "occupied" } as CollectionConfig;
        await expect(ensureCollectionTables(client, [songs, occupying])).rejects.toThrow(/will not replace public\.occupied/);
        expect((await admin.query("SELECT to_regclass('public.occupied')::text AS t")).rows[0].t).toBe("occupied");
    });
});
