/**
 * The OAuth store's SQL, executed against a real Postgres.
 *
 * Every other MCP test drives an in-memory `OAuthStore` that reimplements the
 * invariants in TypeScript. That is the right way to test the protocol, and it
 * proves nothing whatsoever about the statements in `oauth-store.ts` — which,
 * until this file existed, had never run. A `text[]` bound the wrong way, a
 * `RETURNING` naming a column that is not there, an `ON CONFLICT` against a
 * constraint that does not exist: all of them pass every suite and fail on the
 * first real request.
 *
 * It lives in `server-postgres` rather than beside the code because that is the
 * package with PGlite — a genuine Postgres in-process, not a mock — and adding
 * the dependency to `@rebasepro/server` for a test would put a database engine
 * in the import graph of the package that must stay portable.
 *
 * The most important assertion here is not any single behaviour. It is that
 * `ensureTables()` leaves four tables actually present: the DDL bootstrapper
 * swallows and logs failures rather than throwing, so a broken CREATE would
 * otherwise produce a green boot, a mounted surface, and a 500 on every call.
 */
import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import { PGlite } from "@electric-sql/pglite";
import type { DataDriver } from "@rebasepro/types";

import { createOAuthStore, OAUTH_TABLES, type OAuthStore } from "../../server/src/mcp/oauth-store";

/** A driver whose SQL escape hatch is a real database. */
function pgliteDriver(db: PGlite): DataDriver {
    return {
        key: "postgres",
        admin: {
            async executeSql(sql: string, options?: { params?: unknown[] }) {
                const result = await db.query(sql, options?.params as unknown[] | undefined);
                return (result.rows ?? []) as Record<string, unknown>[];
            }
        }
    } as unknown as DataDriver;
}

let db: PGlite;
let store: OAuthStore;

beforeEach(async () => {
    db = new PGlite();
    await db.exec("CREATE SCHEMA IF NOT EXISTS rebase");
    const created = createOAuthStore(pgliteDriver(db));
    if (!created) throw new Error("createOAuthStore returned null for a SQL-capable driver");
    store = created;
    await store.ensureTables();
});

afterEach(async () => {
    await db.close();
});

