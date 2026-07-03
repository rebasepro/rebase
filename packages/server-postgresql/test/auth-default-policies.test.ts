import { SnapshotCollection, PostgresCollection } from "@rebasepro/types";
import { generatePostgresPoliciesDdl } from "../src/schema/generate-postgres-ddl-logic";
import { getEffectiveSecurityRules } from "../src/schema/auth-default-policies";

describe("auth collection default RLS policies", () => {
    const adminWrite = "string_to_array(auth.roles(), ',') && ARRAY['admin']";

    it("injects admin write policies (permissive grant + restrictive gate) when an auth collection has no security rules", () => {
        const collection: PostgresCollection = {
            slug: "users",
            table: "users",
            name: "Users",
            auth: true,
            properties: {
                id: { type: "string", isId: "uuid" },
                roles: { type: "array", columnType: "text[]", of: { type: "string" } }
            }
        };

        const ddl = generatePostgresPoliciesDdl([collection]);

        expect(ddl).toContain("FORCE ROW LEVEL SECURITY");
        // Restrictive gate exists for every write op.
        expect(ddl).toContain("AS RESTRICTIVE FOR INSERT");
        expect(ddl).toContain("AS RESTRICTIVE FOR UPDATE");
        expect(ddl).toContain("AS RESTRICTIVE FOR DELETE");
        expect(ddl).toContain(adminWrite);
    });

    it("keeps an author's permissive owner write rule but the restrictive gate still blocks non-admins", () => {
        const collection: PostgresCollection = {
            slug: "users",
            table: "users",
            name: "Users",
            auth: true,
            properties: {
                id: { type: "string", isId: "uuid" },
                roles: { type: "array", columnType: "text[]", of: { type: "string" } }
            },
            // The dangerous case: author lets users edit their own row.
            securityRules: [
                { name: "edit_own", operation: "update", ownerField: "id" }
            ]
        };

        const rules = getEffectiveSecurityRules(collection);
        const gate = rules.find(r => r.name === "users_require_admin_write");
        const grant = rules.find(r => r.name === "users_default_admin_write");

        // Author rule preserved.
        expect(rules.find(r => r.name === "edit_own")).toBeDefined();
        // Restrictive gate added covering all write ops.
        expect(gate).toBeDefined();
        expect(gate?.mode).toBe("restrictive");
        expect(gate?.operations).toEqual(["insert", "update", "delete"]);
        // Permissive grant added.
        expect(grant).toBeDefined();
        expect(grant?.mode).toBeUndefined();

        // The generated SQL AND's the restrictive gate, so a self-update by a
        // non-admin cannot pass — only admins/server can write.
        const ddl = generatePostgresPoliciesDdl([collection]);
        expect(ddl).toContain("AS RESTRICTIVE FOR UPDATE");
    });

    it("can be opted out with disableDefaultAuthPolicies", () => {
        const collection: PostgresCollection = {
            slug: "users",
            table: "users",
            name: "Users",
            auth: true,
            disableDefaultAuthPolicies: true,
            properties: { id: { type: "string", isId: "uuid" } }
        };

        expect(getEffectiveSecurityRules(collection)).toHaveLength(0);
    });

    it("leaves non-auth collections untouched", () => {
        const collection: SnapshotCollection = {
            slug: "products",
            table: "products",
            name: "Products",
            properties: { name: { type: "string" } }
        };

        expect(getEffectiveSecurityRules(collection)).toHaveLength(0);
    });
});
