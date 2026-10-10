/**
 * `include` is what makes a collection view's read return the relations its
 * cells render in the same request as its rows — over REST and over the
 * realtime subscription alike, which run the same include loader. A relation a
 * cell renders that is not named here arrives as a bare foreign key, and the
 * cell fetches it on its own: one request per cell.
 *
 * It names the relations a *property* declares. It used to be `["*"]`, which
 * the server reads as every relation the collection declares — including the
 * ones declared only in `relations: []` for a record's tabs, which no list
 * surface renders and whose rows every read embedded for every parent.
 */
import { describe, expect, it } from "@jest/globals";
import type { AdminCollection } from "@rebasepro/cms-types";
import { getRelationIncludeParams } from "../src/util/previews";

const users: AdminCollection = { slug: "users", name: "Users", table: "users", properties: { name: { type: "string" } } };
const tagsCollection: AdminCollection = { slug: "tags", name: "Tags", table: "tags", properties: { label: { type: "string" } } };
const comments: AdminCollection = { slug: "comments", name: "Comments", table: "comments", properties: { body: { type: "string" } } };

const collectionWith = (properties: AdminCollection["properties"], relations?: AdminCollection["relations"]): AdminCollection =>
    ({ slug: "posts",
        name: "Posts",
        table: "posts",
        properties,
        ...(relations ? { relations } : {}) });

describe("getRelationIncludeParams", () => {

    it("names a relation a property declares inline", () => {
        const collection = collectionWith({
            title: { type: "string" },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => users } }
        });
        expect(getRelationIncludeParams(collection)).toEqual(["author"]);
    });

    it("names a property whose relation is declared in `relations` under its key", () => {
        const collection = collectionWith({
            title: { type: "string" },
            author: { type: "relation" }
        }, [{ kind: "belongsTo", relationName: "author", target: () => users }]);
        expect(getRelationIncludeParams(collection)).toEqual(["author"]);
    });

    it("names an array of relations backed by a relation of the same name", () => {
        // Rendered by ArrayOfRelationsPreview, so the data has to arrive with
        // the rows — an inline check that only looked at top-level types once
        // left these collections fetching one request per cell.
        const collection = collectionWith({
            title: { type: "string" },
            tags: { type: "array", of: { type: "relation" } }
        }, [{ kind: "manyToMany", relationName: "tags", target: () => tagsCollection }]);
        expect(getRelationIncludeParams(collection)).toEqual(["tags"]);
    });

    it("leaves out a relation declared only for the record's tabs", () => {
        // No property names `comments`: no list cell, chip or card renders it,
        // and `*` used to embed every comment of every post on the page.
        const collection = collectionWith({
            title: { type: "string" },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => users } }
        }, [{ kind: "hasMany", relationName: "comments", target: () => comments }]);
        expect(getRelationIncludeParams(collection)).toEqual(["author"]);

        const tabsOnly = collectionWith({ title: { type: "string" } },
            [{ kind: "hasMany", relationName: "comments", target: () => comments }]);
        expect(getRelationIncludeParams(tabsOnly)).toBeUndefined();
    });

    it("asks for nothing for references, which no include loads", () => {
        // A reference is resolved by its own preview; the server's include
        // covers relations only, so `*` never loaded anything for one.
        const collection = collectionWith({
            title: { type: "string" },
            owner: { type: "reference", path: "users" },
            editors: { type: "array", of: { type: "reference", path: "users" } }
        });
        expect(getRelationIncludeParams(collection)).toBeUndefined();
    });

    it("stays out of the way when the collection has no relations", () => {
        const collection = collectionWith({
            title: { type: "string" },
            count: { type: "number" },
            tags: { type: "array", of: { type: "string" } }
        });
        expect(getRelationIncludeParams(collection)).toBeUndefined();
    });

    it("tolerates property builders and a collection with no properties", () => {
        const withBuilder = collectionWith({
            title: { type: "string" },
            computed: (() => ({ type: "string" })) as never
        });
        expect(getRelationIncludeParams(withBuilder)).toBeUndefined();
        expect(getRelationIncludeParams({ slug: "x", name: "X" } as AdminCollection)).toBeUndefined();
    });

    it("hands back the same array for the same relations, whatever object the collection is", () => {
        // `useRelationSelector` lists the include as an effect dependency;
        // a fresh array per render re-opened its read on every render.
        const build = () => collectionWith({
            author: { type: "relation", relation: { kind: "belongsTo", target: () => users } }
        });
        expect(getRelationIncludeParams(build())).toBe(getRelationIncludeParams(build()));
    });

    it("leaves the choice to the server when a relation cannot be resolved here", () => {
        const collection = collectionWith({
            title: { type: "string" },
            author: { type: "relation", relation: { kind: "belongsTo" } as never }
        });
        expect(getRelationIncludeParams(collection)).toEqual(["*"]);
    });
});
