/**
 * E2E: what the connection posture answers on a database that is still empty.
 *
 * `detectConnectionPosture` decides one thing, once, at boot: whether requests
 * have to be switched to the restricted `rebase_user` role because the
 * connection role would otherwise bypass RLS. Every policy in the product rests
 * on that answer, and it is asked of the catalogue — which is why the two cases
 * below matter.
 *
 * 1. **A fresh database.** The question "does this role own any tables?" is
 *    asked of a database that has none yet. The honest answer at that instant is
 *    "no", and the honest answer for the rest of the process's life is "yes,
 *    all of them" — because this same process is what creates them, and a table
 *    owner bypasses every non-FORCE policy on it. One restart later the answer
 *    flips and the hole closes itself, which is what makes it easy to miss.
 *
 * 2. **An inheriting member of the owner.** `tableowner = current_user` is a
 *    string comparison, so a role that reaches ownership through membership
 *    reads as unprivileged while bypassing exactly as the owner does. That one
 *    never heals: no restart changes the answer.
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { detectConnectionPosture, type RawSqlRunner } from "../../src/security/rls-enforcement.js";

let container: PgContainer;

/** A raw runner bound to one client, in the shape the security module expects. */
function runnerFor(client: pg.Client): RawSqlRunner {
    return async (text: string) => (await client.query(text)).rows as Record<string, unknown>[];
}

async function connect(user: string, database: string): Promise<pg.Client> {
    const client = new pg.Client({
        connectionString: `postgresql://${user}:secret@localhost:${container.port}/${database}?sslmode=disable`
    });
    await client.connect();
    return client;
}

describe("connection posture on a database with no tables yet", () => {
    let admin: pg.Client;

    beforeAll(async () => {
        container = await startPgContainer();
        admin = new pg.Client({ connectionString: container.connectionString });
        await admin.connect();

        // An ordinary application owner: not a superuser, no BYPASSRLS, and the
        // owner of its own database — which is what every managed tenant and
        // every `docker compose` self-host gets.
        await admin.query("CREATE ROLE app_owner LOGIN PASSWORD 'secret' NOSUPERUSER NOBYPASSRLS CREATEROLE");
        await admin.query("CREATE DATABASE fresh OWNER app_owner");

        // And a second role that reaches the owner's tables through membership
        // rather than by being it.
        await admin.query("CREATE ROLE app_member LOGIN PASSWORD 'secret' NOSUPERUSER NOBYPASSRLS INHERIT");
        await admin.query("GRANT app_owner TO app_member");
    }, 180_000);

    afterAll(async () => {
        await admin?.end().catch(() => {});
        if (container) await stopPgContainer(container.containerName);
    });

    /**
     * The reproduction. The role owns nothing *yet*; it is about to own
     * everything, because provisioning runs on this very connection.
     */
    it("treats a role that is about to create every table as privileged", async () => {
        const owner = await connect("app_owner", "fresh");
        try {
            const posture = await detectConnectionPosture(runnerFor(owner));

            expect(posture.role).toBe("app_owner");
            expect(posture.superuser).toBe(false);
            expect(posture.bypassRLS).toBe(false);
            expect(posture.privileged).toBe(true);
        } finally {
            await owner.end();
        }
    });

    it("still says privileged once the tables actually exist", async () => {
        const owner = await connect("app_owner", "fresh");
        try {
            await owner.query("CREATE TABLE IF NOT EXISTS notes (id text primary key)");
            const posture = await detectConnectionPosture(runnerFor(owner));
            expect(posture.privileged).toBe(true);
            expect(posture.ownsTables).toBe(true);
        } finally {
            await owner.end();
        }
    });

    /**
     * `app_member` never appears in `pg_tables.tableowner`, but it INHERITs
     * `app_owner`, so Postgres treats it as the owner for every ownership test —
     * including the one that decides whether a policy applies.
     */
    it("sees ownership reached through role membership", async () => {
        const member = await connect("app_member", "fresh");
        try {
            // Prove the bypass first, so the assertion below is about a real
            // capability and not about the catalogue query's opinion.
            await member.query("ALTER TABLE notes ENABLE ROW LEVEL SECURITY");
            await member.query("INSERT INTO notes (id) VALUES ('seen-by-owner') ON CONFLICT DO NOTHING");
            const visible = await member.query("SELECT id FROM notes");
            expect(visible.rows.length).toBeGreaterThan(0);

            const posture = await detectConnectionPosture(runnerFor(member));
            expect(posture.role).toBe("app_member");
            expect(posture.ownsTables).toBe(true);
            expect(posture.privileged).toBe(true);
        } finally {
            await member.end();
        }
    });

    /**
     * The other direction: a role that genuinely cannot create anything and owns
     * nothing is subject to RLS natively, and must not be dragged through a role
     * switch it does not need.
     */
    it("leaves a genuinely unprivileged role alone", async () => {
        await admin.query("CREATE ROLE app_reader LOGIN PASSWORD 'secret' NOSUPERUSER NOBYPASSRLS NOINHERIT");
        const fresh = new pg.Client({
            connectionString: `postgresql://app_owner:secret@localhost:${container.port}/fresh?sslmode=disable`
        });
        await fresh.connect();
        await fresh.query("GRANT CONNECT ON DATABASE fresh TO app_reader");
        await fresh.query("REVOKE CREATE ON SCHEMA public FROM PUBLIC");
        await fresh.query("GRANT USAGE ON SCHEMA public TO app_reader");
        await fresh.end();

        const reader = await connect("app_reader", "fresh");
        try {
            const posture = await detectConnectionPosture(runnerFor(reader));
            expect(posture.role).toBe("app_reader");
            expect(posture.privileged).toBe(false);
        } finally {
            await reader.end();
        }
    });
});
