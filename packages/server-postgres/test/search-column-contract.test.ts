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
import {
    generatePostgresDdl,
    generatePostgresSearchDdl,
    searchExcludePatterns,
    getSqlColumnType
} from "../src/schema/generate-postgres-ddl-logic";
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

describe("what Atlas is allowed to read", () => {
    /**
     * `schema.sql` is a desired-state file handed to Atlas, and Atlas's free
     * tier refuses to parse one containing a function at all:
     *
     *   drizzle/schema.sql:6: functions and procedures are available to
     *   logged-in users only. Use 'atlas login' to access this feature
     *
     * Emitting the search helpers there took `rebase db push` down for every
     * project declaring a `search` block — the whole feature, not the helpers.
     * They live in `search.sql` now and the CLI applies them first, to the
     * target database and to the dev database Atlas diffs against.
     *
     * The table definition still has to reference them, so this is not "keep
     * search out of the schema" — it is a split, and both halves are pinned.
     */
    it("keeps functions and extensions out of the Atlas desired state", async () => {
        const ddl = await generatePostgresDdl([collection], {
            includePolicies: false,
            includeSearch: false
        });
        expect(ddl).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i);
        expect(ddl).not.toMatch(/CREATE\s+EXTENSION/i);
    });

    it("shows Atlas no trace of search at all — not the column, not the index", async () => {
        const ddl = await generatePostgresDdl([collection], {
            includePolicies: false,
            includeSearch: false
        });
        // The column cannot come across on its own: its expression calls a
        // helper, and Atlas materialises the schema it inspects in a dev
        // database it has just emptied, so the helper is never there when the
        // plan is analysed. Column, index and helpers move together.
        expect(ddl).not.toContain("search_vector");
        expect(ddl).not.toContain("rebase_search_text");
        expect(ddl).not.toContain(spec.indexName);
    });

    it("puts the whole apparatus in the file the CLI applies", () => {
        const sql = generatePostgresSearchDdl([collection]);
        expect(sql).toMatch(/CREATE\s+OR\s+REPLACE\s+FUNCTION/i);
        expect(sql).toContain("rebase_search_text");
        expect(sql).toMatch(/CREATE\s+EXTENSION[^\n]*unaccent/i);
        // Replayed against a live database on every push, so every statement
        // must tolerate already being there.
        for (const line of sql.split("\n").filter(l => /^CREATE /.test(l))) {
            expect(line).toMatch(/IF NOT EXISTS|OR REPLACE/i);
        }
    });

    it("writes nothing when no collection opted in", () => {
        const noSearch: CollectionConfig[] = [{
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: { id: { type: "string", isId: "uuid" }, title: { type: "string" } }
        }];
        expect(generatePostgresSearchDdl(noSearch)).toBe("");
    });

    it("declares every helper it calls, since nothing else will", () => {
        const sql = generatePostgresSearchDdl([collection]);
        // `search.sql` is applied on its own, against databases that have only
        // ever been touched by Atlas. A helper referenced but not declared here
        // has nowhere else to come from.
        const called = new Set([...sql.matchAll(/(rebase_search_\w+)\s*\(/g)].map(m => m[1]));
        expect(called.size).toBeGreaterThan(0);
        for (const fn of called) {
            expect(sql).toMatch(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${fn}`));
        }
    });

    it("adds the column rather than defining it inline — the table already exists", () => {
        const sql = generatePostgresSearchDdl([collection]);
        expect(sql).toContain(`ALTER TABLE "public"."talents" ADD COLUMN IF NOT EXISTS "${spec.column}"`);
        expect(sql).not.toContain("CREATE TABLE");
    });
});

describe("searchExcludePatterns — what Atlas is told to keep its hands off", () => {
    /**
     * Atlas takes the schema from the pattern's first segment. A two-part
     * `posts.search_vector` is read as a *table* `search_vector` in a *schema*
     * `posts`, matches nothing, and — this is the part that costs the time —
     * is not an error. The push then plans a `DROP COLUMN` for the search
     * column it was supposed to protect, and the exclude that was meant to
     * stop it reported nothing at all.
     */
    it("qualifies every pattern with the schema", () => {
        for (const pattern of searchExcludePatterns([collection])) {
            expect(pattern.split(".")).toHaveLength(3);
            expect(pattern.startsWith("public.")).toBe(true);
        }
    });

    it("covers the column and the index — both are absent from the desired state", () => {
        const patterns = searchExcludePatterns([collection]);
        expect(patterns).toContain(`public.talents.${spec.column}`);
        expect(patterns).toContain(`public.talents.${spec.indexName}`);
    });

    it("names the fuzzy column and its index too, when one is configured", () => {
        const fuzzy: PostgresCollectionConfig = {
            ...collection,
            search: { ...collection.search!, fuzzy: true }
        };
        const fuzzySpec = buildSearchColumnSpec(fuzzy)!;
        const patterns = searchExcludePatterns([fuzzy]);
        expect(fuzzySpec.fuzzy).toBeDefined();
        expect(patterns).toContain(`public.talents.${fuzzySpec.fuzzy!.column}`);
        expect(patterns).toContain(`public.talents.${fuzzySpec.fuzzy!.indexName}`);
    });

    it("is empty for a project that never opted in, so nothing changes for it", () => {
        expect(searchExcludePatterns([{
            slug: "posts", table: "posts", name: "Posts",
            properties: { id: { type: "string", isId: "uuid" }, title: { type: "string" } }
        }])).toEqual([]);
    });

    it("excludes exactly the objects search.sql creates, and nothing else", () => {
        // The two lists are built independently. If one grows an object the
        // other does not know about, Atlas drops it on the next push.
        const sql = generatePostgresSearchDdl([collection]);
        for (const pattern of searchExcludePatterns([collection])) {
            expect(sql).toContain(pattern.split(".")[2]);
        }
    });
});
