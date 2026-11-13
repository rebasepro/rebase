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
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresBootstrapper, createPostgresDatabaseConnection, openRebase, type OpenedRebase } from "../../src/index.js";
import { tablesFromCollections } from "../helpers/tables.js";

const songs: LegacyCollectionConfig = {
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

const notes: LegacyCollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    tenant: { field: "orgId", from: { claim: "org_id" } },
    securityRules: [{ name: "members", operation: "all", access: "public" }],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        orgId: { name: "Org", type: "string", columnName: "org_id", validation: { required: true } },
        body: { name: "Body", type: "string" }
    }
};

const people: LegacyCollectionConfig = {
    name: "People",
    slug: "people",
    table: "people",
    securityRules: [{ name: "readable", operation: "select", access: "public" }],
    properties: {
        id: { name: "ID", type: "number", isId: "increment" },
        name: { name: "Name", type: "string" },
        passwordHash: { name: "Hash", type: "string", columnName: "password_hash", excludeFromApi: true },
        salary: { name: "Salary", type: "number", access: { read: ["hr"] } }
    }
};

async function provision(url: string, collections: LegacyCollectionConfig[]): Promise<void> {
    const conn = createPostgresDatabaseConnection(url);
    try {
        const bootstrapper = createPostgresBootstrapper({ connectionString: url, connection: conn.db });
        const driverResult = await bootstrapper.initializeDriver({ collections, tables: tablesFromCollections(collections).tables, realtime: { subscribe: false, provision: false } });
        await bootstrapper.ensureTableSchema!(tablesFromCollections(collections).tables, driverResult);
        await bootstrapper.ensureRlsRuntime!(driverResult);
        await bootstrapper.ensureTablePolicies!(tablesFromCollections(collections).tables, driverResult);
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
        await provision(container.connectionString, [songs, notes, people]);
        rebase = await openRebase({ databaseUrl: container.connectionString, collections: [songs, notes, people], tables: tablesFromCollections([songs, notes, people]).tables });
        await rebase.sql(`INSERT INTO public.songs (owner_id, artist) VALUES
            ('ada', 'Rosalía'), ('ada', 'Björk'), ('bob', 'Muse')`);
        await rebase.sql("INSERT INTO public.notes (org_id, body) VALUES ('a', 'first'), ('b', 'second')");
        await rebase.sql("INSERT INTO public.people (name, password_hash, salary) VALUES ('Ada', 'h4sh', 100)");
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

    it("drops the columns the caller may not read, as the API does", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        const [row] = await ada.sql("SELECT * FROM people");
        expect(row).toEqual({ id: 1, name: "Ada" });
        const [aliased] = await ada.sql("SELECT name AS who, password_hash AS h, salary AS s FROM people p");
        expect(aliased).toEqual({ who: "Ada" });
        const hr = await rebase.withAuth({ uid: "hana", roles: ["hr"] });
        expect((await hr.sql("SELECT name, salary, password_hash FROM people"))[0]).toEqual({ name: "Ada", salary: "100" });
        // The owner's SQL is the server's, and reads everything.
        expect((await rebase.sql("SELECT password_hash FROM people"))[0]).toEqual({ password_hash: "h4sh" });
    });

    it("cannot move a row to another tenant, unless the caller may", async () => {
        const member = await rebase.withAuth({ uid: "ada", roles: ["user"], claims: { org_id: "a" } });
        expect((await member.sql("SELECT body FROM notes")).map(row => row.body)).toEqual(["first"]);
        await expect(member.sql("UPDATE notes SET org_id = 'b' WHERE body = 'first'", { write: true }))
            .rejects.toMatchObject({ cause: { code: "42501", message: expect.stringMatching(/^TENANT_IMMUTABLE/) } });
        // Editing the row in place is fine.
        await member.sql("UPDATE notes SET body = 'edited' WHERE body = 'first'", { write: true });
        // A bypass role (admin, by default) may move it, and so may the owner.
        const admin = await rebase.withAuth({ uid: "root", roles: ["admin"] });
        await admin.sql("UPDATE notes SET org_id = 'b' WHERE body = 'edited'", { write: true });
        await rebase.sql("UPDATE notes SET org_id = 'a' WHERE body = 'edited'");
        expect((await member.sql("SELECT body FROM notes")).map(row => row.body)).toEqual(["edited"]);
    });

    it("refuses the server's own functions", async () => {
        const ada = await rebase.withAuth({ uid: "ada", roles: ["user"] });
        await expect(ada.sql("SELECT rebase.enqueue_job('x', '{}'::jsonb)", { write: true }))
            .rejects.toMatchObject({ code: "SQL_NOT_ALLOWED" });
        expect(await ada.sql("SELECT rebase.uid() AS uid")).toEqual([{ uid: "ada" }]);
    });
});
