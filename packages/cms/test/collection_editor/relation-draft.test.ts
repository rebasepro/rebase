import { RelationKind } from "@rebasepro/types";

import { KIND_LABELS, draftIsComplete, relationFromDraft } from "../../src/collection_editor/ui/collection_editor/CollectionRelationsTab";

/**
 * The relations tab used to enable Save as soon as a draft had a name and a
 * target. For four of the five kinds that is enough — every missing field has a
 * derived default. `via` has nothing to derive from: a join chain with no steps
 * joins nothing, so the editor could save a relation that returned no rows and
 * that the server now refuses to boot on.
 */
describe("the relations tab's kind picker", () => {
    it("offers every kind in the union", () => {
        // Typed `Record<RelationKind, string>`, so a sixth kind breaks the
        // build rather than quietly going missing from the dropdown.
        const offered = Object.keys(KIND_LABELS).sort();
        const expected: RelationKind[] = ["belongsTo", "hasOne", "hasMany", "manyToMany", "via"];
        expect(offered).toEqual([...expected].sort());
    });

    it("says via is read-only where the user picks it", () => {
        expect(KIND_LABELS.via.toLowerCase()).toContain("read-only");
    });
});

describe("when a relation draft may be saved", () => {
    it("needs a name and a target whatever the kind", () => {
        expect(draftIsComplete({ kind: "belongsTo" })).toBe(false);
        expect(draftIsComplete({ kind: "belongsTo",
relationName: "author" })).toBe(false);
        expect(draftIsComplete({ kind: "belongsTo",
relationName: "author",
target: "users" })).toBe(true);
    });

    it("lets the derivable kinds save without their key — it has a default", () => {
        expect(draftIsComplete({ kind: "hasMany",
relationName: "comments",
target: "comments" })).toBe(true);
        expect(draftIsComplete({ kind: "manyToMany",
relationName: "tags",
target: "tags" })).toBe(true);
    });

    it("refuses a via with no steps, which would join nothing", () => {
        expect(draftIsComplete({ kind: "via",
relationName: "perms",
target: "permissions" })).toBe(false);
        expect(draftIsComplete({ kind: "via",
relationName: "perms",
target: "permissions",
joinPath: [] })).toBe(false);
    });

    it("refuses a via step that is missing a table or either column", () => {
        const base = { kind: "via" as const,
relationName: "perms",
target: "permissions" };
        expect(draftIsComplete({ ...base,
joinPath: [{ table: "",
on: { from: "id",
to: "user_id" } }] })).toBe(false);
        expect(draftIsComplete({ ...base,
joinPath: [{ table: "user_roles",
on: { from: "",
to: "user_id" } }] })).toBe(false);
        expect(draftIsComplete({ ...base,
joinPath: [{ table: "user_roles",
on: { from: "id",
to: "" } }] })).toBe(false);
    });

    it("accepts a via once every step is filled in", () => {
        expect(draftIsComplete({
            kind: "via",
            relationName: "perms",
            target: "permissions",
            joinPath: [
                { table: "user_roles",
on: { from: "id",
to: "user_id" } },
                { table: "permissions",
on: { from: "role_id",
to: "id" } }
            ]
        })).toBe(true);
    });
});

describe("building a relation from a draft", () => {
    it("keeps only the fields the chosen kind owns", () => {
        // A draft that has been through several kinds: the user filled in a
        // junction table, then switched to "Belongs to". Casting this straight
        // to a Relation saved both `localKey` and `through`.
        const messy = {
            kind: "belongsTo" as const,
            relationName: "author",
            target: "users",
            localKey: "author_id",
            foreignKeyOnTarget: "post_id",
            through: { table: "posts_tags",
sourceColumn: "post_id",
targetColumn: "tag_id" },
            joinPath: [{ table: "x",
on: { from: "a",
to: "b" } }],
            cardinality: "many" as const
        };
        expect(relationFromDraft(messy)).toEqual({
            kind: "belongsTo",
            relationName: "author",
            target: "users",
            localKey: "author_id"
        });
    });

    it("drops a junction when the kind is not many-to-many", () => {
        const built = relationFromDraft({
            kind: "hasMany",
            relationName: "comments",
            target: "comments",
            foreignKeyOnTarget: "post_id",
            through: { table: "leftover" }
        });
        expect(built).not.toHaveProperty("through");
        expect(built).toMatchObject({ kind: "hasMany",
foreignKeyOnTarget: "post_id" });
    });

    it("refuses a draft that is not a relation yet", () => {
        expect(relationFromDraft({ relationName: "x",
target: "y" })).toBeNull();
        expect(relationFromDraft({ kind: "belongsTo",
target: "y" })).toBeNull();
        expect(relationFromDraft({ kind: "belongsTo",
relationName: "x" })).toBeNull();
    });

    it("gives a via its cardinality and path", () => {
        expect(relationFromDraft({
            kind: "via",
            relationName: "perms",
            target: "permissions",
            cardinality: "one",
            joinPath: [{ table: "roles",
on: { from: "role_id",
to: "id" } }]
        })).toMatchObject({ kind: "via",
cardinality: "one",
joinPath: [{ table: "roles" }] });
    });
});
