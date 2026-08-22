/**
 * Commit, then apply.
 *
 * Almost everything here is about ordering and half-failure, because that is
 * the whole reason this is one function instead of two calls:
 *
 * - nothing is written when the change is refused;
 * - nothing is applied unless the commit landed first;
 * - a failed apply is a *result*, not an error, because the durable half
 *   succeeded and boot will finish the job;
 * - a failed commit means nothing ran at all.
 *
 * The one that would be easiest to get wrong and hardest to notice is
 * apply-before-commit, so it is asserted directly by recording the order the
 * two collaborators were called in.
 */
import type { CollectionConfig } from "@rebasepro/types";
import {
    applySchemaChange,
    DirtyWorkingTreeError,
    type SchemaEditRepository
} from "../src/schema/apply-schema-change";
import { SchemaCommitError } from "../src/schema/generate-schema-commit";

const collection = (slug: string, properties: Record<string, unknown> = {}): CollectionConfig =>
    ({
        slug,
        name: slug,
        properties: { id: { type: "string", name: "Id", isId: true }, ...properties }
    }) as unknown as CollectionConfig;

const str = (over: Record<string, unknown> = {}) => ({ type: "string", name: "S", ...over });

/** A repository that records what happened to it. */
function fakeRepository(over: Partial<SchemaEditRepository> = {}) {
    const calls: string[] = [];
    const written: string[] = [];
    const repo: SchemaEditRepository = {
        root: "/tmp/project",
        currentBranch: async () => "main",
        dirtyPaths: async () => [],
        writeFiles: async (files) => {
            calls.push("write");
            written.push(...files.map(f => f.path));
        },
        commit: async () => {
            calls.push("commit");
            return "abc123def456";
        },
        ...over
    };
    return { repo, calls, written };
}

describe("the happy path", () => {
    it("commits and applies, and says what it did", async () => {
        const { repo, calls, written } = fakeRepository();
        const applied: string[][] = [];

        const result = await applySchemaChange({
            before: [collection("posts")],
            after: [collection("posts", { subtitle: str() })],
            repository: repo,
            apply: async (statements) => { calls.push("apply"); applied.push(statements); }
        });

        expect(calls).toEqual(["write", "commit", "apply"]);
        expect(result.applied).toBe(true);
        expect(result.committed).toMatchObject({ sha: "abc123def456", branch: "main" });
        expect(result.summary).toContain("Committed abc123def");
        expect(applied[0].some(s => /ADD COLUMN/i.test(s))).toBe(true);
        expect(written).toContain("backend/src/schema.generated.ts");
    });

    it("commits the source files the caller supplied, alongside the generated ones", async () => {
        const { repo, written } = fakeRepository();
        await applySchemaChange({
            before: [],
            after: [collection("posts")],
            sourceFiles: [{ path: "config/collections/posts.ts", contents: "export const posts = {};" }],
            repository: repo,
            apply: async () => undefined
        });
        expect(written).toContain("config/collections/posts.ts");
        expect(written).toContain("drizzle/schema.sql");
    });

    it("stages exactly the files it wrote, and nothing else", async () => {
        let staged: string[] = [];
        const { repo } = fakeRepository({
            commit: async (paths) => { staged = paths; return "sha"; }
        });
        await applySchemaChange({
            before: [],
            after: [collection("posts")],
            repository: repo,
            apply: async () => undefined
        });
        expect(staged.sort()).toEqual([
            "backend/src/schema.generated.ts",
            "drizzle/policies.sql",
            "drizzle/schema.sql",
            "drizzle/search.sql"
        ]);
    });

    it("skips the apply when the change needs no DDL, and still reports success", async () => {
        const same = [collection("posts", { title: str() })];
        const { repo, calls } = fakeRepository();

        const result = await applySchemaChange({
            before: same,
            after: same,
            repository: repo,
            apply: async () => { calls.push("apply"); }
        });

        expect(calls).toEqual(["write", "commit"]);
        expect(result.applied).toBe(true);
        expect(result.summary).toContain("No DDL was needed");
    });
});

describe("nothing happens when the change is refused", () => {
    it("does not write or commit a change the ensure path cannot express", async () => {
        const { repo, calls } = fakeRepository();

        await expect(applySchemaChange({
            before: [collection("posts", { subtitle: str() })],
            after: [collection("posts", {})],
            repository: repo,
            apply: async () => { calls.push("apply"); }
        })).rejects.toThrow(SchemaCommitError);

        expect(calls).toEqual([]);
    });

    it("refuses before writing when the tree already has our files modified", async () => {
        const { repo, calls } = fakeRepository({
            dirtyPaths: async () => ["drizzle/schema.sql", "some/other/file.ts"]
        });

        await expect(applySchemaChange({
            before: [],
            after: [collection("posts")],
            repository: repo,
            apply: async () => { calls.push("apply"); }
        })).rejects.toThrow(DirtyWorkingTreeError);

        expect(calls).toEqual([]);
    });

    it("names only the conflicting paths, not every dirty file in the tree", async () => {
        const { repo } = fakeRepository({
            dirtyPaths: async () => ["drizzle/schema.sql", "README.md"]
        });

        const err = await applySchemaChange({
            before: [],
            after: [collection("posts")],
            repository: repo,
            apply: async () => undefined
        }).catch(e => e as DirtyWorkingTreeError);

        expect(err.paths).toEqual(["drizzle/schema.sql"]);
        expect(err.message).not.toContain("README.md");
    });

    it("ignores unrelated dirty files entirely", async () => {
        const { repo, calls } = fakeRepository({
            dirtyPaths: async () => ["src/app.tsx", "README.md"]
        });
        await applySchemaChange({
            before: [],
            after: [collection("posts")],
            repository: repo,
            apply: async () => { calls.push("apply"); }
        });
        expect(calls).toEqual(["write", "commit", "apply"]);
    });
});

describe("a failed apply is a state, not an error", () => {
    it("reports committed-but-not-applied instead of throwing", async () => {
        const { repo } = fakeRepository();

        const result = await applySchemaChange({
            before: [collection("posts")],
            after: [collection("posts", { subtitle: str() })],
            repository: repo,
            apply: async () => { throw new Error("connection refused"); }
        });

        expect(result.applied).toBe(false);
        expect(result.applyError).toContain("connection refused");
        expect(result.committed.sha).toBe("abc123def456");
        expect(result.summary).toContain("applied on the next boot");
    });

    it("keeps the statements on the result, so the failure can be diagnosed", async () => {
        const { repo } = fakeRepository();
        const result = await applySchemaChange({
            before: [collection("posts")],
            after: [collection("posts", { subtitle: str() })],
            repository: repo,
            apply: async () => { throw new Error("nope"); }
        });
        expect(result.statements.length).toBeGreaterThan(0);
    });
});

describe("a failed commit means nothing ran", () => {
    it("never applies when the commit throws", async () => {
        const calls: string[] = [];
        const { repo } = fakeRepository({
            commit: async () => { calls.push("commit"); throw new Error("hook rejected"); }
        });

        await expect(applySchemaChange({
            before: [collection("posts")],
            after: [collection("posts", { subtitle: str() })],
            repository: repo,
            apply: async () => { calls.push("apply"); }
        })).rejects.toThrow("hook rejected");

        expect(calls).toEqual(["commit"]);
        expect(calls).not.toContain("apply");
    });
});
