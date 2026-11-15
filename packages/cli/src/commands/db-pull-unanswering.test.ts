/**
 * `rebase db pull` when the local database stops answering part-way.
 *
 * A pull from a LATIN1 database into the managed one ended like this: the
 * restore failed on every statement, and `restoreCopy` returned that failure.
 * Then the re-grant opened a connection with no bound to a daemon that
 * accepted the socket and never answered, and the command hung there for good,
 * with the local database already emptied and the failure never printed.
 *
 * Here the local database is a server that refuses nothing and answers
 * nothing (see `dev-db/__fixtures__/unanswering-postgres.ts`). The bounds are
 * shortened so a hang shows up as a test that runs out of time. The dump and
 * the restore are stood in for: what they do is the integration suites'.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnonymizeOutcome, PullPlan, RestoreOutcome } from "../dev-db/pull";
import { unansweringPostgres, type UnansweringPostgres } from "../dev-db/__fixtures__/unanswering-postgres";

const state = vi.hoisted(() => ({
    root: "",
    target: "",
    restored: null as RestoreOutcome | null,
    anonymized: 0
}));

vi.mock("../dev-db/local-timeouts", () => ({ LOCAL_CONNECT_TIMEOUT_MS: 300, LOCAL_QUERY_TIMEOUT_MS: 300 }));

vi.mock("../utils/project", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/project")>(),
    requireProjectRoot: () => state.root
}));

vi.mock("../dev-db/prepare", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/prepare")>(),
    prepareDatabaseEnv: async () => ({
        database: { kind: "managed", source: "managed" },
        description: "the managed development database (PGlite)",
        env: { DATABASE_URL: state.target }
    })
}));

vi.mock("../dev-db/pull", async importOriginal => {
    const actual = await importOriginal<typeof import("../dev-db/pull")>();
    return {
        ...actual,
        dumpSource: async (plan: PullPlan) => ({ ok: true, plan }),
        restoreCopy: async () => {
            if (!state.restored) throw new Error("no restore outcome set");
            return state.restored;
        },
        anonymizeCopy: async (): Promise<AnonymizeOutcome> => {
            state.anonymized++;
            return { ok: true, tables: [] };
        }
    };
});

// The re-grant's driver, slow to load and not what is under test. Its first
// read goes to the database, as the real one's does, so a database that
// answers no query is met there.
vi.mock("@rebasepro/server-postgres", () => ({
    REBASE_USER_ROLE: "rebase_user",
    cliRlsSettings: () => ({ roles: ["rebase_user"], defaultRole: "rebase_user", provisionRole: "auto", grants: "schema" }),
    readRecordedRequestRoles: async (runSql: (text: string) => Promise<Record<string, unknown>[]>) => {
        await runSql("SELECT 1");
        return undefined;
    },
    detectConnectionPosture: async () => ({ privileged: true }),
    ensureAppRole: async () => undefined
}));

vi.mock("execa", () => ({
    execa: async (file: string, args: readonly string[]) => {
        if (args[0] === "--version") return { exitCode: 0, stdout: `${file} (PostgreSQL) 18.4`, stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
    }
}));

const { dbCommand } = await import("./db");
const { restoreOutcome } = await import("../dev-db/pull");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

/** What `restoreCopy` returned for the LATIN1 pull: every statement after the SET failed. */
const EVERY_STATEMENT_FAILED: RestoreOutcome = {
    cleared: true,
    ...restoreOutcome({
        exitCode: 1,
        stderr: "pg_restore: error: could not execute query: server closed the connection unexpectedly\n"
            + "Command was: SET client_encoding = 'LATIN1';\n"
            + "pg_restore: error: could not execute query: no connection to the server\n"
            + "pg_restore: warning: errors ignored on restore: 30\n"
    }, "pglite")
};

describe("rebase db pull, when the local database stops answering", () => {
    let printed: string[];
    let server: UnansweringPostgres | null = null;

    beforeEach(() => {
        state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-pull-unanswering-"));
        state.restored = EVERY_STATEMENT_FAILED;
        state.anonymized = 0;
        printed = [];
        const capture = (...parts: unknown[]) => { printed.push(parts.map(String).join(" ")); };
        vi.spyOn(console, "log").mockImplementation(capture);
        vi.spyOn(console, "error").mockImplementation(capture);
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exit(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await server?.close();
        server = null;
        fs.rmSync(state.root, { recursive: true, force: true });
    });

    const pull = (...extra: string[]) => dbCommand("pull", [
        "node", "rebase", "db", "pull", "--from", "postgresql://u:pw@prod.example.com/app", "--yes", ...extra
    ]);

    it("prints the failed restore and exits 1 when the database never answers a connection", async () => {
        server = await unansweringPostgres("silent");
        state.target = server.url;

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(server.connections()).toBeGreaterThan(0);
        expect(output).toContain("could not re-grant");
        expect(output).toContain("pg_restore could not restore 30 object(s)");
        expect(output).not.toContain("✓ Local database now holds a copy");
    }, 5_000);

    it("prints the failed restore and exits 1 when the database connects and never answers a query", async () => {
        server = await unansweringPostgres("after-handshake");
        state.target = server.url;

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("could not re-grant");
        expect(output).toContain("pg_restore could not restore 30 object(s)");
    }, 5_000);

    it("with --anonymize, says the copy could not be anonymized rather than waiting to anonymize it", async () => {
        server = await unansweringPostgres("silent");
        state.target = server.url;

        await expect(pull("--anonymize")).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(state.anonymized).toBe(0);
        expect(output).toContain("The copy could not be anonymized");
        expect(output).toContain("rebase db reset --yes");
    }, 5_000);
});
