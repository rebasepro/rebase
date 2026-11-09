import { declaredIndexesIfNotExists, indexAdoptionStatement, indexMatchesSpec, planIndexAdoptions, type ExistingIndexShape } from "../src/schema/index-adoption";
import type { CollectionIndexSpec } from "../src/schema/collection-index";

const spec = (over: Partial<CollectionIndexSpec> = {}): CollectionIndexSpec => ({
    schema: "public",
    table: "events",
    method: "btree",
    unique: false,
    keys: [{ column: "kind", direction: "asc", nulls: "last" }, { column: "at", direction: "desc", nulls: "first" }],
    include: [],
    predicate: null,
    reason: "test",
    indexName: "events_kind_at_ix_1234567",
    ...over
});

const shape = (over: Partial<ExistingIndexShape> = {}): ExistingIndexShape => ({
    schema: "public",
    table: "events",
    index: "events_kind_at",
    method: "btree",
    unique: false,
    keys: ["kind", "at"],
    options: [0, 3],
    include: [],
    predicate: null,
    defaultOpclassAndCollation: true,
    constraint: false,
    valid: true,
    ...over
});

describe("index adoption", () => {
    it("matches an index identical part by part", () => {
        expect(indexMatchesSpec(spec(), shape())).toBe(true);
    });

    it.each([
        ["another table", { table: "other" }],
        ["the other direction", { options: [0, 0] }],
        ["NULLS placement", { options: [0, 1] }],
        ["the keys reordered", { keys: ["at", "kind"] }],
        ["an expression key", { keys: ["kind", null] }],
        ["another method", { method: "hash" }],
        ["uniqueness", { unique: true }],
        ["an INCLUDE column", { include: ["id"] }],
        ["a predicate", { predicate: "(kind = 'a'::text)" }],
        ["a non-default operator class or collation", { defaultOpclassAndCollation: false }],
        ["a constraint behind it", { constraint: true }],
        ["an INVALID build", { valid: false }]
    ])("does not match one that differs in %s", (_label, over) => {
        expect(indexMatchesSpec(spec(), shape(over as Partial<ExistingIndexShape>))).toBe(false);
    });

    it("reads a predicate past Postgres's quotes, casts and parentheses", () => {
        const partial = spec({ predicate: { column: "kind", op: "=", value: "live" } });
        expect(indexMatchesSpec(partial, shape({ predicate: "((kind)::text = 'live'::text)" }))).toBe(true);
        expect(indexMatchesSpec(partial, shape({ predicate: "(kind = 'dead'::text)" }))).toBe(false);
    });

    it("ignores direction on an unordered method", () => {
        const gin = spec({ method: "gin", keys: [{ column: "tags", direction: "asc", nulls: "last" }], indexName: "events_tags_ix_7654321" });
        expect(indexMatchesSpec(gin, shape({ method: "gin", keys: ["tags"], options: [0] }))).toBe(true);
    });

    it("plans one rename per declared index, never twice, never over a Rebase name, never when the name is held", () => {
        const shapes = [shape(), shape({ index: "events_kind_at_twin" }), shape({ index: "events_kind_at_ix_abcdef0" })];
        expect(planIndexAdoptions([spec()], shapes)).toEqual([
            { schema: "public", table: "events", from: "events_kind_at", to: "events_kind_at_ix_1234567" }
        ]);
        expect(planIndexAdoptions([spec()], [...shapes, shape({ index: "events_kind_at_ix_1234567" })])).toEqual([]);
        expect(planIndexAdoptions([spec()], [shape({ index: "events_kind_at_ix_abcdef0" })])).toEqual([]);
    });

    it("renders the rename quoted", () => {
        expect(indexAdoptionStatement({ schema: "public", table: "events", from: "a\"b", to: "events_kind_at_ix_1234567" }))
            .toBe('ALTER INDEX "public"."a""b" RENAME TO "events_kind_at_ix_1234567";');
    });

    it("writes a migration's declared indexes IF NOT EXISTS, and leaves the others as Atlas wrote them", () => {
        const sql = [
            'CREATE INDEX "events_kind_at_ix_1234567" ON "public"."events" ("kind", "at" DESC);',
            'CREATE UNIQUE INDEX "events_code_ux_89abcde" ON "public"."events" ("code");',
            'CREATE INDEX "hand_made" ON "public"."events" ("kind");',
            'CREATE INDEX IF NOT EXISTS "events_tags_ix_7654321" ON "public"."events" USING gin ("tags");'
        ].join("\n");
        const result = declaredIndexesIfNotExists(sql);
        expect(result.rewritten).toBe(2);
        expect(result.sql).toBe([
            'CREATE INDEX IF NOT EXISTS "events_kind_at_ix_1234567" ON "public"."events" ("kind", "at" DESC);',
            'CREATE UNIQUE INDEX IF NOT EXISTS "events_code_ux_89abcde" ON "public"."events" ("code");',
            'CREATE INDEX "hand_made" ON "public"."events" ("kind");',
            'CREATE INDEX IF NOT EXISTS "events_tags_ix_7654321" ON "public"."events" USING gin ("tags");'
        ].join("\n"));
    });
});
