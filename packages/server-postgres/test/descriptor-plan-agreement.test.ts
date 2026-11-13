/**
 * The descriptor and the plan agree on every name the descriptor states.
 *
 * `compileTables` derives table, column, foreign-key and junction names itself
 * — it is what `GET /api/schema/tables`, the SDK generator and the panel read.
 * The planner derives the same names from the compiled tables, and the
 * planner is what creates the database. If the two ever disagree, a client is
 * told about a column the database does not have. So for each set of tables,
 * this compiles the descriptors and plans the compiled tables, and checks:
 *
 * - each table's SQL name and schema;
 * - each column's SQL name, key, nullability, primary-key membership and
 *   uniqueness, in physical order (the plan may add only auth, search and
 *   junction columns the descriptor does not state);
 * - the foreign-key column of each `belongsTo`, and its constraint;
 * - each junction table and its two key columns;
 * - each enum type and its labels;
 * - each view.
 */
import { describe, expect, it } from "@jest/globals";
import { col, defineAuthTable, defineTable, defineView, rel } from "@rebasepro/types";
import type { AnyTableDef, AnyViewDef, ColumnDescriptor, DefaultRls, TableDescriptor } from "@rebasepro/types";
import { compileTables, isSchemaDefinitionError, compileSchema } from "@rebasepro/common";
import { collectionsToTableDefs } from "@rebasepro/common/migrate";

import { planSchema } from "../src/schema/plan/plan-schema";
import type { ColumnPlan, SchemaPlan, TablePlan } from "../src/schema/plan/types";
import { loadPlanCorpus, withPinnedPlannerWorld, type PlanCorpus } from "./helpers/plan-corpus";
import { TABLE_FEATURES } from "./fixtures/table-features";

type Def = AnyTableDef | AnyViewDef;

/** The columns the plan adds that a descriptor does not state. */
const PLAN_ONLY_SOURCES = new Set(["auth", "search"]);

/** The SQL columns of a table's primary key, however the plan records it. */
function planKeyColumns(table: TablePlan): string[] {
    return table.primaryKey.length > 0 ? [...table.primaryKey] : table.columns.filter(c => c.primaryKey).map(c => c.column);
}

function enumName(column: ColumnDescriptor, table: string): string | undefined {
    const type = column.type.kind === "array" ? column.type.of : column.type;
    if (type.kind !== "enum") return undefined;
    return type.name ?? `${table}_${column.column}`;
}

