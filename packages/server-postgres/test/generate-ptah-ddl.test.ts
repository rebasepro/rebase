import type { LegacyCollectionConfig, LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";
import { generatePtahDdl, generatePtahManagedSelectors } from "../src/schema/generate-postgres-ddl-logic";
import { compileSet } from "./helpers/plan-tables";

const notes: LegacyPostgresCollectionConfig = {
    slug: "notes",
    table: "notes",
    name: "Notes",
    properties: {
        id: { name: "ID", type: "string", isId: "uuid" },
        title: { name: "Title", type: "string", validation: { required: true } },
        owner: { name: "Owner", type: "string" },
        embedding: { name: "Embedding", type: "vector", dimensions: 3, index: { method: "hnsw", distance: "cosine" } },
        updatedAt: { name: "Updated", type: "date", columnName: "updated_at", autoValue: "on_update" }
    },
    search: { fields: ["title"] },
    disableDefaultPolicies: true,
    securityRules: [{
        name: "owner_reads",
        operations: ["select"],
        using: "owner = current_setting('app.user_id', true)",
        pgRoles: ["public"]
    }]
};

describe("Ptah desired-state DDL", () => {
    it("renders declared tables, policies, search, vector and triggers together", () => {
        const desired = generatePtahDdl(compileSet([notes]), { extensions: ["vector"] });
        expect(desired).toContain("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA public;");
        expect(desired).toContain('"embedding" VECTOR(3)');
        expect(desired).toContain('"search_vector" tsvector GENERATED ALWAYS AS');
        expect(desired).toContain("USING hnsw");
        expect(desired).toContain("USING GIN");
        expect(desired).toContain("CREATE OR REPLACE FUNCTION rebase.set_updated_at()");
        expect(desired).toContain("CREATE TRIGGER \"notes_updated_at_touch\"");
        expect(desired).toContain("CREATE POLICY \"owner_reads\"");
        expect(desired).toContain("TO PUBLIC USING");
        expect(desired).toContain("COMMENT ON COLUMN \"public\".\"notes\".\"search_vector\"");
        expect(desired).toContain("CREATE OR REPLACE FUNCTION rebase.uid()");
        expect(desired).not.toMatch(/DROP (POLICY|TRIGGER|TABLE|INDEX)/);
        expect(desired).not.toContain("DO $");

    });

    it("declares an admin role before a policy that uses it", () => {
        const rule = notes.securityRules?.[0];
        if (!rule) throw new Error("The fixture has no security rule.");
        const adminNotes: LegacyPostgresCollectionConfig = {
            ...notes,
            securityRules: [{ ...rule, pgRoles: ["rebase_admin"] }]
        };
        const tables = compileSet([adminNotes]);
        const desired = generatePtahDdl(tables, { extensions: ["vector"] });
        expect(desired.indexOf("DO $rebase_admin_role$")).toBeLessThan(desired.indexOf("CREATE POLICY"));
        expect(generatePtahManagedSelectors(tables, { extensions: ["vector"] }))
            .toContain("rebase_admin[type=role]");
    });

    it("renders PUBLIC once when a rule also names another role", () => {
        const rule = notes.securityRules?.[0];
        if (!rule) throw new Error("The fixture has no security rule.");
        const mixed: LegacyPostgresCollectionConfig = {
            ...notes,
            securityRules: [{ ...rule, pgRoles: ["public", "reader"] }]
        };
        const desired = generatePtahDdl(compileSet([mixed]), { extensions: ["vector"] });
        expect(desired).toContain("TO PUBLIC USING");
        expect(desired).not.toContain("TO PUBLIC, ");
    });

    it("refuses vector SQL without an extension declaration", () => {
        expect(() => generatePtahDdl(compileSet([notes]))).toThrow("Declare the vector database extension");
    });

    it("selects the declared resources and leaves unrelated names outside the push", () => {
        const summary: LegacyCollectionConfig = {
            slug: "note_titles",
            table: "note_titles",
            name: "Note titles",
            view: { query: "SELECT id, title FROM public.notes" },
            properties: { id: { name: "ID", type: "string", isId: true } }
        };
        const tables = compileSet([notes, summary]);
        const desired = generatePtahDdl(tables, { extensions: ["vector"] });
        const selectors = generatePtahManagedSelectors(tables, { extensions: ["vector"] });
        expect(desired).toContain('CREATE VIEW "public"."note_titles"');
        expect(selectors).toEqual(expect.arrayContaining([
            "public.notes",
            "public.note_titles",
            "rebase.uid[type=function]",
            "public.rebase_search_text[type=function]",
            "rebase.set_updated_at[type=function]",
            "public.vector[type=extension]"
        ]));
        expect(selectors).not.toContain("*[type=function]");
        expect(selectors).not.toContain("*[type=extension]");
    });

    it("selects both parts of a materialized view", () => {
        const summary: LegacyCollectionConfig = {
            slug: "note_titles",
            table: "note_titles",
            name: "Note titles",
            view: { query: "SELECT id, title FROM public.notes", materialized: true },
            properties: { id: { name: "ID", type: "string", isId: true } }
        };
        const tables = compileSet([notes, summary]);
        const selectors = generatePtahManagedSelectors(tables, { extensions: ["vector"] });
        expect(selectors).toContain("public.note_titles");
        expect(selectors).toContain("public.note_titles_rebase_rows");
        expect(generatePtahDdl(tables, { extensions: ["vector"] }))
            .toContain('CREATE MATERIALIZED VIEW "public"."note_titles_rebase_rows"');
    });
});
