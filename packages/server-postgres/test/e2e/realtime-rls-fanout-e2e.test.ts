/**
 * E2E: realtime fan-out never carries a row past its reader's policy.
 *
 * Two users on one table whose policy shows each only their own rows. A write
 * only Alice may see reaches every one of Alice's subscriptions and none of
 * Bob's — through both of the paths that decide how few reads a write costs:
 *
 * - **grouping**: several sockets of one user on the same list share one
 *   read, and a different user is a different read;
 * - **the pre-filter**: a list filtered on the row's owner is only asked to
 *   look again when the change can reach it — including Bob's list that
 *   *asks* for Alice's rows, which the pre-filter must ask (it matches) and
 *   which must still read as Bob, and so find nothing.
 *
 * Writes come both ways a change reaches realtime: through the API (the
 * driver hands its row images over) and as raw SQL (the change read from the
 * WAL, with the values it streamed).
 *
 * Requires Docker.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { pgTable, varchar } from "drizzle-orm/pg-core";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";
import { startPgContainer, stopPgContainer, type PgContainer } from "./pg-setup.js";
import { PostgresBackendDriver } from "../../src/PostgresBackendDriver.js";
import { FixtureTableRegistry } from "../helpers/tables";
import { RealtimeService, type SubscriptionAuthContext } from "../../src/services/realtimeService.js";
import { provisionWalPublication } from "../../src/services/cdc/wal-cdc.js";
import { ensureAppRole, REBASE_USER_ROLE } from "../../src/security/rls-enforcement.js";

const notesTable = pgTable("notes", {
    id: varchar("id").primaryKey(),
    owner: varchar("owner"),
    body: varchar("body")
});
const notesCollection: LegacyCollectionConfig = {
    name: "Notes",
    slug: "notes",
    table: "notes",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        owner: { name: "Owner", type: "string" },
        body: { name: "Body", type: "string" }
    }
};

const ALICE: SubscriptionAuthContext = { uid: "alice", roles: ["user"] };
const BOB: SubscriptionAuthContext = { uid: "bob", roles: ["user"] };

class CollectingSocket {
    readyState = 1;
    bufferedAmount = 0;
    messages: string[] = [];
    send(msg: string) { this.messages.push(msg); }
    on() { /* not needed */ }
    close() { this.readyState = 3; }
    terminate() { this.readyState = 3; }
    clear() { this.messages = []; }
    /** Whether any data frame this socket received carries `marker`. */
    saw(marker: string) { return this.messages.some((m) => m.includes(marker)); }
}

async function waitFor(fn: () => boolean, timeoutMs = 10_000, stepMs = 50): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (!fn()) {
        if (Date.now() > deadline) throw new Error("waitFor timed out");
        await new Promise((r) => setTimeout(r, stepMs));
    }
}

const settle = (ms = 1500) => new Promise((r) => setTimeout(r, ms));

