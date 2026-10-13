/**
 * `rebase db pull --anonymize`, when the anonymize pass does not succeed.
 *
 * The pass threw, so the command skipped its own verdict and the role re-grant
 * and left whatever the pass had not reached — real emails — in the local
 * database, with nothing on screen saying so. What the pass itself does is in
 * `dev-db/pull-anonymize.integration.test.ts`, on a real Postgres; this is what
 * the command says and does with each way it ends.
 *
 * No database is touched: the tools are stood in for at `execa`, and the
 * connection at `pg`.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AnonymizeOutcome } from "../dev-db/pull";

const state = vi.hoisted(() => ({
    root: "",
    connect: "accept" as "accept" | "refuse",
    connections: 0,
    outcome: null as AnonymizeOutcome | null,
    kind: "managed" as "managed" | "docker" | "external"
}));

vi.mock("../utils/project", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/project")>(),
    requireProjectRoot: () => state.root
}));

vi.mock("../dev-db/prepare", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/prepare")>(),
    prepareDatabaseEnv: async () => ({
        database: state.kind === "external"
            ? { kind: "external", source: "env-file", url: "postgresql://postgres@127.0.0.1:1/postgres" }
            : { kind: state.kind, source: state.kind },
        description: "the local database",
        env: { DATABASE_URL: "postgresql://postgres@127.0.0.1:1/postgres" }
    })
}));

vi.mock("../dev-db/pull", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/pull")>(),
    anonymizeCopy: async () => {
        if (!state.outcome) throw new Error("no outcome set");
        return state.outcome;
    }
}));

vi.mock("pg", () => {
    class Client {
        on(): this { return this; }
        async connect(): Promise<void> {
            state.connections++;
            if (state.connect === "refuse") throw new Error("connect ECONNREFUSED 127.0.0.1:1");
        }
        async query(): Promise<{ rows: unknown[] }> { return { rows: [] }; }
        async end(): Promise<void> { /* nothing to close */ }
    }
    return { Client, default: { Client } };
});

// The re-grant's driver, which is not what is under test and is slow to load.
vi.mock("@rebasepro/server-postgres", () => ({
    REBASE_USER_ROLE: "rebase_user",
    detectConnectionPosture: async () => ({ privileged: false }),
    ensureAppRole: async () => undefined
}));

vi.mock("execa", () => ({
    execa: async (file: string, args: readonly string[]) => {
        if (args[0] === "--version") return { exitCode: 0, stdout: `${file} (PostgreSQL) 17.2`, stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
    }
}));

const { dbCommand } = await import("./db");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

describe("rebase db pull --anonymize, when the pass does not succeed", () => {
    let printed: string[];

    beforeEach(() => {
        state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-pull-anon-"));
        state.connect = "accept";
        state.connections = 0;
        state.outcome = null;
        state.kind = "managed";
        printed = [];
        const capture = (...parts: unknown[]) => { printed.push(parts.map(String).join(" ")); };
        vi.spyOn(console, "log").mockImplementation(capture);
        vi.spyOn(console, "error").mockImplementation(capture);
        vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
            throw new Exit(typeof code === "number" ? code : undefined);
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        fs.rmSync(state.root, { recursive: true, force: true });
    });

    const pull = () => dbCommand("pull", [
        "node", "rebase", "db", "pull", "--from", "postgresql://u:pw@prod.example.com/app", "--anonymize", "--yes"
    ]);

    it("says which tables it emptied, and exits 1, when the pass fails and rolls back", async () => {
        state.outcome = {
            ok: false,
            error: "duplicate key value violates unique constraint \"refresh_tokens_token_hash_key\"",
            emptied: ['"rebase"."refresh_tokens"', '"rebase"."users"'],
            emptyError: null
        };

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("refresh_tokens_token_hash_key");
        expect(output).toContain('"rebase"."users"');
        expect(output).toContain("emptied");
        expect(output).not.toContain("✓ Local database now holds a copy");
        expect(output).not.toContain("✓ Anonymized");
    });

    it("says the copy holds real data, and how to delete it, when the tables could not be emptied", async () => {
        state.kind = "docker";
        state.outcome = { ok: false, error: "terminating connection", emptied: [], emptyError: "Connection terminated" };

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("UN-ANONYMIZED copy of prod.example.com/app");
        expect(output).toContain("docker compose down -v");
        expect(output).toContain("Connection terminated");
        // Never the source's password.
        expect(output).not.toContain("pw@");
    });

    it("says the copy holds real data when it cannot even connect to anonymize it", async () => {
        state.connect = "refuse";

        await expect(pull()).rejects.toEqual(new Exit(1));

        const output = printed.join("\n");
        expect(output).toContain("ECONNREFUSED");
        expect(output).toContain("UN-ANONYMIZED");
        expect(output).toContain("rebase db reset --yes");
        expect(output).not.toContain("✓ Local database now holds a copy");
    });

    it("still re-grants the app role after a failed pass", async () => {
        state.outcome = { ok: false, error: "boom", emptied: ['"public"."authors"'], emptyError: null };

        await expect(pull()).rejects.toEqual(new Exit(1));

        // One connection for the pass, and one for the re-grant after it.
        expect(state.connections).toBe(2);
    });

    it("reports a copy when the pass succeeds", async () => {
        state.outcome = { ok: true, tables: ['"public"."authors"', '"rebase"."users"'] };

        await pull();

        const output = printed.join("\n");
        expect(output).toContain("✓ Anonymized 2 table(s).");
        expect(output).toContain("✓ Local database now holds a copy of prod.example.com/app");
    });
});
