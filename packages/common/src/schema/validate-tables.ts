import type {
    ColumnDef,
    ColumnType,
    ColumnValidation,
    JsonShapeDef,
    PolicyExpression,
    PolicyOperand,
    SecurityRule
} from "@rebasepro/types";
import { columnTypeLabel } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

import { customSqlTypeProblem } from "./custom-sql-type";
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
        refuse(`the key "${key}" has no snake_case form to name a SQL column with. Give it one as the builder's first argument: \`col.text("…")\`.`);
    }
    if (def.generatedAs !== undefined) {
        if (def.default !== undefined) {
            refuse(
                "`.generatedAlwaysAs()` and a default contradict each other: Postgres computes a generated column " +
                "on every write and refuses any default for it. Keep one of the two."
            );
        }
        if (def.stamp !== undefined) {
            refuse(
                "`.generatedAlwaysAs()` and a stamp (`.onCreateNow()`, `.onUpdateUser()`, …) contradict each other: " +
                "nobody, not even the server, writes a generated column. Keep one of the two."
            );
        }
    }
    if (def.default?.kind === "identity" && !INTEGER_KINDS.has(kind)) {
        refuse(`\`.generatedByDefaultAsIdentity()\` needs a \`smallint\`, \`integer\` or \`bigint\` column, and this one is \`${columnTypeLabel(def.type)}\`.`);
    }
    if (def.default?.kind === "random-uuid" && kind !== "uuid") {
        refuse(
            `\`.defaultRandom()\` writes \`gen_random_uuid()\`, which needs a \`uuid\` column, and this one is ` +
            `\`${columnTypeLabel(def.type)}\`. Use \`col.uuid()\`, or \`.default(sql\`gen_random_uuid()::text\`)\`.`
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
    const keyProblem = def.primaryKey ? keyTypeProblem(def.type, def.semantic) : undefined;
    if (keyProblem !== undefined) refuse(keyProblem);
    if (def.private && def.access !== undefined) {
        refuse(
            "`.private()` and `.access()` contradict each other: a private column is never served to or written " +
            "by a client, so access rules say nothing. Drop one of the two."
        );
    }
    if (def.transform !== undefined && def.json?.transform !== undefined) {
        refuse(
            "declares a `.transform()` on the column and another on its JSON shape. They are the same hook on the " +
            "same value, and only one would run: keep one of the two."
        );
    }
    if (kind === "array") {
        const elementProblem = arrayElementProblem(def.type.of, def.element?.semantic);
        if (elementProblem !== undefined) refuse(elementProblem);
    }
    for (const problem of unsupportedRules(def)) refuse(problem);
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
        const columnOnly = elementColumnModifiers(def.element);
        if (columnOnly.length > 0) {
            refuse(
                `the array's items declare ${columnOnly.join(", ")}, which apply to a column, not to the items of one. ` +
                "An item takes `.validate()`, `.oneOf()`, storage, `.userId()`, `.describe()` and `.transform()`; put a " +
                "default, `.notNull()`, `.unique()`, access, a stamp or `.private()` on the array column itself."
            );
        }
    }
    return problems;
}

/**
 * The modifiers an array's item declares that only a column can carry: a
 * default, nullability, a key, uniqueness, generation, access, privacy, a
 * stamp, a JSON shape, a vector index. The item rules the API checks
 * (`validate`, `oneOf`), storage, `.userId()`, the description and a
 * transform apply to each item and are kept.
 */
function elementColumnModifiers(element: ColumnDef): string[] {
    const out: string[] = [];
    if (element.notNull) out.push("`.notNull()`");
    if (element.unique) out.push("`.unique()`");
    if (element.primaryKey) out.push("`.primaryKey()`");
    if (element.default !== undefined) out.push("a default");
    if (element.generatedAs !== undefined) out.push("`.generatedAlwaysAs()`");
    if (element.readOnly) out.push("`.readOnly()`");
    if (element.private) out.push("`.private()`");
    if (element.access !== undefined) out.push("`.access()`");
    if (element.stamp !== undefined) out.push("a stamp");
    if (element.json !== undefined) out.push("a JSON shape");
    if (element.vectorIndex !== undefined) out.push("a vector index");
    return out;
}

