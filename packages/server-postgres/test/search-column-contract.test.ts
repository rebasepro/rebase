/**
 * The generators must describe the search column identically.
 *
 * Four things build a Postgres table here — the DDL generator, the Drizzle
 * schema generator, the boot-time ensure, and (for introspected databases) the
 * runtime table builder. They have drifted before: the `varchar(255)` comment in
 * `generate-postgres-ddl-logic` records the same property producing a capped
 * column down one path and an uncapped one down the other, with nothing failing
 * until a user hit the cap.
 *
 * A shared spec module makes agreement the default. This test is what makes it
 * a guarantee, and what will notice if someone later re-derives the expression
 * in one place "just for this case".
 */
import { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import { generatePostgresDdl, getSqlColumnType } from "../src/schema/generate-postgres-ddl-logic";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { planCollectionSchemaEnsure } from "../src/schema/ensure-collection-tables";
import { buildSearchColumnSpec } from "../src/schema/search-column";

const collection: PostgresCollectionConfig = {
    slug: "talents",
    table: "talents",
    name: "Talents",
    properties: {
        id: { type: "string", isId: "uuid" },
        full_name: { type: "string" },
        interests: { type: "array", of: { type: "string" } },
        questionnaire: { type: "map", properties: {} }
    },
    search: {
        language: "spanish",
        unaccent: true,
        fields: [
            { path: "full_name", weight: "A" },
            "interests",
            "questionnaire.certifications"
        ]
    }
};

const collections: CollectionConfig[] = [collection];
const spec = buildSearchColumnSpec(collection)!;

const emptySchema = { tables: new Map<string, Set<string>>(), enums: new Set<string>(), constraints: new Set<string>() };

describe("every generator renders the same search column", () => {
    it("the spec is the thing they all agree on", () => {
        expect(spec.column).toBe("search_vector");
        expect(spec.fields).toHaveLength(3);
    });

    it("the DDL generator emits the spec's expression verbatim", async () => {
        const ddl = await generatePostgresDdl(collections, { includePolicies: false });
        expect(ddl).toContain(`"search_vector" tsvector GENERATED ALWAYS AS (${spec.expression}) STORED`);
    });

    it("the Drizzle schema generator emits the spec's expression verbatim", async () => {
        const schema = await generateSchema(collections);
        expect(schema).toContain(spec.expression);
        expect(schema).toContain(`customType({ dataType() { return 'tsvector'; } })("search_vector")`);
        expect(schema).toContain("generatedAlwaysAs");
    });

    it("the boot-time ensure adds the same column definition", () => {
        const plan = planCollectionSchemaEnsure(collections, emptySchema);
        const addSearch = plan.actions.find(a => a.kind === "add-column" && a.target.endsWith("search_vector"));
        expect(addSearch).toBeDefined();
        expect(addSearch!.sql).toContain(`tsvector GENERATED ALWAYS AS (${spec.expression}) STORED`);
    });

    it("the DDL generator and the ensure agree on the index", async () => {
        const ddl = await generatePostgresDdl(collections, { includePolicies: false });
        const plan = planCollectionSchemaEnsure(collections, emptySchema);
        const index = plan.actions.find(a => a.kind === "create-index");

        expect(ddl).toContain(`USING GIN ("search_vector")`);
        expect(index!.sql).toContain(`USING GIN ("search_vector")`);
        expect(ddl).toContain(spec.indexName);
        expect(index!.sql).toContain(spec.indexName);
    });
});

describe("the helper functions exist before anything that calls them", () => {
    it("the DDL declares them above the first CREATE TABLE", async () => {
        const ddl = await generatePostgresDdl(collections, { includePolicies: false });
        const fnAt = ddl.indexOf("CREATE OR REPLACE FUNCTION public.rebase_search_text(text[])");
        const tableAt = ddl.indexOf("CREATE TABLE");
        expect(fnAt).toBeGreaterThan(-1);
        expect(fnAt).toBeLessThan(tableAt);
    });

    it("the DDL creates the unaccent extension above the function that uses it", async () => {
        const ddl = await generatePostgresDdl(collections, { includePolicies: false });
        expect(ddl.indexOf("CREATE EXTENSION IF NOT EXISTS unaccent"))
            .toBeLessThan(ddl.indexOf("rebase_search_unaccent"));
    });

    it("the ensure plans them before the column that calls them", () => {
        const kinds = planCollectionSchemaEnsure(collections, emptySchema).actions.map(a => a.kind);
        const lastFunction = kinds.lastIndexOf("create-function");
        const firstColumn = kinds.indexOf("add-column");
        expect(lastFunction).toBeGreaterThan(-1);
        expect(lastFunction).toBeLessThan(firstColumn);
    });

    it("the ensure plans the extension before the functions", () => {
        const kinds = planCollectionSchemaEnsure(collections, emptySchema).actions.map(a => a.kind);
        expect(kinds.indexOf("create-extension")).toBeLessThan(kinds.indexOf("create-function"));
    });

    it("the ensure builds its indexes concurrently, since it meets live tables", () => {
        const plan = planCollectionSchemaEnsure(collections, emptySchema);
        const index = plan.actions.find(a => a.kind === "create-index")!;
        expect(index.sql).toContain("CREATE INDEX CONCURRENTLY");
    });

    it("the ensure plans the index after the column it indexes", () => {
        const kinds = planCollectionSchemaEnsure(collections, emptySchema).actions.map(a => a.kind);
        expect(kinds.lastIndexOf("add-column")).toBeLessThan(kinds.indexOf("create-index"));
    });
});

describe("the spec's classification matches the physical column type", () => {
    // The spec decides `text` / `text_array` / `jsonb` from the property, and
    // getSqlColumnType decides the actual column. If those two ever disagree,
    // the generated expression addresses a column of a type it is not.
    const cases: [string, string][] = [
        ["full_name", "TEXT"],
        ["interests", "TEXT[]"],
        ["questionnaire", "JSONB"]
    ];

    it.each(cases)("%s is %s, and the spec extracts it accordingly", (propName, expectedType) => {
        const prop = collection.properties[propName];
        expect(getSqlColumnType(propName, prop, collection, collections)).toBe(expectedType);

        const field = spec.fields.find(f => f.column === propName)!;
        if (expectedType === "TEXT") expect(field.kind).toBe("text");
        if (expectedType === "TEXT[]") expect(field.kind).toBe("text_array");
        if (expectedType === "JSONB") expect(field.kind).toBe("jsonb");
    });
});

describe("a collection that has not opted in is untouched", () => {
    const plain: CollectionConfig[] = [{
        slug: "posts",
        table: "posts",
        name: "Posts",
        properties: { id: { type: "string", isId: "uuid" }, title: { type: "string" } }
    }];

    it("emits no search column, index, extension or helper in the DDL", async () => {
        const ddl = await generatePostgresDdl(plain, { includePolicies: false });
        expect(ddl).not.toContain("tsvector");
        expect(ddl).not.toContain("rebase_search_text");
        expect(ddl).not.toContain("CREATE EXTENSION");
        expect(ddl).not.toContain("-- Indexes");
    });

    it("emits no customType import in the Drizzle schema", async () => {
        expect(await generateSchema(plain)).not.toContain("tsvector");
    });

    it("plans no search action at boot", () => {
        const kinds = planCollectionSchemaEnsure(plain, emptySchema).actions.map(a => a.kind);
        expect(kinds).not.toContain("create-function");
        expect(kinds).not.toContain("create-extension");
        expect(kinds).not.toContain("create-index");
    });
});
