/**
 * A history entry is served as a read of its table is: the caller's field
 * access first, then the table's `afterRead` chain (global, table, column).
 *
 * History stores the row as it was written — the stored values, before any
 * hook — because that is what a revert writes back. The route serves those
 * snapshots to anyone who may read the row, so whatever a live read masks or
 * withholds has to be masked or withheld in every snapshot too; otherwise the
 * history of a row is the row without its protections.
 *
 * A real driver over PGlite, with real row policies and the restricted request
 * role, the real history service and table, and the real routes — so what is
 * asserted is what a caller receives.
 */
import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { Hono } from "hono";
import { col, defineTable, type User } from "@rebasepro/types";
import { compileSchema } from "@rebasepro/common";
import { createHistoryRoutes, type HonoEnv } from "@rebasepro/server";

import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { buildTableRegistry } from "../src/model/build-registry";
import { RealtimeService } from "../src/services/realtimeService";
import { REBASE_USER_ROLE } from "../src/security/rls-enforcement";
import { HistoryService } from "../src/history/HistoryService";
import { ensureHistoryTableExists } from "../src/history/ensure-history-table";
import { testUser } from "./helpers/spg-b-fixtures";
import { pgliteNodePg } from "./helpers/spg-b-pglite-node-pg";

const maskEmail = (value: unknown): unknown =>
    typeof value === "string" ? value.replace(/^(.).*@/, "$1***@") : value;

const contacts = defineTable("contacts", {
    columns: {
        id: col.serial().primaryKey(),
        name: col.text(),
        email: col.text(),
        // A column transform: served upper-cased, stored as written.
        handle: col.text().transform({ afterRead: ({ value }) => typeof value === "string" ? value.toUpperCase() : value }),
        // Never served, for anyone.
        secret: col.text().private(),
        // Served to admins only.
        salary: col.integer().access({ read: ["admin"] }),
        // Served to everyone, written by no API caller.
        code: col.text().readOnly(),
        ownerId: col.text("owner_id"),
        shared: col.boolean()
    },
    history: true,
    hooks: {
        afterRead: ({ values }) => ({ ...values, email: maskEmail(values.email) })
    },
    // Declared for the descriptor; the policies are written by hand below, so
    // the test does not lean on the generator to prove what the database does.
    rls: [{ operation: "all", ownerField: "ownerId" }]
});

const contactsPg = pgTable("contacts", {
    id: serial("id").primaryKey(),
    name: text("name"),
    email: text("email"),
    handle: text("handle"),
    secret: text("secret"),
    salary: integer("salary"),
    code: text("code"),
    ownerId: text("owner_id"),
    shared: boolean("shared")
});

const OWNER = testUser({ uid: "u-owner", roles: ["user"] });
const READER = testUser({ uid: "u-reader", roles: ["user"] });
const ADMIN = testUser({ uid: "u-admin", roles: ["admin"] });

const COMPILED = compileSchema([contacts]);
const DESCRIPTORS = COMPILED.map(table => table.descriptor);

let db: PGlite;
let base: PostgresBackendDriver;
let historyService: HistoryService;

async function boot(): Promise<void> {
    const registry = buildTableRegistry({
        compiledTables: COMPILED,
        tables: { contacts: contactsPg }
    });
    const orm = pgliteNodePg(db, { schema: { contacts: contactsPg } });
    const state = await ensureHistoryTableExists(orm);
    // No inline prune: it would run on the one PGlite session while a
    // request transaction holds the restricted role.
    historyService = new HistoryService(orm, undefined, { ...state, pruneOnRecord: false });
    base = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry, undefined, undefined, historyService);
    base.rlsUserRole = REBASE_USER_ROLE;
}

function app(user: User): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    router.use("/*", async (c, next) => {
        c.set("driver", await base.withAuth(user));
        c.set("user", user);
        await next();
    });
    router.route("/api/data", createHistoryRoutes({
        historyService,
        tables: () => ({ descriptors: DESCRIPTORS }),
        driver: base
    }));
    return router;
}

interface HistoryEntryBody {
    id: string;
    action: string;
    changed_fields: string[] | null;
    values: Record<string, unknown>;
    previous_values: Record<string, unknown> | null;
    updated_by: string | null;
}

async function history(user: User, id: number): Promise<{ status: number; data: HistoryEntryBody[] }> {
    const res = await app(user).request(`/api/data/contacts/${id}/history`);
    const body = await res.json() as { data?: HistoryEntryBody[] };
    return { status: res.status, data: body.data ?? [] };
}

async function revert(user: User, id: number, entryId: string): Promise<{ status: number; body: Record<string, unknown> }> {
    const res = await app(user).request(`/api/data/contacts/${id}/history/${entryId}/revert`, { method: "POST" });
    return { status: res.status, body: await res.json() as Record<string, unknown> };
}

