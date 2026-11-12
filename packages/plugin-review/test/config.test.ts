import { describe, expect, it } from "@jest/globals";
import { col, defineTable } from "@rebasepro/types";
import { compileRulePolicies, compileTables, lowerTables } from "@rebasepro/common";
import {
    assertReviewConfig,
    diffStagedChange,
    findReviewConfigProblems,
    isReviewer,
    mayPropose,
    ReviewConfigError,
    reviewRls,
    type ReviewConfig,
    type StateFieldReview
} from "../src/config";

const POSTS_COLUMNS = {
    id: col.uuid().primaryKey().defaultRandom(),
    title: col.text(),
    views: col.integer(),
    status: col.enum(["draft", "published", "rejected"])
};
const postsDef = defineTable("posts", { columns: POSTS_COLUMNS, rls: "admin-only" });
const ordersDef = defineTable("orders", {
    columns: {
        id: col.serial().primaryKey(),
        total: col.integer()
    },
    rls: "admin-only"
});
const [posts, orders] = compileTables([postsDef, ordersDef]);

const stateField: StateFieldReview = {
    mode: "state-field",
    field: "status",
    pendingValue: "draft",
    approvedValue: "published",
    rejectedValue: "rejected",
    agentRoles: ["agent"],
    reviewerRoles: ["editor"]
};

const problems = (config: ReviewConfig) => findReviewConfigProblems(config, [posts, orders]).map(problem => problem.path).sort();

describe("findReviewConfigProblems", () => {
    it("accepts a state-field review over an enum holding every value, and a staged-table review", () => {
        expect(problems({
            collections: {
                posts: stateField,
                orders: { mode: "staged-table",
operations: ["update", "delete"],
agentRoles: ["agent"],
reviewerRoles: ["ops"] }
            }
        })).toEqual([]);
    });

    it("accepts a plain text column, with no value set to check against", () => {
        const [plain] = compileTables([defineTable("posts", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), status: col.text() },
            rls: "admin-only"
        })]);
        expect(findReviewConfigProblems({ collections: { posts: { ...stateField,
pendingValue: "anything" } } }, [plain])).toEqual([]);
    });

    it("checks the values against a `.oneOf([...])` text column too", () => {
        const [closed] = compileTables([defineTable("posts", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), status: col.text().oneOf(["draft", "published"]) },
            rls: "admin-only"
        })]);
        expect(findReviewConfigProblems({ collections: { posts: { ...stateField, rejectedValue: undefined } } }, [closed])).toEqual([]);
        expect(findReviewConfigProblems({ collections: { posts: stateField } }, [closed]).map(problem => problem.path))
            .toEqual(["collections.posts.rejectedValue"]);
    });

    it("names a table that does not exist", () => {
        expect(problems({ collections: { comments: { mode: "staged-table" } } })).toEqual(["collections.comments"]);
    });

    it("refuses a column the table lacks, and one that does not hold text", () => {
        expect(problems({ collections: { posts: { ...stateField,
field: "state" } } })).toEqual(["collections.posts.field"]);
        const [problem] = findReviewConfigProblems({ collections: { posts: { ...stateField,
field: "views" } } }, [posts]);
        expect(problem.message).toContain("integer");
    });

    it("refuses each value outside the enum, listing the values there are", () => {
        const found = findReviewConfigProblems({
            collections: { posts: { ...stateField,
pendingValue: "pending",
approvedValue: "live",
rejectedValue: "nope" } }
        }, [posts]);
        expect(found.map(problem => problem.path).sort()).toEqual([
            "collections.posts.approvedValue",
            "collections.posts.pendingValue",
            "collections.posts.rejectedValue"
        ]);
        expect(found[0].message).toContain("\"draft\", \"published\", \"rejected\"");
    });

    it("refuses an approved value equal to the pending one, malformed roles and operations", () => {
        expect(problems({ collections: { posts: { ...stateField,
approvedValue: "draft" } } })).toEqual(["collections.posts.approvedValue"]);
        expect(problems({
            collections: { orders: { mode: "staged-table",
operations: [],
agentRoles: [""],
reviewerRoles: ["ok"] } }
        })).toEqual(["collections.orders.agentRoles", "collections.orders.operations"]);
    });

    it("throws every problem at once from assertReviewConfig", () => {
        expect(() => assertReviewConfig({ collections: { comments: { mode: "staged-table" } },
functionName: "Bad Name" }, [posts]))
            .toThrow(ReviewConfigError);
    });
});

