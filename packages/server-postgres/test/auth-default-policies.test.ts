import { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import { generatePostgresPoliciesDdl } from "../src/schema/generate-postgres-ddl-logic";
import { getEffectiveSecurityRules } from "@rebasepro/common";

describe("auth collection default RLS policies", () => {
    const adminWrite = "string_to_array(rebase.roles(), ',') && ARRAY['admin']";

    it("injects admin write policies (permissive grant + restrictive gate) when an auth collection has no security rules", () => {
        const collection: PostgresCollectionConfig = {
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

        // No FORCE: user requests run as the non-owner rebase_user role, which
        // plain ENABLE binds; the owner is the trusted server context.
        expect(ddl).toContain("ENABLE ROW LEVEL SECURITY");
        expect(ddl).not.toContain("FORCE ROW LEVEL SECURITY");
        // Restrictive gate exists for every write op.
        expect(ddl).toContain("AS RESTRICTIVE FOR INSERT");
        expect(ddl).toContain("AS RESTRICTIVE FOR UPDATE");
        expect(ddl).toContain("AS RESTRICTIVE FOR DELETE");
        expect(ddl).toContain(adminWrite);
    });

    it("keeps an author's permissive owner write rule but the restrictive gate still blocks non-admins", () => {
        const collection: PostgresCollectionConfig = {
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

    it("injects a self-read policy on auth collections (id = rebase.uid())", () => {
        const collection: PostgresCollectionConfig = {
            slug: "users",
            table: "users",
            name: "Users",
            auth: true,
            properties: { id: { type: "string", isId: "uuid" } }
        };

        const selfRead = getEffectiveSecurityRules(collection).find(r => r.name === "users_default_self_read");
        expect(selfRead).toBeDefined();
        expect(selfRead?.operations).toEqual(["select"]);

        // uuid id column must compare against text rebase.uid() via a cast.
        const ddl = generatePostgresPoliciesDdl([collection]);
        expect(ddl).toContain("(id)::text = rebase.uid()");
    });

    it("can be opted out with disableDefaultPolicies", () => {
        const collection: PostgresCollectionConfig = {
            slug: "users",
            table: "users",
            name: "Users",
            auth: true,
            disableDefaultPolicies: true,
            properties: { id: { type: "string", isId: "uuid" } }
        };

        expect(getEffectiveSecurityRules(collection)).toHaveLength(0);
    });

    it("locks non-auth collections by default: server-or-admin read + write baselines", () => {
        const collection: CollectionConfig = {
            slug: "products",
            table: "products",
            name: "Products",
            properties: { name: { type: "string" } }
        };

        // User requests run under the restricted rebase_user role, so RLS
        // default-denies. Without these baselines a rule-less collection would
        // be locked to everyone including the admin studio. Both are permissive
        // (mode undefined) so author rules broaden access from here.
        const rules = getEffectiveSecurityRules(collection);
        expect(rules).toHaveLength(2);

        const read = rules.find(r => r.name === "products_default_admin_read");
        expect(read?.operations).toEqual(["select"]);
        expect(read?.mode).toBeUndefined();

        const write = rules.find(r => r.name === "products_default_admin_write");
        expect(write?.operations).toEqual(["insert", "update", "delete"]);
        expect(write?.mode).toBeUndefined();

        // Locked by default: only the server context / admins pass.
        const ddl = generatePostgresPoliciesDdl([collection]);
        expect(ddl).not.toContain("FORCE ROW LEVEL SECURITY");
        expect(ddl).toContain("ENABLE ROW LEVEL SECURITY");
        expect(ddl).toContain("FOR INSERT");
        expect(ddl).toContain(adminWrite);
    });
});
