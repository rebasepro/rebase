/**
 * A database dump must not be committable from a fresh scaffold.
 *
 * `rebase db backup` writes `backend/backups/rebase-<db>-<stamp>.dump` by
 * default — the driver runs with `cwd: backend/` — and `rebase db --help`'s own
 * example, `rebase db backup --out ./backups`, lands in the tree too. Neither
 * was ignored: `git check-ignore -v backend/backups/*.dump` matched nothing.
 * A dump carries every row of every table, `rebase.users` password hashes
 * included, so this is not tidiness.
 *
 * Asserted through `git check-ignore` rather than by reading the patterns,
 * because the question is what git does with them.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";

const here = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_GITIGNORE = path.resolve(here, "..", "..", "templates", "template", "gitignore");

let repo: string;

/** `git check-ignore` answers 0 when the path is ignored, 1 when it is not. */
function isIgnored(relativePath: string): boolean {
    try {
        execFileSync("git", ["check-ignore", "-q", "--no-index", relativePath], { cwd: repo });

        return true;
    } catch {
        return false;
    }
}

beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-gitignore-"));
    execFileSync("git", ["init", "-q"], { cwd: repo });
    // `rebase init` renames it; the template ships it without the leading dot
    // so npm does not eat it on publish.
    fs.copyFileSync(TEMPLATE_GITIGNORE, path.join(repo, ".gitignore"));
});

afterAll(() => {
    fs.rmSync(repo, { recursive: true, force: true });
});

describe("the scaffold's .gitignore", () => {
    it.each([
        ["backend/backups/rebase-app-20260714T030000Z.dump", "the default destination, run through the CLI"],
        ["backups/rebase-app-20260714T030000Z.dump", "`rebase db backup --out ./backups`, the help's own example"],
        ["backups/rebase-app-20260714T030000Z.globals.sql", "the roles sidecar written beside it"],
        ["dumps/snapshot.dump", "a dump written anywhere else"]
    ])("ignores %s (%s)", (file) => {
        expect(isIgnored(file)).toBe(true);
    });

    it("still tracks the things a scaffold is meant to commit", () => {
        // The counter-check: `*.dump` and `backups/` must not swallow source.
        for (const file of [
            "config/collections/posts.ts",
            "drizzle/schema.sql",
            "drizzle/migrations/20260714000000_init.sql",
            "backend/package.json"
        ]) {
            expect(isIgnored(file), `${file} must stay tracked`).toBe(false);
        }
    });

    it("keeps ignoring the uploads directory it already ignored", () => {
        expect(isIgnored("backend/uploads/photo.jpg")).toBe(true);
    });
});
