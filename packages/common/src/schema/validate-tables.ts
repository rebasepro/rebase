import type {
    ColumnDef,
    ColumnType,
    PolicyExpression,
    PolicyOperand,
    SecurityRule
} from "@rebasepro/types";
import { columnTypeLabel } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

import type { SchemaDefinitionProblem } from "./errors";
import { deriveEnumTypeName } from "./derive-names";

/**
 * The column-level and rule-level checks of the schema compiler.
 *
 * Each returns the problems it found rather than throwing, so the compiler can
 * report every problem of every table at once. Messages name the column and
 * say what to write instead.
 */

const INTEGER_KINDS = new Set(["smallint", "integer", "bigint"]);
const TEMPORAL_KINDS = new Set(["timestamptz", "date", "time"]);
const USER_STAMP_KINDS = new Set(["text", "varchar", "char", "uuid"]);
const ONE_OF_KINDS = new Set([
    "text", "varchar", "char",
    "smallint", "integer", "bigint", "smallserial", "serial", "bigserial", "real", "doublePrecision", "numeric"
]);

/**
 * Problems in one column's own definition: modifiers that contradict each
 * other or do not apply to its type, an unusable enum, a private key.
 *
 * The builders' types already refuse most of these; this is the runtime half,
 * for JavaScript callers and for a builder reached through a cast.
 *
 * @param table The name the table was defined under, for the problem.
 * @param key The column's key.
 * @param sqlColumn The column's SQL name.
 *
 * @group Schema
 */
export function checkColumnDef(
    table: string,
    key: string,
    def: ColumnDef,
    sqlColumn: string
): SchemaDefinitionProblem[] {
    const problems: SchemaDefinitionProblem[] = [];
    const refuse = (message: string) => problems.push({ table, key, message });
    const kind = def.type.kind;

    if (sqlColumn.length === 0) {
        refuse(`the key "${key}" has no snake_case form to name a SQL column with. Give it one: \`.column("…")\`.`);
    }
    if (def.generatedAs !== undefined) {
        if (def.default !== undefined) {
            refuse(
                "`.generatedAs()` and a default contradict each other: Postgres computes a generated column " +
                "on every write and refuses any default for it. Keep one of the two."
            );
        }
        if (def.stamp !== undefined) {
            refuse(
                "`.generatedAs()` and a stamp (`.onCreateNow()`, `.onUpdateUser()`, …) contradict each other: " +
                "nobody, not even the server, writes a generated column. Keep one of the two."
            );
        }
    }
    if (def.default?.kind === "identity" && !INTEGER_KINDS.has(kind)) {
        refuse(`\`.identity()\` needs a \`smallint\`, \`integer\` or \`bigint\` column, and this one is \`${columnTypeLabel(def.type)}\`.`);
    }
    if (def.default?.kind === "random-uuid" && kind !== "uuid") {
        refuse(
            `\`.defaultRandom()\` writes \`gen_random_uuid()\`, which needs a \`uuid\` column, and this one is ` +
            `\`${columnTypeLabel(def.type)}\`. Use \`col.uuid()\`, or \`.defaultSql("gen_random_uuid()::text")\`.`
        );
    }
    if (def.stamp?.value === "now" && !TEMPORAL_KINDS.has(kind)) {
        refuse(
            `\`.${def.stamp.on === "create" ? "onCreateNow" : "onUpdateNow"}()\` stamps the current time, which ` +
            `needs a \`timestamptz\`, \`date\` or \`time\` column, and this one is \`${columnTypeLabel(def.type)}\`.`
        );
    }
    if (def.stamp?.value === "user" && !USER_STAMP_KINDS.has(kind)) {
        refuse(
            `\`.${def.stamp.on === "create" ? "onCreateUser" : "onUpdateUser"}()\` stores the caller's id, which ` +
            `needs a text or \`uuid\` column, and this one is \`${columnTypeLabel(def.type)}\`.`
        );
    }
    if (def.private && def.primaryKey) {
        refuse(
            "a primary-key column cannot be `.private()`: the key is how every row is addressed on the wire — " +
            "in URLs, in relations, in realtime events. Drop `.private()`, or key the table on another column."
        );
    }
    if (def.primaryKey && (kind === "timestamptz" || kind === "time")) {
        refuse(
            `a \`${kind}\` column cannot be part of the key: an instant addressed by its text is not a stable ` +
            "address. Key on a `date` (a calendar day the caller supplies), a string or a number, and keep the " +
            "timestamp beside it."
        );
    }
    if (def.oneOf !== undefined && !ONE_OF_KINDS.has(kind)) {
        refuse(`\`.oneOf()\` takes a text or numeric column, and this one is \`${columnTypeLabel(def.type)}\`. Use \`col.enum([...])\` for a Postgres enum.`);
    }
    if (def.oneOf !== undefined && def.oneOf.length === 0) {
        refuse("`.oneOf([])` accepts no value at all. List the accepted values, or drop `.oneOf()`.");
    }
    problems.push(...checkColumnType(table, key, def.type));
    if (def.type.kind === "enum" && def.default?.kind === "literal" && !def.type.values.includes(String(def.default.value))) {
        refuse(
            `the default ${JSON.stringify(def.default.value)} is not one of the enum's values ` +
            `(${def.type.values.join(", ")}). Postgres refuses the DEFAULT. Default to one of them.`
        );
    }
    if (def.element) {
        if (def.element.oneOf !== undefined && def.element.oneOf.length === 0) {
            refuse("the array's items take `.oneOf([])`, which accepts no value at all. List the accepted values.");
        }
    }
    return problems;
}

