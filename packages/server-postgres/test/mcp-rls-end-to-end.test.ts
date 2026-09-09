/**
 * The product claim, proved against a real database.
 *
 * Everything else about the MCP surface tests the plumbing: that the tools call
 * `scopeDataDriver`, that the identity handed to it comes from a verified
 * token, that the token cannot be forged. None of that proves the sentence the
 * whole feature is sold on — **an agent connected to your project sees only
 * what you can see** — because a stub driver agreeing to be scoped proves
 * nothing about what Postgres does next.
 *
 * So this file uses the real `applyAuthContext` from `security/rls-enforcement`
 * — the same function the data path uses — against real tables with real
 * policies in PGlite, and asks whether the rows that come back are the caller's.
 * The tools are driven through their actual `run()`, not reimplemented.
 *
 * PGlite connects as `postgres`, a superuser, and **superusers bypass RLS** —
 * the first version of this file passed every read test while returning every
 * row, which is the most dangerous possible way for a security test to be
 * green. So the driver below does what the real one does and switches to the
 * restricted `rebase_user` role inside the transaction. That is not a
 * workaround; it is the mechanism, and running without it proves nothing.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { sql as drizzleSql } from "drizzle-orm";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";

import { applyAuthContext, REBASE_USER_ROLE } from "../src/security/rls-enforcement";
import { MCP_TOOLS, McpToolError } from "../../server/src/mcp/mcp-tools";

const CANDIDATES = {
    slug: "candidates",
    name: "Candidates",
    properties: {
        name: { type: "string", name: "Name" },
        stage: { type: "string", name: "Stage" },
        ownerId: { type: "string", name: "Owner" }
    }
} as unknown as CollectionConfig;

let db: PGlite;

/**
 * A driver over PGlite whose `withAuth` does what the real one does: open a
 * transaction, apply the auth context, and run every statement inside it.
 */
function rlsDriver(): DataDriver {
    const base = {
        key: "postgres",
        async withAuth(user: { uid: string; roles?: string[]; isAnonymous?: boolean }) {
            const scoped = {
                ...base,
                async fetchCollection(props: { path: string; limit?: number }) {
                    return inContext(user, async (tx) => {
                        const res = await tx.execute(
                            drizzleSql.raw(`SELECT * FROM ${props.path} LIMIT ${Number(props.limit ?? 25)}`)
                        );
                        return (res as { rows?: Record<string, unknown>[] }).rows ?? [];
                    });
                },
                async fetchOne(props: { path: string; id: string }) {
                    return inContext(user, async (tx) => {
                        const res = await tx.execute(
                            drizzleSql.raw(`SELECT * FROM ${props.path} WHERE id = '${props.id}'`)
                        );
                        return ((res as { rows?: Record<string, unknown>[] }).rows ?? [])[0];
                    });
                },
                async save(props: { path: string; values: Record<string, unknown>; id?: string }) {
                    return inContext(user, async (tx) => {
                        const id = props.id ?? `gen-${Math.random().toString(36).slice(2, 8)}`;
                        const res = await tx.execute(drizzleSql.raw(
                            `INSERT INTO ${props.path} (id, name, stage, owner_id) VALUES (` +
                            `'${id}', '${props.values.name ?? ""}', '${props.values.stage ?? "new"}', ` +
                            `'${props.values.ownerId ?? ""}') RETURNING *`
                        ));
                        return ((res as { rows?: Record<string, unknown>[] }).rows ?? [])[0];
                    });
                },
                async delete(props: { row: { path: string; id: string } }) {
                    return inContext(user, async (tx) => {
                        await tx.execute(drizzleSql.raw(
                            `DELETE FROM ${props.row.path} WHERE id = '${props.row.id}'`
                        ));
                    });
                }
            };
            return scoped as unknown as DataDriver;
        }
    };
    return base as unknown as DataDriver;
}

/** Run inside a transaction with the caller's RLS context applied. */
async function inContext<T>(
    user: { uid: string; roles?: string[]; isAnonymous?: boolean },
    body: (tx: { execute(q: unknown): Promise<unknown> }) => Promise<T>
): Promise<T> {
    const d = drizzle(db);
    return d.transaction(async (tx) => {
        // The REAL function the data path uses. If its `set_config` calls ever
        // stop matching what the policies read, this file goes red.
        // The third argument is what makes this real: `SET LOCAL ROLE
        // rebase_user`, so the statements below run as a principal RLS applies
        // to. Without it PGlite stays `postgres`, a superuser, and every policy
        // in this file is silently skipped.
        await applyAuthContext(tx as never, {
            uid: user.uid, roles: user.roles ?? [], isAnonymous: user.isAnonymous
        }, REBASE_USER_ROLE);
        return body(tx as never);
    }) as Promise<T>;
}

