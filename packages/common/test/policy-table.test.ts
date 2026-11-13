import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable, policy, rel } from "@rebasepro/types";

import { compileTables } from "../src/schema/compile-tables";
import { claimCastOf, policyTableFromDescriptor, policyTableResolver } from "../src/util/policy/policy-table";
import { compilePolicyExpression } from "../src/util/policy/policyToPostgres";
import { compileTableRulePolicies } from "../src/util/policy/compileRulePolicies";
import { tableEffectiveRules } from "../src/util/auth-default-policies";
import { junctionPolicyTable, resolveTableJunctions, tableJunctionRules } from "../src/util/junction-policies";

/**
 * The policy compiler's view of a compiled table: what a rule's key
 * addresses, the claim cast it compares with, and the posture the injected
 * baseline follows — read from the descriptor alone.
 */

const orgs = defineTable("orgs", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text() },
    rls: "admin-only"
});

const tags = defineTable("tags", {
    columns: { id: col.serial().primaryKey(), label: col.text() },
    rls: "admin-only"
});

const posts = defineTable("posts", {
    schema: "content",
    columns: {
        id: col.integer().primaryKey().generatedByDefaultAsIdentity(),
        title: col.text("headline"),
        score: col.numeric(),
        views: col.bigint({ mode: "number" })
    },
    relations: {
        org: rel.belongsTo(() => orgs),
        tags: rel.manyToMany(() => tags)
    },
    tenant: { field: "org", from: { claim: "org_id" } },
    rls: [{ operation: "select", ownerField: "org" }],
    defaultPolicies: false
});

const users = defineAuthTable("users", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), email: col.text() },
    rls: "admin-only"
});

const descriptors = compileTables([orgs, tags, posts, users]);
const byName = (slug: string) => {
    const found = descriptors.find(d => d.slug === slug);
    if (!found) throw new Error(`no ${slug}`);
    return found;
};

describe("policyTableFromDescriptor", () => {
    it("addresses a column by key, a belongsTo by name, each with its claim cast", () => {
        const table = policyTableFromDescriptor(byName("posts"));
        expect(table.columns.title).toEqual({ column: "headline", claimCast: "text" });
        expect(table.columns.score).toEqual({ column: "score", claimCast: "numeric" });
        expect(table.columns.views).toEqual({ column: "views", claimCast: "bigint" });
        expect(table.links.org).toEqual({ column: "org_id", claimCast: "uuid" });
        expect(table).toMatchObject({ slug: "posts", table: "posts", schema: "content", idKey: "id", defaultPolicies: false, auth: false });
    });

    it("leaves an undeclared public schema unstated, and the baseline to the database", () => {
        const table = policyTableFromDescriptor(byName("orgs"));
        expect(table.schema).toBeUndefined();
        expect(table.defaultPolicies).toBeUndefined();
        expect(table.rules).toEqual([]);
    });

    it("casts a claim by the column's type", () => {
        expect(claimCastOf({ kind: "uuid" })).toBe("uuid");
        expect(claimCastOf({ kind: "numeric", precision: 10 })).toBe("numeric");
        expect(claimCastOf({ kind: "serial" })).toBe("bigint");
        expect(claimCastOf({ kind: "real" })).toBe("bigint");
        expect(claimCastOf({ kind: "enum", values: ["a"] })).toBe("text");
        expect(claimCastOf({ kind: "timestamptz" })).toBe("text");
    });
});

describe("compiling against a compiled table", () => {
    const resolveTable = policyTableResolver(descriptors);

    it("compares a link's foreign key, casting the claim to the key's type", () => {
        const table = policyTableFromDescriptor(byName("posts"));
        expect(compilePolicyExpression(policy.compare(policy.field("org"), "eq", policy.authClaim("org_id")), table))
            .toContain("org_id = (SELECT CASE WHEN NULLIF(rebase.jwt() ->> 'org_id', '')");
        expect(compilePolicyExpression(policy.compare(policy.field("title"), "eq", policy.literal("x")), table))
            .toBe("headline = 'x'");
    });

    it("joins an existsIn by the target's table and schema", () => {
        const table = policyTableFromDescriptor(byName("posts"));
        const sql = compilePolicyExpression(policy.existsIn({
            table: "orgs",
            where: policy.compare(policy.field("id"), "eq", policy.outerField("org"))
        }), table, { resolveTable });
        expect(sql).toBe("EXISTS (SELECT 1 FROM \"content\".\"orgs\" \"_ex0\" WHERE \"_ex0\".id = \"content\".\"posts\".org_id)");
    });

    it("injects the tenant gate but no baseline under defaultPolicies: false; the auth rules on the auth table", () => {
        expect(tableEffectiveRules(policyTableFromDescriptor(byName("posts"))).map(rule => rule.name))
            .toEqual([undefined, "posts_tenant_scope"]);
        expect(tableEffectiveRules(policyTableFromDescriptor(byName("users"))).map(rule => rule.name))
            .toEqual(["users_default_admin_read", "users_default_admin_write", "users_default_self_read", "users_require_admin_write"]);
    });

    it("refuses a shorthand naming no column, listing the keys it could name", () => {
        const table = policyTableFromDescriptor(byName("orgs"));
        expect(() => compileTableRulePolicies(table, { operation: "select", condition: { nam: "x" } }))
            .toThrow(/"orgs" names "nam" in its `condition`.*"id", "name"/);
    });
});

describe("junctions of compiled tables", () => {
    it("resolves posts_tags from its declaring side, and derives no rule when every side opted out", () => {
        const junctions = resolveTableJunctions(descriptors);
        const junction = junctions.get("posts_tags");
        if (!junction) throw new Error("posts_tags was not resolved");
        expect(junction.endpoints.map(end => [end.descriptor.slug, end.junctionColumn])).toEqual([["posts", "post_id"], ["tags", "tag_id"]]);
        expect(Object.keys(junctionPolicyTable(junction).columns)).toEqual(["post_id", "tag_id"]);
        // Its only declaring side, posts, switched the baseline off: the
        // junction is the author's to police, and gets no derived rule.
        expect(tableJunctionRules(junction)).toEqual([]);
    });

    // A view is a valid target — the junction keys into it with no foreign
    // key — but declares no junction of its own. Callers filtered views out
    // before resolving, and lost every junction into one: the planner refused
    // such a schema ("the junction table … was not resolved") and the doctor
    // did not know the junction was managed.
    it("resolves a junction into a view, and none declared by a view", () => {
        const asView = (slug: string) => {
            const found = descriptors.find(descriptor => descriptor.slug === slug);
            if (!found) throw new Error(`no descriptor "${slug}"`);
            return { ...found, kind: "view" as const };
        };
        const intoView = resolveTableJunctions(descriptors.map(d => (d.slug === "tags" ? asView("tags") : d))).get("posts_tags");
        expect(intoView?.endpoints.map(end => [end.descriptor.slug, end.descriptor.kind])).toEqual([["posts", "table"], ["tags", "view"]]);
        expect(resolveTableJunctions(descriptors.map(d => (d.slug === "posts" ? asView("posts") : d))).has("posts_tags")).toBe(false);
    });
});