/**
 * The column types a key may have: the scalars a row is addressed by — in
 * every URL, filter, cursor and foreign key. (`timestamptz` and `time` are
 * scalars too, refused as keys with their own message.)
 */
const KEY_KINDS: ReadonlySet<ColumnType["kind"]> = new Set([
    "text", "varchar", "char", "uuid", "enum",
    "smallint", "integer", "bigint", "smallserial", "serial", "bigserial", "real", "doublePrecision", "numeric",
    "boolean", "timestamptz", "date", "time"
]);

/** Whether a `col.custom()` type is an array type (`inet[]`, `text[3]`). */
const isCustomArrayType = (sqlType: string): boolean => /\]\s*$/.test(sqlType);

/**
 * Why a column of this type cannot be (part of) a primary key, or `undefined`
 * when it can.
 *
 * A row is addressed by its key as text, so a key is a scalar. A JSON
 * document, a geopoint, a vector, binary data and a list are not; a
 * `col.custom()` scalar (`citext`, `inet`) is served as the text the driver
 * returns and may key a table, a custom list type may not.
 *
 * @param semantic The column's `semantic` (`"geopoint"` marks a point stored as `jsonb`).
 *
 * @group Schema
 */
export function keyTypeProblem(type: ColumnType, semantic?: ColumnDef["semantic"]): string | undefined {
    const passThrough = type.kind === "other" && !isCustomArrayType(type.sqlType);
    if (semantic !== "geopoint" && (KEY_KINDS.has(type.kind) || passThrough)) return undefined;
    const label = semantic === "geopoint" ? "geopoint" : `\`${columnTypeLabel(type)}\``;
    return (
        `a ${label} column cannot be part of the key. A row is addressed by its key — in every URL, filter, ` +
        "cursor and foreign key — so a key is a scalar: text, varchar, char, uuid, an enum, a number, a boolean " +
        "or a date. Key the table on such a column (several make a composite key) and keep this one as an " +
        "ordinary column."
    );
}

/**
 * Element types a Postgres array column does not take here: a JSON document
 * or a vector is a list already, a `bytea` item would need a binary codec per
 * element, and a `col.custom()` list is spelled as its own type. The planner
 * refuses the same set.
 */
const NON_ELEMENT_KINDS: ReadonlySet<ColumnType["kind"]> = new Set(["json", "jsonb", "vector", "bytea", "other"]);

/**
 * Why an array column cannot hold items of this type, or `undefined` when it
 * can. (An array of arrays is refused by the type check.)
 *
 * @param elementSemantic The item's `semantic` (`"geopoint"` for `col.geopoint().array()`).
 *
 * @group Schema
 */
export function arrayElementProblem(of: ColumnType, elementSemantic?: ColumnDef["semantic"]): string | undefined {
    if (elementSemantic !== "geopoint" && !NON_ELEMENT_KINDS.has(of.kind)) return undefined;
    if (of.kind === "other") {
        return (
            `\`.array()\` of \`col.custom({ dataType: ${JSON.stringify(of.sqlType)} })\` is not an array column Rebase plans. ` +
            `Name the list type itself: \`col.custom({ dataType: ${JSON.stringify(`${of.sqlType}[]`)} })\`.`
        );
    }
    const items = elementSemantic === "geopoint" ? "geopoints" : `\`${columnTypeLabel(of)}\` values`;
    return (
        `an array (\`.array()\`) of ${items} is not a Postgres array column Rebase reads and writes. An array ` +
        "column holds scalars — text, uuid, numbers, booleans, dates, enums; a list of documents, points or " +
        "vectors is `col.jsonb(json.array(…))`."
    );
}

// ── Validation rules a column kind checks ───────────────────────────────────

const STRING_RULES: ReadonlySet<string> = new Set(["requiredMessage", "min", "max", "length", "matches", "matchesFlags", "matchesMessage", "email", "url", "trim", "lowercase", "uppercase"]);
const NUMBER_RULES: ReadonlySet<string> = new Set(["requiredMessage", "min", "max", "lessThan", "moreThan", "positive", "negative", "integer"]);
const DATE_RULES: ReadonlySet<string> = new Set(["requiredMessage", "min", "max"]);
const LIST_RULES: ReadonlySet<string> = new Set(["requiredMessage", "minItems", "maxItems", "uniqueItems"]);
const BASE_RULES: ReadonlySet<string> = new Set(["requiredMessage"]);

