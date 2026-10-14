/**
 * A switched checkout has to actually reach the branch.
 *
 * The pointer resolved correctly long before this worked: `prepareDatabaseEnv`
 * returned an empty environment for every external database, on the reasoning
 * that the child would find the connection string in `.env` or the shell. A
 * branch URL is in neither — it is derived from the base at resolution time —
 * so `rebase db backup` on a switched checkout still reported
 * `Database: leadgen`. The switch was real and changed nothing.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
    BRANCH_PARENT_DATABASE_ENV,
    devDatabaseKind,
    prepareDatabaseEnv,
    resolveActiveBranch,
    resolveProjectDatabase,
    resolveProjectDatabaseAndBranch
} from "./prepare";
import { writeActiveBranch } from "./branch-pointer";
import { recordLastDevDatabase } from "./last-dev-database";
import type { DevDatabase } from "./resolve";

describe("prepareDatabaseEnv with a branch active", () => {
    let root: string;
    const base = "postgresql://rebase:s3cret@localhost:5434/leadgen?sslmode=disable";

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-prepare-"));
        fs.writeFileSync(path.join(root, ".env"), `DATABASE_URL=${base}\n`);
        delete process.env.DATABASE_URL;
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    it("exports the branch URL, because nothing else in the child knows it", async () => {
        writeActiveBranch(root, { name: "feat_x", database: "rb_feat_x" });

        const prepared = await prepareDatabaseEnv(root);

        expect(prepared.env.DATABASE_URL)
            .toBe("postgresql://rebase:s3cret@localhost:5434/rb_feat_x?sslmode=disable");
    });

    it("names the main database the branch was taken from, where the server keeps its branches", async () => {
        // A branch database holds only a snapshot of the branch registry,
        // taken when it was copied; the registry itself lives in the main
        // database. The server cannot tell which that is from a branch URL.
        writeActiveBranch(root, { name: "feat_x", database: "rb_feat_x" });

        const prepared = await prepareDatabaseEnv(root);

        expect(prepared.env[BRANCH_PARENT_DATABASE_ENV]).toBe("leadgen");
        expect(BRANCH_PARENT_DATABASE_ENV).toBe("REBASE_BRANCH_PARENT_DATABASE");
    });

    it("names the branch in the line commands print", async () => {
        writeActiveBranch(root, { name: "feat_x", database: "rb_feat_x" });

        expect((await prepareDatabaseEnv(root)).description).toContain("feat_x");
    });

    it("adds nothing when no branch is active", async () => {
        // The pre-existing contract for an external database, unchanged.
        expect((await prepareDatabaseEnv(root)).env).toEqual({});
    });

    it("ignores the branch when the project has no DATABASE_URL to branch from", () => {
        // Such a project is on the managed database, where branching cannot
        // work at all. Asserted on the seam rather than through
        // prepareDatabaseEnv, which would start a real PGlite to prove it.
        writeActiveBranch(root, { name: "feat_x", database: "rb_feat_x" });

        expect(resolveActiveBranch(root, {})).toBeNull();
    });

    it("ignores a branch whose base connection string cannot be parsed", () => {
        writeActiveBranch(root, { name: "feat_x", database: "rb_feat_x" });

        expect(resolveActiveBranch(root, { DATABASE_URL: "not a url" })).toBeNull();
    });

    it("derives the branch URL from .env, never from the shell", () => {
        // A switch is a statement about this project's database; a DATABASE_URL
        // that happens to be in the shell is not the thing being branched — and
        // it outranks the branch anyway.
        writeActiveBranch(root, { name: "feat_x", database: "rb_feat_x" });

        expect(resolveActiveBranch(root, { DATABASE_URL: base }))
            .toEqual({ name: "feat_x", url: "postgresql://rebase:s3cret@localhost:5434/rb_feat_x?sslmode=disable" });
    });

    it("does not export a branch URL when --database-url was given", async () => {
        writeActiveBranch(root, { name: "feat_x", database: "rb_feat_x" });

        const prepared = await prepareDatabaseEnv(root, { flagUrl: "postgresql://h/explicit" });

        // The flag is exported, because it exists nowhere the child can look —
        // but it is the flag's database, not the branch's. A switch made
        // yesterday must not redirect a URL typed on this command line.
        expect(prepared.env).toEqual({ DATABASE_URL: "postgresql://h/explicit" });
        expect(prepared.database).toMatchObject({ source: "flag" });
    });
});

/**
 * A switch on Postgres in Docker, the setup the docs send you to for branching.
 *
 * `rebase dev --docker` is remembered, so the scaffold's `.env` keeps
 * `DATABASE_URL` commented out and every command reaches the compose database.
 * The branch was derived from `.env` alone, so on exactly this project `switch`
 * said "every rebase command in this checkout now uses it" and then `db url`,
 * `console`, `db backup` and `dev --docker` all kept using the main database —
 * every write meant for the branch landed on main.
 */