const stored = async (id: number): Promise<Record<string, unknown>> =>
    (await db.query<Record<string, unknown>>(`SELECT * FROM contacts WHERE id = ${id}`)).rows[0];

beforeEach(async () => {
    db = new PGlite();
    await db.waitReady;
    await db.exec(`
        CREATE SCHEMA IF NOT EXISTS rebase;
        CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN;
        CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text
            LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.uid', true), '') $$;
        CREATE TABLE contacts (
            id serial PRIMARY KEY, name text, email text, handle text, secret text,
            salary integer, code text, owner_id text, shared boolean
        );
        ALTER TABLE contacts ENABLE ROW LEVEL SECURITY;
        ALTER TABLE contacts FORCE ROW LEVEL SECURITY;
        -- Read: your own rows and the shared ones. Write: your own.
        CREATE POLICY read_rows ON contacts FOR SELECT USING (owner_id = rebase.uid() OR shared);
        CREATE POLICY write_rows ON contacts FOR UPDATE USING (owner_id = rebase.uid()) WITH CHECK (owner_id = rebase.uid());
        GRANT USAGE ON SCHEMA public, rebase TO ${REBASE_USER_ROLE};
        GRANT SELECT, INSERT, UPDATE, DELETE ON contacts TO ${REBASE_USER_ROLE};
        GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO ${REBASE_USER_ROLE};
        GRANT EXECUTE ON FUNCTION rebase.uid() TO ${REBASE_USER_ROLE};
        INSERT INTO contacts (name, email, handle, secret, salary, code, owner_id, shared) VALUES
            ('Ann', 'ann@example.com', 'ann', 's3cret', 90000, 'C-1', 'u-owner', true),
            ('Bob', 'bob@example.com', 'bob', 'hidden', 50000, 'C-2', 'u-owner', false);
    `);
    await boot();

    // Two writes to row 1. The first on the trusted server plane, which reads
    // every column, private ones included — so its snapshots carry them. The
    // second by the owner, through their scoped driver.
    await base.save({
        path: "contacts", id: "1", status: "existing",
        values: { email: "ann.lee@example.com", secret: "s3cret-2", salary: 95000, code: "C-1b" }
    });
    await (await base.withAuth(OWNER)).save({
        path: "contacts", id: "1", status: "existing",
        values: { name: "Ann Lee", handle: "annlee" }
    });
    // Row 2, not readable by READER, gets an entry too.
    await base.save({
        path: "contacts", id: "2", status: "existing",
        values: { email: "robert@example.com" }
    });
    // An entry recorded while the table still had a column it has since
    // dropped (`ssn`), and a key an old `afterRead` once added (`displayName`).
    await db.query(`
        INSERT INTO rebase.entity_history (table_name, entity_id, action, changed_fields, "values", previous_values, updated_by, updated_at)
        VALUES ('contacts', '1', 'update', ARRAY['ssn','name'],
            '{"id":1,"name":"Ann","ssn":"123-45-6789","displayName":"Ann (owner)"}',
            '{"name":"A.","ssn":"000-00-0000"}', 'u-legacy', now() - interval '1 day')
    `);
});

afterEach(async () => {
    await db.close();
});

/** Every snapshot of every entry, `values` and `previous_values`. */
const snapshots = (entries: HistoryEntryBody[]): Record<string, unknown>[] =>
    entries.flatMap(entry => [entry.values, entry.previous_values].filter((s): s is Record<string, unknown> => s !== null && typeof s === "object"));

