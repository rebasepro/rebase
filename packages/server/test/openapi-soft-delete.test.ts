import { describe, expect, it } from "@jest/globals";
import type { CollectionConfig } from "@rebasepro/types";

import { generateOpenApiSpec } from "../src/api/openapi-generator";

/**
 * What the spec says a delete does on a `softDelete` collection.
 *
 * The routes move the row to the trash. They take `?hard=true` to delete it
 * for good, and `?deleted=include|only` on the reads to see trashed rows. The
 * spec said "Deleted successfully" and named none of those parameters. It
 * drives Studio's API explorer, which sends only parameters the spec names.
 * So an administrator who deleted a row there was told it was gone while it
 * sat restorable in the table, and had no way to purge it or list the trash.
 */

const notes = {
    slug: "notes", name: "Notes", singularName: "Note", table: "notes",
    softDelete: true,
    properties: {
        id: { type: "string", isId: true },
        body: { type: "string" },
        // A column under the name the soft-delete parameter takes.
        deleted: { type: "boolean" },
        deletedAt: { type: "date" }
    }
} as unknown as CollectionConfig;

const tags = {
    slug: "tags", name: "Tags", singularName: "Tag", table: "tags",
    properties: { id: { type: "string", isId: true }, name: { type: "string" } }
} as unknown as CollectionConfig;

type Json = Record<string, any>;
const spec = generateOpenApiSpec([notes, tags]) as Json;

const params = (op: Json): Json[] => op.parameters ?? [];
const param = (op: Json, name: string): Json | undefined => params(op).find(p => p.name === name);

describe("a softDelete collection's spec", () => {
    it("says a delete moves the row to the trash, and offers `hard` to delete it for good", () => {
        const del = spec.paths["/data/notes/{id}"].delete;

        expect(del.responses[204].description).toMatch(/trash/i);
        expect(del.responses[204].description).not.toBe("Deleted successfully");
        expect(del.description).toContain("?hard=true");
        expect(param(del, "hard")).toMatchObject({ in: "query", schema: { type: "boolean" } });
    });

    it("offers `hard` on the bulk delete, which also only trashes", () => {
        const bulk = spec.paths["/data/notes/bulk/delete"].post;

        expect(param(bulk, "hard")).toMatchObject({ in: "query" });
        expect(bulk.description).toMatch(/trash/i);
    });

    it("offers `deleted` on every read that honours it", () => {
        for (const path of ["/data/notes", "/data/notes/{id}", "/data/notes/count", "/data/notes/aggregate"]) {
            const deleted = param(spec.paths[path].get, "deleted");
            expect({ path, deleted }).toMatchObject({
                path,
                deleted: { in: "query", schema: { enum: ["include", "only"] } }
            });
        }
    });

    it("names `deleted` once, as the soft-delete parameter, not also as a filter the server never applies", () => {
        const named = params(spec.paths["/data/notes"].get).filter(p => p.name === "deleted");

        expect(named).toHaveLength(1);
        expect(named[0].schema.enum).toEqual(["include", "only"]);
    });
});

describe("a collection without softDelete", () => {
    it("keeps a plain delete and no soft-delete parameters", () => {
        const del = spec.paths["/data/tags/{id}"].delete;

        expect(del.responses[204].description).toBe("Deleted successfully");
        expect(param(del, "hard")).toBeUndefined();
        expect(param(spec.paths["/data/tags/bulk/delete"].post, "hard")).toBeUndefined();
        expect(param(spec.paths["/data/tags"].get, "deleted")).toBeUndefined();
        expect(param(spec.paths["/data/tags/{id}"].get, "deleted")).toBeUndefined();
    });
});
