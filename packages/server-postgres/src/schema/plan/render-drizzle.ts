/**
 * `schema.generated.ts`, rendered from a {@link SchemaPlan}.
 *
 * This file is what a developer running drizzle-kit themselves diffs against,
 * and what the runtime's query builder is typed by. It has to *compile*, which
 * nothing in this repo checked until `generated-schema-compiles.test.ts`: six
 * ordinary inputs used to produce a file TypeScript rejects, and the class the
 * bigint incident already taught is that a file which will not build gets
 * hand-patched and then sits stale until a security fix misses production.
 *
 * Two structural rules keep that from coming back:
 *
 * - **The import list is derived from what was emitted.** Every builder is
 *   recorded as it is used ({@link BuilderUses}), and the header is written
 *   last, from that set. It used to be a fixed roster plus three
 *   property-scanning heuristics, so `columnType: "uuid"` on a plain string
 *   emitted `uuid(…)` and imported nothing.
 * - **Nothing here reads a `Property`.** Types, defaults, keys and constraints
 *   all arrive decided. The Drizzle generator disagreeing with the DDL one is
 *   what left `geopoint` with a database column and no Drizzle key.
 */
import type { ColumnPlan, ForeignKeyPlan, PgType, PolicyPlan, RelationPlan, SchemaPlan, TablePlan } from "./types";
import { renderPredicate } from "../collection-index";

/** What the generated file may leave out. */
export interface DrizzleRenderOptions {
    /**
     * `false` strips the `pgPolicy(...)` calls. RLS is still enabled on every
     * table regardless — a bare table must default-deny, not fail open.
     */
    policies?: boolean;
}

const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A string literal for the generated file.
 *
 * Column names, table names and enum values are all written in as literals and
 * none of them is constrained to be quote-free: a Postgres identifier only has
 * to be quoted, and `O'Brien` is an ordinary enum value. Interpolating them raw
 * ended the literal early.
 */
const quote = (value: string): string => JSON.stringify(value);

/** An object key: verbatim when it is an identifier, quoted otherwise. */
const propKey = (name: string): string => (JS_IDENTIFIER.test(name) ? name : quote(name));

/**
 * A property access on a generated table variable.
 *
 * `users.full name` is not an expression; `users["full name"]` is, and Drizzle
 * treats the two identically.
 */
const member = (object: string, key: string): string =>
    (JS_IDENTIFIER.test(key) ? `${object}.${key}` : `${object}[${quote(key)}]`);

/**
 * The drizzle-orm builders this file emitted, collected as they are written.
 * The only way to use a builder is to record it here.
 */
type BuilderUses = Set<string>;

/** Record a builder and hand back its name, so a call site cannot use one silently. */
const needs = (uses: BuilderUses, builder: string): string => {
    uses.add(builder);
    return builder;
};

/**
 * Wraps a compiled SQL clause in a Drizzle `sql\`...\`` template literal.
 *
 * The clause is SQL being written into a TypeScript file, so it has to survive
 * being read back as a template literal. Three characters do not:
 *
 * - `` ` `` closes the template early, and the rest of the clause becomes code.
 * - `${` opens an interpolation — the file stops compiling, or worse, compiles
 *   against whatever identifier happens to be in scope.
 * - `\` is an escape, and Drizzle's `sql` tag reads the *cooked* strings, not
 *   `.raw`. So a policy written as `email ~ '^admin\.user@corp\.com$'` reached
 *   the database as `^admin.user@corp.com$`, where every `\.` now matches any
 *   character. A `USING` clause is a security boundary and that one silently
 *   widened it.
 */
