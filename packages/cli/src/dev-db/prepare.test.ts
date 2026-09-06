/**
 * What every command actually receives when it asks for a database.
 *
 * `resolve.ts` decides *which* database; this decides what a child process is
 * told about it. The failure that matters is narrow and severe: adding a
 * `DATABASE_URL` to the environment of a command that already had one would
 * silently redirect a migration away from the database its author meant. So the
 * central assertion here is a negative — where the child can already see the
 * connection string (the shell, or `.env`), the returned environment is empty.
 * The exceptions are the strings that exist nowhere else: `--database-url`, a
 * branch pointer, `--docker`'s compose URL, and the managed database.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { MANAGED_POOL_MAX } from "./constraints";
import { managedNotices, prepareDatabaseEnv } from "./prepare";

let root: string;
const originalEnv = { ...process.env };

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-prepare-")));
    delete process.env.DATABASE_URL;
});

afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(root, { recursive: true, force: true });
    vi.restoreAllMocks();
});

function writeEnvFile(contents: string): void {
    fs.writeFileSync(path.join(root, ".env"), contents, "utf8");
}

/** The `db` service `rebase init` writes, trimmed to what the derivation reads. */
function writeComposeFile(hostPort = "5435"): void {
    fs.writeFileSync(path.join(root, "docker-compose.yml"), [
        "name: demo",
        "",
        "services:",
        "  db:",
        "    image: pgvector/pgvector:pg18",
        "    environment:",
        "      POSTGRES_USER: rebase_app",
        "      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}",
        "      POSTGRES_DB: rebase",
        "    ports:",
        `      - "${hostPort}:5432"`,
        ""
    ].join("\n"), "utf8");
}

describe("an explicit database", () => {
    it("adds nothing to the environment when DATABASE_URL is already set", async () => {
        // The child already has what it needs. Anything added here could only
        // do harm, and redirecting a migration is the harm in question.
        process.env.DATABASE_URL = "postgresql://u:pw@staging:5432/app";

        const prepared = await prepareDatabaseEnv(root);

        expect(prepared.database.kind).toBe("external");
        expect(prepared.env).toEqual({});
    });

    it("reads DATABASE_URL out of the project's .env", async () => {
        writeEnvFile("DATABASE_URL=postgresql://u:pw@localhost:5432/mine\n");

        const prepared = await prepareDatabaseEnv(root);

        expect(prepared.database).toMatchObject({ kind: "external", source: "env-file" });
        expect(prepared.env).toEqual({});
    });

    it("lets --database-url outrank both", async () => {
        process.env.DATABASE_URL = "postgresql://u:pw@from-environment/app";
        writeEnvFile("DATABASE_URL=postgresql://u:pw@from-file/app\n");

        const prepared = await prepareDatabaseEnv(root, { flagUrl: "postgresql://u:pw@from-flag/app" });

        expect(prepared.database).toMatchObject({ kind: "external", source: "flag" });
    });

    it("exports the --database-url flag, which exists nowhere the child can look", async () => {
        // The flag lives in this process's argv and in no environment at all.
        // Leaving `env` empty announced the database in the banner and then
        // handed the backend nothing: `DATABASE_URL: is required`, on a run
        // that had just been told which database to use.
        const prepared = await prepareDatabaseEnv(root, { flagUrl: "postgresql://u:pw@from-flag/app" });

        expect(prepared.database).toMatchObject({ kind: "external", source: "flag" });
        expect(prepared.env.DATABASE_URL).toBe("postgresql://u:pw@from-flag/app");
        expect(fs.existsSync(path.join(root, ".rebase"))).toBe(false);
    });

    it("exports the flag even when a different DATABASE_URL is already in the environment", async () => {
        // Without the export the child would inherit the *shell's* URL while
        // every message named the flag's — the worst of both.
        process.env.DATABASE_URL = "postgresql://u:pw@from-environment/app";

        const prepared = await prepareDatabaseEnv(root, { flagUrl: "postgresql://u:pw@from-flag/app" });

        expect(prepared.env.DATABASE_URL).toBe("postgresql://u:pw@from-flag/app");
    });

    it("starts nothing at all", async () => {
        // Not just "returns no env": a project with its own Postgres must never
        // pay for a database it did not ask for, in start-up time or in disk.
        process.env.DATABASE_URL = "postgresql://u:pw@staging:5432/app";

        await prepareDatabaseEnv(root);

        expect(fs.existsSync(path.join(root, ".rebase"))).toBe(false);
    });

    it("hands --docker the compose service's own URL", async () => {
        // The one case that MUST export a connection string. `.env` leaves
        // DATABASE_URL commented out, so before this the backend booted with no
        // database at all — while the container the flag asked for was never
        // started either, because the preflight decides from a DSN.
        writeComposeFile();
        writeEnvFile("DATABASE_PASSWORD=s3cret\n");

        const prepared = await prepareDatabaseEnv(root, { flagDocker: true });

        expect(prepared.database.kind).toBe("docker");
        expect(prepared.env.DATABASE_URL).toBe(
            "postgresql://rebase_app:s3cret@127.0.0.1:5435/rebase?options=-c%20search_path%3Dpublic&sslmode=disable"
        );
        expect(fs.existsSync(path.join(root, ".rebase"))).toBe(false);
    });

    it("refuses --docker when there is no compose db service to reach", async () => {
        await expect(prepareDatabaseEnv(root, { flagDocker: true }))
            .rejects.toThrow(/--docker needs a docker-compose\.yml/);
    });

    it("treats an empty DATABASE_URL as absent rather than as a connection string", async () => {
        // `DATABASE_URL=` is what someone writes to mean "not this one".
        writeComposeFile();
        writeEnvFile("DATABASE_URL=\nDATABASE_PASSWORD=s3cret\n");

        const prepared = await prepareDatabaseEnv(root, { flagDocker: true });

        expect(prepared.database.kind).toBe("docker");
    });
});

describe("managedNotices", () => {
    it("says nothing about a database the developer chose", async () => {
        process.env.DATABASE_URL = "postgresql://u:pw@staging:5432/app";
        const prepared = await prepareDatabaseEnv(root);

        expect(managedNotices(prepared)).toEqual([]);
    });

    it("states the limitations rather than leaving them to be discovered", () => {
        // A developer who does not know requests are serialized here will read
        // the difference as a bug in their own code.
        const notices = managedNotices({
            database: { kind: "managed", source: "managed" },
            env: {},
            description: "the managed development database (PGlite)",
            dataDir: "/tmp/project/.rebase/pgdata"
        });

        expect(notices.join("\n")).toContain("one at a time");
        expect(notices.join("\n")).toContain("/tmp/project/.rebase/pgdata");
        // …and always how to opt out, since that is the whole promise.
        expect(notices.join("\n")).toContain("DATABASE_URL");
    });

    it("no longer claims realtime is unavailable", () => {
        // It was, before the notification proxy. A stale warning telling
        // someone realtime does not work would send them to Docker for nothing.
        const notices = managedNotices({
            database: { kind: "managed", source: "managed" },
            env: {},
            description: "the managed development database (PGlite)"
        });

        expect(notices.join("\n").toLowerCase()).not.toContain("realtime");
    });
});

describe("the managed environment", () => {
    it("caps the pool, because overlapping transactions deadlock otherwise", () => {
        // Not a tuning choice: PGlite is one session behind a multiplexer, and
        // two pooled clients in overlapping transactions hang rather than error.
        expect(MANAGED_POOL_MAX).toBe(1);
    });
});
