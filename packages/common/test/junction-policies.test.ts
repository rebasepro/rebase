import { describe, it, expect } from "@jest/globals";
import {
    resolveJunctionSpecs,
    getJunctionSecurityRules,
    getJunctionCollectionConfig,
    embedParentExpression
} from "../src/util/junction-policies";
import { policyToPostgres } from "../src/util/policy/policyToPostgres";
import { securityRuleToConditions } from "../src/util/policy/securityRuleToConditions";
import { getPolicyNamesForRules } from "@rebasepro/utils";
import { CollectionConfig, SecurityRule, policy } from "@rebasepro/types";

/** Build a minimal postgres collection with an m2m relation through a junction. */
function makeCollections(options?: {
    postsRules?: SecurityRule[];
    tagsDeclaresToo?: boolean;
    disableDefaults?: boolean;
}): { posts: CollectionConfig; tags: CollectionConfig } {
    const tags: CollectionConfig = {
        slug: "tags",
        name: "Tags",
        table: "tags",
        engine: "postgres",
        properties: { id: { type: "string", isId: "uuid" }, name: { type: "string" } }
    } as unknown as CollectionConfig;

    const posts: CollectionConfig = {
        slug: "posts",
        name: "Posts",
        table: "posts",
        engine: "postgres",
        disableDefaultPolicies: options?.disableDefaults,
        securityRules: options?.postsRules,
        properties: { id: { type: "string", isId: "uuid" }, title: { type: "string" }, author_id: { type: "string" } },
        relations: [{
            kind: "manyToMany",
            relationName: "tags",
            target: () => tags,
            through: { table: "posts_tags", sourceColumn: "post_id", targetColumn: "tag_id" }
        }]
    } as unknown as CollectionConfig;

    if (options?.tagsDeclaresToo) {
        (tags as unknown as { relations: unknown[] }).relations = [{
            kind: "manyToMany",
            relationName: "posts",
            target: () => posts,
            through: { table: "posts_tags", sourceColumn: "tag_id", targetColumn: "post_id" }
        }];
    }

    return { posts, tags };
}

/** Compile a derived rule's USING clause the way the DDL generator does. */
function compileUsing(rule: SecurityRule, junction: CollectionConfig, collections: CollectionConfig[]): string {
    const { usingExpr } = securityRuleToConditions(rule);
    expect(usingExpr).toBeTruthy();
    return policyToPostgres(usingExpr!, junction, {
        resolveCollection: (slug) => collections.find(c => c.slug === slug)
    });
}

describe("resolveJunctionSpecs", () => {
    it("finds the junction a relation declares, with its endpoints and columns", () => {
        const { posts, tags } = makeCollections();
        const specs = resolveJunctionSpecs([posts, tags]);

        expect([...specs.keys()]).toEqual(["posts_tags"]);
        const spec = specs.get("posts_tags")!;
        expect(spec.schema).toBe("public");
        expect(spec.endpoints[0].collection).toBe(posts);
        expect(spec.endpoints[0].junctionColumn).toBe("post_id");
        expect(spec.endpoints[1].collection).toBe(tags);
        expect(spec.endpoints[1].junctionColumn).toBe("tag_id");
        expect(spec.declaringSides).toHaveLength(1);
    });

    it("aggregates both declaring sides into one spec when both collections declare it", () => {
        const { posts, tags } = makeCollections({ tagsDeclaresToo: true });
        const specs = resolveJunctionSpecs([posts, tags]);

        expect(specs.size).toBe(1);
        expect(specs.get("posts_tags")!.declaringSides.map(s => s.collection.slug).sort())
            .toEqual(["posts", "tags"]);
    });
});