const wrapSql = (clause: string): string =>
    `sql\`${clause.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;

/** The pg-core builder call for a tagged type, minus the column name. */
const builderFor = (type: PgType, column: string, uses: BuilderUses): string => {
    const name = quote(column);
    switch (type.kind) {
        case "text": return `${needs(uses, "text")}(${name})`;
        case "varchar": return `${needs(uses, "varchar")}(${name}, { length: ${type.length} })`;
        case "char": return `${needs(uses, "char")}(${name}, { length: ${type.length} })`;
        case "uuid": return `${needs(uses, "uuid")}(${name})`;
        // The enum variable is declared at the top of the same file; it is not
        // a pg-core import.
        case "enum": return `${type.varName}(${name})`;
        case "smallint": return `${needs(uses, "smallint")}(${name})`;
        case "integer": return `${needs(uses, "integer")}(${name})`;
        // `bigint` and `bigserial` are the only pg-core builders that *require*
        // a config argument: without `mode`, drizzle cannot know whether to hand
        // back a `number` or a `bigint`, and the emitted call does not
        // typecheck. This is why `schema.generated.ts` drifted — regenerating it
        // produced a file that would not compile, so the bigint lines were
        // hand-patched, and every regeneration after that looked like a large,
        // alarming diff nobody wanted to ship.
        //
        // `number` rather than `bigint`: these are counters and byte totals that
        // every caller already treats as numbers.
        case "bigint": return `${needs(uses, "bigint")}(${name}, { mode: "number" })`;
        case "bigserial": return `${needs(uses, "bigserial")}(${name}, { mode: "number" })`;
        case "serial": return `${needs(uses, "serial")}(${name})`;
        case "real": return `${needs(uses, "real")}(${name})`;
        case "doublePrecision": return `${needs(uses, "doublePrecision")}(${name})`;
        case "numeric":
            if (type.precision === undefined) return `${needs(uses, "numeric")}(${name})`;
            return type.scale === undefined
                ? `${needs(uses, "numeric")}(${name}, { precision: ${type.precision} })`
                : `${needs(uses, "numeric")}(${name}, { precision: ${type.precision}, scale: ${type.scale} })`;
        case "boolean": return `${needs(uses, "boolean")}(${name})`;
        case "timestamptz": return `${needs(uses, "timestamp")}(${name}, { withTimezone: true, mode: 'string' })`;
        case "date": return `${needs(uses, "date")}(${name}, { mode: 'string' })`;
        case "time": return `${needs(uses, "time")}(${name})`;
        case "json": return `${needs(uses, "json")}(${name})`;
        case "jsonb": return `${needs(uses, "jsonb")}(${name})`;
        case "vector": return `${needs(uses, "vector")}(${name}, { dimensions: ${type.dimensions} })`;
        case "bytea": return `${needs(uses, "customType")}({ dataType() { return 'bytea'; } })(${name})`;
        case "tsvector": return `${needs(uses, "customType")}({ dataType() { return 'tsvector'; } })(${name})`;
        // pg-core has no array *type*; `.array()` is a modifier on the element.
        case "array": return `${builderFor(type.of, column, uses)}.array()`;
    }
};

/**
 * The `.references(...)` clause a foreign key column carries.
 *
 * The `(): AnyPgColumn =>` annotation is not optional decoration and it is
 * emitted on every reference rather than only the self-referential ones. A
 * `belongsTo` pointing at its own table — a comment thread, a category tree —
 * produces `.references(() => posts.id)` inside the initializer of `posts`, and
 * TypeScript cannot infer a type for a `const` that appears in its own
 * initializer (TS7022). Drizzle documents the annotation as the fix; applying
 * it everywhere means the generated line does not depend on whether the author
 * happened to point the relation at another table.
 */
const referencesClause = (
    fk: ForeignKeyPlan,
    targetVar: string,
    targetKey: string,
    uses: BuilderUses
): string => {
    needs(uses, "type AnyPgColumn");
    const parts = [
        fk.onUpdate ? `onUpdate: "${fk.onUpdate.toLowerCase()}"` : "",
        `onDelete: "${fk.onDelete.toLowerCase()}"`
    ].filter(Boolean);
    return `.references((): AnyPgColumn => ${member(targetVar, targetKey)}, { ${parts.join(", ")} })`;
};

/** The declaration a column compiles to, without its object key. */
const renderColumn = (column: ColumnPlan, table: TablePlan, plan: SchemaPlan, uses: BuilderUses): string => {
    let out = builderFor(column.type, column.column, uses);

    if (column.generated) {
        return `${out}.generatedAlwaysAs(${wrapSql(column.generated.expression)})`;
    }

    // A junction endpoint spells `.notNull()` before its reference; every other
    // column spells it last. Both are the same constraint — this keeps the
    // generated file byte-stable across the move to one planner.
    const junctionKey = column.source.kind === "junction-key";
    if (junctionKey) out += ".notNull()";

    if (column.default?.kind === "identity") out += ".generatedByDefaultAsIdentity()";
    if (column.primaryKey) out += ".primaryKey()";
    if (column.default && column.default.kind !== "identity") {
        const expression = column.default.kind === "sql" ? column.default.expression : column.default.sql;
        // `.defaultRandom()` is drizzle's own spelling of `gen_random_uuid()`,
        // and it exists **only on the uuid builder** — a `text` id whose
        // strategy happens to be spelled ``isId: "sql`gen_random_uuid()`"`` has
        // to take the generic form, which is what the file has always emitted
        // for it.
        out += column.type.kind === "uuid" && expression === "gen_random_uuid()"
            ? ".defaultRandom()"
            : `.default(${wrapSql(expression)})`;
    }
    // A plain property that carries a relation's foreign key column gets the
    // constraint the relation would have emitted. `postId: { columnName:
    // "post_id" }` beside a `belongsTo` on `post_id` used to emit an integer
    // with no `.references()` at all, so that project got no foreign key on the
    // Drizzle side while `db push` created one.
    const foreignKey = column.foreignKey
        ?? table.columns.find(c => c.columnOwnedByProperty && c.column === column.column)?.foreignKey;
    if (foreignKey) {
        const target = plan.tables.find(t =>
            t.schema === foreignKey.targetSchema && t.table === foreignKey.targetTable);
        if (target) {
            const targetColumn = target.columns.find(c => c.column === foreignKey.targetColumn);
            out += referencesClause(foreignKey, target.varName, targetColumn?.key ?? foreignKey.targetColumn, uses);
        }
    }
    if (column.unique) out += ".unique()";
    if (!column.nullable && !column.primaryKey && !junctionKey) out += ".notNull()";
    return out;
};

