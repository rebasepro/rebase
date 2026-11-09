import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const queries: string[] = [];
let failConnect = false;
jest.mock("pg", () => {
    const actual = jest.requireActual<typeof import("pg")>("pg");
    class FakeClient {
        on() { return this; }
        async connect() { if (failConnect) throw new Error("permission denied to set role default"); }
        async query(text: string) { queries.push(text); return { rows: [] }; }
        async end() { /* closed */ }
    }
    return { ...actual, Client: FakeClient };
});

const warn = jest.fn();
const info = jest.fn();
jest.mock("@rebasepro/server", () => ({
    logger: { error: jest.fn(), warn: (...args: unknown[]) => warn(...args), info: (...args: unknown[]) => info(...args), debug: jest.fn() }
}));

import { Pool } from "pg";
import { ensurePooledRoleDefaults, roleSearchPathStatement, searchPathMatches } from "../src/pooled-database";

/**
 * Behind a transaction-mode pooler a statement outside a transaction runs with
 * the role's default `search_path` — `"$user", public` unless someone set it —
 * and a role called `rebase` then resolves unqualified tables in the `rebase`
 * schema. The boot sets the role's default to the path every direct
 * connection already pins.
 */
function pooledAnswering(searchPath: string): Pool {
    // Never connected: `query` is replaced, and nothing else is asked of it.
    const pool = new Pool({ connectionString: "postgres://nobody@127.0.0.1:1/none" });
    jest.spyOn(pool, "query").mockImplementation(async () => ({
        rows: [{ search_path: searchPath, role: "rebase", database: "app" }], command: "SELECT", rowCount: 1, oid: 0, fields: []
    }));
    return pool;
}

beforeEach(() => {
    queries.length = 0;
    failConnect = false;
    warn.mockClear();
    info.mockClear();
});

describe("ensurePooledRoleDefaults", () => {
    it("sets the role's default search_path in this database, over the direct URL", async () => {
        await ensurePooledRoleDefaults(pooledAnswering("\"$user\", public"), "postgres://db/app", { provision: true });
        expect(queries).toEqual([`ALTER ROLE "rebase" IN DATABASE "app" SET search_path TO "public"`]);
        expect(info).toHaveBeenCalled();
    });

    it("does nothing when the pooler already hands out the right path", async () => {
        await ensurePooledRoleDefaults(pooledAnswering("public"), "postgres://db/app", { provision: true });
        expect(queries).toEqual([]);
    });

    it("changes nothing on a boot that runs no DDL, and says what to run", async () => {
        await ensurePooledRoleDefaults(pooledAnswering("\"$user\", public"), "postgres://db/app", { provision: false });
        expect(queries).toEqual([]);
        expect(String(warn.mock.calls[0]?.[0])).toContain(`ALTER ROLE "rebase" IN DATABASE "app"`);
    });

    it("warns rather than failing the boot when the role may not change it", async () => {
        failConnect = true;
        await expect(ensurePooledRoleDefaults(pooledAnswering("\"$user\", public"), "postgres://db/app", { provision: true }))
            .resolves.toBeUndefined();
        expect(String(warn.mock.calls[0]?.[0])).toContain("Run once");
    });
});

describe("the statement and the comparison", () => {
    it("quotes the role and the database", () => {
        expect(roleSearchPathStatement("we\"ird", "my db", "public"))
            .toBe(`ALTER ROLE "we""ird" IN DATABASE "my db" SET search_path TO "public"`);
    });

    it("compares paths whatever their quoting and spacing", () => {
        expect(searchPathMatches("public", "public")).toBe(true);
        expect(searchPathMatches("\"public\"", "public")).toBe(true);
        expect(searchPathMatches("app, public", "app,public")).toBe(true);
        expect(searchPathMatches("\"$user\", public", "public")).toBe(false);
    });
});