/** Problems in a column type itself: an enum with no or repeated values, a non-positive size. */
function checkColumnType(table: string, key: string, type: ColumnType): SchemaDefinitionProblem[] {
    const problems: SchemaDefinitionProblem[] = [];
    const refuse = (message: string) => problems.push({ table, key, message });
    switch (type.kind) {
        case "enum": {
            if (type.values.length === 0) {
                refuse(
                    "the enum lists no values. They become the labels of a Postgres enum type, and a type with no " +
                    "labels cannot be created. List the values, or use a plain `col.text()`."
                );
            }
            const seen = new Set<string>();
            for (const value of type.values) {
                if (typeof value !== "string" || value.length === 0) {
                    refuse("the enum has a blank value. Each value is a label of the Postgres enum type, and a label cannot be empty.");
                    continue;
                }
                if (seen.has(value)) {
                    refuse(
                        `the enum lists "${value}" twice. The values become the labels of one Postgres enum type, ` +
                        "which cannot hold the same label twice, so `CREATE TYPE` would fail. List it once."
                    );
                }
                seen.add(value);
            }
            break;
        }
        case "varchar":
        case "char":
            if (!Number.isInteger(type.length) || type.length <= 0) {
                refuse(`\`col.${type.kind}(n)\` takes a positive whole number of characters, got ${String(type.length)}.`);
            }
            break;
        case "vector":
            if (!Number.isInteger(type.dimensions) || type.dimensions <= 0) {
                refuse(`\`col.vector(dimensions)\` takes a positive whole number, got ${String(type.dimensions)}.`);
            }
            break;
        case "numeric":
            if (type.scale !== undefined && type.precision === undefined) {
                refuse("`col.numeric(precision, scale)`: a scale needs a precision — `NUMERIC(p, s)` has no form without `p`.");
            }
            break;
        case "array":
            if (type.of.kind === "array") {
                refuse("an array of arrays is not supported. Use `col.jsonb()` for nested lists.");
            } else {
                problems.push(...checkColumnType(table, key, type.of));
            }
            break;
        default:
            break;
    }
    return problems;
}

/**
 * Whether two column types are the same Postgres type — what a foreign key
 * needs of the column it binds and the key it points at.
 *
 * An enum compares by the type it names and its values, each side's name
 * resolved against its own table: two unnamed enums on two tables are two
 * types, even with the same labels.
 *
 * @group Schema
 */
export function sameColumnType(
    a: ColumnType,
    aTable: string,
    aColumn: string,
    b: ColumnType,
    bTable: string,
    bColumn: string
): boolean {
    if (a.kind !== b.kind) return false;
    switch (a.kind) {
        case "varchar":
        case "char":
            return b.kind === a.kind && a.length === b.length;
        case "numeric":
            return b.kind === "numeric" && a.precision === b.precision && a.scale === b.scale;
        case "vector":
            return b.kind === "vector" && a.dimensions === b.dimensions;
        case "enum":
            return b.kind === "enum"
                && deriveEnumTypeName(a, aTable, aColumn) === deriveEnumTypeName(b, bTable, bColumn)
                && a.values.length === b.values.length
                && a.values.every((value, index) => value === b.values[index]);
        case "array":
            return b.kind === "array" && sameColumnType(a.of, aTable, aColumn, b.of, bTable, bColumn);
        case "other":
            return b.kind === "other" && a.sqlType === b.sqlType;
        default:
            return true;
    }
}

