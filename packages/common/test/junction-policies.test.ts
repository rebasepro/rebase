import { describe, it, expect } from "@jest/globals";
import {
    embedParentExpression,
    junctionPolicyTable,
    resolveTableJunctions,
    tableJunctionRules,
    type TableJunction
} from "../src/util/junction-policies";
import { compilePolicyExpression } from "../src/util/policy/policyToPostgres";
import { policyTableResolver } from "../src/util/policy/policy-table";
import { securityRuleToConditions } from "../src/util/policy/securityRuleToConditions";
import { compileTables } from "../src/schema/compile-tables";
import { collectionsToTableDefs, type LegacyPostgresCollectionConfig } from "../src/migrate";
import { getPolicyNamesForRules } from "@rebasepro/utils";
import { SecurityRule, TableDescriptor, policy } from "@rebasepro/types";

/** Build a minimal postgres collection with an m2m relation through a junction. */
function makeCollections(options?: {
    postsRules?: SecurityRule[];
    tagsDeclaresToo?: boolean;
    disableDefaults?: boolean;
}): { posts: LegacyPostgresCollectionConfig; tags: LegacyPostgresCollectionConfig } {
    const tags: LegacyPostgresCollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        engine: "postgres",
        properties: { id: { type: "string", isId: "uuid" }, name: { type: "string" } }
    };

    const posts: LegacyPostgresCollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        engine: "postgres",
        disableDefaultPolicies: options?.disableDefaults,
        securityRules: options?.postsRules,
        properties: { id: { type: "string", isId: "uuid" }, title: { type: "string" }, author_id: { type: "string" }, team_id: { type: "string" } },
        relations: [{
            kind: "manyToMany",
            relationName: "tags",
            target: () => tags,
            through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
        }]
    };

    if (options?.tagsDeclaresToo) {
        tags.relations = [{
            kind: "manyToMany",
            relationName: "posts",
            target: () => posts,
            through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" }
        }];
    }

    return { posts, tags };
}

/** The descriptors each junction was resolved from, for {@link compileUsing}. */
const describedBy = new WeakMap<TableJunction, TableDescriptor[]>();

/** Lift and compile the collections, then resolve their junctions — what the planner reads. */
function junctionsOf(collections: LegacyPostgresCollectionConfig[]): Map<string, TableJunction> {
    const descriptors = compileTables(collectionsToTableDefs(collections).tables);
    const junctions = resolveTableJunctions(descriptors);
    for (const junction of junctions.values()) describedBy.set(junction, descriptors);
    return junctions;
}

/** Compile a derived rule's USING clause the way the DDL generator does. */
function compileUsing(rule: SecurityRule, junction: TableJunction): string {
    const { usingExpr } = securityRuleToConditions(rule);
    expect(usingExpr).toBeTruthy();
    return compilePolicyExpression(usingExpr!, junctionPolicyTable(junction), {
        resolveTable: policyTableResolver(describedBy.get(junction) ?? [])
    });
}

describe("resolveJunctionSpecs", () => {
    it("finds the junction a relation declares, with its endpoints and columns", () => {
        const { posts, tags } = makeCollections();
        const specs = junctionsOf([posts, tags]);

        expect([...specs.keys()]).toEqual(["posts_tags"]);
        const spec = specs.get("posts_tags")!;
        expect(spec.schema).toBe("public");
        expect(spec.endpoints[0].descriptor.slug).toBe("posts");
        expect(spec.endpoints[0].junctionColumn).toBe("post_id");
        expect(spec.endpoints[1].descriptor.slug).toBe("tags");
        expect(spec.endpoints[1].junctionColumn).toBe("tag_id");
        expect(spec.declaringSides).toHaveLength(1);
    });

    it("aggregates both declaring sides into one spec when both collections declare it", () => {
        const { posts, tags } = makeCollections({ tagsDeclaresToo: true });
        const specs = junctionsOf([posts, tags]);

        expect(specs.size).toBe(1);
        expect(specs.get("posts_tags")!.declaringSides.map(s => s.descriptor.slug).sort())
            .toEqual(["posts", "tags"]);
    });
});

