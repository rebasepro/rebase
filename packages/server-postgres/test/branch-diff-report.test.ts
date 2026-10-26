import { describe, it, expect } from "@jest/globals";
import type { BranchDiff } from "@rebasepro/types";
import { branchDiffReport } from "../src/branching/branch-diff-report";

/**
 * `rebase db branch diff` in a terminal. What is pinned is what it promises:
 * a row the target wrote is "kept" only when nothing the branch deleted is
 * referenced by it.
 */

const DIFF: BranchDiff = {
    branch: "agent",
    branchDatabase: "rb_agent",
    targetDatabase: "app",
    schemas: ["public"],
    forkPointKnown: true,
    fingerprint: "f1",
    schema: [],
    data: [{
        schema: "public",
        table: "authors",
        primaryKey: ["id"],
        inserted: 0,
        updated: 0,
        deleted: 0,
        conflicts: 1,
        targetChanges: 0,
        samples: [],
        referencedBy: [{ schema: "public", table: "posts", constraint: "posts_author_id_fkey", onDelete: "cascade", rows: 1 }]
    }, {
        schema: "public",
        table: "posts",
        primaryKey: ["id"],
        inserted: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0,
        targetChanges: 2,
        samples: []
    }, {
        schema: "public",
        table: "tags",
        primaryKey: ["id"],
        inserted: 0,
        updated: 0,
        deleted: 0,
        conflicts: 0,
        targetChanges: 1,
        samples: []
    }],
    sampleLimit: 100,
    computedAt: "2026-10-24T00:00:00.000Z"
};

describe("branchDiffReport", () => {
    const lines = branchDiffReport(DIFF);

    it("names the target's rows that reference a row the branch deleted", () => {
        expect(lines).toContain("    deleted on the branch, but referenced by rows app wrote since: public.posts (1 row(s), ON DELETE CASCADE)");
    });

    it("gives a table whose rows were not matched its row counts, not counts nobody knows", () => {
        const blocked = branchDiffReport({ ...DIFF, data: [{
            schema: "public", table: "big", primaryKey: ["id"], inserted: 0, updated: 0, deleted: 0, conflicts: 0, targetChanges: 0, samples: [],
            blocked: { code: "TOO_LARGE", message: "Too many rows." }, rowCounts: { target: 10, branch: 10 }
        }] });
        expect(blocked).toContain("  public.big: rows: 10 on app, 10 on the branch, not matched one by one");
        expect(blocked).toContain("    cannot be merged: Too many rows.");
    });

    it("does not call those rows kept, and still calls the others kept", () => {
        expect(lines).toContain("  public.posts: +0  ~0  -0  2 changed on app only (1 reference a row the branch deleted)");
        expect(lines).toContain("  public.tags: +0  ~0  -0  1 changed on app only, kept");
    });
});