describe("getJunctionSecurityRules — baseline and read derivation", () => {
    it("always emits the locked server/admin baseline plus the endpoint-visibility read", () => {
        const { posts, tags } = makeCollections();
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;

        const rules = getJunctionSecurityRules(spec);
        const names = rules.map(r => r.name);

        expect(names).toContain("posts_tags_default_admin_read");
        expect(names).toContain("posts_tags_default_admin_write");
        expect(names).toContain("posts_tags_default_edge_read");
    });

    it("compiles the read rule to one EXISTS per endpoint, correlated on the FK columns", () => {
        const { posts, tags } = makeCollections();
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;
        const junction = getJunctionCollectionConfig(spec);

        const read = getJunctionSecurityRules(spec).find(r => r.name === "posts_tags_default_edge_read")!;
        const sql = compileUsing(read, junction, [posts, tags]);

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
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;

        const rules = getJunctionSecurityRules(spec);
        const names = getPolicyNamesForRules(rules, "posts_tags");

        expect(names.has("posts_tags_default_admin_read")).toBe(true);
        // Multi-op named rules get the operation suffix, like collections do.
        expect(names.has("posts_tags_default_admin_write_insert")).toBe(true);
        expect(names.has("posts_tags_default_admin_write_delete")).toBe(true);
        expect(names.has("posts_tags_default_edge_read")).toBe(true);
    });

    it("returns nothing when every declaring side opted out of default policies", () => {
        const { posts, tags } = makeCollections({ disableDefaults: true });
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;

        expect(getJunctionSecurityRules(spec)).toEqual([]);
    });
});

describe("getJunctionSecurityRules — write inheritance", () => {
    it("derives no write grant when the declaring side has no explicit update rules", () => {
        const { posts, tags } = makeCollections();
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;

        const names = getJunctionSecurityRules(spec).map(r => r.name);
        expect(names).not.toContain("posts_tags_default_edge_write");
    });

    it("inherits an ownerField update rule: tagging a post follows editing the post", () => {
        const { posts, tags } = makeCollections({
            postsRules: [{ operation: "update", ownerField: "author_id" }]
        });
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;
        const junction = getJunctionCollectionConfig(spec);

        const write = getJunctionSecurityRules(spec).find(r => r.name === "posts_tags_default_edge_write")!;
        expect(write.operations).toEqual(["insert", "update", "delete"]);

        const sql = compileUsing(write, junction, [posts, tags]);
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
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;

        const names = getJunctionSecurityRules(spec).map(r => r.name);
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
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;

        const names = getJunctionSecurityRules(spec).map(r => r.name);
        expect(names).not.toContain("posts_tags_default_edge_write");
    });

    it("inherits raw SQL that does round-trip, embedded in the parent EXISTS", () => {
        // The other half of the invariant: a grant exists only when the parent's
        // own condition travels with it.
        const { posts, tags } = makeCollections({
            postsRules: [{ operation: "update", using: "author_id = rebase.uid()" }]
        });
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;
        const junction = getJunctionCollectionConfig(spec);

        const write = getJunctionSecurityRules(spec).find(r => r.name === "posts_tags_default_edge_write");
        expect(write).toBeDefined();
        const sql = compileUsing(write!, junction, [posts, tags]);
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
                        collection: "team_members",
                        where: policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id"))
                    })
                }
            ]
        });
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;

        const names = getJunctionSecurityRules(spec).map(r => r.name);
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
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;
        const junction = getJunctionCollectionConfig(spec);

        const write = getJunctionSecurityRules(spec).find(r => r.name === "posts_tags_default_edge_write")!;
        const sql = compileUsing(write, junction, [posts, tags]);

        expect(sql).toContain("author_id");
        // The restrictive roles gate travels with the grant.
        expect(sql).toContain("editor");
    });

    it("ORs write grants when both sides declare the junction", () => {
        const { posts, tags } = makeCollections({
            postsRules: [{ operation: "update", ownerField: "author_id" }],
            tagsDeclaresToo: true
        });
        (tags as unknown as { securityRules: SecurityRule[] }).securityRules =
            [{ operation: "update", roles: ["taxonomist"] }];
        const spec = resolveJunctionSpecs([posts, tags]).get("posts_tags")!;
        const junction = getJunctionCollectionConfig(spec);

        const write = getJunctionSecurityRules(spec).find(r => r.name === "posts_tags_default_edge_write")!;
        const sql = compileUsing(write, junction, [posts, tags]);

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
            collection: "team_members",
            where: policy.compare(policy.field("team_id"), "eq", policy.outerField("team_id"))
        });
        expect(embedParentExpression(expr)).toBeNull();
    });

    it("keeps a nested existsIn that does not reach outward", () => {
        const expr = policy.existsIn({
            collection: "team_members",
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
