/**
 * The authenticated context is one statement: GUCs and role together.
 *
 * Every user-context transaction — each REST read and write, each realtime
 * refetch per subscriber — opened with `SELECT set_config(…)` for the `app.*`
 * GUCs and then a separate `SET LOCAL ROLE rebase_user`: a round trip of its
 * own, per transaction. `set_config('role', …, true)` is the same switch
 * (Postgres implements `SET ROLE` as the `role` setting, with the same check),
 * so it rides in the statement that sets the GUCs.
 *
 * What must not move, proven against a real Postgres (PGlite) next to the old
 * spelling: the transaction runs as the role with the GUCs readable, both reset
 * at COMMIT and ROLLBACK, an unknown role and a role the connection may not
 * assume fail with the same SQLSTATE and message as `SET LOCAL ROLE` — so
 * `isRoleSwitchingPermissionError` still recognises the refusal — and a failed
 * switch aborts the transaction rather than leaving it running privileged.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { CollectionConfig } from "@rebasepro/types";
import { PostgresBackendDriver } from "../src/PostgresBackendDriver";
import { PostgresCollectionRegistry } from "../src/collections/PostgresCollectionRegistry";
import { RealtimeService } from "../src/services/realtimeService";
import { applyAuthContext, REBASE_USER_ROLE } from "../src/security/rls-enforcement";
import { isRoleSwitchingPermissionError } from "../src/utils/pg-error-utils";

const AUTH = { uid: "user-1", roles: ["editor"], isAnonymous: false };

describe("applyAuthContext round trips", () => {
    it("sends one statement when it switches the role", async () => {
        const sent: unknown[] = [];
        const tx = { execute: async (query: unknown) => { sent.push(query); } };

        await applyAuthContext(tx as never, AUTH, REBASE_USER_ROLE);

        expect(sent).toHaveLength(1);
    });

    it("sends one statement without a role, as before", async () => {
        const sent: unknown[] = [];
        const tx = { execute: async (query: unknown) => { sent.push(query); } };

        await applyAuthContext(tx as never, AUTH);

        expect(sent).toHaveLength(1);
    });
});

describe("applyAuthContext against Postgres", () => {
    let pglite: PGlite;
    let db: ReturnType<typeof drizzle>;

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        await pglite.exec(`
            CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN;
            CREATE ROLE "Mixed Case" NOLOGIN;
            CREATE ROLE limited NOLOGIN;
        `);
        db = drizzle(pglite);
    });

    afterEach(async () => {
        await pglite.close();
    });

    const whoAmI = async (run: { execute: (q: ReturnType<typeof sql>) => Promise<{ rows: unknown[] }> }) =>
        (await run.execute(sql`SELECT current_user AS role, current_setting('app.uid', true) AS uid,
            current_setting('app.user_roles', true) AS roles`)).rows[0] as { role: string; uid: string | null; roles: string | null };

    it("runs the transaction as the role, with the GUCs readable after the switch", async () => {
        const inside = await db.transaction(async (tx) => {
            await applyAuthContext(tx, AUTH, REBASE_USER_ROLE);
            return whoAmI(tx);
        });

        expect(inside).toEqual({ role: REBASE_USER_ROLE, uid: "user-1", roles: "editor" });
    });

    it("takes a role name verbatim, as the quoted SET ROLE did", async () => {
        const inside = await db.transaction(async (tx) => {
            await applyAuthContext(tx, AUTH, "Mixed Case");
            return whoAmI(tx);
        });

        expect(inside.role).toBe("Mixed Case");
    });

    it("leaves nothing behind on the connection after COMMIT or ROLLBACK", async () => {
        await db.transaction(async (tx) => { await applyAuthContext(tx, AUTH, REBASE_USER_ROLE); });
        expect(await whoAmI(db)).toEqual({ role: "postgres", uid: "", roles: "" });

        await db.transaction(async (tx) => {
            await applyAuthContext(tx, AUTH, REBASE_USER_ROLE);
            tx.rollback();
        }).catch(() => undefined);
        expect(await whoAmI(db)).toEqual({ role: "postgres", uid: "", roles: "" });
    });

    /** What Postgres says to the old spelling and to applyAuthContext, side by side. */
    async function refusals(role: string) {
        const failure = (promise: Promise<unknown>) => promise.then(
            () => { throw new Error("expected a refusal"); },
            (error: unknown) => {
                const cause = (error as { cause?: unknown }).cause ?? error;
                const { code, message } = cause as { code?: string; message?: string };
                return { code, message, roleSwitchRefusal: isRoleSwitchingPermissionError(error) };
            }
        );
        const old = await failure(db.transaction(async (tx) => {
            await tx.execute(sql.raw(`SET LOCAL ROLE "${role.replace(/"/g, "\"\"")}"`));
        }));
        const now = await failure(db.transaction(async (tx) => {
            await applyAuthContext(tx, AUTH, role);
        }));
        return { old, now };
    }

    it("refuses a role that does not exist exactly as SET LOCAL ROLE does", async () => {
        const { old, now } = await refusals("no_such_role");

        expect(now).toEqual(old);
        expect(now.code).toBe("22023");
        // The failed switch aborted the transaction: nothing ran privileged after it.
        expect(await whoAmI(db)).toEqual({ role: "postgres", uid: "", roles: "" });
    });

    it("refuses a role the connection may not assume with the same 42501, still recognised as a role-switch refusal", async () => {
        // A connection role that is not a member of `rebase_user` — the
        // deployment `_roleSwitchingUnavailable` exists for.
        await pglite.exec("SET SESSION AUTHORIZATION limited");

        const { old, now } = await refusals(REBASE_USER_ROLE);

        expect(now).toEqual(old);
        expect(now.code).toBe("42501");
        expect(now.message).toContain("permission denied to set role");
        expect(now.roleSwitchRefusal).toBe(true);
        expect((await whoAmI(db)).role).toBe("limited");
    });
});