/** Every disagreement between the descriptors and the plan, as readable lines. */
export function disagreements(descriptors: readonly TableDescriptor[], plan: SchemaPlan): string[] {
    const out: string[] = [];
    const tableOf = (descriptor: TableDescriptor): TablePlan | undefined =>
        plan.tables.find(t => t.kind === "collection" && t.slug === descriptor.slug);
    for (const descriptor of descriptors) {
        const where = `${descriptor.name}`;
        if (descriptor.kind === "view") {
            const view = plan.views.find(v => v.name === descriptor.table && v.schema === descriptor.schema);
            if (!view) out.push(`${where}: the plan has no view ${descriptor.schema}.${descriptor.table}`);
            else {
                if (view.materialized !== (descriptor.view?.materialized ?? false)) out.push(`${where}: materialized differs`);
                const keys = descriptor.primaryKey.map(key => descriptor.columns.find(c => c.key === key)?.column);
                if (JSON.stringify(view.idColumns) !== JSON.stringify(keys)) out.push(`${where}: view id columns ${JSON.stringify(view.idColumns)} ≠ ${JSON.stringify(keys)}`);
            }
            continue;
        }
        const table = tableOf(descriptor);
        if (!table) {
            out.push(`${where}: the plan has no table for slug "${descriptor.slug}"`);
            continue;
        }
        if (table.table !== descriptor.table) out.push(`${where}: table "${table.table}" ≠ "${descriptor.table}"`);
        if (table.schema !== descriptor.schema) out.push(`${where}: schema "${table.schema}" ≠ "${descriptor.schema}"`);
        if (table.auth !== (descriptor.auth !== undefined)) out.push(`${where}: auth ${table.auth} ≠ ${descriptor.auth !== undefined}`);

        // A relation whose column a declared property owns is planned as a second
        // entry the renderers skip (`columnOwnedByProperty`): the bound column.
        const planned = table.columns.filter(c => !PLAN_ONLY_SOURCES.has(c.source.kind) && !c.columnOwnedByProperty);
        const order = (columns: readonly { column: string }[]) => columns.map(c => c.column).join(", ");
        if (order(planned) !== order(descriptor.columns)) {
            out.push(`${where}: columns [${order(planned)}] ≠ [${order(descriptor.columns)}]`);
        }
        const planKeys = planKeyColumns(table);
        const descriptorKeys = descriptor.primaryKey.map(key => descriptor.columns.find(c => c.key === key)?.column);
        if (JSON.stringify(planKeys) !== JSON.stringify(descriptorKeys)) out.push(`${where}: primary key [${planKeys}] ≠ [${descriptorKeys}]`);
        const composite = descriptor.primaryKey.length > 1;
        for (const column of descriptor.columns) {
            const p: ColumnPlan | undefined = planned.find(c => c.column === column.column);
            const at = `${where}.${column.key}`;
            if (!p) continue;
            if (p.key !== column.key) out.push(`${at}: key "${p.key}" ≠ "${column.key}"`);
            if (p.nullable !== column.nullable) out.push(`${at}: nullable ${p.nullable} ≠ ${column.nullable}`);
            // A composite key is a table constraint in the plan, not a column flag.
            const planPk = composite ? planKeys.includes(p.column) : p.primaryKey;
            if (planPk !== (column.primaryKey === true)) out.push(`${at}: primaryKey ${planPk} ≠ ${column.primaryKey === true}`);
            if (p.unique !== (column.unique === true)) out.push(`${at}: unique ${p.unique} ≠ ${column.unique === true}`);
            const name = enumName(column, descriptor.table);
            if (name !== undefined && !column.derived) {
                const planned = plan.enums.find(e => e.name === name);
                const values = column.type.kind === "enum" ? column.type.values : column.type.kind === "array" && column.type.of.kind === "enum" ? column.type.of.values : [];
                if (!planned) out.push(`${at}: the plan has no enum type "${name}"`);
                else if (JSON.stringify(planned.labels) !== JSON.stringify(values)) out.push(`${at}: enum labels ${JSON.stringify(planned.labels)} ≠ ${JSON.stringify(values)}`);
            }
        }
        for (const relation of descriptor.relations) {
            const at = `${where}.${relation.name}`;
            if (relation.kind === "belongsTo") {
                // The foreign key rides on the relation's own entry, which is the
                // owned one when the column is declared.
                const p = table.columns.find(c => c.column === relation.localKey && c.foreignKey)
                    ?? table.columns.find(c => c.column === relation.localKey);
                if (!p) {
                    out.push(`${at}: the plan has no foreign-key column "${relation.localKey}"`);
                    continue;
                }
                const target = descriptors.find(d => d.slug === relation.target);
                if (relation.constraint && !p.foreignKey) out.push(`${at}: the plan has no foreign key on "${relation.localKey}"`);
                if (p.foreignKey && target && p.foreignKey.targetTable !== target.table) {
                    out.push(`${at}: the foreign key points at "${p.foreignKey.targetTable}", not "${target.table}"`);
                }
                if (!relation.constraint && p.foreignKey) out.push(`${at}: the plan has a foreign key the descriptor says is not there`);
            }
            if (relation.kind === "manyToMany") {
                const junction = plan.tables.find(t => t.kind === "junction" && t.table === relation.through.table);
                if (!junction) {
                    out.push(`${at}: the plan has no junction table "${relation.through.table}"`);
                    continue;
                }
                for (const key of [relation.through.sourceKey, relation.through.targetKey]) {
                    if (!junction.columns.some(c => c.column === key)) out.push(`${at}: junction "${junction.table}" has no column "${key}"`);
                }
                for (const pivot of relation.through.pivot) {
                    if (!junction.columns.some(c => c.column === pivot.column)) out.push(`${at}: junction "${junction.table}" has no pivot column "${pivot.column}"`);
                }
            }
        }
    }
    return out;
}

function agreementOf(defs: readonly Def[], defaultRls?: DefaultRls): string[] {
    return withPinnedPlannerWorld(() => {
        const options = defaultRls === undefined ? {} : { defaultRls };
        const descriptors = compileTables(defs, options);
        const plan = planSchema(compileSchema(defs, options));
        return disagreements(descriptors, plan);
    });
}

// ── A set written in the new model, covering every derivation ────────────────

const users = defineAuthTable("users", {
    schema: "rebase",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        email: col.text().notNull().unique(),
        displayName: col.text(),
        passwordHash: col.text()
    },
    rls: "admin-only"
});

const categories = defineTable("categories", {
    columns: { id: col.serial().primaryKey(), name: col.text().notNull() },
    rls: "inherit"
});

const tags = defineTable("tags", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), label: col.varchar({ length: 40 }).notNull().unique() },
    rls: "inherit"
});

const comments: AnyTableDef = defineTable("comments", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.text().notNull(),
        postId: col.uuid().notNull()
    },
    relations: { post: rel.belongsTo(() => posts) },
    rls: [{ operation: "select", access: "public" }]
});

