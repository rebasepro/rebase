import { RelationKind } from "@rebasepro/types";

import {
    RELATION_KINDS,
    RELATION_KIND_ORDER,
    kindUsesForeignKeyOnTarget,
    kindUsesJoinPath,
    kindUsesLocalKey,
    kindUsesThrough
} from "../../src/collection_editor/relation_kinds";

/**
 * The relation property form used to carry two selects left over from the
 * pre-union model — "Cardinality" (one/many) and "Direction" (owning/inverse).
 * The refactor pointed both of them at `relation.kind` without rethinking the
 * control, so their options still wrote the old vocabulary: picking
 * "One (has-one)" set `kind: "one"`, and picking "Owning" set `kind: "owning"`.
 * Neither is a member of the union.
 *
 * Both selects also read `value={kind}` while rendering with `v === "one"`, so
 * a `belongsTo` relation displayed as "Many (has-many)" and "Inverse" — the
 * form disagreed with itself and with the stored value at the same time. There
 * was no way to choose a kind at all.
 *
 * One shared table drives both editors now. Its type is the guard: a sixth kind
 * cannot be added to the union without this failing to compile.
 */
describe("the relation kind vocabulary", () => {
    it("covers exactly the union, and nothing else", () => {
        const expected: RelationKind[] = ["belongsTo", "hasOne", "hasMany", "manyToMany", "via"];
        expect([...RELATION_KIND_ORDER].sort()).toEqual([...expected].sort());
    });

    it("offers only real kinds — never the retired one/many, owning/inverse values", () => {
        const retired = ["one", "many", "owning", "inverse"];
        for (const dead of retired) {
            expect(RELATION_KIND_ORDER).not.toContain(dead);
        }
    });

    it("gives every kind a label and a description", () => {
        for (const kind of RELATION_KIND_ORDER) {
            expect(RELATION_KINDS[kind].label).toBeTruthy();
            expect(RELATION_KINDS[kind].description).toBeTruthy();
        }
    });

    it("says where the key is, since that is what separates the first four", () => {
        expect(RELATION_KINDS.belongsTo.description).toContain("this table");
        expect(RELATION_KINDS.hasOne.description).toContain("target");
        expect(RELATION_KINDS.hasMany.description).toContain("target");
        expect(RELATION_KINDS.manyToMany.description).toContain("junction");
        expect(RELATION_KINDS.via.description).toContain("Read-only");
    });
});

describe("which fields a kind is configured with", () => {
    it("shows exactly one link field per kind, and never two", () => {
        const shown = (kind: RelationKind) => [
            kindUsesLocalKey(kind) && "localKey",
            kindUsesForeignKeyOnTarget(kind) && "foreignKeyOnTarget",
            kindUsesThrough(kind) && "through",
            kindUsesJoinPath(kind) && "joinPath"
        ].filter(Boolean);

        expect(shown("belongsTo")).toEqual(["localKey"]);
        expect(shown("hasOne")).toEqual(["foreignKeyOnTarget"]);
        expect(shown("hasMany")).toEqual(["foreignKeyOnTarget"]);
        expect(shown("manyToMany")).toEqual(["through"]);
        expect(shown("via")).toEqual(["joinPath"]);
    });

    it("never offers a localKey on a to-many kind — the pairing that corrupted writes", () => {
        expect(kindUsesLocalKey("hasMany")).toBe(false);
        expect(kindUsesLocalKey("manyToMany")).toBe(false);
        expect(kindUsesLocalKey("via")).toBe(false);
    });
});