/** The declared `indexes:` block, as Drizzle table extras. */
const indexExtras = (table: TablePlan, uses: BuilderUses): string[] =>
    table.indexes.map(spec => {
        const builder = spec.unique ? needs(uses, "uniqueIndex") : needs(uses, "index");
        // The spec holds COLUMN names; the generated table is keyed by field
        // name (`authorId` for `author_id`).
        const column = (name: string): string =>
            member("table", table.columns.find(c => c.column === name)?.key ?? name);
        const keys = spec.keys.map(key => {
            if (spec.method !== "btree") return column(key.column);
            const direction = key.direction === "desc" ? ".desc()" : ".asc()";
            const nulls = key.nulls === "first" ? ".nullsFirst()" : ".nullsLast()";
            return `${column(key.column)}${direction}${nulls}`;
        });
        const on = spec.method === "btree"
            ? `.on(${keys.join(", ")})`
            : `.using(${quote(spec.method)}, ${keys.join(", ")})`;
        const where = spec.predicate ? `.where(sql\`${renderPredicate(spec.predicate)}\`)` : "";
        // drizzle-orm has no INCLUDE in its index builder (0.45), so a covering
        // index is emitted here as its key columns alone. The database still
        // gets the INCLUDE — `schema.sql` and boot-ensure both emit it.
        const covering = spec.include.length > 0
            ? ` // INCLUDE (${spec.include.join(", ")}) — drizzle cannot express it; schema.sql does`
            : "";
        return `    ${builder}(${quote(spec.indexName)})${on}${where},${covering}`;
    });

const policyExtra = (policy: PolicyPlan, uses: BuilderUses): string => {
    needs(uses, "pgPolicy");
    const parts = [
        `as: "${policy.mode}"`,
        `for: "${policy.operation}"`,
        `to: [${policy.roles.map(r => `"${r}"`).join(", ")}]`
    ];
    if (policy.using) parts.push(`using: ${wrapSql(policy.using)}`);
    if (policy.withCheck) parts.push(`withCheck: ${wrapSql(policy.withCheck)}`);
    return `    pgPolicy(${quote(policy.name)}, { ${parts.join(", ")} }),`;
};