describe("GET /:slug/:id/history, as a caller who may read the row", () => {
    it("lists the row's entries", async () => {
        const { status, data } = await history(READER, 1);
        expect(status).toBe(200);
        expect(data.map(entry => entry.action)).toEqual(["update", "update", "update"]);
    });

    it("runs the table's afterRead on every snapshot: the email is masked on both sides", async () => {
        const { data } = await history(READER, 1);
        const emails = snapshots(data).map(s => s.email).filter(e => e !== undefined);
        expect(emails.length).toBeGreaterThan(0);
        for (const email of emails) expect(email).toMatch(/^.\*\*\*@example\.com$/);
    });

    it("runs a column's transform on every snapshot", async () => {
        const { data } = await history(READER, 1);
        const handles = snapshots(data).map(s => s.handle).filter(h => h !== undefined);
        expect(handles).toEqual(expect.arrayContaining(["ANNLEE", "ANN"]));
        for (const handle of handles) expect(handle).toBe(String(handle).toUpperCase());
    });

    it("withholds a private column from every snapshot", async () => {
        const { data } = await history(READER, 1);
        for (const s of snapshots(data)) expect(s).not.toHaveProperty("secret");
    });

    it("withholds a role-restricted column from a caller without the role", async () => {
        const { data } = await history(READER, 1);
        for (const s of snapshots(data)) expect(s).not.toHaveProperty("salary");
    });

    it("serves the role-restricted column to a caller with the role, still masked by the hooks", async () => {
        const { data } = await history(ADMIN, 1);
        const salaries = snapshots(data).map(s => s.salary).filter(v => v !== undefined);
        expect(salaries).toEqual(expect.arrayContaining([95000, 90000]));
        for (const s of snapshots(data)) {
            expect(s).not.toHaveProperty("secret");
            if (s.email !== undefined) expect(s.email).toMatch(/^.\*\*\*@/);
        }
    });

    it("does not name a withheld column in changed_fields", async () => {
        const { data } = await history(READER, 1);
        for (const entry of data) {
            expect(entry.changed_fields ?? []).not.toContain("secret");
            expect(entry.changed_fields ?? []).not.toContain("salary");
            expect(entry.changed_fields ?? []).not.toContain("ssn");
        }
    });

    it("withholds a key the table no longer has a column for (a dropped column, an old computed field)", async () => {
        const { data } = await history(READER, 1);
        for (const s of snapshots(data)) {
            expect(s).not.toHaveProperty("ssn");
            expect(s).not.toHaveProperty("displayName");
        }
    });

    it("masks a compact entry's previous values with the row they belong to", async () => {
        // A format-2 update stores only the changed fields' previous values.
        // The owner's write changed name and handle: the handle's old value
        // is served transformed, and nothing the entry does not hold is added.
        const { data } = await history(READER, 1);
        const ownerWrite = data.find(entry => entry.updated_by === OWNER.uid);
        expect(ownerWrite?.previous_values).toEqual({ name: "Ann", handle: "ANN" });
    });

    it("keeps who made each version: the history route answers who changed this row", async () => {
        const { data } = await history(READER, 1);
        expect(data.map(entry => entry.updated_by)).toEqual(expect.arrayContaining([OWNER.uid, "u-legacy"]));
    });
});

describe("which rows' history a caller may list", () => {
    it("a row the caller cannot read has no readable history: a 404, as the row is", async () => {
        const { status, data } = await history(READER, 2);
        expect(status).toBe(404);
        expect(data).toEqual([]);
    });

    it("a row moved out of the caller's reach takes its history with it", async () => {
        await db.query(`UPDATE contacts SET shared = false WHERE id = 1`);
        expect((await history(READER, 1)).status).toBe(404);
        expect((await history(OWNER, 1)).status).toBe(200);
    });
});

describe("POST /:slug/:id/history/:historyId/revert", () => {
    it("writes back only what the caller may write: private, role-restricted and read-only columns stay as they are", async () => {
        const firstWrite = (await history(OWNER, 1)).data.find(entry => entry.updated_by === null && entry.action === "update");
        expect(firstWrite).toBeDefined();
        // Make the private and the role-restricted column differ from the
        // version, so a revert that wrote them would show. (A read-only column
        // the caller can see that differs refuses the revert: next test.)
        await db.query(`UPDATE contacts SET secret = 'now', salary = 1, code = 'C-1b' WHERE id = 1`);

        const { status } = await revert(OWNER, 1, firstWrite!.id);
        expect(status).toBe(200);
        const row = await stored(1);
        expect(row.secret).toBe("now");
        expect(row.salary).toBe(1);
        // What the caller may write is restored — the stored email, never the
        // masked rendering the history list showed them.
        expect(row.email).toBe("ann.lee@example.com");
        expect(row.name).toBe("Ann");
    });

    it("refuses a revert that would change a read-only column the caller can see", async () => {
        const firstWrite = (await history(OWNER, 1)).data.find(entry => entry.updated_by === null && entry.action === "update");
        await db.query(`UPDATE contacts SET code = 'C-now' WHERE id = 1`);
        const { status } = await revert(OWNER, 1, firstWrite!.id);
        expect(status).toBe(400);
        expect((await stored(1)).code).toBe("C-now");
    });

    it("answers the revert with the row as a read serves it", async () => {
        const firstWrite = (await history(OWNER, 1)).data.find(entry => entry.updated_by === null && entry.action === "update");
        const { body } = await revert(OWNER, 1, firstWrite!.id);
        const data = body.data as Record<string, unknown>;
        expect(data.email).toMatch(/^.\*\*\*@/);
        expect(data).not.toHaveProperty("secret");
        expect(data).not.toHaveProperty("salary");
    });

    it("is refused to a caller who may read the row but not write it", async () => {
        const entry = (await history(READER, 1)).data[0];
        const before = await stored(1);
        const { status } = await revert(READER, 1, entry.id);
        expect(status).toBeGreaterThanOrEqual(400);
        expect(await stored(1)).toEqual(before);
    });
});
