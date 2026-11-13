/**
 * E2E: a declared table the database does not protect is not served by a
 * backend that does not provision its tables (SEC-FIX-2 F-2).
 *
 * ## Why this is pinned
 *
 * A provisioning boot leaves every declared table with row-level security on
 * and its policies written. A backend that provisions nothing
 * (`provisionSchema: false`, `REBASE_PROVISION=false`) changed nothing and
 * checked nothing: after `ALTER TABLE notes DISABLE ROW LEVEL SECURITY`, an
 * `rls: "admin-only"` table handed every row to every signed-in caller.
 * Introspection mode already refused exactly this table.
 *
 * Now the boot reads the catalogue once the policies step is over and
 * withholds such a table — RLS off, or RLS on with none of its declared
 * policies — with the statements that protect it in the log; a request for it
 * is refused (503 `TABLE_WITHHELD`) without naming the SQL. The other tables
 * are served. A live refresh holds a table it starts serving to the same.
 *
 * SEC-FIX-3 tightened "protected": any one policy used to do, so a stray
 * `USING (true)` in place of the declared policies was served. Now at least one
 * declared policy must be there by the name provisioning gives it, and no
 * declared restrictive policy may be missing; a missing permissive policy only
 * narrows access, so that table is served (with a warning).
 *
 * Requires Docker.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer } from "node:http";
import pg from "pg";
import { Hono } from "hono";
import { col, defineTable, rel } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";

import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { createPostgresAdapter } from "../../src/PostgresAdapter.js";
import { createPostgresBootstrapper } from "../../src/PostgresBootstrapper.js";
import { createPostgresDatabaseConnection } from "../../src/connection.js";
import { initializeRebaseBackend, _resetRebaseMock } from "../../../server/src/index.js";
import { generateAccessToken } from "../../../server/src/auth/jwt.js";
import type { HonoEnv } from "../../../server/src/api/types.js";
import type { AuthRepository } from "../../../server/src/auth/interfaces.js";

const JWT_SECRET = "declared-table-protection-e2e-secret-long-enough-0123";
const SERVICE_KEY = "declared-table-protection-e2e-service-key-0123456789ab";

const notes = defineTable("notes", {
    columns: { id: col.serial().primaryKey(), body: col.text() },
    rls: "admin-only"
});
const shared = defineTable("shared", {
    columns: { id: col.serial().primaryKey(), body: col.text() },
    rls: [{ operation: "select", access: "public" }]
});
const fine = defineTable("fine", {
    columns: { id: col.serial().primaryKey(), body: col.text() },
    relations: { note: rel.belongsTo(() => notes) },
    rls: [{ operation: "select", access: "public" }]
});
const gated = defineTable("gated", {
    columns: { id: col.serial().primaryKey(), body: col.text() },
    rls: [
        { operation: "select", access: "public" },
        { operation: "select", mode: "restrictive", using: "{body} <> 'hidden by the gate'" }
    ]
});
const labels = defineTable("labels", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    rls: [{ operation: "select", access: "public" }]
});
const tagged = defineTable("tagged", {
    columns: { id: col.serial().primaryKey(), name: col.text() },
    relations: { labels: rel.manyToMany(() => labels) },
    rls: [{ operation: "select", access: "public" }]
});
const TABLES = [notes, shared, fine, gated, labels, tagged];
const SECRET = "admin-only secret";

type Row = Record<string, unknown>;

describe("a declared table the database does not protect is withheld (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    const editor = { uid: "", token: "" };
    const originalProvision = process.env.REBASE_PROVISION;

    async function boot(provisionSchema: boolean) {
        const app = new Hono<HonoEnv>();
        const server = createServer();
        const connection = createPostgresDatabaseConnection(container.connectionString);
        const backend = await initializeRebaseBackend({
            app, server,
            tables: TABLES,
            provisionSchema,
            database: createPostgresAdapter({ connection: connection.db, connectionString: container.connectionString }),
            auth: { jwtSecret: JWT_SECRET, serviceKey: SERVICE_KEY }
        });
        const get = async (path: string, token = editor.token): Promise<{ status: number; text: string; body: Row }> => {
            const response = await app.request(`/api/data${path}`, { headers: { Authorization: `Bearer ${token}` } });
            const text = await response.text();
            const parsed: unknown = text ? JSON.parse(text) : {};
            return { status: response.status, text, body: typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? { ...parsed } : {} };
        };
        const stop = async () => {
            await backend.shutdown(1_000).catch(() => {});
            _resetRebaseMock();
            await connection.pool.end().catch(() => {});
        };
        return { backend, get, stop };
    }

    /** What a caller is told about a withheld table: the refusal, never the rows nor the SQL. */
    function expectWithheld(answer: { status: number; text: string }, table: string): void {
        expect(answer.status, answer.text).toBe(503);
        expect(answer.text).toContain("TABLE_WITHHELD");
        expect(answer.text).toContain(`"${table}"`);
        expect(answer.text).not.toContain(SECRET);
        expect(answer.text).not.toMatch(/ALTER TABLE|CREATE POLICY/);
    }

    async function expectProtectedServing(get: (path: string) => Promise<{ status: number; text: string; body: Row }>) {
        expectWithheld(await get("/notes"), "notes");
        expectWithheld(await get("/shared"), "shared");
        const served = await get("/fine");
        expect(served.status, served.text).toBe(200);
        expect(served.body.data).toEqual([{ id: 1, body: "fine row", noteId: 1 }]);
        // An include into a withheld table never hands its rows over.
        const included = await get("/fine?include=note");
        expect(included.text).not.toContain(SECRET);
    }

    beforeAll(async () => {
        process.env.NODE_ENV = "test";
        container = await startPgContainer();
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise(r => setTimeout(r, 1000));
            }
        }
        // The provisioning boot: tables, RLS, policies, an editor.
        const first = await boot(true);
        const repo = first.backend.auth?.authRepository as AuthRepository | undefined;
        if (!repo) throw new Error("no auth repository");
        const user = await repo.createUser({ email: "editor@protection.test", emailVerified: true });
        await repo.setUserRoles(user.id, ["editor"]);
        editor.uid = user.id;
        editor.token = await generateAccessToken(user.id, ["editor"]);
        await admin.query(`
            INSERT INTO notes (body) VALUES ('${SECRET}');
            INSERT INTO shared (body) VALUES ('${SECRET}');
            INSERT INTO fine (body, note_id) VALUES ('fine row', 1);
        `);
        const before = await first.get("/notes");
        expect(before.status).toBe(200);
        expect(before.body.data).toEqual([]);
        await first.stop();

        // How a database gets here: a debugging session, a hand migration, an old dump.
        await admin.query("ALTER TABLE notes DISABLE ROW LEVEL SECURITY");
        const { rows } = await admin.query<{ policyname: string }>("SELECT policyname FROM pg_policies WHERE tablename = 'shared'");
        expect(rows.length).toBeGreaterThan(0);
        for (const { policyname } of rows) await admin.query(`DROP POLICY "${policyname}" ON shared`);
    }, 240_000);

    afterAll(async () => {
        if (originalProvision === undefined) delete process.env.REBASE_PROVISION;
        else process.env.REBASE_PROVISION = originalProvision;
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    }, 60_000);

    it("provisionSchema: false withholds the unprotected tables and serves the rest, changing nothing", async () => {
        const second = await boot(false);
        try {
            await expectProtectedServing(second.get);
            // The service key does not reach it either: it is not served at all.
            const asService = await second.get("/notes", SERVICE_KEY);
            expect(asService.text).not.toContain(SECRET);
        } finally {
            await second.stop();
        }
        // The check read the catalogue; it changed nothing.
        const { rows } = await admin.query<{ relrowsecurity: boolean }>("SELECT relrowsecurity FROM pg_class WHERE relname = 'notes'");
        expect(rows[0]?.relrowsecurity).toBe(false);
        expect((await admin.query("SELECT 1 FROM pg_policies WHERE tablename = 'shared'")).rows).toHaveLength(0);
    });

    it("REBASE_PROVISION=false withholds them the same way", async () => {
        process.env.REBASE_PROVISION = "false";
        try {
            const third = await boot(true);
            try {
                await expectProtectedServing(third.get);
            } finally {
                await third.stop();
            }
        } finally {
            if (originalProvision === undefined) delete process.env.REBASE_PROVISION;
            else process.env.REBASE_PROVISION = originalProvision;
        }
    });

    it("a live refresh withholds a table it starts serving that has RLS off, and keeps it withheld", async () => {
        // Made by somebody else's change process: granted to the request role, RLS never enabled.
        await admin.query(`
            CREATE TABLE public.adopted (id serial PRIMARY KEY, body text);
            INSERT INTO public.adopted (body) VALUES ('${SECRET}');
            GRANT ALL ON public.adopted TO rebase_user;
        `);
        const adopted = defineTable("adopted", {
            columns: { id: col.serial().primaryKey(), body: col.text() },
            rls: [{ operation: "select", access: "public" }]
        });
        const connection = createPostgresDatabaseConnection(container.connectionString);
        const bootstrapper = createPostgresBootstrapper({ connection: connection.db, connectionString: container.connectionString });
        const driverResult = await bootstrapper.initializeDriver({
            tables: compileSchema([notes, fine]),
            provision: false,
            realtime: { subscribe: false, provision: false }
        });
        try {
            if (!driverResult.refreshTables) throw new Error("the Postgres driver refreshes its tables");
            const edited = compileSchema([notes, fine, adopted]);
            expect(await driverResult.refreshTables(edited)).toEqual({ status: "served" });
            await expect(driverResult.driver.fetchCollection({ path: "adopted" })).rejects.toMatchObject({ code: "TABLE_WITHHELD" });
            // A refresh that changes nothing this database stores keeps it withheld.
            expect(await driverResult.refreshTables(edited)).toEqual({ status: "served" });
            await expect(driverResult.driver.fetchCollection({ path: "adopted" })).rejects.toMatchObject({ code: "TABLE_WITHHELD" });
            expect(await driverResult.driver.fetchCollection({ path: "fine" })).toHaveLength(1);
            // `notes` (RLS still off here) is held to the same on a refresh.
            await expect(driverResult.driver.fetchCollection({ path: "notes" })).rejects.toMatchObject({ code: "TABLE_WITHHELD" });
        } finally {
            await connection.pool.end().catch(() => {});
        }
    });

    it("serves every table again once the database protects them (no false refusal)", async () => {
        // A provisioning boot puts RLS and the policies back…
        const fixing = await boot(true);
        await fixing.stop();
        // …and the next non-provisioning boot serves all three.
        const after = await boot(false);
        try {
            const notesAnswer = await after.get("/notes");
            expect(notesAnswer.status, notesAnswer.text).toBe(200);
            expect(notesAnswer.body.data).toEqual([]);
            const sharedAnswer = await after.get("/shared");
            expect(sharedAnswer.status, sharedAnswer.text).toBe(200);
            expect(sharedAnswer.body.data).toEqual([{ id: 1, body: SECRET }]);
        } finally {
            await after.stop();
        }
    });

    it("a stray policy in place of the declared ones, or a missing restrictive gate, is no protection; a missing permissive policy only narrows", async () => {
        const fixing = await boot(true);
        await fixing.stop();
        await admin.query("INSERT INTO gated (body) VALUES ('hidden by the gate'), ('open row')");
        const policiesOf = async (table: string) =>
            (await admin.query<{ policyname: string; permissive: string }>(`SELECT policyname, permissive FROM pg_policies WHERE tablename = '${table}'`)).rows;

        // shared: its declared policies replaced by one nobody declared.
        for (const { policyname } of await policiesOf("shared")) await admin.query(`DROP POLICY "${policyname}" ON shared`);
        await admin.query("CREATE POLICY stray ON shared FOR SELECT USING (true)");
        // gated: the grant without its gate.
        const gates = (await policiesOf("gated")).filter(policy => policy.permissive === "RESTRICTIVE");
        expect(gates.length).toBeGreaterThan(0);
        for (const { policyname } of gates) await admin.query(`DROP POLICY "${policyname}" ON gated`);

        const withheld = await boot(false);
        try {
            expectWithheld(await withheld.get("/shared"), "shared");
            const gatedAnswer = await withheld.get("/gated");
            expect(gatedAnswer.status, gatedAnswer.text).toBe(503);
            expect(gatedAnswer.text).toContain("TABLE_WITHHELD");
            expect(gatedAnswer.text).not.toContain("hidden by the gate");
            expect((await withheld.get("/fine")).status).toBe(200);
        } finally {
            await withheld.stop();
        }

        // Back to the declared policies, then one permissive grant of several gone: served.
        const again = await boot(true);
        await again.stop();
        await admin.query("DROP POLICY stray ON shared");
        const permissive = (await policiesOf("gated")).filter(policy => policy.permissive === "PERMISSIVE");
        expect(permissive.length).toBeGreaterThan(1);
        await admin.query(`DROP POLICY "${permissive[0].policyname}" ON gated`);
        const narrowed = await boot(false);
        try {
            const answer = await narrowed.get("/gated");
            expect(answer.status, answer.text).toBe(200);
            expect(answer.text).not.toContain("hidden by the gate");
            expect((await narrowed.get("/shared")).status).toBe(200);
        } finally {
            await narrowed.stop();
        }
    });

    it("a many-to-many junction the database does not protect withholds the table that reads through it (SEC-FIX-4 R-2)", async () => {
        const fixing = await boot(true);
        await fixing.stop();
        const relation = compileSchema(TABLES).find(table => table.descriptor.slug === "tagged")?.descriptor.relations
            .find(candidate => candidate.name === "labels");
        if (relation?.kind !== "manyToMany") throw new Error("tagged.labels is a many-to-many");
        await admin.query(`ALTER TABLE "${relation.through.table}" DISABLE ROW LEVEL SECURITY`);
        const after = await boot(false);
        try {
            const taggedAnswer = await after.get("/tagged");
            expect(taggedAnswer.status, taggedAnswer.text).toBe(503);
            expect(taggedAnswer.text).toContain("TABLE_WITHHELD");
            expect(taggedAnswer.text).toContain("junction");
            expect((await after.get("/labels")).status).toBe(200);
            expect((await after.get("/fine")).status).toBe(200);
        } finally {
            await after.stop();
        }
    });
});
