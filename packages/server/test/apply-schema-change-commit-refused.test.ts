/**
 * A commit git refuses — a pre-commit hook (husky, lint-staged), a missing
 * identity, a held `index.lock` — must leave the tree exactly as it was found.
 *
 * `applySchemaChange` writes the collection source and the generated schema,
 * stages them, and commits. When the commit was refused it threw with both
 * files rewritten and staged: the panel said the change failed while the
 * source had changed (and, under `rebase dev`, the watcher restarted the
 * backend and boot-ensure applied the DDL anyway). Every retry then met its own
 * leftovers as somebody else's work — 409 SCHEMA_EDIT_DIRTY_TREE — forever.
 *
 * Against real git, because what is under test is what git leaves behind.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SchemaChangePlan } from "@rebasepro/types";
import { applySchemaChange } from "../src/schema-edit/apply-schema-change";
import { createLocalGitRepository } from "../src/schema-edit/local-git-repository";

jest.setTimeout(60_000);

const SOURCE = "config/collections/posts.ts";
const GENERATED = "backend/src/schema.generated.ts";

function makeRepo(hook: string | undefined): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-hook-"));
    const run = (...args: string[]) => execFileSync("git", args, { cwd: root, stdio: "pipe" });
    run("init", "-q");
    run("symbolic-ref", "HEAD", "refs/heads/main");
    run("config", "user.name", "Fixture");
    run("config", "user.email", "fixture@example.com");
    // A global `core.hooksPath` on the machine running this would otherwise
    // decide which hook runs.
    run("config", "core.hooksPath", ".git/hooks");
    fs.mkdirSync(path.join(root, "config/collections"), { recursive: true });
    fs.mkdirSync(path.join(root, "backend/src"), { recursive: true });
    fs.writeFileSync(path.join(root, SOURCE), "export default { slug: \"posts\" };\n");
    fs.writeFileSync(path.join(root, GENERATED), "// generated\n");
    run("add", "-A");
    run("commit", "-q", "-m", "initial");
    if (hook) {
        const hookPath = path.join(root, ".git/hooks/pre-commit");
        fs.writeFileSync(hookPath, hook);
        fs.chmodSync(hookPath, 0o755);
    }
    return root;
}

const status = (root: string) =>
    execFileSync("git", ["status", "--porcelain"], { cwd: root, encoding: "utf8" }).trim();

const plan = (): SchemaChangePlan => ({
    files: [{ path: GENERATED, contents: "// generated + subtitle\n" }],
    statements: ["ALTER TABLE posts ADD COLUMN subtitle TEXT"],
    classified: { applicable: true, verdict: "safe", changes: [] },
    message: "feat(schema): add subtitle to posts"
});

describe("a commit git refuses", () => {
    let root: string;
    afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

    const attempt = (applied: string[]) => applySchemaChange({
        plan: plan(),
        repository: createLocalGitRepository({ root, author: { name: "Ada", email: "ada@example.com" } }),
        sourcePaths: [SOURCE],
        writeSource: async () => {
            const contents = "export default { slug: \"posts\", properties: { subtitle: {} } };\n";
            fs.writeFileSync(path.join(root, SOURCE), contents);
            return [{ path: SOURCE, contents }];
        },
        apply: async (statements) => { applied.push(...statements); }
    });

    it("restores the source and the generated file, and stages nothing", async () => {
        root = makeRepo("#!/bin/sh\necho \"lint-staged: prettier --check failed\" >&2\nexit 1\n");
        const applied: string[] = [];

        await expect(attempt(applied)).rejects.toThrow();

        expect(status(root)).toBe("");
        expect(fs.readFileSync(path.join(root, SOURCE), "utf8")).toBe("export default { slug: \"posts\" };\n");
        expect(fs.readFileSync(path.join(root, GENERATED), "utf8")).toBe("// generated\n");
        expect(applied).toEqual([]);
    });

    it("names the git subcommand and carries what the hook said", async () => {
        root = makeRepo("#!/bin/sh\necho \"lint-staged: prettier --check failed\" >&2\nexit 1\n");

        const err = await attempt([]).catch((e: unknown) => e as Error);

        expect(err.message).toMatch(/git commit failed/);
        expect(err.message).not.toMatch(/git -c failed/);
        expect(err.message).toContain("prettier --check failed");
    });

    it("refuses the retry for the same reason, not as a dirty tree", async () => {
        root = makeRepo("#!/bin/sh\necho \"hook says no\" >&2\nexit 1\n");

        await attempt([]).catch(() => undefined);
        const retry = await attempt([]).catch((e: unknown) => e as Error);

        expect(retry.name).not.toBe("DirtyWorkingTreeError");
        expect(retry.message).toContain("hook says no");
    });

    it("removes a file the change created, rather than leaving it untracked", async () => {
        root = makeRepo("#!/bin/sh\nexit 1\n");
        const fresh = "config/collections/tags.ts";

        await applySchemaChange({
            plan: plan(),
            repository: createLocalGitRepository({ root }),
            sourcePaths: [fresh],
            writeSource: async () => {
                fs.writeFileSync(path.join(root, fresh), "export default { slug: \"tags\" };\n");
                return [{ path: fresh, contents: "export default { slug: \"tags\" };\n" }];
            },
            apply: async () => undefined
        }).catch(() => undefined);

        expect(fs.existsSync(path.join(root, fresh))).toBe(false);
        expect(status(root)).toBe("");
    });

    it("still commits when nothing is in the way", async () => {
        root = makeRepo(undefined);
        const applied: string[] = [];

        const result = await attempt(applied);

        expect(result.committed.files).toEqual([SOURCE, GENERATED]);
        expect(status(root)).toBe("");
        expect(applied).toHaveLength(1);
    });
});
