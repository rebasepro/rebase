/**
 * The three emitters, column by column, on every property option there is.
 *
 * `getDrizzleColumn`, `getSqlColumnType` (with the `CREATE TABLE` and
 * `planRelationalColumns` around it) and `planCollectionSchemaEnsure` each read
 * a `Property` and each produce a column. They are three renderings of one
 * decision, and the audit that prompted this file found twelve open
 * disagreements between them — a required link that was NOT NULL down one path
 * and nullable down another, a `reference` that cascaded in one file and
 * restricted in the other two, `validation.unique` honoured on two types out of
 * eleven, an id whose default existed on one path only.
 *
 * Every previous test asked whether a column *exists*. This asks what it IS:
 * type, nullability, default, primary key, uniqueness, and the foreign key with
 * its `ON DELETE`. Each emitter is normalised into one small record and the
 * three records must be equal — per column, with the property named, so a
 * failure says which option and which emitter rather than diffing two files.
 *
 * It is deliberately the whole matrix rather than a curated handful:
 * `test/fixtures/property-matrix-collections.ts` is one collection set with
 * every cell in it, and the disagreements above all lived in cells no test
 * happened to cover.
 *
 * The three emitters are now three renderers of one `SchemaPlan`, so they agree
 * by construction — which does not retire this file. It compares the *rendered*
 * output of all three, and a renderer that spells a constraint differently, or
 * drops one, is exactly the bug that survives the refactor. The plan is used
 * only to enumerate the columns; every fact below is read back out of a
 * generated file or a planned statement.
 */
import type { CollectionConfig, Property } from "@rebasepro/types";
import { getTableName, getTableVarName } from "@rebasepro/common";
import { generateSchema } from "../src/schema/generate-drizzle-schema-logic";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";
import { planCollectionSchemaEnsure, type ExistingSchema } from "../src/schema/ensure-collection-tables";
import { resolveColumnName } from "../src/schema/column-plan-helpers";
import { planSchema } from "../src/schema/plan/plan-schema";
import { everything } from "./fixtures/property-matrix-collections";

// ── The common record ────────────────────────────────────────────────────────

interface ColumnFacts {
    /** Postgres type, upper-cased and normalised (`VECTOR(3)`, `"public"."posts_status"`). */
    type: string;
    nullable: boolean;
    primaryKey: boolean;
    unique: boolean;
    /** `gen_random_uuid()`, `now()`, `identity`, a raw expression, or null. */
    default: string | null;
    /** `schema.table.column ON DELETE X[ ON UPDATE Y]`, or null. */
    foreignKey: string | null;
}

const NO_COLUMN: ColumnFacts = {
    type: "(absent)", nullable: true, primaryKey: false, unique: false, default: null, foreignKey: null
};

// ── Shared lookups ───────────────────────────────────────────────────────────

const qualifiedOf = (collection: CollectionConfig): string => {
    const table = getTableName(collection);
    const schema = (collection as { schema?: string }).schema ?? "public";
    return `${schema}.${table.includes(".") ? table.split(".").pop() : table}`;
};

/** Drizzle table variable → the `schema.table` it creates. */
const tableVars = new Map<string, CollectionConfig>(
    everything.map(c => [getTableVarName(getTableName(c)), c])
);

/** Enum variable → the qualified type name the DDL creates, read out of the file. */
const enumTypes = (schema: string): Map<string, string> => {
    const map = new Map<string, string>();
    for (const [, varName, name] of schema.matchAll(/export const (\w+) = pgEnum\("([^"]+)"/g)) {
        map.set(varName, `"public"."${name}"`);
    }
    for (const [, varName, pgSchema, name] of schema.matchAll(/export const (\w+) = (\w+)Schema\.enum\("([^"]+)"/g)) {
        map.set(varName, `"${pgSchema}"."${name}"`);
    }
    return map;
};

// ── Emitter 1: the Drizzle line ──────────────────────────────────────────────