async function tableExists(qualified: string): Promise<boolean> {
    const [schema, table] = qualified.split(".");
    const res = await db.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema = $1 AND table_name = $2`,
        [schema, table]
    );
    return res.rows.length === 1;
}

const CLIENT = {
    clientId: "mcp_abc",
    clientSecretHash: "hash-of-a-secret",
    clientName: "Claude",
    redirectUris: ["https://claude.ai/api/mcp/auth_callback", "http://127.0.0.1:1234/cb"],
    grantTypes: ["authorization_code", "refresh_token"],
    scope: "mcp:read mcp:write",
    tokenEndpointAuthMethod: "none"
};

const CODE_RECORD = {
    clientId: "mcp_abc",
    uid: "user-1",
    roles: ["recruiter", "admin"],
    redirectUri: "https://claude.ai/api/mcp/auth_callback",
    codeChallenge: "challenge",
    codeChallengeMethod: "S256",
    scope: "mcp:read",
    resource: "https://talent.sustentalent.com/mcp"
};

const REFRESH_RECORD = {
    clientId: "mcp_abc",
    uid: "user-1",
    roles: ["recruiter"],
    scope: "mcp:read",
    resource: "https://talent.sustentalent.com/mcp",
    family: "fam-1"
};

const soon = () => new Date(Date.now() + 60_000);
const past = () => new Date(Date.now() - 60_000);

describe("ensureTables", () => {
    it("actually creates all four tables", async () => {
        // The DDL bootstrapper logs failures instead of throwing, so "no error"
        // is not evidence. This asks the database.
        for (const table of OAUTH_TABLES) {
            expect(await tableExists(table)).toBe(true);
        }
    });

    it("is idempotent — a second boot changes nothing", async () => {
        await store.ensureTables();
        await store.ensureTables();
        for (const table of OAUTH_TABLES) {
            expect(await tableExists(table)).toBe(true);
        }
    });

    it("creates the refresh-family index the replay path needs", async () => {
        const res = await db.query(
            `SELECT indexname FROM pg_indexes WHERE schemaname = 'rebase' AND indexname = 'oauth_refresh_family_idx'`
        );
        expect(res.rows).toHaveLength(1);
    });
});

describe("clients", () => {
    it("round-trips a client, arrays and all", async () => {
        await store.registerClient(CLIENT);
        const back = await store.getClient("mcp_abc");

        // `text[]` is where a driver disagreement would show: `pg` parses it to
        // an array, a JSON path hands back the literal `{a,b}`.
        expect(back).toEqual(CLIENT);
        expect(Array.isArray(back?.redirectUris)).toBe(true);
        expect(back?.redirectUris).toHaveLength(2);
    });

    it("stores a public client with no secret", async () => {
        await store.registerClient({ ...CLIENT, clientId: "mcp_public", clientSecretHash: null });
        expect((await store.getClient("mcp_public"))?.clientSecretHash).toBeNull();
    });

    it("returns null for a client that does not exist", async () => {
        expect(await store.getClient("nope")).toBeNull();
    });

    it("counts clients", async () => {
        expect(await store.countClients()).toBe(0);
        await store.registerClient(CLIENT);
        await store.registerClient({ ...CLIENT, clientId: "mcp_two" });
        expect(await store.countClients()).toBe(2);
    });

    it("survives a redirect URI containing a comma and a quote", async () => {
        // Postgres array literals are comma-separated and quote-escaped, so
        // these are the values that break a hand-built literal.
        const awkward = ['https://x.example/cb?a=1,2', 'https://x.example/cb?q="hi"'];
        await store.registerClient({ ...CLIENT, clientId: "mcp_odd", redirectUris: awkward });
        expect((await store.getClient("mcp_odd"))?.redirectUris).toEqual(awkward);
    });
});

describe("authorization codes", () => {
    it("round-trips a code and its roles", async () => {
        await store.saveAuthorizationCode("code-1", CODE_RECORD, soon());
        expect(await store.consumeAuthorizationCode("code-1")).toEqual(CODE_RECORD);
    });

    it("is single-use", async () => {
        await store.saveAuthorizationCode("code-1", CODE_RECORD, soon());
        expect(await store.consumeAuthorizationCode("code-1")).not.toBeNull();
        expect(await store.consumeAuthorizationCode("code-1")).toBeNull();
    });

    it("refuses an expired code", async () => {
        await store.saveAuthorizationCode("code-old", CODE_RECORD, past());
        expect(await store.consumeAuthorizationCode("code-old")).toBeNull();
    });

    it("refuses a code that was never issued", async () => {
        expect(await store.consumeAuthorizationCode("never")).toBeNull();
    });

    it("stores only a hash — the code itself is not recoverable from the table", async () => {
        await store.saveAuthorizationCode("code-secret", CODE_RECORD, soon());
        const res = await db.query(`SELECT code_hash FROM rebase.oauth_authorization_codes`);
        const stored = String((res.rows[0] as { code_hash: string }).code_hash);
        expect(stored).not.toBe("code-secret");
        expect(stored).toMatch(/^[0-9a-f]{64}$/);
    });

    it("grants a code raced by two exchanges exactly once", async () => {
        // The single-use guarantee is one UPDATE with `consumed_at IS NULL` in
        // the WHERE. This is the assertion that it is really the database
        // deciding, not a read-then-write that both callers win.
        await store.saveAuthorizationCode("code-race", CODE_RECORD, soon());
        const results = await Promise.all([
            store.consumeAuthorizationCode("code-race"),
            store.consumeAuthorizationCode("code-race"),
            store.consumeAuthorizationCode("code-race")
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
    });

    it("keeps an empty roles array as an empty array", async () => {
        await store.saveAuthorizationCode("code-2", { ...CODE_RECORD, roles: [] }, soon());
        expect((await store.consumeAuthorizationCode("code-2"))?.roles).toEqual([]);
    });
});

describe("refresh tokens", () => {
    it("round-trips a token and its roles", async () => {
        await store.saveRefreshToken("rt-1", REFRESH_RECORD, soon());
        expect(await store.consumeRefreshToken("rt-1")).toEqual(REFRESH_RECORD);
    });

    it("refuses a token that has already been spent", async () => {
        await store.saveRefreshToken("rt-1", REFRESH_RECORD, soon());
        expect(await store.consumeRefreshToken("rt-1")).not.toBeNull();
        expect(await store.consumeRefreshToken("rt-1")).toBeNull();
    });

    it("kills the whole family when a spent token is replayed", async () => {
        // Rotation: rt-1 is spent for rt-2. Replaying rt-1 must take rt-2 with
        // it, because we cannot tell the legitimate holder from a thief.
        await store.saveRefreshToken("rt-1", REFRESH_RECORD, soon());
        await store.consumeRefreshToken("rt-1");
        await store.saveRefreshToken("rt-2", REFRESH_RECORD, soon());

        expect(await store.consumeRefreshToken("rt-1")).toBeNull();   // the replay
        expect(await store.consumeRefreshToken("rt-2")).toBeNull();   // collateral, by design
    });

    it("leaves another family alone when one is revoked", async () => {
        await store.saveRefreshToken("a-1", REFRESH_RECORD, soon());
        await store.saveRefreshToken("b-1", { ...REFRESH_RECORD, family: "fam-2" }, soon());

        await store.revokeFamily("fam-1");

        expect(await store.consumeRefreshToken("a-1")).toBeNull();
        expect(await store.consumeRefreshToken("b-1")).not.toBeNull();
    });

    it("refuses an expired token", async () => {
        await store.saveRefreshToken("rt-old", REFRESH_RECORD, past());
        expect(await store.consumeRefreshToken("rt-old")).toBeNull();
    });

    it("stores only a hash", async () => {
        await store.saveRefreshToken("rt-secret", REFRESH_RECORD, soon());
        const res = await db.query(`SELECT token_hash FROM rebase.oauth_refresh_tokens`);
        expect(String((res.rows[0] as { token_hash: string }).token_hash)).toMatch(/^[0-9a-f]{64}$/);
    });

    it("spends a token raced by two refreshes exactly once", async () => {
        await store.saveRefreshToken("rt-race", REFRESH_RECORD, soon());
        const results = await Promise.all([
            store.consumeRefreshToken("rt-race"),
            store.consumeRefreshToken("rt-race")
        ]);
        expect(results.filter(Boolean)).toHaveLength(1);
    });
});

describe("consent and grants", () => {
    beforeEach(async () => {
        await store.registerClient(CLIENT);
    });

    it("records consent and lists it", async () => {
        await store.recordConsent("user-1", "mcp_abc", "mcp:read");
        const grants = await store.listGrants("user-1");

        expect(grants).toHaveLength(1);
        expect(grants[0]).toMatchObject({
            clientId: "mcp_abc", clientName: "Claude", scope: "mcp:read", activeTokens: 0
        });
        // ISO, not a Date and not a Postgres timestamp string, because it goes
        // straight out over JSON.
        expect(grants[0].grantedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });

    it("updates the scope on a second consent rather than inserting twice", async () => {
        await store.recordConsent("user-1", "mcp_abc", "mcp:read");
        await store.recordConsent("user-1", "mcp_abc", "mcp:read mcp:write");

        const grants = await store.listGrants("user-1");
        expect(grants).toHaveLength(1);
        expect(grants[0].scope).toBe("mcp:read mcp:write");
    });

    it("counts only live refresh tokens", async () => {
        await store.recordConsent("user-1", "mcp_abc", "mcp:read");
        await store.saveRefreshToken("live", REFRESH_RECORD, soon());
        await store.saveRefreshToken("stale", { ...REFRESH_RECORD, family: "fam-x" }, past());
        await store.saveRefreshToken("spent", { ...REFRESH_RECORD, family: "fam-y" }, soon());
        await store.consumeRefreshToken("spent");

        expect((await store.listGrants("user-1"))[0].activeTokens).toBe(1);
    });

    it("lists a grant whose client row is gone, as an unnamed entry", async () => {
        // An INNER JOIN would hide exactly the grants nobody can account for.
        await store.recordConsent("user-1", "mcp_ghost", "mcp:read");
        const grants = await store.listGrants("user-1");
        expect(grants).toHaveLength(1);
        expect(grants[0].clientName).toBe("(unknown application)");
    });

    it("shows one user nothing of another's", async () => {
        await store.recordConsent("user-1", "mcp_abc", "mcp:read");
        expect(await store.listGrants("user-2")).toEqual([]);
    });

    it("revokes a grant: tokens dead, consent forgotten", async () => {
        await store.recordConsent("user-1", "mcp_abc", "mcp:read");
        await store.saveRefreshToken("rt-1", REFRESH_RECORD, soon());

        expect(await store.revokeGrant("user-1", "mcp_abc")).toBe(true);
        expect(await store.consumeRefreshToken("rt-1")).toBeNull();
        expect(await store.listGrants("user-1")).toEqual([]);
    });

    it("revokes every token in the grant, not only the newest", async () => {
        await store.recordConsent("user-1", "mcp_abc", "mcp:read");
        await store.saveRefreshToken("rt-1", REFRESH_RECORD, soon());
        await store.saveRefreshToken("rt-2", { ...REFRESH_RECORD, family: "fam-2" }, soon());

        await store.revokeGrant("user-1", "mcp_abc");

        expect(await store.consumeRefreshToken("rt-1")).toBeNull();
        expect(await store.consumeRefreshToken("rt-2")).toBeNull();
    });

    it("does not touch another user's tokens for the same client", async () => {
        await store.recordConsent("user-1", "mcp_abc", "mcp:read");
        await store.recordConsent("user-2", "mcp_abc", "mcp:read");
        await store.saveRefreshToken("mine", REFRESH_RECORD, soon());
        await store.saveRefreshToken("theirs", { ...REFRESH_RECORD, uid: "user-2", family: "fam-2" }, soon());

        await store.revokeGrant("user-1", "mcp_abc");

        expect(await store.consumeRefreshToken("mine")).toBeNull();
        expect(await store.consumeRefreshToken("theirs")).not.toBeNull();
    });

    it("reports false when there was nothing to revoke", async () => {
        expect(await store.revokeGrant("user-1", "mcp_never")).toBe(false);
    });

    it("is idempotent", async () => {
        await store.recordConsent("user-1", "mcp_abc", "mcp:read");
        expect(await store.revokeGrant("user-1", "mcp_abc")).toBe(true);
        expect(await store.revokeGrant("user-1", "mcp_abc")).toBe(false);
    });
});

describe("hostile input reaches the database as data", () => {
    // Every value below goes through a bound parameter. If any of them were
    // interpolated, one of these would either throw or return the wrong row.
    const NASTY = [
        "'; DROP TABLE rebase.oauth_clients; --",
        "\\'; DELETE FROM rebase.oauth_refresh_tokens WHERE 't'='t",
        "$$; SELECT 1; $$",
        "line\nbreak\ttab",
        "unicode ☃ and emoji 🔐",
        "%s %d {} [] \" ' `"
    ];

    it.each(NASTY)("stores and returns %j unchanged as a client name", async (name) => {
        await store.registerClient({ ...CLIENT, clientId: `c_${name.length}`, clientName: name });
        expect((await store.getClient(`c_${name.length}`))?.clientName).toBe(name);
        // And the table is still there.
        expect(await tableExists("rebase.oauth_clients")).toBe(true);
    });

    it.each(NASTY)("survives %j as an authorization code", async (code) => {
        await store.saveAuthorizationCode(code, CODE_RECORD, soon());
        expect(await store.consumeAuthorizationCode(code)).toEqual(CODE_RECORD);
    });

    it.each(NASTY)("survives %j as a uid", async (uid) => {
        await store.recordConsent(uid, "mcp_abc", "mcp:read");
        const grants = await store.listGrants(uid);
        expect(grants).toHaveLength(1);
    });
});