/** The `.validate()` rules a value of this Postgres type is checked by (besides `uniqueBy`, which `checkUniqueBy` owns). */
function rulesOfType(type: ColumnType): ReadonlySet<string> {
    switch (type.kind) {
        case "text":
        case "varchar":
        case "char":
        case "uuid":
        case "enum":
            return STRING_RULES;
        case "smallint":
        case "integer":
        case "bigint":
        case "smallserial":
        case "serial":
        case "bigserial":
        case "real":
        case "doublePrecision":
        case "numeric":
            return NUMBER_RULES;
        case "timestamptz":
        case "date":
        case "time":
            return DATE_RULES;
        case "array":
            return LIST_RULES;
        default:
            return BASE_RULES;
    }
}

/** The rules a JSON shape node is checked by. */
function rulesOfShape(node: JsonShapeDef): ReadonlySet<string> {
    switch (node.kind) {
        case "string": return STRING_RULES;
        case "number": return NUMBER_RULES;
        case "date": return DATE_RULES;
        case "array": return LIST_RULES;
        default: return BASE_RULES;
    }
}

/**
 * The `.validate()` rules declared where nothing checks them: on the column
 * (by its kind — a JSON array column takes the list rules), on an array's
 * items, and on every node of a JSON shape. `.validate()` is typed per kind,
 * so such a rule is a definition built by hand or through a cast; served, it
 * would read as a constraint the API never enforces.
 */
function unsupportedRules(def: ColumnDef): string[] {
    const out: string[] = [];
    const check = (rules: ColumnValidation | undefined, allowed: ReadonlySet<string>, where: string, verb = "declares"): void => {
        for (const [rule, value] of Object.entries(rules ?? {})) {
            if (value === undefined || rule === "uniqueBy" || allowed.has(rule)) continue;
            out.push(
                `${where} ${verb} the validation rule \`${rule}\`, which a ${describeRuleSet(allowed)} does not check. ` +
                `Drop it, or move it to a column whose kind checks it.`
            );
        }
    };
    const columnRules = def.semantic === "geopoint"
        ? BASE_RULES
        : def.json?.kind === "array" ? LIST_RULES : rulesOfType(def.type);
    check(def.validate, columnRules, "the column");
    if (def.type.kind === "array" && def.element) check(def.element.validate, rulesOfType(def.type.of), "the array's items", "declare");
    const visit = (node: JsonShapeDef, path: string): void => {
        if ("validate" in node) check(node.validate, rulesOfShape(node), path === "" ? "the document" : `"${path}"`);
        switch (node.kind) {
            case "object":
                for (const [field, child] of Object.entries(node.fields)) visit(child, path === "" ? field : `${path}.${field}`);
                return;
            case "array":
                visit(node.of, path === "" ? "[]" : `${path}[]`);
                return;
            case "oneOf":
                for (const [variant, child] of Object.entries(node.variants)) visit(child, path === "" ? variant : `${path}.${variant}`);
                return;
            default:
                return;
        }
    };
    if (def.json) visit(def.json, "");
    return out;
}

const describeRuleSet = (rules: ReadonlySet<string>): string => {
    if (rules === STRING_RULES) return "text value";
    if (rules === NUMBER_RULES) return "number";
    if (rules === DATE_RULES) return "date/time value";
    if (rules === LIST_RULES) return "list";
    return "value of this kind (it takes only `requiredMessage`)";
};

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
        case "other": {
            const problem = customSqlTypeProblem(type.sqlType);
            if (problem !== undefined) {
                refuse(
                    `\`col.custom({ dataType: ${JSON.stringify(type.sqlType)} })\`: that type name ${problem}. It is written into ` +
                    "DDL verbatim, so it must be a Postgres type as `format_type` prints it — `inet`, `timestamp(3) without " +
                    "time zone`, `geometry(Point, 4326)`, `inet[]` — and nothing after it."
                );
            }
            break;
        }
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