describe("tableJunctionRules — baseline and read derivation", () => {
    it("always emits the locked server/admin baseline plus the endpoint-visibility read", () => {
        const { posts, tags } = makeCollections();
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const rules = tableJunctionRules(spec);
        const names = rules.map(r => r.name);

        expect(names).toContain("posts_tags_default_admin_read");
        expect(names).toContain("posts_tags_default_admin_write");
        expect(names).toContain("posts_tags_default_edge_read");
    });

    it("compiles the read rule to one EXISTS per endpoint, correlated on the FK columns", () => {
        const { posts, tags } = makeCollections();
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const read = tableJunctionRules(spec).find(r => r.name === "posts_tags_default_edge_read")!;
        const sql = compileUsing(read, spec);

        // Visibility delegates to the endpoints: plain subqueries over the real
        // tables, so each endpoint's own RLS filters them at query time.
        expect(sql).toContain(`EXISTS (SELECT 1 FROM "public"."posts"`);
        expect(sql).toContain(`EXISTS (SELECT 1 FROM "public"."tags"`);
        expect(sql).toContain(`"public"."posts_tags".post_id`);
        expect(sql).toContain(`"public"."posts_tags".tag_id`);
        // No duplicated endpoint policy fragments — delegation, not copying.
        expect(sql).not.toContain("auth.roles");
    });

    it("emits generated names the studio mapping machinery recognises", () => {
        const { posts, tags } = makeCollections();
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const rules = tableJunctionRules(spec);
        const names = getPolicyNamesForRules(rules, "posts_tags");

        expect(names.has("posts_tags_default_admin_read")).toBe(true);
        // Multi-op named rules get the operation suffix, like collections do.
        expect(names.has("posts_tags_default_admin_write_insert")).toBe(true);
        expect(names.has("posts_tags_default_admin_write_delete")).toBe(true);
        expect(names.has("posts_tags_default_edge_read")).toBe(true);
    });

    it("returns nothing when every declaring side opted out of default policies", () => {
        // The table model refuses a table with no rules and no baseline (deny-all), so
        // the opted-out side states a rule that grants no edge write.
        const { posts, tags } = makeCollections({ disableDefaults: true, postsRules: [{ operation: "select", access: "public" }] });
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        expect(tableJunctionRules(spec)).toEqual([]);
    });
});