describe("ensureTables refuses to report success it did not have", () => {
    /** A driver that drops every CREATE on the floor, as a failure would. */
    function swallowingDriver(db: PGlite): DataDriver {
        return {
            key: "postgres",
            admin: {
                async executeSql(sql: string, options?: { params?: unknown[] }) {
                    if (/^\s*CREATE\s+(TABLE|INDEX)/i.test(sql)) return [];
                    const result = await db.query(sql, options?.params as unknown[] | undefined);
                    return (result.rows ?? []) as Record<string, unknown>[];
                }
            }
        } as unknown as DataDriver;
    }

    it("throws when the DDL silently failed", async () => {
        // `createDdlBootstrapper` catches and logs a failed statement instead of
        // throwing. Without the verification pass, this driver would produce a
        // clean `ensureTables()`, a mounted authorization server, and a 500 on
        // the first request — with one line in a boot log as the only evidence.
        const empty = new PGlite();
        await empty.exec("CREATE SCHEMA IF NOT EXISTS rebase");

        const broken = createOAuthStore(swallowingDriver(empty));
        await expect(broken!.ensureTables()).rejects.toThrow(/tables were not created/);
        await empty.close();
    });

    it("names every missing table, so the log says what to fix", async () => {
        const empty = new PGlite();
        await empty.exec("CREATE SCHEMA IF NOT EXISTS rebase");
        const broken = createOAuthStore(swallowingDriver(empty));

        const error = await broken!.ensureTables().catch((e: Error) => e);
        expect(String(error)).toContain("oauth_clients");
        expect(String(error)).toContain("oauth_authorization_codes");
        expect(String(error)).toContain("oauth_refresh_tokens");
        expect(String(error)).toContain("oauth_consents");
        await empty.close();
    });

    it("returns null for a driver with no SQL at all", () => {
        // Mongo. The surface declines to mount rather than half-mounting.
        expect(createOAuthStore({ key: "mongodb" } as unknown as DataDriver)).toBeNull();
    });
});
