/**
 * Every editable attribute of every property type, classified against the
 * schema it actually produces.
 *
 * The classifier used to decide "does this change the database?" from a
 * hand-written list of property fields — `type`, `columnType`, `dimensions`,
 * `isId`, `validation.max`, `precision`, `scale`. Everything else the planner
 * reads was invisible to it: an integer toggle, a string becoming an enum, an
 * array's element type, a relation's target, kind, `localKey` or `onDelete`, a
 * `hasMany` whose link column nothing creates. Each was planned "safe, no
 * change", committed, and never applied; the next `db push` met a destructive
 * change nobody had been told about.
 *
 * Two checks per row:
 *
 * - **the oracle**: when the DDL rendered from `after` differs from the DDL
 *   rendered from `before`, the classification is not empty. A new kind of
 *   edit cannot slip through as "no change" while it changes the schema.
 * - **the verdict** the row expects, so a difference is not merely noticed but
 *   judged: what the ensure path can do is `safe`, what it cannot is refused.
 *
 * To see the oracle fail, make `classifyTable` ignore one column attribute.
 */
import type { CollectionConfig } from "@rebasepro/types";
import { classifyCollectionChanges, type SchemaFacts } from "../src/schema/classify-change";
import { generateSchemaCommit } from "../src/schema/generate-schema-commit";
import { planSchema } from "../src/schema/plan/plan-schema";
import { renderPostgresDdl, renderTriggersDdl, renderPgType } from "../src/schema/plan/render-ddl";
import type { SchemaPlan } from "../src/schema/plan/types";

type Props = Record<string, unknown>;
type Verdict = "none" | "safe" | "diverges" | "needs-migration";

const str = (over: Props = {}) => ({ type: "string", name: "S", ...over });
const num = (over: Props = {}) => ({ type: "number", name: "N", ...over });

/**
 * The collections every row starts from. Relations name their target by slug
 * here and are given a thunk into the same set when the set is built, so the
 * planner resolves them exactly as it would a project's.
 */
function world(sides: { posts?: Props; authors?: Props; postsExtra?: Props }): CollectionConfig[] {
    const set: Record<string, Record<string, unknown>> = {
        authors: {
            slug: "authors", name: "Authors", table: "authors",
            properties: { id: str({ isId: "uuid" }), name: str(), ...(sides.authors ?? {}) }
        },
        people: {
            slug: "people", name: "People", table: "people",
            properties: { id: num({ isId: "increment" }), name: str() }
        },
        tags: {
            slug: "tags", name: "Tags", table: "tags",
            properties: { id: str({ isId: "uuid" }), label: str() }
        },
        posts: {
            slug: "posts", name: "Posts", table: "posts",
            properties: { id: str({ isId: "uuid" }), ...(sides.posts ?? {}) },
            ...(sides.postsExtra ?? {})
        }
    };
    const link = (value: unknown): unknown => {
        if (Array.isArray(value)) return value.map(link);
        if (!value || typeof value !== "object") return value;
        const out: Record<string, unknown> = {};
        for (const [key, child] of Object.entries(value)) {
            out[key] = key === "target" && typeof child === "string" ? () => set[child] : link(child);
        }
        return out;
    };
    for (const collection of Object.values(set)) collection.properties = link(collection.properties);
    return Object.values(set) as unknown as CollectionConfig[];
}

/** The physical schema a set asks for: tables, types, constraints, indexes, triggers. Not policies. */
const ddl = (plan: SchemaPlan): string =>
    renderPostgresDdl(plan, { includePolicies: false }) + renderTriggersDdl(plan);

/** A database built from `before`, holding rows unless the row says otherwise. */
function factsFrom(plan: SchemaPlan, populated: boolean): SchemaFacts & { columnTypes: Map<string, string> } {
    const tables = new Map<string, Set<string>>();
    const columnTypes = new Map<string, string>();
    for (const table of plan.tables) {
        tables.set(table.qualified, new Set(table.columns.map(c => c.column)));
        for (const column of table.columns) columnTypes.set(`${table.qualified}.${column.column}`, renderPgType(column.type));
    }
    return {
        tables,
        columnTypes,
        populatedTables: new Set(populated ? plan.tables.map(t => t.qualified) : []),
        notNullColumns: new Set(plan.tables.flatMap(t => t.columns.filter(c => !c.nullable).map(c => `${t.qualified}.${c.column}`))),
        enumValues: new Map(plan.enums.map(e => [e.qualified, e.labels]))
    };
}

interface Row {
    before: Parameters<typeof world>[0];
    after: Parameters<typeof world>[0];
    verdict: Verdict;
    /** The change kind the row must produce, when it matters which. */
    kind?: string;
    /** Something the detail must say. */
    says?: RegExp;
    empty?: boolean;
}