describe("tableJunctionRules — write inheritance", () => {
    it("derives no write grant when the declaring side has no explicit update rules", () => {
        const { posts, tags } = makeCollections();
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const names = tableJunctionRules(spec).map(r => r.name);
        expect(names).not.toContain("posts_tags_default_edge_write");
    });

    it("inherits an ownerField update rule: tagging a post follows editing the post", () => {
        const { posts, tags } = makeCollections({
            postsRules: [{ operation: "update", ownerField: "author_id" }]
        });
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const write = tableJunctionRules(spec).find(r => r.name === "posts_tags_default_edge_write")!;
        expect(write.operations).toEqual(["insert", "update", "delete"]);

        const sql = compileUsing(write, spec);
        // The grant is an EXISTS against the owning row…
        expect(sql).toContain(`EXISTS (SELECT 1 FROM "public"."posts"`);
        // …correlated to the edge…
        expect(sql).toContain(`"public"."posts_tags".post_id`);
        // …and constrained by the author's own update condition, rebound to the
        // parent inside the subquery.
        expect(sql).toContain("rebase.uid()");
        expect(sql).toContain("author_id");
    });

    it("covers rules declared with operation 'all'", () => {
        const { posts, tags } = makeCollections({
            postsRules: [{ operation: "all", ownerField: "author_id" }]
        });
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const names = tableJunctionRules(spec).map(r => r.name);
        expect(names).toContain("posts_tags_default_edge_write");
    });

    it("refuses to inherit raw SQL that does not round-trip: the failure mode is locked, never open", () => {
        // `is_shared` is a bare boolean column reference that the SQL parser does
        // not turn into the structured model, so the rule stays `raw` and cannot
        // be re-scoped into the junction's EXISTS. Nothing may be granted.
        //
        // The assertion used to sit inside `if (write)` — the branch that does
        // not run — so a regression that started granting an *unconstrained*
        // edge write here would have passed too.
        const { posts, tags } = makeCollections({
            postsRules: [{ operation: "update", using: "author_id = rebase.uid() OR is_shared" }]
        });
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const names = tableJunctionRules(spec).map(r => r.name);
        expect(names).not.toContain("posts_tags_default_edge_write");
    });

    it("inherits raw SQL that does round-trip, embedded in the parent EXISTS", () => {
        // The other half of the invariant: a grant exists only when the parent's
        // own condition travels with it.
        const { posts, tags } = makeCollections({
            postsRules: [{ operation: "update", using: "author_id = rebase.uid()" }]
        });
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const write = tableJunctionRules(spec).find(r => r.name === "posts_tags_default_edge_write");
        expect(write).toBeDefined();
        const sql = compileUsing(write!, spec);
        expect(sql).toContain(`EXISTS (SELECT 1 FROM "public"."posts"`);
        expect(sql).toContain(`"public"."posts_tags".post_id`);
        expect(sql).toContain("author_id");
        expect(sql).toContain("rebase.uid()");
    });

    it("suppresses a side's whole grant when a restrictive update rule cannot be embedded", () => {
        const { posts, tags } = makeCollections({
            postsRules: [
                { operation: "update", ownerField: "author_id" },
                {
                    operation: "update",
                    mode: "restrictive",
                    // A nested existsIn correlating via outerField cannot be
                    // re-scoped into the junction's EXISTS.
                    condition: policy.existsIn({
                        table: "team_members",
                        where: policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id"))
                    })
                }
            ]
        });
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const names = tableJunctionRules(spec).map(r => r.name);
        // Granting writes while dropping the author's gate would be looser than
        // the parent itself — so nothing is granted.
        expect(names).not.toContain("posts_tags_default_edge_write");
    });

    it("ANDs embeddable restrictive gates into the inherited grant", () => {
        const { posts, tags } = makeCollections({
            postsRules: [
                { operation: "update", ownerField: "author_id" },
                { operation: "update", mode: "restrictive", roles: ["editor"] }
            ]
        });
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const write = tableJunctionRules(spec).find(r => r.name === "posts_tags_default_edge_write")!;
        const sql = compileUsing(write, spec);

        expect(sql).toContain("author_id");
        // The restrictive roles gate travels with the grant.
        expect(sql).toContain("editor");
    });

    it("ORs write grants when both sides declare the junction", () => {
        const { posts, tags } = makeCollections({
            postsRules: [{ operation: "update", ownerField: "author_id" }],
            tagsDeclaresToo: true
        });
        tags.securityRules =
            [{ operation: "update", roles: ["taxonomist"] }];
        const spec = junctionsOf([posts, tags]).get("posts_tags")!;

        const write = tableJunctionRules(spec).find(r => r.name === "posts_tags_default_edge_write")!;
        const sql = compileUsing(write, spec);

        expect(sql).toContain(`EXISTS (SELECT 1 FROM "public"."posts"`);
        expect(sql).toContain(`EXISTS (SELECT 1 FROM "public"."tags"`);
        expect(sql).toContain("taxonomist");
    });
});

describe("embedParentExpression", () => {
    it("rewrites a top-level outerField to field (they are synonyms outside a subquery)", () => {
        const embedded = embedParentExpression(
            policy.compare(policy.outerField("author_id"), "eq", policy.authUid())
        );
        expect(embedded).toEqual(
            policy.compare(policy.field("author_id"), "eq", policy.authUid())
        );
    });

    it("rejects raw SQL at any depth", () => {
        expect(embedParentExpression(policy.raw("{author_id} = rebase.uid()"))).toBeNull();
        expect(embedParentExpression(
            policy.and(policy.true(), policy.raw("1=1"))
        )).toBeNull();
    });

    it("rejects an outerField inside a nested existsIn (no operand can express the middle scope)", () => {
        const expr = policy.existsIn({
            table: "team_members",
            where: policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id"))
        });
        expect(embedParentExpression(expr)).toBeNull();
    });

    it("keeps a nested existsIn that does not reach outward", () => {
        const expr = policy.existsIn({
            table: "team_members",
            where: policy.compare(policy.field("user_id"), "eq", policy.authUid())
        });
        expect(embedParentExpression(expr)).toEqual(expr);
    });

    it("passes position-independent leaves through unchanged", () => {
        for (const expr of [policy.true(), policy.serverContext(), policy.rolesOverlap(["admin"])]) {
            expect(embedParentExpression(expr)).toEqual(expr);
        }
    });
});
