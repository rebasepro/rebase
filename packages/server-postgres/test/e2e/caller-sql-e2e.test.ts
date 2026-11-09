/**
 * E2E: SQL run as the caller (`DataDriver.sql`, `openRebase().withAuth().sql`).
 *
 * What is pinned:
 *
 * - it runs under the tables' row-level security, as the caller: a query
 *   that asks for every row gets the caller's, aggregates included;
 * - it is read-only unless asked to write, and a write still passes the
 *   insert/update policies;
 * - the statements that could change whose rows these are — `RESET ROLE`,
 *   `set_config`, a second statement — are refused before they run;
 * - the owner-level `sql` beside it still sees everything.
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
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
        artist: { name: "Artist", type: "string" }
    }
};

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

describe("SQL as the caller (E2E)", () => {
    let container: PgContainer;
    let rebase: OpenedRebase;
    const quiet: Array<{ mockRestore(): void }> = [];

    beforeAll(async () => {
        container = await startPgContainer();
        quiet.push(
            vi.spyOn(console, "log").mockImplementation(() => undefined),
            vi.spyOn(console, "info").mockImplementation(() => undefined),
            vi.spyOn(console, "debug").mockImplementation(() => undefined),
            vi.spyOn(console, "warn").mockImplementation(() => undefined)
        );
        await provision(container.connectionString, [songs]);
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [songs] });
        await rebase.sql(`INSERT INTO public.songs (owner_id, artist) VALUES
            ('ada', 'Rosalía'), ('ada', 'Björk'), ('bob', 'Muse')`);
    }, 180_000);

    afterAll(async () => {
        for (const spy of quiet) spy.mockRestore();
        await rebase?.close();
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("sees only the caller's rows, whatever the query asks for", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        const rows = await ada.sql("SELECT artist FROM songs ORDER BY artist");
        expect(rows.map(row => row.artist)).toEqual(["Björk", "Rosalía"]);
        const [counted] = await ada.sql("SELECT count(*)::int AS n FROM songs");
        expect(counted.n).toBe(2);
        const bob = await rebase.withAuth({ uid: "bob", roles: ["user"] });
        expect(await bob.sql("SELECT artist FROM songs WHERE owner_id = $1", { params: ["ada"] })).toEqual([]);
        const [total] = await rebase.sql("SELECT count(*)::int AS n FROM songs");
        expect(total.n).toBe(3);
    });

    it("is read-only unless asked to write, and a write still passes the policies", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        await expect(ada.sql("INSERT INTO songs (owner_id, artist) VALUES ($1, $2)", { params: ["ada", "Sade"] }))
            .rejects.toMatchObject({ cause: { code: "25006" } });

        const [created] = await ada.sql(
            "INSERT INTO songs (owner_id, artist) VALUES ($1, $2) RETURNING artist",
            { params: ["ada", "Sade"], write: true }
        );
        expect(created.artist).toBe("Sade");
        // Writing a row as somebody else fails the insert policy.
        await expect(ada.sql("INSERT INTO songs (owner_id, artist) VALUES ('bob', 'x')", { write: true }))
            .rejects.toMatchObject({ cause: { code: "42501" } });
        // An update reaches only the caller's rows.
        const touched = await ada.sql("UPDATE songs SET artist = upper(artist) RETURNING owner_id", { write: true });
        expect(new Set(touched.map(row => row.owner_id))).toEqual(new Set(["ada"]));
        const [muse] = await rebase.sql("SELECT artist FROM songs WHERE owner_id = 'bob'");
        expect(muse.artist).toBe("Muse");
    });

    it("refuses what could change whose rows these are, before it runs", async () => {
        const bob = await rebase.withAuth({ uid: "bob", roles: ["user"] });
        for (const query of [
            "RESET ROLE",
            "SELECT 1; RESET ROLE",
            "SELECT set_config('app.uid', 'ada', true)",
            "WITH x AS (SELECT set_config('role', current_user, true)) SELECT artist FROM songs",
            "UPDATE pg_settings SET setting = 'ada' WHERE name = 'app.uid'"
        ]) {
            await expect(bob.sql(query, { write: true })).rejects.toMatchObject({ code: "SQL_NOT_ALLOWED", statusCode: 400 });
        }
        expect((await bob.sql("SELECT artist FROM songs")).map(row => row.artist)).toEqual(["Muse"]);
    });
});
