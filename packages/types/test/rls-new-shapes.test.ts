/**
 * The `rls` forms of the Postgres-first spec, as types.
 *
 * The runtime assertions are trivially true; the content is the compilation:
 * the spec's §4.1 `rls` block must type-check as `RlsPosture` inside
 * `defineTable`, and every combination the `never`-based exclusivity forbade
 * must still be refused — each `@ts-expect-error` below fails `pnpm typecheck`
 * the day the line under it starts compiling.
 */
import {
    col,
    defineTable,
    isPolicyShorthand,
    policy,
    type PolicyCondition,
    type PolicyShorthand,
    type RlsPosture,
    type SecurityRule
} from "../src";

describe("rls: the spec's example", () => {
    it("type-checks the §4.1 rls block as RlsPosture inside defineTable", () => {
        const rls: RlsPosture = [
            { operation: "select", access: "public", condition: { status: "published" } },
            { operations: ["select", "insert", "update"], roles: ["editor"] },
            { operation: "delete", roles: ["admin"] }
        ];
        const posts = defineTable("posts", {
            columns: {
                id: col.uuid().primaryKey().defaultRandom(),
                status: col.enum(["draft", "needs_review", "published", "archived"]).notNull().default("draft")
            },
            rls: [
                { operation: "select", access: "public", condition: { status: "published" } },
                { operations: ["select", "insert", "update"], roles: ["editor"] },
                { operation: "delete", roles: ["admin"] }
            ]
        });
        expect(posts.config.rls).toEqual(rls);
    });

    it("accepts the other new combinations", () => {
        const rules: SecurityRule[] = [
            { operation: "update", access: "authenticated", condition: { status: "draft" }, check: { deletedAt: null } },
            { operation: "insert", access: "authenticated", check: { state: "open" } },
            { operation: "select", access: "public", condition: policy.compare(policy.field("rank"), "gt", policy.literal(0)) },
            { operation: "select", condition: { orgId: "acme", deletedAt: null, featured: true, rank: 2 } },
            { operation: "update", condition: policy.authenticated(), check: { status: "draft" } },
            { operation: "select", access: "authenticated" },
            { operations: ["insert", "update"], access: "authenticated", roles: ["member"] }
        ];
        expect(rules).toHaveLength(7);
    });
});

describe("rls: what stays illegal", () => {
    it("refuses the combinations the exclusivity forbids", () => {
        const refused: SecurityRule[] = [
            // @ts-expect-error — `ownerField` and `access` cannot be combined
            { operation: "select", ownerField: "userId", access: "public" },
            // @ts-expect-error — raw SQL and a structured condition cannot be combined
            { operation: "select", using: "true", condition: { status: "published" } },
            // @ts-expect-error — `access` and raw SQL cannot be combined
            { operation: "select", access: "public", withCheck: "true" },
            // @ts-expect-error — `ownerField` and a structured condition cannot be combined
            { operation: "select", ownerField: "userId", condition: { status: "published" } },
            // @ts-expect-error — `access: "authenticated"` and raw SQL cannot be combined
            { operation: "select", access: "authenticated", using: "true" },
            // @ts-expect-error — `access` admits "public" and "authenticated" only
            { operation: "select", access: "anyone", condition: { status: "published" } }
        ];
        expect(refused).toHaveLength(6);
    });

    it("refuses a shorthand that is not column → literal, or that names `kind`", () => {
        // @ts-expect-error — `kind` is the expression discriminator; a shorthand cannot name it
        const kind: PolicyShorthand = { kind: "published" };
        // @ts-expect-error — shorthand values are literals, not nested objects
        const nested: PolicyCondition = { status: { eq: "published" } };
        // @ts-expect-error — shorthand values are literals, not arrays
        const list: PolicyShorthand = { tags: ["a", "b"] };
        expect([kind, nested, list].map(isPolicyShorthand)).toEqual([false, false, false]);
    });
});
