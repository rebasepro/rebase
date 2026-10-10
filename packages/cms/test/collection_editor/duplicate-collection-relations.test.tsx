/**
 * @jest-environment jsdom
 */
/**
 * A duplicated collection keeps its relations.
 *
 * "Duplicate" starts the editor from the collection the panel holds, whose
 * relations point at their targets through thunks and carry the registry's
 * `resolvedRelation`. Posted as it was, JSON dropped every thunk, and saving
 * the duplicate of "Blog posts" was refused with "Relation property
 * "properties.author" on collection "articles" has no target collection" — a
 * relation the person never touched.
 */
import React from "react";
import { describe, expect, it, beforeEach, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";

import { useLocalCollectionsConfigController }
    from "../../src/collection_editor/useLocalCollectionsConfigController";
import { collectionForWire } from "../../src/collection_editor/collection_wire";
import type { CollectionsConfigController } from "../../src/collection_editor/types/config_controller";
import type { AdminCollection } from "@rebasepro/cms-types";

const client = { baseUrl: "https://api.example.com", apiPath: "/api" };

const authors = { slug: "authors", name: "Authors", properties: {} } as unknown as AdminCollection;
const tags = { slug: "tags", name: "Tags", properties: {} } as unknown as AdminCollection;

/** "Blog posts" as the panel holds it, duplicated and renamed "Articles". */
const articles = () => ({
    slug: "articles",
    name: "Articles",
    table: "articles",
    properties: {
        title: { type: "string", name: "Title" },
        author: {
            type: "relation",
            name: "Author",
            relation: { kind: "belongsTo", target: () => authors, localKey: "author_id" },
            resolvedRelation: { kind: "belongsTo", targetSlug: "authors", cardinality: "one" }
        },
        tags: {
            type: "relation",
            name: "Tags",
            relation: {
                kind: "manyToMany",
                // A target the panel has not loaded: the registry's answer names it.
                target: () => { throw new Error("tags is not loaded"); },
                through: { table: "articles_tags", sourceColumn: "article_id", targetColumn: "tag_id" }
            },
            resolvedRelation: { kind: "manyToMany", targetSlug: "tags", cardinality: "many" }
        }
    },
    relations: [{ relationName: "editor", kind: "belongsTo", target: () => authors, localKey: "editor_id" }]
}) as unknown as AdminCollection;

type Posted = { url: string; body: Record<string, unknown> };

function backend() {
    const posted: Posted[] = [];
    const json = (body: unknown) => ({
        ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body)
    }) as unknown as Response;
    global.fetch = (async (url: string, init?: RequestInit) => {
        if (init?.method === "POST") posted.push({ url: String(url), body: JSON.parse(String(init.body)) });
        if (String(url).endsWith("/api/admin/schema/status")) {
            return json({ enabled: false, canPlan: false, canApply: false, code: "SCHEMA_EDITING_NO_REPOSITORY" });
        }
        return json({ enabled: true });
    }) as unknown as typeof fetch;
    return posted;
}

let controller: CollectionsConfigController;
function Harness() {
    controller = useLocalCollectionsConfigController(client, [authors, tags]);
    return null;
}

beforeEach(() => { jest.restoreAllMocks(); });

describe("saving a duplicated collection", () => {
    it("sends every relation's target as its slug, without the runtime's keys", async () => {
        const posted = backend();
        render(<Harness/>);
        await act(async () => {
            await controller.saveCollection({ id: "articles", collectionData: articles() });
        });
        const body = posted.find(p => p.url.endsWith("/collection/save"))?.body as {
            collectionData: { properties: Record<string, { relation: { target?: unknown } }>, relations: { target?: unknown }[] }
        };
        expect(body.collectionData.properties.author.relation.target).toBe("authors");
        expect(body.collectionData.properties.tags.relation.target).toBe("tags");
        expect(body.collectionData.relations[0].target).toBe("authors");
        expect(JSON.stringify(body)).not.toContain("resolvedRelation");
    });
});

describe("collectionForWire", () => {
    it("leaves a target that is already a slug, and everything else, as it is", () => {
        const collection = {
            slug: "a",
            properties: { b: { type: "relation", relation: { kind: "belongsTo", target: "authors", onDelete: "cascade" } } },
            admin: { icon: "Book" }
        };
        expect(collectionForWire(collection)).toEqual(collection);
    });
});