/** The pg type a drizzle builder call declares. */
const drizzleType = (builder: string, args: string, enums: Map<string, string>): string => {
    const enumType = enums.get(builder);
    if (enumType) return enumType;
    const option = (name: string): string | undefined =>
        args.match(new RegExp(`${name}:\\s*([\\w.]+)`))?.[1];
    switch (builder) {
        case "text": return "TEXT";
        case "uuid": return "UUID";
        case "char": return `CHAR(${option("length")})`;
        case "varchar": return `VARCHAR(${option("length")})`;
        case "integer": return "INTEGER";
        case "smallint": return "SMALLINT";
        case "numeric": return "NUMERIC";
        case "real": return "REAL";
        case "doublePrecision": return "DOUBLE PRECISION";
        case "bigint": return "BIGINT";
        case "serial": return "SERIAL";
        case "bigserial": return "BIGSERIAL";
        case "boolean": return "BOOLEAN";
        case "json": return "JSON";
        case "jsonb": return "JSONB";
        case "date": return "DATE";
        case "time": return "TIME";
        case "timestamp": return "TIMESTAMP WITH TIME ZONE";
        case "vector": return `VECTOR(${option("dimensions")})`;
        case "customType": return args.includes("bytea") ? "BYTEA" : "TSVECTOR";
        default: throw new Error(`the matrix test has no pg type for the drizzle builder \`${builder}\``);
    }
};

/** `posts.id` on the drizzle side → `public.posts.id` as the SQL side names it. */
const drizzleReference = (target: string): string => {
    const [varName, field] = target.split(".");
    const collection = tableVars.get(varName);
    if (!collection) throw new Error(`the matrix test cannot resolve the table variable \`${varName}\``);
    const property = collection.properties?.[field] as Property | undefined;
    return `${qualifiedOf(collection)}.${resolveColumnName(field, property)}`;
};

/**
 * `table variable → object key → the line that declares it`, out of the
 * generated file.
 *
 * Read back from the emitted text rather than asked of a per-column function:
 * there is no per-column function any more, and the thing worth checking is
 * what actually landed in `schema.generated.ts`.
 */
const drizzleColumnLines = (schema: string): Map<string, Map<string, string>> => {
    const tables = new Map<string, Map<string, string>>();
    const re = /export const (\w+) = [\w.]+\("[^"]+", \{\n([\s\S]*?)\n\}(?:, \(table\)|\)\.enableRLS)/g;
    for (const [, varName, body] of schema.matchAll(re)) {
        const columns = new Map<string, string>();
        for (const line of body.split("\n")) {
            const key = line.trim().match(/^(?:"((?:[^"\\]|\\.)*)"|([A-Za-z_$][\w$]*))\s*:/);
            if (!key) continue;
            columns.set((key[1] ?? key[2]).replace(/\\(.)/g, "$1"), line.replace(/,\s*$/, ""));
        }
        tables.set(varName, columns);
    }
    return tables;
};