describe("who reviews and who proposes", () => {
    it("lets admin and the reviewer roles review", () => {
        expect(isReviewer(["admin"], stateField)).toBe(true);
        expect(isReviewer(["editor"], stateField)).toBe(true);
        expect(isReviewer(["agent"], stateField)).toBe(false);
    });

    it("lets the agent roles and reviewers propose the operations the review takes", () => {
        const review = { mode: "staged-table" as const,
operations: ["update" as const],
agentRoles: ["agent"],
reviewerRoles: ["ops"] };
        expect(mayPropose(["agent"], review, "update")).toBe(true);
        expect(mayPropose(["ops"], review, "update")).toBe(true);
        expect(mayPropose(["agent"], review, "delete")).toBe(false);
        expect(mayPropose(["viewer"], review, "update")).toBe(false);
        expect(mayPropose(["viewer"], { mode: "staged-table" }, "insert")).toBe(true);
        expect(mayPropose(["agent"], stateField, "update")).toBe(false);
    });
});

describe("reviewRls", () => {
    /** The policies the rules compile to on the table they are spread into, as the backend lowers it. */
    const compile = (review: StateFieldReview) => {
        const table = defineTable("posts", { columns: POSTS_COLUMNS, rls: reviewRls("posts", review) });
        const [descriptor] = compileTables([table]);
        const [lowered] = lowerTables([table], { describe: () => descriptor });
        return descriptor.rls.rules.flatMap(rule => compileRulePolicies(lowered, rule));
    };

    it("compiles to one restrictive policy per write, named after the slug, the same every time", () => {
        const policies = compile(stateField);
        expect(policies.map(policy => ({ name: policy.name,
operation: policy.operation,
mode: policy.mode }))).toEqual([
            { name: "posts_review_pending_only_insert",
operation: "insert",
mode: "restrictive" },
            { name: "posts_review_pending_only_update",
operation: "update",
mode: "restrictive" }
        ]);
        expect(compile(stateField)).toEqual(policies);
    });

    it("holds the agent roles to the pending value and lets the server, admin and reviewers through", () => {
        const [insert, update] = compile(stateField);
        expect(insert.using).toBeNull();
        expect(insert.withCheck).toBe(
            "((SELECT rebase.uid() IS NULL)) OR ((SELECT string_to_array(rebase.roles(), ',') && ARRAY['admin','editor'])) " +
            "OR ((SELECT NOT (string_to_array(rebase.roles(), ',') && ARRAY['agent']))) OR (status = 'draft')"
        );
        expect(update.using).toBe(insert.withCheck);
        expect(update.withCheck).toBe(insert.withCheck);
    });

    it("holds every caller but the reviewers when no agent roles are named", () => {
        const [insert] = compile({ ...stateField,
agentRoles: undefined,
reviewerRoles: undefined });
        expect(insert.withCheck).not.toContain("NOT");
        expect(insert.withCheck).toContain("ARRAY['admin']");
    });

    it("writes a dashed slug as an identifier", () => {
        expect(reviewRls("blog-posts", stateField)[0].name).toBe("blog_posts_review_pending_only");
    });
});

describe("diffStagedChange", () => {
    it("lists an update's fields as changed or unchanged against the snapshot", () => {
        expect(diffStagedChange({
            operation: "update",
            before_data: { id: 1,
title: "Old",
total: 3,
note: "kept" },
            proposed_data: { title: "New",
total: 3,
extra: true }
        })).toEqual([
            { field: "title",
kind: "changed",
before: "Old",
after: "New" },
            { field: "total",
kind: "unchanged",
before: 3,
after: 3 },
            { field: "extra",
kind: "added",
before: undefined,
after: true }
        ]);
    });

    it("lists every proposed field of an insert as added, and every field of a deleted row as removed", () => {
        expect(diffStagedChange({ operation: "insert",
before_data: null,
proposed_data: { a: 1 } }))
            .toEqual([{ field: "a",
kind: "added",
before: undefined,
after: 1 }]);
        expect(diffStagedChange({ operation: "delete",
before_data: { a: 1 },
proposed_data: null }))
            .toEqual([{ field: "a",
kind: "removed",
before: 1,
after: undefined }]);
    });

    it("compares nested values by content", () => {
        expect(diffStagedChange({ operation: "update",
before_data: { tags: ["a"] },
proposed_data: { tags: ["a"] } })[0].kind).toBe("unchanged");
    });
});