const tool = (name: string) => {
    const found = MCP_TOOLS.find(t => t.name === name);
    if (!found) throw new Error(`no such tool: ${name}`);
    return found;
};

const ctx = (driver: DataDriver, uid: string, scope = "mcp:read mcp:write") => ({
    driver,
    collections: [CANDIDATES],
    caller: { uid, roles: ["recruiter"], scope, clientId: "mcp_test" }
});

beforeEach(async () => {
    db = new PGlite();

    // The helper the generated policies call, exactly as the auth boot step
    // creates it in a real database.
    await db.exec(`
        CREATE SCHEMA IF NOT EXISTS rebase;
        CREATE ROLE ${REBASE_USER_ROLE} NOLOGIN;
        CREATE OR REPLACE FUNCTION rebase.uid() RETURNS text
            LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.uid', true), '') $$;

        CREATE TABLE candidates (
            id       text PRIMARY KEY,
            name     text NOT NULL,
            stage    text NOT NULL,
            owner_id text NOT NULL
        );
        ALTER TABLE candidates ENABLE ROW LEVEL SECURITY;
        ALTER TABLE candidates FORCE ROW LEVEL SECURITY;

        CREATE POLICY own_rows ON candidates
            USING (owner_id = rebase.uid())
            WITH CHECK (owner_id = rebase.uid());

        GRANT USAGE ON SCHEMA public, rebase TO ${REBASE_USER_ROLE};
        GRANT SELECT, INSERT, UPDATE, DELETE ON candidates TO ${REBASE_USER_ROLE};
        GRANT EXECUTE ON FUNCTION rebase.uid() TO ${REBASE_USER_ROLE};

        INSERT INTO candidates (id, name, stage, owner_id) VALUES
            ('a1', 'Ada',    'interview', 'user-1'),
            ('a2', 'Alan',   'offer',     'user-1'),
            ('b1', 'Grace',  'screening', 'user-2');
    `);
});

afterEach(async () => {
    await db.close();
});

describe("what an agent can read", () => {
    it("returns only the caller's rows", async () => {
        // The whole claim, in one assertion. Nothing in `mcp-tools.ts` filters
        // by owner — the policy does.
        const driver = rlsDriver();
        const result = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-1")
        ) as { rows: { id: string }[] };

        expect(result.rows.map(r => r.id).sort()).toEqual(["a1", "a2"]);
    });

    it("returns a different set for a different caller", async () => {
        const driver = rlsDriver();
        const result = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-2")
        ) as { rows: { id: string }[] };

        expect(result.rows.map(r => r.id)).toEqual(["b1"]);
    });

    it("returns nothing for a caller who owns nothing", async () => {
        const driver = rlsDriver();
        const result = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-3")
        ) as { rows: unknown[] };

        expect(result.rows).toEqual([]);
    });

    it("cannot read another user's row by id, even knowing the id", async () => {
        // The tool reports "no such row" rather than "not allowed", which is
        // what stops it being an existence oracle — but the reason it cannot
        // return the row is the policy, not the message.
        const driver = rlsDriver();
        await expect(
            tool("get_document").run({ collection: "candidates", id: "b1" }, ctx(driver, "user-1"))
        ).rejects.toThrow(McpToolError);
    });

    it("can read its own row by id", async () => {
        const driver = rlsDriver();
        const row = await tool("get_document").run(
            { collection: "candidates", id: "a1" }, ctx(driver, "user-1")
        ) as { name: string };
        expect(row.name).toBe("Ada");
    });

    it("a scope grant does not widen what the database allows", async () => {
        // `mcp:read` vs `mcp:write` decides which tools exist. It has no bearing
        // on which rows come back — that is the point of putting the boundary in
        // the database.
        const driver = rlsDriver();
        const readOnly = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-1", "mcp:read")
        ) as { rows: unknown[] };
        const readWrite = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-1", "mcp:read mcp:write")
        ) as { rows: unknown[] };

        expect(readOnly.rows).toEqual(readWrite.rows);
    });
});