const parseDrizzleColumn = (line: string, enums: Map<string, string>): { column: string; facts: ColumnFacts } => {
    const body = line.trim().replace(/^(?:"(?:[^"\\]|\\.)*"|[A-Za-z_$][\w$]*)\s*:\s*/, "");
    const head = body.match(/^(\w+)\((.*?)\)(?=\.|$)/s);
    if (!head) throw new Error(`the matrix test cannot parse the drizzle column \`${line.trim()}\``);
    const [, builder, args] = head;
    // `customType({...})("col")` is the one two-call builder.
    const column = builder === "customType"
        ? body.match(/\}\)\("([^"]+)"\)/)![1]
        : args.match(/^"((?:[^"\\]|\\.)*)"/)![1].replace(/\\(.)/g, "$1");

    const identity = body.includes(".generatedByDefaultAsIdentity()");
    const sqlDefault = body.match(/\.default\(sql`([^`]*)`\)/);
    const reference = body.match(/\.references\(\(\): AnyPgColumn => ([\w.]+),\s*\{([^}]*)\}\)/);
    const onDelete = reference?.[2].match(/onDelete:\s*"([^"]+)"/)?.[1];
    const onUpdate = reference?.[2].match(/onUpdate:\s*"([^"]+)"/)?.[1];
    const primaryKey = body.includes(".primaryKey()");

    return {
        column,
        facts: {
            type: `${drizzleType(builder, args, enums)}${body.includes(".array()") ? "[]" : ""}`,
            // A primary key is NOT NULL whether or not `.notNull()` is written.
            nullable: !(primaryKey || body.includes(".notNull()")),
            primaryKey,
            unique: body.includes(".unique()"),
            default: identity
                ? "identity"
                : body.includes(".defaultRandom()")
                    ? "gen_random_uuid()"
                    : sqlDefault ? sqlDefault[1] : null,
            foreignKey: reference
                ? `${drizzleReference(reference[1])} ON DELETE ${onDelete!.toUpperCase()}` +
                  (onUpdate ? ` ON UPDATE ${onUpdate.toUpperCase()}` : "")
                : null
        }
    };
};

// ── Emitters 2 and 3: SQL, from either producer ──────────────────────────────

/**
 * A column definition as SQL, from `"col" TYPE …` — the same shape the DDL
 * generator writes inline and boot-ensure writes into `ADD COLUMN`.
 */
const parseSqlColumn = (definition: string): ColumnFacts => {
    let rest = definition.trim().replace(/,$/, "");
    const primaryKey = /\bPRIMARY KEY\b/.test(rest);
    const unique = /\bUNIQUE\b/.test(rest);
    const notNull = /\bNOT NULL\b/.test(rest);
    const identity = /GENERATED BY DEFAULT AS IDENTITY/.test(rest);
    const defaultMatch = rest.match(/\bDEFAULT\s+(.+?)(?:\s+(?:PRIMARY KEY|UNIQUE|NOT NULL)\b|$)/);

    rest = rest
        .replace(/\s+GENERATED BY DEFAULT AS IDENTITY/, "")
        .replace(/\s+PRIMARY KEY/, "")
        .replace(/\s+UNIQUE/, "")
        .replace(/\s+NOT NULL/, "")
        .replace(/\s+DEFAULT\s+.*$/, "")
        .trim();

    return {
        type: rest,
        nullable: !(primaryKey || notNull),
        primaryKey,
        unique,
        default: identity ? "identity" : (defaultMatch ? defaultMatch[1].trim() : null),
        foreignKey: null
    };
};

/** `table → column → definition`, out of every `CREATE TABLE` in a DDL file. */
const ddlColumns = (ddl: string): Map<string, Map<string, ColumnFacts>> => {
    const tables = new Map<string, Map<string, ColumnFacts>>();
    for (const [, schema, table, bodyText] of ddl.matchAll(/CREATE TABLE(?: IF NOT EXISTS)? "([^"]+)"\."([^"]+)" \(\n([\s\S]*?)\n\);/g)) {
        const columns = new Map<string, ColumnFacts>();
        for (const line of bodyText.split(",\n")) {
            const match = line.trim().match(/^"([^"]+)"\s+(.+?),?$/);
            if (!match) continue;                       // PRIMARY KEY (...) tail
            columns.set(match[1], parseSqlColumn(match[2]));
        }
        tables.set(`${schema}.${table}`, columns);
    }
    return tables;
};

/** The same map, assembled from an ensure plan's statements. */
const ensureColumns = (
    plan: ReturnType<typeof planCollectionSchemaEnsure>
): Map<string, Map<string, ColumnFacts>> => {
    const tables = new Map<string, Map<string, ColumnFacts>>();
    const columnsFor = (key: string): Map<string, ColumnFacts> => {
        if (!tables.has(key)) tables.set(key, new Map());
        return tables.get(key)!;
    };
    for (const action of plan.actions) {
        if (action.kind === "create-table") {
            const body = action.sql.replace(/^[\s\S]*?\(/, "").replace(/\);?\s*$/, "");
            for (const part of body.split(", ")) {
                const match = part.trim().match(/^"([^"]+)"\s+(.+)$/);
                if (!match) continue;                   // PRIMARY KEY (...) tail
                columnsFor(action.target).set(match[1], parseSqlColumn(match[2]));
            }
        } else if (action.kind === "add-column") {
            const match = action.sql.match(/ADD COLUMN IF NOT EXISTS "([^"]+)" (.+);$/);
            if (!match) continue;
            const table = action.target.split(".").slice(0, 2).join(".");
            columnsFor(table).set(match[1], parseSqlColumn(match[2]));
        }
    }
    return tables;
};

/** `schema.table.column → target ON DELETE …`, out of `ADD CONSTRAINT` statements. */
const foreignKeys = (sql: string): Map<string, string> => {
    const map = new Map<string, string>();
    const re = /ALTER TABLE "([^"]+)"\."([^"]+)" ADD CONSTRAINT "[^"]+" FOREIGN KEY \("([^"]+)"\) REFERENCES "([^"]+)"\."([^"]+)" \("([^"]+)"\) ON DELETE ([A-Z ]+?)(?: ON UPDATE ([A-Z ]+?))?;/g;
    for (const [, schema, table, column, targetSchema, targetTable, targetColumn, onDelete, onUpdate] of sql.matchAll(re)) {
        map.set(
            `${schema}.${table}.${column}`,
            `${targetSchema}.${targetTable}.${targetColumn} ON DELETE ${onDelete.trim()}` +
            (onUpdate ? ` ON UPDATE ${onUpdate.trim()}` : "")
        );
    }
    return map;
};

// ── The comparison ───────────────────────────────────────────────────────────

const emptyDb = (): ExistingSchema => ({
    tables: new Map(),
    enums: new Set(),
    constraints: new Set(),
    enumValues: new Map(),
    notNullColumns: new Set(),
    populatedTables: new Set(),
    columnTypes: new Map()
});

describe("the three emitters agree, column by column", () => {
    let drizzle: string;
    let ddl: string;
    let ensure: ReturnType<typeof planCollectionSchemaEnsure>;

    beforeAll(() => {
        drizzle = generateSchema(everything);
        ddl = generatePostgresDdl(everything);
        ensure = planCollectionSchemaEnsure(everything, emptyDb(), { databaseExtensions: ["vector"] });
    });

    it("on the type, nullability, default, key, uniqueness and foreign key of every property's column", () => {
        const enums = enumTypes(drizzle);
        const fromDrizzleFile = drizzleColumnLines(drizzle);
        const fromDdl = ddlColumns(ddl);
        const fromEnsure = ensureColumns(ensure);
        const ddlKeys = foreignKeys(ddl);
        const ensureKeys = foreignKeys(ensure.statements.join("\n"));

        const disagreements: string[] = [];
        let compared = 0;

        for (const table of planSchema(everything).tables) {
            for (const plannedColumn of table.columns) {
                // A junction's two key columns have their own case below; its
                // `through.properties` columns are compared here with the rest,
                // because "declared exactly like collection properties" is a
                // claim about these three emitters and not only about the plan.
                // Only the columns a declared property owns. The implicit id,
                // the generated search columns and the auth contract's own
                // columns are compared by the "which columns each table has"
                // case below; they have no property to name in a failure.
                if (plannedColumn.source.kind !== "property"
                    && plannedColumn.source.kind !== "relation"
                    && plannedColumn.source.kind !== "reference") continue;
                // A foreign key another property declares is that property's.
                if (plannedColumn.columnOwnedByProperty) continue;

                const line = fromDrizzleFile.get(table.varName)?.get(plannedColumn.key);
                expect(line).toBeDefined();

                const { column, facts: fromDrizzle } = parseDrizzleColumn(line!, enums);
                const key = `${table.qualified}.${column}`;
                compared++;

                const ddlFacts = { ...(fromDdl.get(table.qualified)?.get(column) ?? NO_COLUMN), foreignKey: ddlKeys.get(key) ?? null };
                const ensureFacts = { ...(fromEnsure.get(table.qualified)?.get(column) ?? NO_COLUMN), foreignKey: ensureKeys.get(key) ?? null };

                const rendered = (facts: ColumnFacts): string => JSON.stringify(facts);
                if (rendered(fromDrizzle) !== rendered(ddlFacts) || rendered(ddlFacts) !== rendered(ensureFacts)) {
                    disagreements.push(
                        `${table.slug ?? table.table}.${plannedColumn.source.propName} → ${key}\n` +
                        `        drizzle: ${rendered(fromDrizzle)}\n` +
                        `        db push: ${rendered(ddlFacts)}\n` +
                        `        ensure : ${rendered(ensureFacts)}`
                    );
                }
            }
        }

        expect(disagreements).toEqual([]);
        // The fixture is the point: a comparison that quietly walked nothing
        // would pass just as loudly. Every property option in it produces a
        // column here except the inverse relations.
        expect(compared).toBeGreaterThan(140);
    });

    it("on which columns each table has at all", () => {
        const fromDdl = ddlColumns(ddl);
        const fromEnsure = ensureColumns(ensure);

        const disagreements: string[] = [];
        for (const [table, ddlCols] of fromDdl) {
            const ensureCols = fromEnsure.get(table);
            const missing = [...ddlCols.keys()].filter(c => !ensureCols?.has(c));
            const extra = [...(ensureCols?.keys() ?? [])].filter(c => !ddlCols.has(c));
            if (missing.length > 0 || extra.length > 0) {
                disagreements.push(`${table}: push-only [${missing.join(", ")}] ensure-only [${extra.join(", ")}]`);
            }
        }
        expect(disagreements).toEqual([]);
    });

    it("on the junction tables and their key types", () => {
        const fromDdl = ddlColumns(ddl);
        const fromEnsure = ensureColumns(ensure);

        // posts has an increment id, tags a uuid one: the junction must hold
        // one of each, and all three emitters have to derive that the same way.
        expect(fromDdl.get("public.post_tags")!.get("post_id")!.type).toBe("INTEGER");
        expect(fromDdl.get("public.post_tags")!.get("tag_id")!.type).toBe("UUID");
        expect(fromEnsure.get("public.post_tags")!.get("post_id")).toEqual(fromDdl.get("public.post_tags")!.get("post_id"));
        expect(fromEnsure.get("public.post_tags")!.get("tag_id")).toEqual(fromDdl.get("public.post_tags")!.get("tag_id"));
        expect(drizzle).toContain('post_id: integer("post_id").notNull()');
        expect(drizzle).toContain('tag_id: uuid("tag_id").notNull()');
    });

    it("on a junction's own `through.properties` columns", () => {
        const fromDdl = ddlColumns(ddl);
        const fromEnsure = ensureColumns(ensure);
        const junction = "public.org_members";

        // Every payload column exists on both SQL paths, with the same facts.
        for (const column of ["role", "seat", "joined_at", "touched_at"]) {
            expect(fromDdl.get(junction)!.get(column)).toBeDefined();
            expect(fromEnsure.get(junction)!.get(column)).toEqual(fromDdl.get(junction)!.get(column));
        }

        // …and they are the facts the property declared, not a junction
        // column's defaults: an enum type of its own, NOT NULL with a DEFAULT,
        // a UNIQUE, and a nullable timestamp.
        expect(fromDdl.get(junction)!.get("role")!.type).toBe('"public"."org_members_role"');
        expect(fromDdl.get(junction)!.get("role")!.nullable).toBe(false);
        expect(fromDdl.get(junction)!.get("role")!.default).toBe("'member'");
        expect(fromDdl.get(junction)!.get("seat")!.unique).toBe(true);
        expect(fromDdl.get(junction)!.get("joined_at")!.nullable).toBe(true);

        // The enum type is created — no collection owns this table, so nothing
        // else would have emitted it.
        expect(ddl).toContain('CREATE TYPE "public"."org_members_role" AS ENUM');

        // The Drizzle file keys them by the property key, not the column: a
        // `_pivot` write goes through the drizzle object and a key that does
        // not exist there is dropped from the statement in silence.
        expect(drizzle).toContain('joinedAt: timestamp("joined_at"');
        expect(drizzle).toContain('seat: integer("seat").unique()');

        // `autoValue: "on_update"` puts its trigger on the junction too. It
        // lives in `triggers.sql` rather than `schema.sql` (a trigger is a
        // function plus a binding, which Atlas does not manage), so the plan is
        // where the three emitters read it from.
        const junctionPlan = planSchema(everything).tables.find(t => t.table === "org_members")!;
        expect(junctionPlan.kind).toBe("junction");
        expect(junctionPlan.triggers.map(t => t.name)).toEqual(["org_members_touched_at_touch"]);
        // The two key columns are still the whole primary key: a payload column
        // is a column on the link, not part of its identity.
        expect(junctionPlan.primaryKey).toEqual(["org_id", "person_id"]);
    });

    it("on which Postgres enum types exist", () => {
        // A `number` enum creates no type on any path: its column is NUMERIC or
        // INTEGER, so the type was referenced by nothing and only gave
        // drizzle-kit something to plan a DROP for.
        const created = [...ddl.matchAll(/CREATE TYPE "([^"]+)"\."([^"]+)" AS ENUM/g)].map(m => `${m[1]}.${m[2]}`).sort();
        const planned = ensure.actions.filter(a => a.kind === "create-enum").map(a => a.target).sort();
        const declared = [...enumTypes(drizzle).values()].map(t => t.replace(/"/g, "")).sort();

        expect(planned).toEqual(created);
        expect(declared).toEqual(created);
        expect(created).not.toContain("public.num_props_enum_num");
        // …and a record-form enum is read by all three, rather than throwing in
        // boot-ensure the way `(p.enum as unknown[]).map` did.
        expect(created).toContain("public.str_enum_rec_enum_rec");
        // A collection with `schema: "app"` gets its type in `app`.
        expect(created).toContain("app.app_items_status");
    });
});
