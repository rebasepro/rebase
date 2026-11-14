import type { LegacyPostgresCollectionConfig } from "@rebasepro/common/migrate";
import { generatePostgresDdl, generatePostgresPoliciesDdl, generatePtahDdl } from "../src/schema/generate-postgres-ddl-logic";
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
    it("includes declarations that the Atlas file keeps in sidecars", () => {
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
        expect(desired).not.toMatch(/DROP (POLICY|TRIGGER|TABLE|INDEX)/);
        expect(desired).not.toContain("DO $");

        const atlas = generatePostgresDdl(compileSet([notes]), {
            includePolicies: false,
            includeSearch: false,
            includeVector: false
        });
        expect(atlas).not.toContain("CREATE POLICY");
        expect(atlas).not.toContain("USING hnsw");
        expect(atlas).not.toContain("CREATE TRIGGER");
        expect(generatePostgresPoliciesDdl(compileSet([notes]))).toContain("TO PUBLIC USING");
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
});
