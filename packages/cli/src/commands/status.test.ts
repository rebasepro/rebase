/**
 * Which database `rebase status` reports the project on.
 *
 * It resolved the database with the same order every command uses, and then
 * told the status view only about the managed case: on Postgres in Docker —
 * `rebase dev --docker`, remembered, with `.env`'s DATABASE_URL commented out —
 * the default database read `○ … has no connection string — set DATABASE_URL`
 * while `rebase dev --docker` served the project from it. And a checkout
 * switched to a branch said nothing about it.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { writeActiveBranch } from "../dev-db/branch-pointer";
import { recordLastDevDatabase } from "../dev-db/last-dev-database";
import { statusDatabase } from "./status";

let root: string;
const originalEnv = { ...process.env };

beforeEach(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-status-db-")));
    fs.writeFileSync(path.join(root, "docker-compose.yml"), [
        "services:",
        "  db:",
        "    image: pgvector/pgvector:pg18",
        "    environment:",
        "      POSTGRES_USER: rebase_app",
        "      POSTGRES_PASSWORD: ${DATABASE_PASSWORD:-changeme}",
        "      POSTGRES_DB: rebase",
        "    ports:",
        // A port nothing listens on, so the row says the container is down.
        "      - \"1:5432\"",
        ""
    ].join("\n"));
});

afterEach(() => {
    process.env = { ...originalEnv };
    fs.rmSync(root, { recursive: true, force: true });
});

/** Writes the project's `.env` and returns it parsed, the way `rebase status` holds it. */
function writeEnv(values: Record<string, string>): Record<string, string> {
    fs.writeFileSync(path.join(root, ".env"), Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join(""));
    return values;
}

describe("statusDatabase", () => {
    it("reports the compose database after `rebase dev --docker`", async () => {
        recordLastDevDatabase(root, "docker");

        const resolved = await statusDatabase(root, writeEnv({ DATABASE_PASSWORD: "s3cret" }));

        expect(resolved.managedDatabase).toBeUndefined();
        expect(resolved.dockerDatabase?.url).toContain("@127.0.0.1:1/rebase");
        expect(resolved.dockerDatabase?.detail).toContain("Postgres in Docker, as the last `rebase dev --docker` did · 127.0.0.1:1/rebase");
        expect(resolved.dockerDatabase?.detail).toContain("not running");
        // No password in a line people paste into issues.
        expect(resolved.dockerDatabase?.detail).not.toContain("s3cret");
    });

    it("names the branch a Docker checkout is switched to, and reports that database", async () => {
        recordLastDevDatabase(root, "docker");
        writeActiveBranch(root, { name: "feat_one", database: "rb_feat_one" });

        const resolved = await statusDatabase(root, writeEnv({ DATABASE_PASSWORD: "s3cret" }));

        expect(resolved.branch).toEqual({ name: "feat_one", database: "rb_feat_one", parent: "rebase" });
        expect(resolved.dockerDatabase?.url).toContain("/rb_feat_one?");
        expect(resolved.dockerDatabase?.detail).toContain("feat_one");
    });

    it("names the branch over a DATABASE_URL in .env", async () => {
        writeActiveBranch(root, { name: "feat_one", database: "rb_feat_one" });

        const resolved = await statusDatabase(root, writeEnv({ DATABASE_URL: "postgresql://u:pw@localhost:5432/app" }));

        expect(resolved.branch).toMatchObject({ name: "feat_one", parent: "app" });
        expect(resolved.dockerDatabase).toBeUndefined();
        expect(resolved.managedDatabase).toBeUndefined();
    });

    it("reads the project, not this shell", async () => {
        recordLastDevDatabase(root, "docker");
        process.env.DATABASE_URL = "postgresql://u:pw@staging:5432/app";

        expect((await statusDatabase(root, writeEnv({ DATABASE_PASSWORD: "s3cret" }))).dockerDatabase).toBeDefined();
    });

    it("stands nothing in for a production .env", async () => {
        recordLastDevDatabase(root, "docker");

        const resolved = await statusDatabase(root, writeEnv({ DATABASE_PASSWORD: "s3cret", NODE_ENV: "production" }));

        expect(resolved.dockerDatabase).toBeUndefined();
        expect(resolved.managedDatabase).toBeUndefined();
    });

    it("says when a switch is not followed, because the managed database has no branches", async () => {
        writeActiveBranch(root, { name: "feat_one", database: "rb_feat_one" });

        const resolved = await statusDatabase(root, writeEnv({ DATABASE_PASSWORD: "s3cret" }));

        expect(resolved.branch).toBeNull();
        expect(resolved.ignoredBranch).toBe("feat_one");
        expect(resolved.managedDatabase).toEqual({ url: null });
    });
});