describe("a branch on Postgres in Docker", () => {
    let root: string;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-prepare-docker-"));
        fs.writeFileSync(path.join(root, "docker-compose.yml"), [
            "services:",
            "  db:",
            "    image: pgvector/pgvector:pg18",
            "    environment:",
            "      POSTGRES_USER: rebase_app",
            "      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}",
            "      POSTGRES_DB: rebase",
            "    ports:",
            "      - \"5433:5432\"",
            ""
        ].join("\n"));
        // The scaffold's `.env`: the password the compose file reads, and
        // DATABASE_URL commented out.
        fs.writeFileSync(path.join(root, ".env"), "DATABASE_PASSWORD=s3cret\n# DATABASE_URL=postgresql://…\n");
        writeActiveBranch(root, { name: "feat_one", database: "rb_feat_one" });
        delete process.env.DATABASE_URL;
    });
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const onBranch = (url: string | null | undefined) => {
        expect(url).toBeTruthy();
        const parsed = new URL(url ?? "");
        expect(parsed.pathname).toBe("/rb_feat_one");
        expect(parsed.port).toBe("5433");
        // The query string is carried across: `sslmode=disable` is what a
        // local container needs.
        expect(parsed.searchParams.get("sslmode")).toBe("disable");
    };

    it("is what every command resolves after `rebase dev --docker`", () => {
        recordLastDevDatabase(root, "docker");

        const database = resolveProjectDatabase(root);

        // Still Docker: `rebase dev --docker` starts the container for it, and
        // records Docker as what the other commands follow.
        expect(database).toMatchObject({ kind: "docker", source: "last-dev" });
        onBranch(database.kind === "docker" ? database.url : null);
        expect(devDatabaseKind(root)).toBe("docker");
    });

    it("hands the child the branch, and the main database the branch registry lives in", async () => {
        recordLastDevDatabase(root, "docker");
        const progress: string[] = [];

        const prepared = await prepareDatabaseEnv(root, { onProgress: (line) => progress.push(line) });

        onBranch(prepared.env.DATABASE_URL);
        expect(prepared.env[BRANCH_PARENT_DATABASE_ENV]).toBe("rebase");
        expect(prepared.description).toContain("feat_one");
        expect(prepared.description).toContain("Docker");
        expect(progress.join("\n")).toContain("feat_one");
    });

    it("follows --docker typed on the command line", () => {
        onBranch(databaseUrl(resolveProjectDatabase(root, { flagDocker: true })));
    });

    it("is what `rebase dev --docker` starts and serves", async () => {
        // `dev` resolves with its own flags and without the record.
        const options = { flagDocker: true, followLastDev: false };

        onBranch(databaseUrl(resolveProjectDatabase(root, options)));
        onBranch((await prepareDatabaseEnv(root, options)).env.DATABASE_URL);
    });

    it("is what `rebase status` reads, from .env and not this shell", () => {
        recordLastDevDatabase(root, "docker");
        process.env.DATABASE_URL = "postgresql://u:pw@staging:5432/app";

        const resolved = resolveProjectDatabaseAndBranch(root, { env: {} });

        onBranch(databaseUrl(resolved.database));
        expect(resolved.branch).toEqual({ name: "feat_one", database: "rb_feat_one", parent: "rebase" });
    });

    it("still loses to a DATABASE_URL in the shell, which outranks any switch", () => {
        recordLastDevDatabase(root, "docker");
        process.env.DATABASE_URL = "postgresql://u:pw@staging:5432/app";

        expect(resolveProjectDatabaseAndBranch(root)).toMatchObject({
            database: { kind: "external", source: "environment" },
            branch: null
        });
    });

    it("says so, rather than nothing, when the database it resolves to cannot have one", () => {
        // No `--docker`, nothing remembered: the managed database, which serves
        // exactly one database. Asserted on the seam, because
        // `prepareDatabaseEnv` would start a real PGlite to prove it.
        expect(resolveProjectDatabaseAndBranch(root)).toMatchObject({
            database: { kind: "managed" },
            branch: null,
            ignoredBranch: "feat_one"
        });
    });
});

function databaseUrl(database: DevDatabase): string | null {
    return database.kind === "managed" ? null : database.url;
}
