import { describe, expect, it } from "@jest/globals";
import path from "node:path";
import type { LegacyCollectionConfig } from "@rebasepro/common/migrate";

import { generateOpenApiSpec } from "../src/api/openapi-generator";
import { openApiDocument, schemaOf, type JsonSchema, type OpenApiDocument } from "./helpers/server-b-g1-openapi";
// The SDK generator, by path: `@rebasepro/codegen` is not a dependency of this
// package and must not become one for a test. The point of the suite is that
// the two generators describe the same collection, so it has to run both.
import { generateTypedefs } from "../../codegen/src/generate-types";
import { compileTables } from "@rebasepro/common";
import { tablesFrom, tablesFromCollections } from "./helpers/tables";
import { compileLoadedSchema, loadBackendSchema } from "../src/schema/load-schema";

/** The SDK generator reads compiled descriptors: the same collections, lifted and compiled. */
const descriptorsOf = (collections: LegacyCollectionConfig[]) => {
    const { tables, defaultRls } = tablesFrom(collections);
    return compileTables(tables, defaultRls ? { defaultRls } : {});
};

/**
 * `/api/docs` and `generated/sdk/database.types.ts` describe the same
 * collections, and one field has one type.
 *
 * Four artefacts are generated from a collection — the OpenAPI document, the
 * SDK `Database` interface, the Drizzle schema and the admin's view model — and
 * two of them were describing different tables. OpenAPI dropped every relation
 * (so `Post` had no `authorId` and no `author`, both of which the SDK's `Row`
 * carries and the REST layer serves), and it wrote `id` as a literal in two
 * places that disagreed: a `number` in the read schema, a `string` in every
 * Input and Update schema, for the same column.
 *
 * The fixture is the shape that made both defects invisible: a **numeric**
 * primary key — every previous OpenAPI fixture declared `id: { type: "string" }`,
 * which made the hardcode unfalsifiable — a `belongsTo` whose foreign key is
 * derived rather than declared, and a `manyToMany`.
 */

const tags: LegacyCollectionConfig = {
    slug: "tags",
    name: "Tags",
    singularName: "Tag",
    table: "tags",
    properties: {
        id: { name: "ID", type: "number", isId: "serial", columnType: "serial" },
        label: { name: "Label", type: "string" }
    }
};

const authors: LegacyCollectionConfig = {
    slug: "authors",
    name: "Authors",
    singularName: "Author",
    table: "authors",
    properties: {
        id: { name: "ID", type: "number", isId: "serial", columnType: "serial" },
        name: { name: "Name", type: "string", validation: { required: true } }
    }
};

const posts: LegacyCollectionConfig = {
    slug: "posts",
    name: "Posts",
    singularName: "Post",
    table: "posts",
    properties: {
        id: { name: "ID", type: "number", isId: "serial", columnType: "serial" },
        title: { name: "Title", type: "string", validation: { required: true } },
        secret: { name: "Draft Notes", type: "string", excludeFromApi: true },
        // No `relationName`, no declared foreign key: the wire key `authorId` is
        // derived from the `author_id` column, which is the derivation the two
        // generators have to agree on.
        author: {
            name: "Author",
            type: "relation",
            relation: { kind: "belongsTo", target: () => authors },
            validation: { required: true }
        },
        tags: {
            name: "Tags",
            type: "relation",
            relation: { kind: "manyToMany", target: () => tags }
        }
    }
};

const collections = [posts, authors, tags];
const spec = openApiDocument(generateOpenApiSpec(tablesFromCollections(collections).descriptors));

/** A component schema's properties; throws when it declares none. */
function propertiesOf(doc: OpenApiDocument, name: string): Record<string, JsonSchema> {
    const properties = schemaOf(doc, name).properties;
    if (!properties) throw new Error(`The schema ${name} declares no properties`);
    return properties;
}

/** The keys of one collection's `Row` block in the generated `Database`. */
function sdkRowKeys(typedefs: string, accessor: string): string[] {
    const start = typedefs.indexOf(`  ${accessor}: {`);
    if (start < 0) throw new Error(`no accessor "${accessor}" in the generated typedefs`);
    const rowStart = typedefs.indexOf("    Row: {", start);
    const rowEnd = typedefs.indexOf("    };", rowStart);
    if (rowStart < 0 || rowEnd < 0) throw new Error(`no Row block for "${accessor}"`);
    return typedefs
        .slice(rowStart + "    Row: {".length, rowEnd)
        .split("\n")
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.replace(/^"?([^"?:]+)"?\??:.*$/, "$1"));
}

describe("the OpenAPI document and the generated SDK", () => {
    it("describe the same set of fields", () => {
        const typedefs = generateTypedefs(descriptorsOf(collections));

        for (const [accessor, schemaName] of [["posts", "Post"], ["authors", "Author"], ["tags", "Tag"]] as const) {
            const documented = Object.keys(propertiesOf(spec, schemaName));
            expect(new Set(documented)).toEqual(new Set(sdkRowKeys(typedefs, accessor)));
        }
    });

    it("agree that the fixture actually has relations to lose", () => {
        // A parity assertion between two empty sets passes for the wrong reason.
        const documented = Object.keys(propertiesOf(spec, "Post"));
        expect(documented).toEqual(expect.arrayContaining(["authorId", "author", "tags"]));
        expect(documented).not.toContain("secret");
    });
});

