import { describe, expect, it } from "@jest/globals";
import path from "node:path";
import type { CollectionConfig } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";
// The SDK generator, by path: `@rebasepro/codegen` is not a dependency of this
// package and must not become one for a test. The point of the suite is that
// the two generators describe the same collection, so it has to run both.
import { generateTypedefs } from "../../codegen/src/generate-types";

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

const tags = {
    slug: "tags",
    name: "Tags",
    singularName: "Tag",
    table: "tags",
    properties: {
        id: { name: "ID", type: "number", isId: "serial", columnType: "serial" },
        label: { name: "Label", type: "string" }
    }
} as unknown as CollectionConfig;

const authors = {
    slug: "authors",
    name: "Authors",
    singularName: "Author",
    table: "authors",
    properties: {
        id: { name: "ID", type: "number", isId: "serial", columnType: "serial" },
        name: { name: "Name", type: "string", validation: { required: true } }
    }
} as unknown as CollectionConfig;

const posts = {
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
} as unknown as CollectionConfig;

const collections = [posts, authors, tags];
const spec = generateOpenApiSpec(collections) as Record<string, any>;

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
        const typedefs = generateTypedefs(collections);

        for (const [accessor, schemaName] of [["posts", "Post"], ["authors", "Author"], ["tags", "Tag"]] as const) {
            const documented = Object.keys(spec.components.schemas[schemaName].properties as Record<string, unknown>);
            expect(new Set(documented)).toEqual(new Set(sdkRowKeys(typedefs, accessor)));
        }
    });

    it("agree that the fixture actually has relations to lose", () => {
        // A parity assertion between two empty sets passes for the wrong reason.
        const documented = Object.keys(spec.components.schemas.Post.properties as Record<string, unknown>);
        expect(documented).toEqual(expect.arrayContaining(["authorId", "author", "tags"]));
        expect(documented).not.toContain("secret");
    });
});

describe("the primary key", () => {
    it("has one type across the read, Input and Update schemas", () => {
        for (const name of ["Post", "Author", "Tag"]) {
            const types = [name, `${name}Input`, `${name}Update`].map(
                schema => (spec.components.schemas[schema].properties as Record<string, any>).id.type
            );
            expect(new Set(types)).toEqual(new Set(["integer"]));
        }
    });
});

describe("a relation in the document", () => {
    it("points a to-one at the target's component", () => {
        expect(spec.components.schemas.Post.properties.author).toEqual({ $ref: "#/components/schemas/Author" });
    });

    it("makes a to-many an array of the target's component", () => {
        expect(spec.components.schemas.Post.properties.tags).toEqual({
            type: "array",
            items: { $ref: "#/components/schemas/Tag" }
        });
    });

    it("types the foreign key as the target's primary key", () => {
        expect(spec.components.schemas.Post.properties.authorId.type).toBe("integer");
        expect(spec.components.schemas.PostInput.properties.authorId.type).toBe("integer");
    });

    it("does not demand both spellings of one link on a create", () => {
        // `authorId` and `author` are alternatives, so requiring either would
        // make a gateway reject a create the server accepts.
        const required: string[] = spec.components.schemas.PostInput.required ?? [];
        expect(required).not.toContain("author");
        expect(required).not.toContain("authorId");
    });
});

describe("the scaffold every `rebase init` produces", () => {
    // The collections themselves, not a fixture shaped like them: `posts`
    // declares both a `belongsTo` and a `manyToMany`, and its `id` is
    // `isId: "increment"`. Loading them here turns the check the sweep ran
    // against a booted scaffold — `jq '.components.schemas.Post.properties |
    // keys'` — into an assertion that runs in CI.
    const collectionsDir = path.resolve(__dirname, "../../cli/templates/template/config/collections");

    const scaffold = async (): Promise<CollectionConfig[]> => Promise.all(
        ["posts", "authors", "tags"].map(async name =>
            (await import(path.join(collectionsDir, `${name}.ts`))).default as CollectionConfig)
    );

    it("documents the post's author key, its author and its tags", async () => {
        const scaffoldSpec = generateOpenApiSpec(await scaffold()) as Record<string, any>;
        const documented = Object.keys(scaffoldSpec.components.schemas.Post.properties as Record<string, unknown>);

        expect(documented).toEqual(expect.arrayContaining(["authorId", "author", "tags"]));
    });

    it("gives the post's id one type in all three of its schemas", async () => {
        const scaffoldSpec = generateOpenApiSpec(await scaffold()) as Record<string, any>;
        const types = ["Post", "PostInput", "PostUpdate"].map(
            schema => (scaffoldSpec.components.schemas[schema].properties as Record<string, any>).id.type
        );

        expect(new Set(types)).toEqual(new Set(["integer"]));
    });

    it("describes the same fields as the SDK it ships beside", async () => {
        const collections = await scaffold();
        const scaffoldSpec = generateOpenApiSpec(collections) as Record<string, any>;
        const typedefs = generateTypedefs(collections);

        expect(new Set(Object.keys(scaffoldSpec.components.schemas.Post.properties as Record<string, unknown>)))
            .toEqual(new Set(sdkRowKeys(typedefs, "posts")));
    });
});
