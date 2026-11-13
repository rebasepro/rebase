import { describe, expect, it } from "@jest/globals";
import { col, defineTable, rel } from "@rebasepro/types";
import type { AnyTableDef, JoinStep } from "@rebasepro/types";
import type { LegacyCollectionConfig, LegacyRelation } from "@rebasepro/common/migrate";

import { compileTables } from "../../src/schema/compile-tables";
import {
    deriveBelongsToLocalKey,
    deriveColumnName,
    deriveForeignKeyField,
    deriveJunctionSourceKey,
    deriveJunctionTable,
    deriveJunctionTargetKey,
    deriveReferencingType,
    deriveTargetForeignKey,
    deriveViaWritable
} from "../../src/schema/derive-names";
import { getTableName } from "../../src/util/relations";
import { resolveRelation } from "../../src/util/resolve-relation";

/**
 * The compiler's derived names, against the legacy pipeline's.
 *
 * `resolveRelation` and `getTableName` take a `CollectionConfig`, so the
 * compiler mirrors their rules over plain inputs (`derive-names.ts`). Each test
 * here feeds the same table — once as a collection, once as a `defineTable` —
 * to both and compares, over names chosen for the cases the rules handle
 * specially: irregular plurals, acronyms, double-s words, camelCase, a slug
 * that differs from its table.
 */

/** Slug, SQL table: the legacy collection derives its table from the slug; the codemod writes both. */
const TABLES: readonly [slug: string, table: string][] = [
    ["posts", "posts"],
    ["categories", "categories"],
    ["addresses", "addresses"],
    ["URLs", "urls"],
    ["people", "people"],
    ["order_items", "order_items"],
    ["blogPosts", "blog_posts"],
    ["status", "status"],
    ["class", "class"],
    ["app_accounts", "accounts"]
];

const RELATION_NAMES = ["author", "tags", "children", "favouriteTags", "URLs", "addresses", "status"];

const collection = (slug: string, table: string): LegacyCollectionConfig => ({
    slug, name: slug, table,
    properties: { id: { type: "string", isId: "uuid" } }
});

const tableDef = (slug: string, table: string): AnyTableDef => defineTable(table, {
    slug,
    columns: { id: col.uuid().primaryKey() },
    rls: "admin-only"
});

