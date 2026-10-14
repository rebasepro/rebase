/**
 * The `db` subcommands this CLI answers itself — `pull`, `url`, `stop` and
 * `reset` — refuse a flag they do not take, before anything is read, started
 * or copied.
 *
 * The driver's `db` commands were strict and these four were not, because the
 * driver never sees them. `pull` read its flags by hand
 * (`rawArgs.includes("--anonymize")`), so a misspelt privacy flag was dropped
 * on the floor and the copy went ahead without it:
 *
 *     rebase db pull --from "$PROD" --yes --anonymiz
 *         Data  copied as-is, including any personal data
 *     ✓ Local database now holds a copy of …
 *
 * `--anonymise`, `--anonymiz` and `--anon` all copied real personal data onto
 * the laptop, and `--schem public` pulled every schema. The flag that exists
 * for privacy was the one a typo turned off.
 *
 * No database is touched: the steps a pull takes are stood in for, and each is
 * asserted not to have run.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PullPlan } from "../dev-db/pull";
import { dataDir } from "../dev-db/state";

const state = vi.hoisted(() => ({
    root: "",
    prepared: 0,
    ensured: 0,
    dumped: [] as PullPlan[],
    restored: 0,
    tools: 0,
    stopped: 0,
    reset: 0
}));

vi.mock("../utils/project", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/project")>(),
    requireProjectRoot: () => state.root
}));

vi.mock("../utils/dev-preflight", async importOriginal => ({
    ...await importOriginal<typeof import("../utils/dev-preflight")>(),
    ensureDevDatabase: async () => {
        state.ensured++;
        return { action: "already-running", host: "127.0.0.1", port: 1 };
    }
}));

vi.mock("../dev-db/prepare", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/prepare")>(),
    prepareDatabaseEnv: async () => {
        state.prepared++;
        return {
            database: { kind: "managed", source: "managed" },
            description: "the managed development database (PGlite)",
            env: { DATABASE_URL: "postgresql://postgres@127.0.0.1:1/postgres" }
        };
    }
}));

vi.mock("../dev-db/pull", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/pull")>(),
    findPgTool: async () => {
        state.tools++;
        return "pg_dump (PostgreSQL) 17.2";
    },
    dumpSource: async (plan: PullPlan) => {
        state.dumped.push(plan);
        return { ok: true, plan };
    },
    restoreCopy: async () => {
        state.restored++;
        return { cleared: true, started: true, failure: null, advice: null };
    },
    anonymizeCopy: async () => ({ ok: true, tables: [] })
}));

vi.mock("../dev-db/daemon", async importOriginal => ({
    ...await importOriginal<typeof import("../dev-db/daemon")>(),
    stopManagedDatabase: async () => {
        state.stopped++;
        return false;
    },
    resetManagedDatabase: async () => {
        state.reset++;
    },
    findRunningDaemon: async () => null
}));

vi.mock("pg", () => {
    class Client {
        on(): this { return this; }
        async connect(): Promise<void> { /* accepted */ }
        async query(): Promise<{ rows: unknown[] }> { return { rows: [] }; }
        async end(): Promise<void> { /* nothing to close */ }
    }
    return { Client, default: { Client } };
});

vi.mock("@rebasepro/server-postgres", () => ({
    REBASE_USER_ROLE: "rebase_user",
    detectConnectionPosture: async () => ({ privileged: false }),
    ensureAppRole: async () => undefined
}));

const { dbCommand } = await import("./db");

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

const PROD = "postgresql://app:hunter2@prod.example.com/app";
const argv = (...words: string[]) => ["node", "rebase", "db", ...words];

let printed: string[];