/**
 * The keys of one block (`Insert`, `Update`) of a collection in the generated
 * `Database`. A block ends at the first line that closes it — `    };`, or
 * `    } & (...)` for an `Insert` carrying a required belongsTo's alternatives.
 */
function sdkBlockKeys(typedefs: string, accessor: string, block: "Insert" | "Update"): string[] {
    const start = typedefs.indexOf(`  ${accessor}: {`);
    const blockStart = typedefs.indexOf(`    ${block}: {`, start);
    if (start < 0 || blockStart < 0) throw new Error(`no ${block} block for "${accessor}"`);
    const lines = typedefs.slice(blockStart + `    ${block}: {`.length).split("\n");
    const end = lines.findIndex(line => line.startsWith("    }"));
    return lines.slice(0, end)
        .map(line => line.trim())
        .filter(Boolean)
        .map(line => line.replace(/^"?([^"?:]+)"?\??:.*$/, "$1"));
}

describe("the OpenAPI create and update bodies and the generated SDK", () => {
    // The write half drifted on its own: the document offered `belongsTo`
    // only, while the SDK's Insert typed the `manyToMany` membership the
    // server writes. The bodies and the SDK now name the same keys.
    it("name the same writable fields", () => {
        const typedefs = generateTypedefs(descriptorsOf(collections));
        for (const [accessor, schemaName] of [["posts", "Post"], ["authors", "Author"], ["tags", "Tag"]] as const) {
            const input = Object.keys(propertiesOf(spec, `${schemaName}Input`));
            expect(new Set(input)).toEqual(new Set(sdkBlockKeys(typedefs, accessor, "Insert")));
        }
        expect(Object.keys(propertiesOf(spec, "PostInput"))).toEqual(expect.arrayContaining(["tags", "author", "authorId"]));
    });
});

describe("the primary key", () => {
    it("has one type across the read, Input and Update schemas", () => {
        for (const name of ["Post", "Author", "Tag"]) {
            const types = [name, `${name}Input`, `${name}Update`].map(
                schema => propertiesOf(spec, schema).id?.type
            );
            expect(new Set(types)).toEqual(new Set(["integer"]));
        }
    });
});

describe("a relation in the document", () => {
    it("points a to-one at the target's component", () => {
        expect(propertiesOf(spec, "Post").author).toEqual({ $ref: "#/components/schemas/Author" });
    });

    it("makes a to-many an array of the target's component", () => {
        expect(propertiesOf(spec, "Post").tags).toEqual({
            type: "array",
            items: { $ref: "#/components/schemas/Tag" }
        });
    });

    it("types the foreign key as the target's primary key", () => {
        expect(propertiesOf(spec, "Post").authorId?.type).toBe("integer");
        expect(propertiesOf(spec, "PostInput").authorId?.type).toBe("integer");
    });

    it("does not demand both spellings of one link on a create", () => {
        // `authorId` and `author` are alternatives, so requiring either would
        // make a gateway reject a create the server accepts.
        const required: string[] = schemaOf(spec, "PostInput").required ?? [];
        expect(required).not.toContain("author");
        expect(required).not.toContain("authorId");
    });
});

describe("the scaffold every `rebase init` produces", () => {
    // The tables themselves, not a fixture shaped like them: `posts` declares
    // both a `belongsTo` and a `manyToMany`, and its `id` is an identity
    // integer. Loaded from the template's backend/schema the way boot loads it,
    // which turns the check the sweep ran against a booted scaffold — `jq
    // '.components.schemas.Post.properties | keys'` — into an assertion in CI.
    const schemaDir = path.resolve(__dirname, "../../cli/templates/template/backend/schema");

    const scaffold = async () => {
        const compiled = compileLoadedSchema(await loadBackendSchema(schemaDir));
        const wanted = new Set(["posts", "authors", "tags"]);
        return {
            descriptors: compiled.descriptors.filter(descriptor => wanted.has(descriptor.slug))
        };
    };

    it("documents the post's author key, its author and its tags", async () => {
        const scaffoldSpec = openApiDocument(generateOpenApiSpec((await scaffold()).descriptors));
        const documented = Object.keys(propertiesOf(scaffoldSpec, "Post"));

        expect(documented).toEqual(expect.arrayContaining(["authorId", "author", "tags"]));
    });

    it("gives the post's id one type in all three of its schemas", async () => {
        const scaffoldSpec = openApiDocument(generateOpenApiSpec((await scaffold()).descriptors));
        const types = ["Post", "PostInput", "PostUpdate"].map(
            schema => propertiesOf(scaffoldSpec, schema).id?.type
        );

        expect(new Set(types)).toEqual(new Set(["integer"]));
    });

    it("describes the same fields as the SDK it ships beside", async () => {
        const { descriptors } = await scaffold();
        const scaffoldSpec = openApiDocument(generateOpenApiSpec(descriptors));
        const typedefs = generateTypedefs(descriptors);

        expect(new Set(Object.keys(propertiesOf(scaffoldSpec, "Post"))))
            .toEqual(new Set(sdkRowKeys(typedefs, "posts")));
    });
});