/**
 * The names a rule may use for a column of its table: the column keys, the
 * SQL column names, and the `belongsTo` relation names (which address their
 * foreign-key column).
 *
 * @group Schema
 */
export interface RuleFieldScope {
    /** Every name that addresses a column of the table. */
    names: ReadonlySet<string>;
}

/**
 * Whether a field name in a rule addresses a column — by key, by relation, or
 * by the snake_case form the policy compiler falls back to (`ownerField:
 * "author_id"` reaches the derived `author_id` column, as it always has).
 */
function addresses(scope: RuleFieldScope, name: string): boolean {
    return scope.names.has(name) || scope.names.has(toSnakeCase(name));
}

/**
 * Problems in a rule's field references: an `ownerField`, or a `field` /
 * `outerField` operand of a structured `condition` / `check`, naming no
 * column of the table.
 *
 * The policy compiler snake-cases a name it does not recognise and compiles a
 * comparison against that column, so a typo reached `CREATE POLICY` and failed
 * there — on a table whose RLS was already enabled, which then served nobody.
 * Fields inside an `existsIn` belong to the other table and are not checked
 * here; its `outerField`s are, because they read this one. Raw SQL is not
 * parsed.
 *
 * @param index The rule's position in `rls`, for the message.
 *
 * @group Schema
 */
export function checkRuleFields(
    table: string,
    rule: SecurityRule,
    index: number,
    scope: RuleFieldScope
): SchemaDefinitionProblem[] {
    const problems: SchemaDefinitionProblem[] = [];
    const label = rule.name ? `rule "${rule.name}"` : `rule #${index}`;
    const refuse = (message: string) => problems.push({ table, key: `rls[${index}]`, message });

    if (typeof rule.ownerField === "string" && !addresses(scope, rule.ownerField)) {
        refuse(
            `${label} has \`ownerField: "${rule.ownerField}"\`, and the table has no such column or \`belongsTo\` ` +
            "relation. The policy would compare a column that does not exist and fail when it is created. Name " +
            "the column (or relation) that holds the owner's user id."
        );
    }
    const checkName = (name: string, clause: "condition" | "check"): void => {
        if (addresses(scope, name)) return;
        refuse(
            `${label} compares the field "${name}" in its \`${clause}\`, and the table has no such column ` +
            "or `belongsTo` relation. The policy would fail when it is created. Name a column key of this table."
        );
    };
    const checkOperand = (operand: PolicyOperand, clause: "condition" | "check", inExists: boolean): void => {
        if (operand.kind === "field" && !inExists) checkName(operand.name, clause);
        if (operand.kind === "outerField" && inExists) checkName(operand.name, clause);
    };
    const walk = (node: unknown, clause: "condition" | "check", inExists: boolean): void => {
        if (typeof node !== "object" || node === null) return;
        if (!isPolicyExpression(node)) {
            // The plain-object shorthand, `{ status: "published" }`: every key
            // is a column of this table (inside an `existsIn`, of the other one).
            if (!inExists) for (const key of Object.keys(node)) checkName(key, clause);
            return;
        }
        switch (node.kind) {
            case "and":
            case "or":
                for (const operand of node.operands) walk(operand, clause, inExists);
                return;
            case "not":
                walk(node.operand, clause, inExists);
                return;
            case "existsIn":
                walk(node.where, clause, true);
                return;
            case "compare":
                checkOperand(node.left, clause, inExists);
                checkOperand(node.right, clause, inExists);
                return;
            default:
                return;
        }
    };
    if ("condition" in rule) walk(rule.condition, "condition", false);
    if ("check" in rule) walk(rule.check, "check", false);
    return problems;
}

/** Whether a rule's condition node is a structured expression (it carries `kind`) rather than the shorthand object. */
function isPolicyExpression(node: object): node is PolicyExpression {
    return "kind" in node && typeof node.kind === "string";
}
