/**
 * What "Duplicate" opens with.
 *
 * The copy is saved as a create, and a create writes every relation it
 * carries. Carrying a relation whose key lives on the other row is a write to
 * that row: duplicating an author with posts used to re-parent every post to
 * the copy. The end-to-end proof, over every kind against a real database, is
 * `server-postgres/test/e2e/duplicate-record-e2e.test.ts`; this pins what the
 * form itself opens with.
 */
import type { AdminCollection, AuthController } from "@rebasepro/cms-types";
import { EntityRelation } from "@rebasepro/types";
import { getInitialEntityValues } from "../../src/form/form_utils";

const target = (slug: string) => () => ({ slug, table: slug, name: slug, properties: { id: { type: "string", isId: true } } });

const authors = {
    slug: "authors",
    table: "authors",
    name: "Authors",
    properties: {
        id: { type: "string", isId: true },
        name: { type: "string" },
        editor: { type: "relation", relation: { kind: "belongsTo", target: target("editors"), localKey: "editor_id" } },
        posts: { type: "relation", relation: { kind: "hasMany", target: target("posts"), foreignKeyOnTarget: "author_id" } },
        profile: { type: "relation", relation: { kind: "hasOne", target: target("profiles"), foreignKeyOnTarget: "author_id" } },
        tags: { type: "relation", relation: { kind: "manyToMany", target: target("tags") } },
        badge: {
            type: "relation",
            relation: {
                kind: "via", target: target("badges"), cardinality: "one",
                joinPath: [{ table: "badges", on: { from: "authors.id", to: "badges.owner_id" } }]
            }
        }
    },
    relations: [
        // Declared only in `relations`: it can still come back on the row.
        { kind: "hasMany", relationName: "drafts", target: target("drafts"), foreignKeyOnTarget: "author_id" }
    ]
} as unknown as AdminCollection;

const stored = {
    id: "a-1",
    name: "Ada",
    editor: new EntityRelation("e-1", "editors"),
    posts: [new EntityRelation("p-1", "posts"), new EntityRelation("p-2", "posts")],
    profile: new EntityRelation("pr-1", "profiles"),
    tags: [new EntityRelation("t-1", "tags")],
    badge: new EntityRelation("b-1", "badges"),
    drafts: [new EntityRelation("d-1", "drafts")]
};

const authController = {} as AuthController;

describe("the values a duplicate opens with", () => {
    const copy = getInitialEntityValues(authController, authors, "authors", "copy", {
        id: "a-1",
        path: "authors",
        values: stored
    });

    it("leaves behind every relation whose key lives on the other row", () => {
        expect(copy).not.toHaveProperty("posts");
        expect(copy).not.toHaveProperty("profile");
        expect(copy).not.toHaveProperty("badge");
        expect(copy).not.toHaveProperty("drafts");
    });

    it("keeps the links that are the copy's own", () => {
        expect(copy.editor).toEqual(stored.editor);
        expect(copy.tags).toEqual(stored.tags);
        expect(copy.name).toBe("Ada");
    });

    it("drops the key, so the copy gets its own", () => {
        expect(copy).not.toHaveProperty("id");
    });

    it("leaves an edit of the original alone", () => {
        const existing = getInitialEntityValues(authController, authors, "authors", "existing", {
            id: "a-1",
            path: "authors",
            values: stored
        });
        expect(existing).toBe(stored);
    });
});
