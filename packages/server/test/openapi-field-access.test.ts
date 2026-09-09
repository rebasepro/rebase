import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";

/**
 * What `/api/docs` says about a field with an `access` block.
 *
 * The document is one document, served off the app rather than off the
 * authenticated data router, so it cannot be per-caller — and it should not
 * pretend to be. It states the rule instead: the role lists in a vendor
 * extension a gateway can read, and a sentence for the human looking at the
 * Explorer. Field *names* are public; field *values* are not, and that is the
 * same decision the query refusal makes when it names a field it will not
 * filter on.
 *
 * The two directions are separate schemas and were sharing one exclusion set,
 * which got both wrong for a write-only field.
 */

const staff = {
    slug: "staff",
    name: "Staff",
    singularName: "Member",
    table: "staff",
    properties: {
        id: { name: "ID", type: "number", isId: "serial", columnType: "serial" },
        name: { name: "Name", type: "string" },
        salary: { name: "Salary", type: "number", access: { read: ["hr"], write: ["hr"] } },
        // Set by the server, read by anyone.
        rating: { name: "Rating", type: "number", access: { write: [] } },
        // Written through the API by an admin, never served back.
        importToken: { name: "Import Token", type: "string", access: { read: [] } },
        secret: { name: "Secret", type: "string", excludeFromApi: true }
    }
} as unknown as CollectionConfig;

const spec = generateOpenApiSpec([staff], {}) as {
    components: { schemas: Record<string, { properties: Record<string, Record<string, unknown>> }> };
    paths: Record<string, { get?: { parameters?: Array<{ name: string }> } }>;
};

const readSchema = spec.components.schemas.Member.properties;
const inputSchema = spec.components.schemas.MemberInput.properties;

describe("the read schema", () => {
    it("carries a role-restricted field, annotated", () => {
        expect(readSchema.salary).toMatchObject({
            type: "number",
            "x-rebase-access": { read: ["hr"], write: ["hr"] }
        });
    });

    it("explains the rule in the description a reader of /docs sees", () => {
        expect(readSchema.salary.description).toContain("readable by `hr` (and `admin`)");
        expect(readSchema.salary.description).toContain("absent, not null");
    });

    it("keeps the property's own name in front of that sentence", () => {
        expect(readSchema.salary.description).toMatch(/^Salary — /);
    });

    it("omits a field nobody can read", () => {
        expect(readSchema).not.toHaveProperty("importToken");
    });

    it("omits an `excludeFromApi` field, as it always did", () => {
        expect(readSchema).not.toHaveProperty("secret");
    });

    it("carries a write-only-restricted field, since reading it is unrestricted", () => {
        expect(readSchema.rating).toMatchObject({ "x-rebase-access": { write: [] } });
    });

    it("leaves a field with no rule unannotated", () => {
        expect(readSchema.name).not.toHaveProperty("x-rebase-access");
    });
});

describe("the input schema", () => {
    it("omits a field nobody can write", () => {
        expect(inputSchema).not.toHaveProperty("rating");
    });

    it("carries a field that is writable but not readable", () => {
        // The two halves are separate questions and used to share one answer:
        // a token an admin posts and never reads back belongs in the body and
        // not in the row.
        expect(inputSchema).toHaveProperty("importToken");
    });

    it("carries a role-restricted one, since some callers may write it", () => {
        expect(inputSchema).toHaveProperty("salary");
    });
});

describe("the filter parameters", () => {
    it("do not offer a field nobody can read", () => {
        const params = spec.paths["/data/staff"].get?.parameters ?? [];
        expect(params.map(p => p.name)).not.toContain("importToken");
    });

    it("still offer a role-restricted one — the refusal is per caller, the document is not", () => {
        const params = spec.paths["/data/staff"].get?.parameters ?? [];
        expect(params.map(p => p.name)).toContain("salary");
    });
});