const author = (over: Props = {}) => ({
    type: "relation", name: "Author",
    relation: { kind: "belongsTo", target: "authors", ...over }
});

const ROWS: Record<string, Row> = {
    // ── string ───────────────────────────────────────────────────────────
    "string: presentation only": {
        before: { posts: { title: str() } },
        after: { posts: { title: str({ name: "Headline", description: "x", admin: { readOnly: true } }) } },
        verdict: "none"
    },
    "string: text → varchar": {
        before: { posts: { title: str() } },
        after: { posts: { title: str({ columnType: "varchar" }) } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "string: varchar width narrowed": {
        before: { posts: { title: str({ columnType: "varchar", validation: { max: 500 } }) } },
        after: { posts: { title: str({ columnType: "varchar", validation: { max: 50 } }) } },
        verdict: "needs-migration", kind: "change-property-type", says: /VARCHAR\(500\) to VARCHAR\(50\)/
    },
    "string: max on a text column": {
        before: { posts: { title: str({ validation: { max: 500 } }) } },
        after: { posts: { title: str({ validation: { max: 50 } }) } },
        verdict: "none"
    },
    "string: text → enum": {
        before: { posts: { status: str() } },
        after: { posts: { status: str({ enum: ["draft", "live"] }) } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "string: enum → text": {
        before: { posts: { status: str({ enum: ["draft", "live"] }) } },
        after: { posts: { status: str() } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "string: enum gains a value": {
        before: { posts: { status: str({ enum: ["draft"] }) } },
        after: { posts: { status: str({ enum: ["draft", "live"] }) } },
        verdict: "safe", kind: "add-enum-value"
    },
    "string: enum loses a value": {
        before: { posts: { status: str({ enum: ["draft", "live"] }) } },
        after: { posts: { status: str({ enum: ["draft"] }) } },
        verdict: "needs-migration", kind: "remove-enum-value"
    },
    "string: becomes required on a populated table": {
        before: { posts: { title: str() } },
        after: { posts: { title: str({ validation: { required: true } }) } },
        verdict: "diverges", kind: "change-required"
    },
    "string: becomes required on an empty table": {
        before: { posts: { title: str() } },
        after: { posts: { title: str({ validation: { required: true } }) } },
        verdict: "safe", kind: "change-required", empty: true
    },
    "string: no longer required": {
        before: { posts: { title: str({ validation: { required: true } }) } },
        after: { posts: { title: str() } },
        verdict: "safe", kind: "change-required"
    },
    "string: becomes unique": {
        before: { posts: { slug: str() } },
        after: { posts: { slug: str({ validation: { unique: true } }) } },
        verdict: "needs-migration", kind: "change-constraint"
    },
    "string: gains a default": {
        before: { posts: { title: str() } },
        after: { posts: { title: str({ defaultValue: "untitled" }) } },
        verdict: "safe", kind: "change-default"
    },
    "string: default changes": {
        before: { posts: { title: str({ defaultValue: "a" }) } },
        after: { posts: { title: str({ defaultValue: "b" }) } },
        verdict: "safe", kind: "change-default"
    },
    "string: column renamed": {
        before: { posts: { title: str() } },
        after: { posts: { title: str({ columnName: "headline" }) } },
        verdict: "needs-migration", kind: "rename-column"
    },
    "string: key renamed, column kept": {
        before: { posts: { title: str() } },
        after: { posts: { headline: str({ columnName: "title" }) } },
        verdict: "safe", kind: "rename-property", says: /no data moves/
    },
    "string: → uuid column": {
        before: { posts: { ref: str() } },
        after: { posts: { ref: str({ columnType: "uuid" }) } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "string: → number": {
        before: { posts: { views: str() } },
        after: { posts: { views: num() } },
        verdict: "needs-migration", kind: "change-property-type", says: /string to number/
    },
    "string: added optional": {
        before: { posts: {} },
        after: { posts: { subtitle: str() } },
        verdict: "safe", kind: "add-property", says: /column "subtitle"/
    },
    "string: removed": {
        before: { posts: { subtitle: str() } },
        after: { posts: {} },
        verdict: "needs-migration", kind: "remove-property"
    },
    // ── number ───────────────────────────────────────────────────────────
    "number: integer toggled": {
        before: { posts: { price: num() } },
        after: { posts: { price: num({ validation: { integer: true } }) } },
        verdict: "needs-migration", kind: "change-property-type", says: /NUMERIC to INTEGER/
    },
    "number: → bigint": {
        before: { posts: { views: num({ columnType: "integer" }) } },
        after: { posts: { views: num({ columnType: "bigint" }) } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "number: precision and scale": {
        before: { posts: { price: num() } },
        after: { posts: { price: num({ precision: 10, scale: 2 }) } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "number: default changes": {
        before: { posts: { stock: num({ defaultValue: 0 }) } },
        after: { posts: { stock: num({ defaultValue: 1 }) } },
        verdict: "safe", kind: "change-default"
    },
    // ── boolean ──────────────────────────────────────────────────────────
    "boolean: gains a default": {
        before: { posts: { featured: { type: "boolean", name: "F" } } },
        after: { posts: { featured: { type: "boolean", name: "F", defaultValue: false } } },
        verdict: "safe", kind: "change-default"
    },
    "boolean: → string": {
        before: { posts: { featured: { type: "boolean", name: "F" } } },
        after: { posts: { featured: str() } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    // ── date ─────────────────────────────────────────────────────────────
    "date: timestamp → date": {
        before: { posts: { published: { type: "date", name: "P" } } },
        after: { posts: { published: { type: "date", name: "P", columnType: "date" } } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "date: stamped on update": {
        before: { posts: { updated: { type: "date", name: "U" } } },
        after: { posts: { updated: { type: "date", name: "U", autoValue: "on_update" } } },
        verdict: "safe"
    },
    "date: no longer stamped on update": {
        before: { posts: { updated: { type: "date", name: "U", autoValue: "on_update" } } },
        after: { posts: { updated: { type: "date", name: "U" } } },
        verdict: "needs-migration", kind: "change-constraint"
    },
    // ── map, array, geopoint, vector, binary ─────────────────────────────
    "map: jsonb → json": {
        before: { posts: { meta: { type: "map", name: "M", properties: {} } } },
        after: { posts: { meta: { type: "map", name: "M", properties: {}, columnType: "json" } } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "map: a child property added": {
        before: { posts: { meta: { type: "map", name: "M", properties: { a: str() } } } },
        after: { posts: { meta: { type: "map", name: "M", properties: { a: str(), b: str() } } } },
        verdict: "none"
    },
    "array: of string → of number": {
        before: { posts: { scores: { type: "array", name: "A", of: str() } } },
        after: { posts: { scores: { type: "array", name: "A", of: num() } } },
        verdict: "needs-migration", kind: "change-property-type", says: /TEXT\[\] to NUMERIC\[\]/
    },
    "array: element renamed": {
        before: { posts: { scores: { type: "array", name: "A", of: str() } } },
        after: { posts: { scores: { type: "array", name: "A", of: str({ name: "Score" }) } } },
        verdict: "none"
    },
    "geopoint: presentation only": {
        before: { posts: { place: { type: "geopoint", name: "G" } } },
        after: { posts: { place: { type: "geopoint", name: "Place" } } },
        verdict: "none"
    },
    "vector: dimensions": {
        before: { posts: { embedding: { type: "vector", name: "E", dimensions: 1536 } } },
        after: { posts: { embedding: { type: "vector", name: "E", dimensions: 768 } } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    "binary: → string": {
        before: { posts: { blob: { type: "binary", name: "B" } } },
        after: { posts: { blob: str() } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    // ── reference ────────────────────────────────────────────────────────
    "reference: path to a collection keyed differently": {
        before: { posts: { owner: { type: "reference", name: "O", path: "authors" } } },
        after: { posts: { owner: { type: "reference", name: "O", path: "people" } } },
        verdict: "needs-migration", kind: "change-property-type"
    },
    // ── relation: belongsTo ──────────────────────────────────────────────
    "belongsTo: added": {
        before: { posts: {} },
        after: { posts: { author: author() } },
        verdict: "safe", kind: "add-property", says: /column "author_id"/
    },
    "belongsTo: removed": {
        before: { posts: { author: author() } },
        after: { posts: {} },
        verdict: "needs-migration", kind: "remove-property", says: /author_id/
    },
    "belongsTo: target keyed differently (authors uuid → people int)": {
        before: { posts: { author: author() } },
        after: { posts: { author: author({ target: "people" }) } },
        verdict: "needs-migration"
    },
    "belongsTo → manyToMany": {
        before: { posts: { author: author() } },
        after: { posts: { author: { type: "relation", name: "Author", relation: { kind: "manyToMany", target: "authors" } } } },
        verdict: "needs-migration", kind: "change-relation"
    },
    "belongsTo: localKey moved": {
        before: { posts: { author: author() } },
        after: { posts: { author: author({ localKey: "writer_id" }) } },
        verdict: "needs-migration", kind: "change-relation", says: /author_id/
    },
    "belongsTo: on delete set null → cascade": {
        before: { posts: { author: author({ onDelete: "set null" }) } },
        after: { posts: { author: author({ onDelete: "cascade" }) } },
        verdict: "needs-migration", kind: "change-relation", says: /CASCADE/
    },
    "belongsTo: becomes required on a populated table": {
        before: { posts: { author: author() } },
        after: { posts: { author: { ...author({ onDelete: "set null" }), validation: { required: true } } } },
        verdict: "diverges"
    },
    // ── relation: manyToMany ─────────────────────────────────────────────
    "manyToMany: added": {
        before: { posts: {} },
        after: { posts: { tags: { type: "relation", name: "T", relation: { kind: "manyToMany", target: "tags" } } } },
        verdict: "safe", kind: "add-property", says: /junction table/
    },
    "manyToMany: removed": {
        before: { posts: { tags: { type: "relation", name: "T", relation: { kind: "manyToMany", target: "tags" } } } },
        after: { posts: {} },
        verdict: "needs-migration", kind: "remove-property", says: /junction table/
    },
    // ── relation: hasMany ────────────────────────────────────────────────
    "hasMany: added over an existing link column": {
        before: { posts: { author: author() } },
        after: {
            posts: { author: author() },
            authors: { posts: { type: "relation", name: "P", relation: { kind: "hasMany", target: "posts", foreignKeyOnTarget: "author_id" } } }
        },
        verdict: "safe", kind: "add-property", says: /adds no column/
    },
    "hasMany: added over a link column nothing creates": {
        before: { posts: { author: author() } },
        after: {
            posts: { author: author() },
            authors: { posts: { type: "relation", name: "P", relation: { kind: "hasMany", target: "posts", foreignKeyOnTarget: "writer_id" } } }
        },
        verdict: "needs-migration", kind: "change-relation", says: /writer_id/
    },
    "hasMany: removed": {
        before: {
            posts: { author: author() },
            authors: { posts: { type: "relation", name: "P", relation: { kind: "hasMany", target: "posts", foreignKeyOnTarget: "author_id" } } }
        },
        after: { posts: { author: author() } },
        verdict: "safe", kind: "remove-property"
    },
    // ── collection-level ─────────────────────────────────────────────────
    "an index declared": {
        before: { posts: { title: str() } },
        after: { posts: { title: str() }, postsExtra: { indexes: [{ on: ["title"], reason: "list by title" }] } },
        verdict: "safe", kind: "change-constraint"
    },
    "a unique index no longer declared": {
        before: { posts: { title: str() }, postsExtra: { indexes: [{ on: ["title"], unique: true, reason: "one per title" }] } },
        after: { posts: { title: str() } },
        verdict: "needs-migration", kind: "change-constraint"
    }
};

describe("classifying from the plan, attribute by attribute", () => {
    it.each(Object.entries(ROWS))("%s", (_name, row) => {
        const before = world(row.before);
        const after = world(row.after);
        const beforePlan = planSchema(before);
        const afterPlan = planSchema(after);
        const facts = factsFrom(beforePlan, !row.empty);

        const result = classifyCollectionChanges(before, after, facts);

        // The oracle: a schema that changed is a change.
        if (ddl(beforePlan) !== ddl(afterPlan)) {
            expect(result.changes.length).toBeGreaterThan(0);
        }

        if (row.verdict === "none") {
            expect(result.changes).toEqual([]);
            expect(ddl(beforePlan)).toBe(ddl(afterPlan));
            return;
        }
        expect(result.verdict).toBe(row.verdict);
        if (row.kind) expect(result.changes.map(c => c.kind)).toContain(row.kind);
        if (row.says) expect(result.changes.map(c => c.detail).join("\n")).toMatch(row.says);
    });
});

describe("what a default change runs", () => {
    it("sets the new default on a column that had one, which the additive ensure never does", async () => {
        const before = world({ posts: { title: str({ defaultValue: "a" }) } });
        const after = world({ posts: { title: str({ defaultValue: "b" }) } });
        const commit = await generateSchemaCommit({ before, after, existing: { ...factsFrom(planSchema(before), true), enums: new Set() } });
        expect(commit.statements).toContain(`ALTER TABLE "public"."posts" ALTER COLUMN "title" SET DEFAULT 'b';`);
    });

    it("drops a default that is no longer declared", async () => {
        const before = world({ posts: { title: str({ defaultValue: "a" }) } });
        const after = world({ posts: { title: str() } });
        const commit = await generateSchemaCommit({ before, after, existing: { ...factsFrom(planSchema(before), true), enums: new Set() } });
        expect(commit.statements).toContain(`ALTER TABLE "public"."posts" ALTER COLUMN "title" DROP DEFAULT;`);
    });
});