describe("derived names agree with the legacy pipeline", () => {
    it("the SQL table: getTableName of the collection = the compiled table", () => {
        for (const [slug, table] of TABLES) {
            const [descriptor] = compileTables([tableDef(slug, table)]);
            expect([slug, descriptor.table]).toEqual([slug, getTableName(collection(slug, table))]);
            expect(descriptor.slug).toBe(slug);
        }
    });

    it("a belongsTo's localKey", () => {
        for (const name of RELATION_NAMES) {
            for (const [slug, table] of TABLES) {
                const legacy = resolveRelation({ kind: "belongsTo", relationName: name, target: () => collection(slug, table) }, collection("src", "src"));
                if (legacy.kind !== "belongsTo") throw new Error("kind");
                expect([name, deriveBelongsToLocalKey(name, undefined)]).toEqual([name, legacy.localKey]);
            }
            const explicit = resolveRelation({ kind: "belongsTo", relationName: name, localKey: "writer_ref", target: () => collection("t", "t") }, collection("s", "s"));
            expect(explicit.kind === "belongsTo" && explicit.localKey).toBe(deriveBelongsToLocalKey(name, "writer_ref"));
        }
    });

    it("a hasOne / hasMany foreign key, from the source slug", () => {
        for (const [slug, table] of TABLES) {
            for (const kind of ["hasOne", "hasMany"] as const) {
                const relation: LegacyRelation = { kind, relationName: "things", target: () => collection("things", "things") };
                const legacy = resolveRelation(relation, collection(slug, table));
                if (legacy.kind !== "hasOne" && legacy.kind !== "hasMany") throw new Error("kind");
                expect([slug, deriveTargetForeignKey(slug, undefined)]).toEqual([slug, legacy.foreignKeyOnTarget]);
            }
        }
        expect(deriveTargetForeignKey("posts", "owner")).toBe("owner");
    });

    it("a many-to-many junction table and its two keys", () => {
        for (const [sourceSlug, sourceTable] of TABLES) {
            for (const [targetSlug, targetTable] of TABLES) {
                for (const name of RELATION_NAMES) {
                    const legacy = resolveRelation(
                        { kind: "manyToMany", relationName: name, target: () => collection(targetSlug, targetTable) },
                        collection(sourceSlug, sourceTable)
                    );
                    if (legacy.kind !== "manyToMany") throw new Error("kind");
                    expect({
                        table: deriveJunctionTable(sourceTable, targetTable, undefined),
                        sourceColumn: deriveJunctionSourceKey(sourceSlug, undefined),
                        targetColumn: deriveJunctionTargetKey(name, undefined)
                    }).toEqual({
                        table: legacy.through.table,
                        sourceColumn: legacy.through.sourceColumn,
                        targetColumn: legacy.through.targetColumn
                    });
                }
            }
        }
        expect([deriveJunctionTable("a", "b", "links"), deriveJunctionSourceKey("a", "x"), deriveJunctionTargetKey("b", "y")]).toEqual(["links", "x", "y"]);
    });

    it("whether a via can be written through", () => {
        const step = (table: string, on: JoinStep["on"] = { from: "id", to: "x" }): JoinStep => ({ table, on });
        const chains: [("one" | "many"), JoinStep[]][] = [
            ["one", [step("a")]],
            ["one", [step("a"), step("b")]],
            ["many", [step("a"), step("b")]],
            ["many", [step("a"), step("a")]],
            ["many", [step("a")]],
            ["many", [step("a", [{ from: "id", to: "x" }]), step("b")]],
            ["many", [step("a", [{ from: "id", to: "x" }, { from: "id", to: "y" }]), step("b")]],
            ["one", [step("a", [])]]
        ];
        for (const [cardinality, joinPath] of chains) {
            const legacy = resolveRelation({ kind: "via", relationName: "v", cardinality, joinPath, target: () => collection("t", "t") }, collection("s", "s"));
            expect([cardinality, joinPath.length, deriveViaWritable(cardinality, joinPath)]).toEqual([cardinality, joinPath.length, legacy.writable]);
        }
    });

    it("the compiled descriptor states the same names end to end", () => {
        for (const [slug, table] of TABLES) {
            const target = tableDef("targets", "targets");
            const source = defineTable(table, {
                slug,
                columns: { id: col.uuid().primaryKey() },
                relations: {
                    author: rel.belongsTo(() => target),
                    targets: rel.manyToMany(() => target),
                    children: rel.hasMany(() => target)
                },
                rls: "admin-only"
            });
            const [, compiled] = compileTables([target, source]);
            const legacySource = collection(slug, table);
            const legacyTarget = collection("targets", "targets");
            const belongsTo = resolveRelation({ kind: "belongsTo", relationName: "author", target: () => legacyTarget }, legacySource);
            const manyToMany = resolveRelation({ kind: "manyToMany", relationName: "targets", target: () => legacyTarget }, legacySource);
            const hasMany = resolveRelation({ kind: "hasMany", relationName: "children", target: () => legacyTarget }, legacySource);
            expect(compiled.relations).toEqual([
                expect.objectContaining({ kind: "belongsTo", localKey: belongsTo.kind === "belongsTo" ? belongsTo.localKey : "" }),
                expect.objectContaining({
                    kind: "manyToMany",
                    through: expect.objectContaining(manyToMany.kind === "manyToMany"
                        ? { table: manyToMany.through.table, sourceKey: manyToMany.through.sourceColumn, targetKey: manyToMany.through.targetColumn }
                        : {})
                }),
                expect.objectContaining({ kind: "hasMany", foreignKey: hasMany.kind === "hasMany" ? hasMany.foreignKeyOnTarget : "" })
            ]);
        }
    });
});

describe("derived names on their own", () => {
    it("a column is `.column()` or the snake_case of its key", () => {
        expect(deriveColumnName("publishDate", {})).toBe("publish_date");
        expect(deriveColumnName("photoURL", {})).toBe("photo_url");
        expect(deriveColumnName("__order", {})).toBe("order");
        expect(deriveColumnName("x2fa", {})).toBe("x_2_fa");
        expect(deriveColumnName("title", { column: "legacy_title" })).toBe("legacy_title");
    });

    it("a derived foreign key is served under the camelCase of its column", () => {
        expect(deriveForeignKeyField("author_id")).toBe("authorId");
        expect(deriveForeignKeyField("photo_URL_id")).toBe("photoURLId");
        expect(deriveForeignKeyField("owner")).toBe("owner");
    });

    it("a column pointing at a key takes the key's type, minus a serial's sequence", () => {
        expect(deriveReferencingType({ kind: "serial" }, "t", "id")).toEqual({ kind: "integer" });
        expect(deriveReferencingType({ kind: "bigserial" }, "t", "id")).toEqual({ kind: "bigint" });
        expect(deriveReferencingType({ kind: "smallserial" }, "t", "id")).toEqual({ kind: "smallint" });
        expect(deriveReferencingType({ kind: "varchar", length: 20 }, "t", "id")).toEqual({ kind: "varchar", length: 20 });
        expect(deriveReferencingType({ kind: "enum", values: ["a"] }, "codes", "code")).toEqual({ kind: "enum", values: ["a"], name: "codes_code" });
        expect(deriveReferencingType({ kind: "enum", values: ["a"], name: "shared" }, "codes", "code")).toEqual({ kind: "enum", values: ["a"], name: "shared" });
    });
});