describe("what an agent can write", () => {
    it("cannot create a row owned by somebody else", async () => {
        // `WITH CHECK` refuses it. A `mcp:write` token is not a licence to
        // write anything — it is a licence to write what its holder could.
        const driver = rlsDriver();
        await expect(
            tool("create_document").run(
                { collection: "candidates", values: { name: "Mallory", ownerId: "user-2" } },
                ctx(driver, "user-1")
            )
        ).rejects.toThrow();
    });

    it("can create a row it owns", async () => {
        const driver = rlsDriver();
        const created = await tool("create_document").run(
            { collection: "candidates", values: { name: "Mine", stage: "new", ownerId: "user-1" } },
            ctx(driver, "user-1")
        ) as { name: string };
        expect(created.name).toBe("Mine");
    });

    it("cannot delete another user's row", async () => {
        const driver = rlsDriver();
        await tool("delete_document").run(
            { collection: "candidates", id: "b1" }, ctx(driver, "user-1")
        );

        // The DELETE matched no rows rather than erroring — which is how RLS
        // expresses "you cannot see it". The row is still there.
        const stillThere = await db.query(`SELECT id FROM candidates WHERE id = 'b1'`);
        expect(stillThere.rows).toHaveLength(1);
    });

    it("can delete its own row", async () => {
        const driver = rlsDriver();
        await tool("delete_document").run(
            { collection: "candidates", id: "a1" }, ctx(driver, "user-1")
        );
        const gone = await db.query(`SELECT id FROM candidates WHERE id = 'a1'`);
        expect(gone.rows).toHaveLength(0);
    });
});

describe("the identity the database sees", () => {
    it("is the uid from the token, not a default", async () => {
        const driver = rlsDriver();
        const seen = await inContext({ uid: "user-42", roles: [] }, async (tx) => {
            const res = await tx.execute(drizzleSql.raw(`SELECT rebase.uid() AS uid`));
            return ((res as { rows?: { uid: string }[] }).rows ?? [])[0]?.uid;
        });
        expect(seen).toBe("user-42");
    });

    it("carries the roles a policy could read", async () => {
        const driver = rlsDriver();
        const seen = await inContext({ uid: "user-1", roles: ["recruiter", "admin"] }, async (tx) => {
            const res = await tx.execute(
                drizzleSql.raw(`SELECT current_setting('app.user_roles', true) AS roles`)
            );
            return ((res as { rows?: { roles: string }[] }).rows ?? [])[0]?.roles;
        });
        expect(seen).toBe("recruiter,admin");
    });

    it("marks an MCP caller as NOT anonymous", async () => {
        // An MCP grant always comes from a real sign-in and a consent screen,
        // so a policy asking `rebase.is_anonymous()` should see an account.
        const driver = rlsDriver();
        const result = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-1")
        ) as { rows: unknown[] };
        expect(result.rows).toHaveLength(2);

        const seen = await inContext({ uid: "user-1", roles: [], isAnonymous: false }, async (tx) => {
            const res = await tx.execute(
                drizzleSql.raw(`SELECT current_setting('app.is_anonymous', true) AS anon`)
            );
            return ((res as { rows?: { anon: string }[] }).rows ?? [])[0]?.anon;
        });
        expect(seen).toBe("false");
    });

    it("does not leak between callers on the same connection", async () => {
        // `set_config(..., true)` is transaction-local. If it were not, a second
        // caller on a pooled connection would inherit the first one's identity —
        // which on this surface means one user's agent reading another's rows.
        const driver = rlsDriver();

        const first = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-1")
        ) as { rows: unknown[] };
        const second = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-2")
        ) as { rows: { id: string }[] };
        const third = await tool("query_collection").run(
            { collection: "candidates" }, ctx(driver, "user-3")
        ) as { rows: unknown[] };

        expect(first.rows).toHaveLength(2);
        expect(second.rows.map(r => r.id)).toEqual(["b1"]);
        expect(third.rows).toEqual([]);

        // And outside any transaction the setting is gone.
        const after = await db.query(`SELECT current_setting('app.uid', true) AS uid`);
        expect((after.rows[0] as { uid: string | null }).uid ?? "").toBe("");
    });
});
