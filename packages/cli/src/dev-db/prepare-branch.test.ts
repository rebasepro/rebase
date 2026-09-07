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
import { prepareDatabaseEnv, resolveActiveBranch } from "./prepare";
import { writeActiveBranch } from "./branch-pointer";

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