beforeEach(() => {
    state.root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-db-own-flags-"));
    Object.assign(state, { prepared: 0, ensured: 0, dumped: [], restored: 0, tools: 0, stopped: 0, reset: 0 });
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

/** Nothing a pull does happened: no database resolved or started, no tool asked, nothing dumped or restored. */
function expectNothingRan(): void {
    expect(state.prepared).toBe(0);
    expect(state.ensured).toBe(0);
    expect(state.tools).toBe(0);
    expect(state.dumped).toEqual([]);
    expect(state.restored).toBe(0);
    expect(printed.join("\n")).not.toContain("This will replace your local database");
}

describe("rebase db pull refuses a flag it does not take", () => {
    it.each([
        ["--anonymise"],
        ["--anonymiz"],
        ["--anon"]
    ])("%s is refused, naming --anonymize, and copies nothing", async (typo) => {
        await expect(dbCommand("pull", argv("pull", "--from", PROD, "--yes", typo)))
            .rejects.toThrow(`\`rebase db pull\` has no option ${typo} — did you mean --anonymize? Nothing was run.`);

        expectNothingRan();
    });

    it("refuses --schem rather than pulling every schema", async () => {
        await expect(dbCommand("pull", argv("pull", "--from", PROD, "--schem", "public", "--yes")))
            .rejects.toThrow("has no option --schem — did you mean --schema?");

        expectNothingRan();
    });

    it("says --fro is not an option, rather than that the source is missing", async () => {
        await expect(dbCommand("pull", argv("pull", "--fro", PROD, "--yes")))
            .rejects.toThrow("has no option --fro — did you mean --from?");

        expectNothingRan();
        expect(printed.join("\n")).not.toContain("needs a source");
    });

    // One shell word holding the flag and the URL: a quoting mistake, refused
    // with arg's sentence inside ours and the password in it.
    it("refuses a flag quoted together with its URL, and does not echo the password", async () => {
        const refusal = await dbCommand("pull", argv("pull", `--fro ${PROD}`, "--yes")).catch((error: unknown) => error);

        expect(refusal).toMatchObject({ isUsageError: true });
        const said = String(refusal);
        expect(said).toContain("has no option \"--fro postgresql://app:***@prod.example.com/app\": that is a flag and a value in one argument");
        expect(said).toContain("--from <value>");
        expect(said).not.toContain("hunter2");
        expect(said).not.toContain("unknown or unexpected option");
        expectNothingRan();
    });

    it("refuses --anonymize=false rather than anonymizing", async () => {
        await expect(dbCommand("pull", argv("pull", "--from", PROD, "--anonymize=false", "--yes")))
            .rejects.toThrow("takes --anonymize without a value (--anonymize=false)");

        expectNothingRan();
    });

    it("refuses a stray argument without echoing the password in it", async () => {
        const refusal = dbCommand("pull", argv("pull", PROD, "--yes"));

        await expect(refusal).rejects.toThrow(/takes 0 arguments/);
        await expect(refusal).rejects.not.toThrow(/hunter2/);
        expectNothingRan();
    });

    /**
     * The refusal suggests the `--from` line to type instead, and it printed
     * the URL it was given: password and all, unquoted, so the `&` in a
     * query string sent the pasted command to the background.
     */
    it("refuses --database-url without printing its password, quoted so it pastes", async () => {
        const target = "postgresql://rebase_app:s3cret@127.0.0.1:5508/u3?sslmode=disable&application_name=x";

        await expect(dbCommand("pull", argv("pull", "--from", PROD, "--database-url", target, "--yes")))
            .rejects.toEqual(new Exit(1));

        const out = printed.join("\n");
        expect(out).toContain("does not take --database-url");
        expect(out).not.toContain("s3cret");
        expect(out).toContain("rebase db pull --from \"postgresql://rebase_app:***@127.0.0.1:5508/u3?sslmode=disable&application_name=x\"");
        expect(out).toContain("with the password in place of ***");
        expectNothingRan();
    });

    it("still takes every flag it documents, in both spellings", async () => {
        await dbCommand("pull", argv(
            "pull", `--from=${PROD}`, "--schema", "public", "--schema=rebase", "--anonymize", "-y"
        ));

        expect(state.dumped).toHaveLength(1);
        expect(state.dumped[0]).toMatchObject({ source: PROD, anonymize: true, schemas: ["public", "rebase"] });
        expect(printed.join("\n")).toContain("✓ Local database now holds a copy of prod.example.com/app");
    });

    it("copies as-is only when --anonymize was not asked for", async () => {
        await dbCommand("pull", argv("pull", "--from", PROD, "--yes"));

        expect(state.dumped[0]).toMatchObject({ anonymize: false, schemas: [] });
    });
});

/**
 * `--from garbage --yes` printed "This will replace your local database.
 * From (unparseable connection string)" and "Dumping…" before pg_dump refused
 * it. Whether a value is a connection string is known from the string.
 */
describe("rebase db pull --from something that is not a connection string", () => {
    it.each([
        ["garbage", "it is neither a postgres:// URL nor libpq keyword=value pairs"],
        ["mysql://app:hunter2@db/prod", "it is a mysql:// URL, and a pull copies from PostgreSQL (postgres:// or postgresql://)"],
        ["postgres://app:hunter2@[db/prod", "it starts like a postgres:// URL but is not a valid one"]
    ])("refuses %s before anything is checked, started or said", async (from, why) => {
        await expect(dbCommand("pull", argv("pull", "--from", from, "--yes"))).rejects.toEqual(new Exit(1));

        const out = printed.join("\n");
        expect(out).toContain(`✗ The --from value is not a connection string: ${why}. Nothing was read or changed.`);
        expect(out).not.toContain("hunter2");
        expect(out).not.toContain("unparseable");
        expectNothingRan();
    });

    it("still takes libpq's keyword=value form, and names its host and database", async () => {
        await dbCommand("pull", argv("pull", "--from", "host=prod.example.com port=5432 dbname=app user=app password='hun ter2'", "--yes"));

        expect(state.dumped).toHaveLength(1);
        const out = printed.join("\n");
        expect(out).toContain("prod.example.com:5432/app");
        expect(out).not.toContain("hun ter2");
    });
});

describe("rebase db url, stop and reset refuse a flag they do not take", () => {
    it("db url refuses before a remembered container is started", async () => {
        await expect(dbCommand("url", argv("url", "--dokcer"))).rejects.toThrow("has no option --dokcer — did you mean --docker?");

        expect(state.ensured).toBe(0);
        expect(state.prepared).toBe(0);
    });

    it("db stop takes no options", async () => {
        await expect(dbCommand("stop", argv("stop", "--force"))).rejects.toThrow("`rebase db stop` has no option --force — it takes no options.");

        expect(state.stopped).toBe(0);
    });

    it("db reset refuses a misspelt --yes rather than reading it as no answer", async () => {
        await expect(dbCommand("reset", argv("reset", "--ys"))).rejects.toThrow("has no option --ys — did you mean --yes?");

        expect(state.reset).toBe(0);
    });

    it("db reset still takes --yes and -y", async () => {
        fs.mkdirSync(dataDir(state.root), { recursive: true });
        await dbCommand("reset", argv("reset", "-y"));

        expect(state.reset).toBe(1);
    });
});