export function renderDrizzleSchema(plan: SchemaPlan, options: DrizzleRenderOptions = {}): string {
    const withPolicies = options.policies !== false;
    const uses: BuilderUses = new Set();
    // The body is assembled first and the header composed around it, because
    // the header cannot be written until the body has said what it needs.
    let body = "";

    let schemaDeclarations = "";
    if (plan.declaredSchemas.length > 0) {
        needs(uses, "pgSchema");
        plan.declaredSchemas.forEach(schema => {
            schemaDeclarations += `export const ${schema}Schema = pgSchema("${schema}");\n`;
        });
        schemaDeclarations += "\n";
    }

    const enumVars: string[] = [];
    for (const enumPlan of plan.enums) {
        // A collection with `schema: "app"` gets `CREATE TYPE "app"."…"` from
        // the DDL renderer, so the type has to be declared in the same schema
        // here — `pgEnum` is `public` and nothing else. Unqualified, the runtime
        // and drizzle-kit looked for a type that does not exist in `public`.
        const labels = enumPlan.labels.map(quote).join(", ");
        const declaration = enumPlan.declaredSchema
            ? `${enumPlan.declaredSchema}Schema.enum(${quote(enumPlan.name)}, [${labels}])`
            : `${needs(uses, "pgEnum")}(${quote(enumPlan.name)}, [${labels}])`;
        body += `export const ${enumPlan.varName} = ${declaration};\n`;
        if (!enumVars.includes(enumPlan.varName)) enumVars.push(enumPlan.varName);
    }
    body += "\n";

    const tableVars: string[] = [];
    for (const table of plan.tables) {
        const creator = table.declaredSchema
            ? `${table.declaredSchema}Schema.table`
            : needs(uses, "pgTable");
        body += `export const ${table.varName} = ${creator}("${table.table}", {\n`;

        // The implicit `id` goes last here and first in the SQL file: the DDL
        // generator unshifts it so the key leads the `CREATE TABLE`, and this
        // one appends it after the generated search columns. Both describe the
        // same table; only the reading order differs.
        const ordered = [
            ...table.columns.filter(c => c.source.kind !== "implicit-id"),
            ...table.columns.filter(c => c.source.kind === "implicit-id")
        ].filter(c => !c.columnOwnedByProperty);

        const lines = ordered.map(column => `    ${propKey(column.key)}: ${renderColumn(column, table, plan, uses)}`);
        // A junction's column list carries a trailing comma; a collection's does
        // not. Kept as the two files have always spelled them.
        body += table.kind === "junction"
            ? `${lines.join(",\n")},\n`
            : `${lines.join(",\n")}\n`;

        const extras: string[] = [];
        if (table.kind === "junction") {
            extras.push(`    ${needs(uses, "primaryKey")}({ columns: [${table.primaryKey.map(c => member("table", c)).join(", ")}] }),`);
        } else {
            extras.push(...indexExtras(table, uses));
        }
        if (withPolicies) {
            extras.push(...table.policies.map(policy => policyExtra(policy, uses)));
        }

        if (extras.length > 0) {
            body += "}, (table) => ([\n";
            body += `${extras.join("\n")}\n`;
            body += "])).enableRLS();\n\n";
        } else {
            // No explicit policies and no declared indexes — RLS enabled with a
            // deny-all default (Postgres denies everything when RLS is on and no
            // permissive policies exist).
            body += "}).enableRLS();\n\n";
        }
        if (!tableVars.includes(table.varName)) tableVars.push(table.varName);
    }

    const relationVars: string[] = [];
    for (const table of plan.tables) {
        const entries = plan.relations.filter(r => r.tableVar === table.varName);
        if (entries.length === 0) continue;
        const rendered = entries.map(relation => renderRelation(table, relation));
        const varName = `${table.varName}Relations`;
        body += `export const ${varName} = drizzleRelations(${table.varName}, ({ one, many }) => ({\n${rendered.join(",\n")}\n}));\n\n`;
        if (!relationVars.includes(varName)) relationVars.push(varName);
    }

    // ── The header, written last because the body decides what is in it ──────
    const imports = Array.from(uses).sort((a, b) =>
        a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")));

    let out = "// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.\n\n";
    out += `import { ${imports.join(", ")} } from 'drizzle-orm/pg-core';\n`;
    out += "import { relations as drizzleRelations, sql } from 'drizzle-orm';\n\n";
    out += schemaDeclarations;
    out += body;
    out += `export const tables = { ${tableVars.join(", ")} };\n`;
    out += `export const enums = { ${enumVars.join(", ")} };\n`;
    out += `export const relations = { ${relationVars.join(", ")} };\n\n`;
    return out;
}

const renderRelation = (table: TablePlan, relation: RelationPlan): string => {
    if (relation.kind === "many") {
        return `    ${quote(relation.key)}: many(${relation.targetVar}, { relationName: ${quote(relation.relationName!)} })`;
    }
    // A `hasOne` inverse has no `fields`/`references` to give: the foreign key
    // lives on the target. `one(target, { relationName })` is not a
    // `RelationConfig` (TS2345) *and* not something the runtime survives —
    // `createOne` reads `config.fields.reduce(...)` unconditionally — so a bare
    // `one(target)` is the documented FK-less form.
    if (!relation.fields) return `    ${quote(relation.key)}: one(${relation.targetVar})`;
    return `    ${quote(relation.key)}: one(${relation.targetVar}, {\n` +
        `        fields: [${relation.fields.map(f => member(table.varName, f)).join(", ")}],\n` +
        `        references: [${relation.references!.map(r => member(relation.targetVar, r)).join(", ")}],\n` +
        `        relationName: ${quote(relation.relationName!)}\n` +
        "    })";
};