const posts = defineTable("posts", {
    slug: "blog_posts",
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        status: col.enum(["draft", "published"]).notNull().default("draft"),
        labels: col.text().array(),
        orgId: col.uuid(),
        createdAt: col.timestamp({ withTimezone: true }).notNull().onCreateNow(),
        deletedAt: col.timestamp({ withTimezone: true }),
        __order: col.text()
    },
    relations: {
        author: rel.belongsTo(() => users, { notNull: true }),
        category: rel.belongsTo(() => categories, { index: false }),
        tags: rel.manyToMany(() => tags, { pivot: { sortOrder: col.integer().default(0) } }),
        comments: rel.hasMany(() => comments)
    },
    rls: [
        { operation: "select", access: "public" },
        { operations: ["insert", "update", "delete"], roles: ["editor"] }
    ],
    tenant: { field: "orgId", from: { claim: "org_id" } },
    softDelete: true,
    search: { fields: ["title"] }
});

const memberships = defineTable("memberships", {
    columns: { userId: col.uuid().primaryKey(), orgId: col.uuid().primaryKey(), role: col.text().notNull() },
    rls: "admin-only"
});

const published = defineView("published_posts", {
    query: "select id, title from posts where status = 'published'",
    columns: { id: col.uuid().primaryKey(), title: col.text().notNull() }
});

describe("descriptor ↔ plan agreement", () => {
    it("agrees on a set written in the new model", () => {
        expect(agreementOf([users, categories, tags, posts, comments, memberships, published], "admin-only")).toEqual([]);
    });

    it("agrees on the features only the table model states (test/fixtures/table-features.ts)", () => {
        expect(agreementOf(TABLE_FEATURES)).toEqual([]);
    });

    it("notices a descriptor that states a name the plan does not have", () => {
        const defs = [users, categories, tags, posts, comments];
        const lines = withPinnedPlannerWorld(() => {
            const descriptors = compileTables(defs, { defaultRls: "admin-only" });
            const plan = planSchema(compileSchema(defs, { defaultRls: "admin-only" }));
            const tampered = descriptors.map(d => d.name !== "posts" ? d : {
                ...d,
                table: "articles",
                columns: d.columns.map(c => c.key === "title" ? { ...c, column: "headline", nullable: true } : c),
                relations: d.relations.map(r => r.kind === "manyToMany" ? { ...r, through: { ...r.through, table: "post_tag_links" } } : r)
            });
            return disagreements(tampered, plan);
        });
        expect(lines).toEqual(expect.arrayContaining([
            "posts: table \"posts\" ≠ \"articles\"",
            expect.stringMatching(/^posts: columns \[id, title, .*\] ≠ \[id, headline, /),
            "posts.tags: the plan has no junction table \"post_tag_links\""
        ]));
    });
});

// ── Every corpus set, lifted from its collections ────────────────────────────

describe("descriptor ↔ plan agreement on the plan-golden corpus", () => {
    let corpus: PlanCorpus;
    beforeAll(async () => {
        corpus = await loadPlanCorpus();
    }, 120_000);
    afterAll(() => corpus?.dispose());

    it("agrees on every set the lift can express", () => {
        const report: Record<string, string[]> = {};
        const notLifted: string[] = [];
        for (const set of corpus.sets) {
            withPinnedPlannerWorld(() => {
                let lifted: ReturnType<typeof collectionsToTableDefs>;
                try {
                    lifted = collectionsToTableDefs(set.collections);
                } catch (error) {
                    if (!isSchemaDefinitionError(error)) throw error;
                    notLifted.push(set.id);
                    return;
                }
                const options = lifted.defaultRls === undefined ? {} : { defaultRls: lifted.defaultRls };
                const descriptors = compileTables(lifted.tables, options);
                const plan = planSchema(compileSchema(lifted.tables, options));
                report[set.id] = disagreements(descriptors, plan);
            });
        }
        const failing = Object.fromEntries(Object.entries(report).filter(([, lines]) => lines.length > 0));
        expect(failing).toEqual({});
        // A set the lift refuses is checked by nothing here, so the list is
        // explicit, and shrinks as the lift learns to state those collections.
        expect(notLifted).toEqual(NOT_LIFTED);
        expect(Object.keys(report).length + notLifted.length).toBe(corpus.sets.length);
    });
});

/**
 * Corpus sets holding a collection `collectionsToTableDefs` refuses, each with
 * its own message: the property matrix declares a tuple array and a `via`
 * without a join path, which the table model cannot state. Remove a set once
 * it lifts.
 */
const NOT_LIFTED: string[] = ["property-matrix"];
