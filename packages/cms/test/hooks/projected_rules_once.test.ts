/**
 * A table's collection carries its effective rules — what it declares plus
 * what Rebase injects into Postgres — because the panel reflects permissions
 * from them. The editors that list what Postgres holds add the injected rules
 * to a collection's own; for a projected table they must not add them again.
 */
import { describe, expect, it } from "@jest/globals";
import type { AdminCollection } from "@rebasepro/cms-types";
import { col, defineAuthTable, defineTable } from "@rebasepro/types";
import type { SecurityRule } from "@rebasepro/types";
import {
    compileTables,
    getEffectiveSecurityRules,
    getEffectiveSecurityRulesOnce,
    getGeneratedPolicyNames,
    getGeneratedPolicyNamesOnce
} from "@rebasepro/common";
import { composeCollections } from "../../src/hooks/navigation/compose_collections";
import { registeredCollection } from "../../src/hooks/navigation/registered_collection";

const users = defineAuthTable("users", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), email: col.text().notNull() },
    rls: "admin-only"
});
const posts = defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull(), orgId: col.uuid().notNull() },
    rls: [{ operation: "select", access: "authenticated" }],
    tenant: { field: "orgId", from: { claim: "org_id" } }
});
const notes = defineTable("notes", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), ownerId: col.uuid().notNull() },
    rls: [{ operations: ["all"], ownerField: "ownerId" }],
    defaultPolicies: false
});

const composed = composeCollections({
    tables: compileTables([users, posts, notes]),
    tableCustomizations: [],
    externalCollections: [],
    declared: []
});
const bySlug = (slug: string) => {
    const found = composed.find(collection => collection.slug === slug);
    if (!found) throw new Error(`no ${slug}`);
    return registeredCollection(found);
};

const names = (rules: SecurityRule[]) => rules.map(rule => rule.name ?? "(unnamed)");

describe("a projected table's rules, listed once", () => {
    it.each(["users", "posts", "notes"])("%s: nothing is injected twice", slug => {
        const collection = bySlug(slug);
        const once = getEffectiveSecurityRulesOnce(collection);
        expect(once).toEqual(collection.securityRules);
        expect(new Set(names(once)).size).toBe(once.length);
    });

    it("re-injecting the old way would have doubled them — which is what this guards against", () => {
        const collection = bySlug("posts");
        const twice = names(getEffectiveSecurityRules(collection));
        expect(twice.filter(name => name === "posts_default_admin_read")).toHaveLength(2);
        expect(getGeneratedPolicyNamesOnce(collection).size).toBeLessThan(twice.length);
    });

    it("a table without the admin baseline is not offered one", () => {
        const collection = bySlug("notes");
        expect(collection).toMatchObject({ disableDefaultPolicies: true });
        expect(names(getEffectiveSecurityRulesOnce(collection)).some(name => name.includes("default_admin"))).toBe(false);
    });
});

describe("a collection declared in code", () => {
    it("gets exactly what getEffectiveSecurityRules gives it", () => {
        const declared: AdminCollection = {
            slug: "orders",
            name: "Orders",
            table: "orders",
            properties: { total: { type: "number", name: "Total" } },
            securityRules: [{ operation: "select", roles: ["staff"] }]
        };
        expect(getEffectiveSecurityRulesOnce(declared)).toEqual(getEffectiveSecurityRules(declared));
        expect(getGeneratedPolicyNamesOnce(declared)).toEqual(getGeneratedPolicyNames(declared));
    });
});