/**
 * Through the real authenticated driver: one ceremony statement per read's
 * transaction, and RLS still scopes the rows to the caller.
 */
describe("an authenticated read on the driver", () => {
    let pglite: PGlite;
    let statements: string[];
    let driver: PostgresBackendDriver;
    let mine: string;
    let theirs: string;

    const notesTable = pgTable("notes", { id: uuid("id").primaryKey(), ownerId: text("owner_id"), title: text("title") });
    const notes: CollectionConfig = {
        name: "Notes",
        slug: "notes",
        table: "notes",
        properties: {
            id: { name: "ID", type: "string", isId: "uuid" },
            ownerId: { name: "Owner", type: "string", columnName: "owner_id" },
            title: { name: "Title", type: "string" }
        }
    };

    beforeEach(async () => {
        pglite = new PGlite();
        await pglite.waitReady;
        await pglite.exec(`
            CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN;
            CREATE TABLE notes (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), owner_id text, title text);
            ALTER TABLE notes ENABLE ROW LEVEL SECURITY;
            CREATE POLICY own ON notes FOR SELECT TO ${REBASE_USER_ROLE}
                USING (owner_id = current_setting('app.uid', true));
            GRANT SELECT ON notes TO ${REBASE_USER_ROLE};
        `);
        mine = (await pglite.query<{ id: string }>("INSERT INTO notes (owner_id, title) VALUES ('user-1', 'mine') RETURNING id")).rows[0].id;
        theirs = (await pglite.query<{ id: string }>("INSERT INTO notes (owner_id, title) VALUES ('user-2', 'theirs') RETURNING id")).rows[0].id;

        statements = [];
        const registry = new PostgresCollectionRegistry();
        registry.registerMultiple([notes]);
        registry.registerTable(notesTable, "notes");
        const orm = drizzle(pglite, {
            schema: { notes: notesTable },
            logger: { logQuery: (query: string) => { statements.push(query); } }
        }) as never;
        driver = new PostgresBackendDriver(orm, new RealtimeService(orm, registry), registry);
        driver.rlsUserRole = REBASE_USER_ROLE;
    });

    afterEach(async () => {
        await pglite.close();
    });

    const ceremony = () => statements.filter(s => /set_config|set\s+(local\s+)?role/i.test(s));

    it("sets identity and role in one statement, and the row filter still holds", async () => {
        const authed = await driver.withAuth({ uid: "user-1", roles: [] } as never);

        const own = await authed.fetchOne({ path: "notes", id: mine, collection: notes });
        expect(own?.title).toBe("mine");
        expect(ceremony()).toHaveLength(1);

        statements = [];
        expect(await authed.fetchOne({ path: "notes", id: theirs, collection: notes })).toBeUndefined();
        expect(ceremony()).toHaveLength(1);

        statements = [];
        const listed = await authed.fetchCollection({ path: "notes", collection: notes });
        expect(listed.map(row => row.title)).toEqual(["mine"]);
        expect(ceremony()).toHaveLength(1);
    });
});