describe("realtime fan-out under RLS (E2E)", () => {
    let container: PgContainer;
    let admin: pg.Client;
    let pool: pg.Pool;
    let realtime: RealtimeService;
    let driver: PostgresBackendDriver;
    const alice: CollectingSocket[] = [];
    const bob: CollectingSocket[] = [];
    let aliceFiltered: CollectingSocket;
    let bobFiltered: CollectingSocket;
    /** Bob's list of Alice's rows: the pre-filter matches it, the policy must not. */
    let bobSpy: CollectingSocket;

    const subscribe = async (clientId: string, auth: SubscriptionAuthContext, filter?: Record<string, unknown>) => {
        const ws = new CollectingSocket();
        realtime.addClient(clientId, ws);
        await realtime.handleClientMessage(clientId, {
            type: "subscribe_collection",
            payload: { path: "notes", subscriptionId: "s", ...(filter ? { filter } : {}) }
        }, auth);
        return ws;
    };
    const everyone = () => [...alice, ...bob, aliceFiltered, bobFiltered, bobSpy];
    const clearAll = () => everyone().forEach((ws) => ws.clear());

    beforeAll(async () => {
        container = await startPgContainer({ args: ["-c", "wal_level=logical"] });
        for (let i = 0; ; i++) {
            try {
                admin = new pg.Client({ connectionString: container.connectionString });
                await admin.connect();
                break;
            } catch (e) {
                if (i >= 10) throw e;
                await new Promise((r) => setTimeout(r, 1000));
            }
        }
        await admin.query(`
            CREATE TABLE public.notes (id varchar PRIMARY KEY, owner varchar, body varchar);
            ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;
            CREATE POLICY notes_own ON public.notes FOR ALL TO public
                USING (owner = current_setting('app.uid', true))
                WITH CHECK (owner = current_setting('app.uid', true));
        `);
        pool = new pg.Pool({ connectionString: container.connectionString });
        const runSql = async (text: string) => (await pool.query(text)).rows as Record<string, unknown>[];
        await ensureAppRole(runSql, ["public"]);

        const db = drizzle(pool);
        const registry = new FixtureTableRegistry();
        registry.registerMultiple([notesCollection]);
        registry.registerPgTable(notesTable, "notes");
        realtime = new RealtimeService(db, registry);
        driver = new PostgresBackendDriver(db, realtime, registry);
        realtime.setDataDriver(driver);
        driver.rlsUserRole = REBASE_USER_ROLE;
        realtime.rlsUserRole = REBASE_USER_ROLE;

        const tables = [{ schema: "public", table: "notes", identityColumns: ["id"] }];
        await provisionWalPublication(runSql, tables);
        await realtime.enableWalCdc(container.connectionString, tables);
        expect(realtime.isCdcActive()).toBe(true);

        for (let i = 0; i < 3; i++) alice.push(await subscribe(`alice-${i}`, ALICE));
        for (let i = 0; i < 3; i++) bob.push(await subscribe(`bob-${i}`, BOB));
        aliceFiltered = await subscribe("alice-f", ALICE, { owner: ["==", "alice"] });
        bobFiltered = await subscribe("bob-f", BOB, { owner: ["==", "bob"] });
        bobSpy = await subscribe("bob-spy", BOB, { owner: ["==", "alice"] });
        await settle(500);
    }, 180_000);

    afterAll(async () => {
        await realtime?.destroy();
        await pool?.end();
        await admin?.end();
        if (container) await stopPgContainer(container.containerName);
    });

    it("an API write only Alice may see reaches all of Alice's lists and none of Bob's", async () => {
        clearAll();
        const asAlice = await driver.withAuth({ uid: "alice", roles: ["user"], displayName: null, email: null, photoURL: null, providerId: "test", isAnonymous: false });
        await asAlice.save({ path: "notes", id: "n-api", values: { owner: "alice", body: "alice-secret-api" }, status: "new" });

        await waitFor(() => [...alice, aliceFiltered].every((ws) => ws.saw("alice-secret-api")));
        await settle();
        for (const ws of [...bob, bobFiltered, bobSpy]) expect(ws.saw("alice-secret-api")).toBe(false);
    });

    it("a raw SQL write only Alice may see, read from the WAL, reaches all of Alice's lists and none of Bob's", async () => {
        clearAll();
        await admin.query(`INSERT INTO public.notes (id, owner, body) VALUES ('n-sql', 'alice', 'alice-secret-sql')`);

        await waitFor(() => [...alice, aliceFiltered].every((ws) => ws.saw("alice-secret-sql")));
        await settle();
        for (const ws of [...bob, bobFiltered, bobSpy]) expect(ws.saw("alice-secret-sql")).toBe(false);
    });

    it("Bob's own row reaches Bob's lists, and his list of Alice's rows stays empty", async () => {
        clearAll();
        await admin.query(`INSERT INTO public.notes (id, owner, body) VALUES ('n-bob', 'bob', 'bob-note')`);

        await waitFor(() => [...bob, bobFiltered].every((ws) => ws.saw("bob-note")));
        await settle();
        for (const ws of [...alice, aliceFiltered, bobSpy]) expect(ws.saw("bob-note")).toBe(false);
    });

    it("a row moved from Alice to Bob reaches Bob, though the change cannot say who owned it before", async () => {
        clearAll();
        // A default replica identity streams no old values: the pre-filter
        // cannot judge it, and every list looks again under its own scope.
        await admin.query(`UPDATE public.notes SET owner = 'bob', body = 'moved-to-bob' WHERE id = 'n-sql'`);

        await waitFor(() => [...bob, bobFiltered].every((ws) => ws.saw("moved-to-bob")));
        // Alice's lists are told the row left them, and never see its new body.
        await waitFor(() => [...alice, aliceFiltered].every((ws) => ws.messages.length > 0));
        await settle();
        for (const ws of [...alice, aliceFiltered, bobSpy]) expect(ws.saw("moved-to-bob")).toBe(false);
    });
});
