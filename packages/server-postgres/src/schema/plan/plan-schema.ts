/**
 * The only place a table is read for schema purposes.
 *
 * Everything that used to `switch (prop.type)` — the Drizzle generator, the DDL
 * generator, the boot-time ensure — now renders the {@link SchemaPlan} this
 * produces. See `./types.ts` for why.
 *
 * Pure and synchronous. It reads compiled tables — their descriptors — and
 * nothing else: no database, no filesystem, no process-wide registry. The one
 * fact about the world it needs (which extensions a project's databases gave
 * Rebase leave to install) is passed in, because a plan that depended on
 * whatever module happened to be imported would not be comparable with itself.
 *
 * It **throws** rather than guessing. A configuration no renderer can honour —
 * an empty enum, a foreign key into a composite key, an array of documents, a
 * custom type name that leaves its statement — used to fail differently in
 * each of the three emitters, or not at all, and the failure landed at
 * `CREATE TABLE` time on a managed tenant with nobody in the loop. Here it
 * lands once, with the table and the column named.
 */
import {
    REBASE_SCHEMA,
    type SecurityRule,
    type ColumnType,
    type CompiledTable,
    type TableDescriptor,
    type ColumnDescriptor
} from "@rebasepro/types";
import {
    getEnumVarName,
    TENANT_INDEX_REASON,
    getTableVarName,
    customSqlTypeProblem,
    declaredSchemaOf,
    columnByKey,
    relationOf,
    columnNameOf,
    tenantOf,
    compileTableRulePolicies,
    junctionPolicyTable,
    policyTableFromDescriptor,
    policyTableResolver,
    resolveTableJunctions,
    tableEffectiveRules,
    tableInjectedRules,
    tableJunctionRules,
    type CompiledRulePolicy,
    type PolicyTable,
    type RelationOfKind,
    type ResolvePolicyTable,
    type TableJunction,
    type TableJunctionSide
} from "@rebasepro/common";
import {
    generateForeignKeyName,
    getPolicySupersededNames,
    legacyForeignKeyName,
    toPostgresIdentifier,
    toSnakeCase
} from "@rebasepro/utils";
import {
    AUTH_USERS_COLUMNS,
    authUsersColumnDefinition,
    authUsersColumnSql
} from "../auth-users-columns";
import {
    buildTableSearchColumnSpec,
    searchColumnTypeSql,
    searchExtensionStatements,
    searchHelperFunctions
} from "../search-column";
import {
    buildTableVectorColumnSpecs,
    buildTableVectorIndexPlan,
    vectorExtensionDeclared,
    vectorExtensionStatement
} from "../vector-index";
import {
    buildTableIndexSpecs,
    collectionIndexStatement,
    deriveIndexName,
    foreignKeyIndexSpec,
    leadsWithColumn,
    type CollectionIndexSpec
} from "../collection-index";
import { createHash } from "node:crypto";
import { servedKeyOf, tableRelationName } from "../relation-names";
import { SET_UPDATED_AT_FN, setUpdatedAtFunction } from "./updated-at-trigger";
import { keepTenantFunction, keepTenantTriggerName } from "./tenant-keep-trigger";
import { DEFAULT_VIEW_ROLES, viewRowsName } from "./view-names";
import {
    IMPLICIT_ID_DEFAULT,
    plannedColumnEntries,
    referencingColumnType,
    writtenWithoutConstraint,
    type BelongsToDescriptor,
    type PlannedColumnEntry
} from "./column-order";
import type {
    ColumnDefault,
    ColumnPlan,
    EnumPlan,
    ForeignKeyPlan,
    PgType,
    PlanOptions,
    PolicyPlan,
    RelationPlan,
    SchemaPlan,
    TablePlan,
    TriggerPlan,
    ViewPlan
} from "./types";

/**
 * Single-quote escaping for a SQL string literal (PostgreSQL doubles the
 * quote). Enum labels and `defaultValue`s come straight from user-authored
 * collection config, so a value like `it's` closes the literal early and the
 * whole generated file stops parsing at that statement.
 */
export const quoteSqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

const bareTableName = (name: string): string => (name.includes(".") ? name.split(".").pop()! : name);

/**
 * The `ON DELETE` a foreign key gets when the author did not say.
 *
 * One rule for every property that emits one — `belongsTo` relations and
 * `reference` properties alike. `reference` kept its own `CASCADE` default for
 * a release after this rule was written, which is exactly the split this
 * function exists to prevent: two spellings of the same link, two
 * data-retention behaviours, and only one of them documented.
 *
 * An optional link is `SET NULL`: the column can hold NULL, so dropping the
 * parent leaves the child row with an empty pointer, which is what "optional"
 * already means.
 *
 * A required link is **`RESTRICT`**, not `CASCADE`. `NOT NULL` says the child
 * cannot exist without a parent; it does not say deleting the parent should
 * take the child with it. That second claim is a data-retention decision, and
 * defaulting to it meant `onDelete` — a field nobody has to write — silently
 * turned every `DELETE FROM authors` into a cascade through posts, comments and
 * anything else that hung off them.
 */
export const defaultBelongsToOnDelete = (required: boolean | undefined): "RESTRICT" | "SET NULL" =>
    required ? "RESTRICT" : "SET NULL";

const foreignKeyPlan = (
    args: Omit<ForeignKeyPlan, "constraintName" | "sql">
): ForeignKeyPlan => {
    const constraintName = toPostgresIdentifier(`${args.table}_${args.column}_fkey`);
    const onUpdate = args.onUpdate ? ` ON UPDATE ${args.onUpdate.toUpperCase()}` : "";
    return {
        ...args,
        constraintName,
        sql:
            `ALTER TABLE "${args.schema}"."${args.table}" ADD CONSTRAINT "${constraintName}" ` +
            `FOREIGN KEY ("${args.column}") REFERENCES "${args.targetSchema}"."${args.targetTable}" ` +
            `("${args.targetColumn}") ON DELETE ${args.onDelete.toUpperCase()}${onUpdate}`
    };
};

// ── Defaults ─────────────────────────────────────────────────────────────────

/** A value already written as a day, or as a time of day. */
const BARE_DATE = /^\d{4}-\d{2}-\d{2}$/;
const BARE_TIME = /^\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;

/**
 * A date default in the shape its column's type accepts: a day for `date`, a
 * time of day for `time`, an instant for a timestamp.
 *
 * Rendered as a full ISO timestamp whatever the column, a `time` column's
 * DEFAULT was `'2024-03-01T15:30:00.000Z'`, which Postgres refuses — "invalid
 * input syntax for type time" — so the schema would not apply. A value already
 * written in the column's shape (`"2024-12-25"`, `"09:00"`) is kept as written;
 * anything else is read as an instant and its UTC day or time of day taken, the
 * same zone the timestamp rendering has always used. A string that is no date
 * at all is no DEFAULT, rather than a schema that cannot be applied.
 */
const dateDefaultLiteral = (value: unknown, type: PgType): string | undefined => {
    if (typeof value === "string") {
        if (type.kind === "date" && BARE_DATE.test(value)) return value;
        if (type.kind === "time" && BARE_TIME.test(value)) return value;
    }
    const instant = value instanceof Date ? value : typeof value === "string" ? new Date(value) : undefined;
    if (!instant || Number.isNaN(instant.getTime())) return undefined;
    const iso = instant.toISOString();
    if (type.kind === "date") return iso.slice(0, 10);
    if (type.kind === "time") return iso.slice(11, 23);
    // A timestamp keeps a string default as it was written — its own offset
    // included — and a Date as the instant it is.
    return typeof value === "string" ? value : iso;
};

// ── Columns planned from their definition ────────────────────────────────────
//
// Every column is planned from its `ColumnDescriptor`: the `ColumnType` is the
// Postgres type, the descriptor says whether it is a key, NOT NULL, UNIQUE,
// generated, stamped or defaulted. Nothing is re-derived from a
// document-shaped field ("a string whose columnType is uuid"), which is what
// kept a generated column, a non-key identity and a `uuid[]` out of the
// planner while it read the legacy shape.

/** Where a defined column lands: what its enum type, if any, is named after. */
export interface DefinedColumnSite {
    /** The Postgres schema of the table (a junction's is `public`). */
    schema: string;
    /** The table, unqualified — an unnamed enum's type is named after it. */
    table: string;
    /** The table as a refusal names it: its slug, or a junction's table. */
    owner: string;
    /** The column key — an unnamed enum's Drizzle variable is named after it. */
    propName: string;
    /** The SQL column — an unnamed enum's type is named after it. */
    column: string;
}

/**
 * The element types a Postgres array column takes here: a scalar Rebase can
 * read and write item by item. A JSON document or a vector is already a list
 * of its own (`col.jsonb()` holds a list of documents), and a `bytea` item
 * would need a binary codec per element that nothing implements.
 */
const NON_ELEMENT_KINDS: ReadonlySet<ColumnType["kind"]> = new Set(["json", "jsonb", "vector", "bytea", "array", "other"]);

/**
 * The Postgres type a column descriptor states.
 *
 * One arm per {@link ColumnType} member: the two type unions are kept 1:1, so
 * this is a renaming, not a derivation. An enum is the one member that needs
 * the site — its type is named after the table and column it is declared on,
 * unless the definition names a shared type.
 */
const describedPgType = (column: ColumnDescriptor, site: DefinedColumnSite): PgType =>
    pgTypeOf(column.type, site);

/** Where a table's described column lands. */
const describedSite = (descriptor: TableDescriptor, column: ColumnDescriptor): DefinedColumnSite => ({
    schema: descriptor.schema,
    table: descriptor.table,
    owner: descriptor.slug,
    propName: column.key,
    column: column.column
});

/** The key a link points at: its column key, its SQL column, and the type a column pointing at it has. */
interface TableKeyTarget {
    key: string;
    column: string;
    type: PgType;
}

/**
 * The single-column key of a table a link points at — a `belongsTo` foreign
 * key, a junction endpoint — and the type the pointing column must have: the
 * key's own type (a serial read as its plain integer, which would otherwise
 * give every referencing column a sequence of its own). A table with no key
 * is pointed at by the implicit `id TEXT`.
 *
 * @param via the link asking, named if the key is composite and so cannot be
 *   pointed at.
 */
export const tableKeyTarget = (target: TableDescriptor, via: string): TableKeyTarget => {
    const keys = target.columns.filter(column => column.primaryKey === true);
    if (keys.length > 1) {
        throw new Error(
            `${via} points at table "${target.slug}", whose primary key spans ${keys.length} columns ` +
            `(${keys.map(key => `"${key.key}"`).join(", ")}). A foreign key is one column and cannot reference a ` +
            "composite key. Point the link at a table with a single-column key, or reach these rows with " +
            "`rel.via(...)`, whose steps compare every key column."
        );
    }
    const key = keys[0];
    if (!key) return { key: "id", column: "id", type: { kind: "text" } };
    return {
        key: key.key,
        column: key.column,
        type: pgTypeOf(referencingColumnType(key.type), describedSite(target, key))
    };
};

export const pgTypeOf = (type: ColumnType, site: DefinedColumnSite): PgType => {
    switch (type.kind) {
        case "text": return { kind: "text" };
        case "varchar": return { kind: "varchar", length: type.length };
        case "char": return { kind: "char", length: type.length };
        case "uuid": return { kind: "uuid" };
        case "enum": return definedEnumType(type, site);
        case "smallint": return { kind: "smallint" };
        case "integer": return { kind: "integer" };
        case "bigint": return { kind: "bigint" };
        case "smallserial": return { kind: "smallserial" };
        case "serial": return { kind: "serial" };
        case "bigserial": return { kind: "bigserial" };
        case "real": return { kind: "real" };
        case "doublePrecision": return { kind: "doublePrecision" };
        case "numeric":
            if (type.precision === undefined) return { kind: "numeric" };
            return type.scale === undefined
                ? { kind: "numeric", precision: type.precision }
                : { kind: "numeric", precision: type.precision, scale: type.scale };
        case "boolean": return { kind: "boolean" };
        case "timestamptz": return { kind: "timestamptz" };
        case "date": return { kind: "date" };
        case "time": return { kind: "time" };
        case "json": return { kind: "json" };
        case "jsonb": return { kind: "jsonb" };
        case "vector": return { kind: "vector", dimensions: type.dimensions };
        case "bytea": return { kind: "bytea" };
        case "array":
            if (NON_ELEMENT_KINDS.has(type.of.kind)) {
                throw new Error(
                    `Column "${site.column}" of "${site.owner}" is an array of ` +
                    `\`${type.of.kind}\`, which is not an element type Rebase stores in a Postgres array. ` +
                    "An array column holds scalars (text, uuid, numbers, booleans, dates, enums); a list of " +
                    "documents or vectors is a `col.jsonb()` column."
                );
            }
            return { kind: "array", of: pgTypeOf(type.of, site) };
        case "other": {
            // `col.custom(sqlType)`, written into DDL verbatim — so refused
            // again here, whoever built the definition, unless it is a type
            // name that cannot leave the statement.
            const problem = customSqlTypeProblem(type.sqlType);
            if (problem !== undefined) {
                throw new Error(
                    `Column "${site.column}" of "${site.owner}" is \`col.custom(${JSON.stringify(type.sqlType)})\`, ` +
                    `and that type name ${problem}. Write the Postgres type as \`format_type\` prints it.`
                );
            }
            return { kind: "custom", sqlType: type.sqlType.trim() };
        }
    }
};

/**
 * The type name an enum states when it names a shared type: its `name`, unless
 * that is exactly the `<table>_<column>` an unnamed one gets — then it is that
 * column's own type, named and declared as it always was.
 */
const sharedEnumName = (type: Extract<ColumnType, { kind: "enum" }>, table: string, column: string): string | undefined =>
    type.name !== undefined && type.name !== `${table}_${column}` ? type.name : undefined;

/**
 * The Drizzle variable of a shared enum type: one per type, whichever columns
 * use it, so it is named after the type (and its schema, outside `public`)
 * rather than after any one column. The `Enum` suffix keeps it apart from the
 * table variables, which are named after tables in the same namespace.
 */
const sharedEnumVarName = (schema: string, name: string): string =>
    `${getTableVarName(schema === "public" ? name : `${schema}_${name}`)}Enum`;

const definedEnumType = (type: Extract<ColumnType, { kind: "enum" }>, site: DefinedColumnSite): PgType => {
    const { table, schema } = site;
    // As `enumLabelsOf` reads a legacy enum: an empty label is no label, and a
    // type with none is refused rather than created empty.
    const labels = type.values.filter(label => label.length > 0);
    if (labels.length === 0) {
        throw new Error(
            `Column "${site.column}" of "${site.owner}" is an enum with no values. A Postgres enum ` +
            "type needs at least one label."
        );
    }
    const shared = sharedEnumName(type, table, site.column);
    return {
        kind: "enum",
        schema,
        name: shared ?? `${table}_${site.column}`,
        varName: shared ? sharedEnumVarName(schema, shared) : getEnumVarName(table, site.propName),
        labels
    };
};

/** The enum type a defined column's values are typed by — its own, or its items'. */
const definedEnumOf = (type: PgType): Extract<PgType, { kind: "enum" }> | undefined => {
    if (type.kind === "enum") return type;
    if (type.kind === "array" && type.of.kind === "enum") return type.of;
    return undefined;
};

/**
 * A column's DEFAULT, from its descriptor.
 *
 * The precedence the legacy reading has — the key's strategy, then the time
 * stamp, then a SQL expression, then a literal — over the one `default` a
 * column holds. `identity` is planned on any integer column, key or not, at
 * the width the column declares. `database` plans none: the database owns
 * that default. A generated column has none at all.
 */
const describedColumnDefault = (column: ColumnDescriptor, type: PgType): ColumnDefault | undefined => {
    if (column.generated !== undefined) return undefined;
    const declared = column.default;
    if (declared?.kind === "identity") return { kind: "identity" };
    if (column.primaryKey) {
        // A key's strategy, as written: the expression is not trimmed (the
        // legacy `isId` reading never trimmed it either).
        if (declared?.kind === "random-uuid") return { kind: "sql", expression: "gen_random_uuid()" };
        if (declared?.kind === "sql") return { kind: "sql", expression: declared.expression };
    }
    if (column.stamp?.value === "now" && (type.kind === "timestamptz" || type.kind === "date" || type.kind === "time")) {
        return { kind: "sql", expression: "now()" };
    }
    if (declared?.kind === "random-uuid") return { kind: "sql", expression: "gen_random_uuid()" };
    if (declared?.kind === "sql") {
        const expression = declared.expression.trim();
        return expression ? { kind: "sql", expression } : undefined;
    }
    if (declared?.kind !== "literal") return undefined;
    return definedLiteralDefault(declared.value, type);
};

/**
 * A literal default, as the column's type quotes it. The same spellings as
 * {@link literalDefault}, chosen by the Postgres type rather than by the
 * property's: a native array, a vector and a `bytea` take none (the driver
 * still applies the value on create), exactly as their legacy reading did.
 */
const definedLiteralDefault = (value: unknown, type: PgType): ColumnDefault | undefined => {
    if (value === undefined || value === null) return undefined;
    switch (type.kind) {
        case "text":
        case "varchar":
        case "char":
        case "uuid":
        case "enum":
            return typeof value === "string" ? { kind: "literal", value, sql: quoteSqlLiteral(value) } : undefined;
        case "smallint":
        case "integer":
        case "bigint":
        case "smallserial":
        case "serial":
        case "bigserial":
        case "real":
        case "doublePrecision":
        case "numeric":
            return typeof value === "number" && Number.isFinite(value) ? { kind: "literal", value, sql: String(value) } : undefined;
        case "boolean":
            return typeof value === "boolean" ? { kind: "literal", value, sql: value ? "TRUE" : "FALSE" } : undefined;
        case "timestamptz":
        case "date":
        case "time": {
            const literal = dateDefaultLiteral(value, type);
            return literal === undefined ? undefined : { kind: "literal", value: literal, sql: quoteSqlLiteral(literal) };
        }
        // A custom scalar takes a string literal, which Postgres reads as the
        // column's type (`'10.0.0.1'` for `inet`, `'1 day'` for `interval`).
        case "custom":
            return typeof value === "string" && !/\]\s*$/.test(type.sqlType)
                ? { kind: "literal", value, sql: quoteSqlLiteral(value) }
                : undefined;
        case "json":
        case "jsonb": {
            let json: string | undefined;
            try {
                json = JSON.stringify(value);
            } catch {
                return undefined;
            }
            if (json === undefined) return undefined;
            return { kind: "literal", value, sql: `${quoteSqlLiteral(json)}::${type.kind}` };
        }
        default:
            return undefined;
    }
};

/**
 * One column planned from its descriptor — collection table and junction
 * pivot alike. {@link planPropertyColumn} hands over to it whenever the table
 * describes the column.
 */
function planDescribedColumn(described: ColumnDescriptor, ctx: DescribedColumnContext): ColumnPlan {
    const { site, auth } = ctx;
    const { schema, table } = site;
    const { key, column } = described;
    const isKey = described.primaryKey === true;
    const type = describedPgType(described, site);
    const authDefinition = auth && !isKey ? authUsersColumnDefinition(column) : undefined;

    const plan: ColumnPlan = {
        key,
        column,
        type,
        nullable: !isKey && described.nullable,
        primaryKey: isKey,
        unique: !isKey && described.unique === true,
        default: describedColumnDefault(described, type),
        sqlDefinition: authDefinition,
        source: { kind: "property", propName: key, slug: ctx.slug }
    };
    if (described.generated !== undefined) {
        plan.generated = { expression: described.generated.expression, stored: true };
    }
    if (described.stamp?.on === "update" && described.stamp.value === "now") {
        plan.touchOnUpdate = true;
        ctx.triggerFunctionNeeded.value = true;
        ctx.triggers.push({
            schema,
            table,
            column,
            name: toPostgresIdentifier(`${table}_${column}_touch`)
        });
    }
    return plan;
}

// ── Policies ─────────────────────────────────────────────────────────────────

/**
 * One security rule of a table, compiled to its policies — what
 * the legacy `compileSecurityRule` does for a collection, read from the table's
 * {@link PolicyTable} (`policyTableFromDescriptor`, `junctionPolicyTable`).
 */
export const compileTableSecurityRule = (
    table: PolicyTable,
    rule: SecurityRule,
    resolveTable: ResolvePolicyTable | undefined,
    injected: boolean,
    ruleKey = rule.name ?? "(unnamed)"
): PolicyPlan[] =>
    policyPlans(
        compileTableRulePolicies(table, rule, { resolveTable, adminRole: true, adminRequestRole: true }),
        getPolicySupersededNames(rule, table.table), injected, ruleKey);

/** The planner's bookkeeping over one rule's compiled policies. */
const policyPlans = (
    compiled: readonly CompiledRulePolicy[],
    supersedes: string[],
    injected: boolean,
    ruleKey: string
): PolicyPlan[] => {
    const plans: PolicyPlan[] = [];
    for (const policy of compiled) {
        // A companion follows its base: carried on it, not planned beside it.
        if (policy.adminRequestTarget) {
            const base = plans[plans.length - 1];
            if (base) base.adminRequestCompanion = { name: policy.name, using: policy.using, withCheck: policy.withCheck };
            continue;
        }
        plans.push({
            ...policy,
            ruleKey,
            injected,
            ...(plans.length === 0 && supersedes.length > 0 ? { supersedes } : {})
        });
    }
    return plans;
};

/**
 * Refuse two of a table's policies that Postgres would store under one name.
 *
 * Each policy is rendered as `DROP POLICY IF EXISTS "<name>"` and then its
 * `CREATE`, and Postgres keeps the first 63 bytes of the name, so the second
 * of two policies whose names share those bytes drops the first and takes its
 * place. On a table of 56 bytes or more every unnamed rule of one operation is
 * `<table>_<op>` once stored, so a restrictive gate followed by a grant left
 * the grant alone in force. One rule's own operations never collide here —
 * `getPolicyNamesForRule` names them apart — so a collision is always two
 * rules, and the author names one of them.
 */
const sameStoredPolicy = (a: PolicyPlan, b: PolicyPlan): boolean =>
    a.name === b.name && a.operation === b.operation && a.mode === b.mode
    && a.roles.join(",") === b.roles.join(",") && a.using === b.using && a.withCheck === b.withCheck;

function assertDistinctStoredPolicyNames(policies: PolicyPlan[]): void {
    const owners = new Map<string, PolicyPlan>();
    for (const policy of policies) {
        const stored = toPostgresIdentifier(policy.name);
        const first = owners.get(stored);
        if (!first) {
            owners.set(stored, policy);
            continue;
        }
        // The same policy twice — a rule repeated verbatim — replaces itself.
        if (sameStoredPolicy(first, policy)) continue;
        throw new Error(
            `The security rules "${first.ruleKey}" and "${policy.ruleKey}" compile to the policies ` +
            `"${first.name}" and "${policy.name}", which Postgres stores under one name, "${stored}": it ` +
            "keeps only the first 63 bytes of an identifier, so the second would replace the first. " +
            "Give one of the rules a shorter `name`, or the collection a shorter `table`."
        );
    }
}

/**
 * A table's policies, minus any superseded name Postgres would store one of
 * them under.
 *
 * A superseded name is a 63-byte cut, and another rule's over-long name can
 * cut to the very same bytes — `<table>_default_admin_read` and the old
 * `<table>_default_admin_write_<op>` both do on a 50-byte table. Dropping it
 * then would drop that policy right after its own `CREATE`. Its own `DROP
 * POLICY IF EXISTS` already removes the old policy, so nothing is lost.
 */
const withoutLiveSupersededNames = (policies: PolicyPlan[]): PolicyPlan[] => {
    assertDistinctStoredPolicyNames(policies);
    const stored = new Set(policies.map(policy => toPostgresIdentifier(policy.name)));
    return policies.map(policy => {
        if (!policy.supersedes) return policy;
        const supersedes = policy.supersedes.filter(name => !stored.has(name));
        if (supersedes.length === policy.supersedes.length) return policy;
        const kept: PolicyPlan = { ...policy };
        if (supersedes.length > 0) kept.supersedes = supersedes;
        else delete kept.supersedes;
        return kept;
    });
};

// ── The planner ──────────────────────────────────────────────────────────────

/**
 * Everything a set of tables asks the database for.
 *
 * The input is the compiled tables — what `compileSchema` returns and every
 * door (`loadTables`, boot, the CLI) hands over. Planned in the order given:
 * the callers sort by slug first, and the generated files keep that order.
 *
 * @param compiledTables the compiled tables, in slug order.
 * @param options the planner's world: the extensions it may install.
 */
export function planSchema(compiledTables: readonly CompiledTable[], options: PlanOptions = {}): SchemaPlan {
    const descriptors = compiledTables.map(table => table.descriptor);
    const descriptorOf = new Map(descriptors.map(descriptor => [descriptor.slug, descriptor]));
    const targetOf = (slug: string): TableDescriptor => {
        const target = descriptorOf.get(slug);
        if (!target) throw new Error(`Internal: a relation points at the table "${slug}", which is not among the planned tables.`);
        return target;
    };
    // A view has no table, policy or enum: it is planned on its own (`views`),
    // and resolvable as a relation target.
    const tableDescriptors = descriptors.filter(descriptor => descriptor.kind !== "view");

    const declaredSchemas = Array.from(new Set(tableDescriptors.flatMap(descriptor => {
        const declared = declaredSchemaOf(descriptor);
        return declared === undefined ? [] : [declared];
    })));
    const schemas = Array.from(new Set([REBASE_SCHEMA, ...declaredSchemas]));

    // ── Enum types ───────────────────────────────────────────────────────────
    // The name is derived from table + column, so two tables mapped onto the
    // same SQL table — or two columns of one SQL name — land on the same type.
    // `CREATE TYPE` has no IF NOT EXISTS, so emitting it twice aborts the whole
    // file; deduplicated by name here, once, for every renderer.
    //
    // Deduplicated by the name *Postgres* holds, which is the first 63 bytes,
    // and only for the same column. Two different columns deriving one name —
    // `orders.item_status` and `orders_item.status`, or two long names that
    // share their first 63 bytes — cannot share a type: the second column would
    // be typed with the first one's labels and reject its own. The name is
    // frozen once a database holds it, so this refuses rather than renaming.
    const enums: EnumPlan[] = [];
    const enumOwners = new Map<string, { table: string; column: string; owner: string; shared?: { name: string; labels: string[] } }>();
    /**
     * The enum type a column is typed by, appended once.
     *
     * A column's own type (`<table>_<column>`) is claimed by that column alone,
     * as above. A type the definition names (`pgEnum(name, values)`) is
     * shared: every column naming it is typed by the one `CREATE TYPE`, and
     * they must agree on its values — `compileTables` refuses a disagreement
     * first, and so does this, for a plan reached any other way.
     *
     * `declaredSchema` is passed rather than read off the site because a
     * junction's `public` is a resolved fact and not a declaration — emitting
     * it as one would make the generated file reach for a `pgSchema("public")`
     * variable that exists for nobody.
     */
    const collectEnumType = (site: DefinedColumnSite, described: ColumnDescriptor, declaredSchema: string | undefined): void => {
        const owner = `column "${described.key}" of "${site.owner}"`;
        // A closed value set that is no enum type (`.oneOf()`) refuses an
        // empty list as an enum type refuses one.
        if (described.oneOf !== undefined && described.oneOf.every(value => String(value).length === 0)) {
            throw new Error(
                `The ${owner} is \`.oneOf()\` with no non-empty value, so no value can be written to it. ` +
                "List the values the column accepts."
            );
        }
        const enumType = definedEnumOf(describedPgType(described, site));
        if (!enumType) return;
        const { schema, name, labels } = enumType;
        const { table, column } = site;
        const qualified = `${schema}.${toPostgresIdentifier(name)}`;
        const shared = name === `${table}_${column}` ? undefined : { name, labels };
        const claimed = enumOwners.get(qualified);
        if (claimed) {
            if (claimed.table === table && claimed.column === column) return;
            if (shared && claimed.shared?.name === name) {
                if (claimed.shared.labels.join("\u0000") === labels.join("\u0000")) return;
                throw new Error(
                    `The enum type "${schema}"."${name}" is given the values (${labels.join(", ")}) by the ${owner} and ` +
                    `(${claimed.shared.labels.join(", ")}) by the ${claimed.owner}. Columns sharing a named enum type must ` +
                    "list the same values, in the same order. Make them agree, or give one column its own type `name`."
                );
            }
            throw new Error(
                `The enum ${owner} and the enum ${claimed.owner} both derive the Postgres type ` +
                `"${schema}"."${toPostgresIdentifier(name)}" (Postgres keeps the first 63 bytes of a name). One type ` +
                "cannot hold both columns' values, and a type's name cannot change once a database holds it. Give " +
                "one of the two columns another name with `.column()`, its table another `table` or `schema`, or " +
                "its enum another `name`."
            );
        }
        enumOwners.set(qualified, { table, column, owner, shared });
        enums.push({ schema, name, qualified, declaredSchema, varName: enumType.varName, labels });
    };
    for (const descriptor of tableDescriptors) {
        const declaredSchema = declaredSchemaOf(descriptor);
        for (const entry of plannedColumnEntries(descriptor, targetOf)) {
            // A link is typed by its target's key, whose type its table declares.
            if (entry.kind !== "column") continue;
            collectEnumType(describedSite(descriptor, entry.column), entry.column, declaredSchema);
        }
    }

    // ── The table set ────────────────────────────────────────────────────────
    // Each table, then any junction its relations imply, in the order the
    // tables arrive. `schema.sql` and `schema.generated.ts` are compared
    // against their committed copies, so this order is the file's.
    const tableJunctions = resolveTableJunctions(tableDescriptors);
    const resolvePolicyTable = policyTableResolver(descriptors);
    const tableEntries = new Map<string, TableEntry>();
    const junctionShapes = new Map<string, { keys: string; claim: string }>();
    for (const descriptor of tableDescriptors) {
        tableEntries.set(descriptor.table, { kind: "table", descriptor });
        for (const relation of descriptor.relations) {
            if (relation.kind !== "manyToMany") continue;
            const junctionTable = relation.through.table;
            assertOneJunctionShape(junctionShapes, junctionTable, descriptor, relation, targetOf(relation.target));
            if (tableEntries.has(junctionTable)) continue;
            const junction = tableJunctions.get(bareTableName(junctionTable));
            if (!junction) throw new Error(`Internal: the junction table "${junctionTable}" of "${descriptor.slug}" was not resolved.`);
            tableEntries.set(junctionTable, { kind: "junction", junction });
        }
    }

    // A junction's pivot may declare an enum too, and the type it names is
    // created by nobody else: no table owns the junction, so the loop above
    // never sees the column. Appended after the tables' — the enum block is
    // compared byte-for-byte against its committed copy, and a junction whose
    // type interleaved with the tables' would reorder that file whenever a
    // `pivot` moved.
    for (const junction of tableJunctions.values()) {
        const keys = new Set(junction.endpoints.map(endpoint => endpoint.junctionColumn));
        for (const pivotColumn of junction.pivot) {
            if (keys.has(pivotColumn.column)) continue;
            collectEnumType(junctionSite(junction, pivotColumn), pivotColumn, undefined);
        }
    }

    const triggerFunctionNeeded = { value: false };

    const tables: TablePlan[] = [];
    for (const entry of tableEntries.values()) {
        tables.push(entry.kind === "junction"
            ? planJunctionTable(entry.junction, targetOf, resolvePolicyTable, triggerFunctionNeeded)
            : planCollectionTable(entry.descriptor, resolvePolicyTable, targetOf, triggerFunctionNeeded));
    }

    assertNoTruncationCollisions(tables, enums);

    // ── Extensions and functions ─────────────────────────────────────────────
    const extensions: string[] = [];
    const functions: string[] = [];
    const seenStatements = new Set<string>();
    const add = (into: string[], statement: string): void => {
        if (seenStatements.has(statement)) return;
        seenStatements.add(statement);
        into.push(statement);
    };
    for (const table of tables) {
        if (!table.search) continue;
        for (const statement of searchExtensionStatements(table.search)) add(extensions, statement);
    }
    // pgvector is a separate build behind an image, a grant and a provider
    // allow-list, so whether Rebase may install it is not Rebase's to decide.
    // See `DatabaseOptions.extensions`.
    if (vectorExtensionDeclared(options.databaseExtensions)
        && tables.some(t => t.vectorColumns.length > 0)) {
        add(extensions, vectorExtensionStatement());
    }
    for (const table of tables) {
        if (!table.search) continue;
        for (const statement of searchHelperFunctions(table.search)) add(functions, statement);
    }
    if (triggerFunctionNeeded.value) add(functions, setUpdatedAtFunction());
    if (tables.some(t => t.triggers.some(trigger => trigger.kind === "keep-tenant"))) add(functions, keepTenantFunction());

    return {
        schemas,
        declaredSchemas,
        enums,
        tables,
        views: planViews(descriptors),
        relations: planRelations(tableDescriptors, tableEntries, targetOf),
        extensions,
        functions,
        options
    };
}

/**
 * The views the tables declare (`defineView`), each after the views its query
 * names.
 *
 * Which views a query reads is read off its text — a planned view's name as a
 * whole word — which is enough to order them: a name that appears in a string
 * literal only orders two views that did not need it, never the other way.
 */
export function planViews(tables: readonly TableDescriptor[]): ViewPlan[] {
    const declared = tables.flatMap(descriptor => {
        const view = descriptor.view;
        if (descriptor.kind !== "view" || !view || view.query === undefined) return [];
        const { schema, table: name } = descriptor;
        const idColumns = descriptor.primaryKey.map(key => columnNameOf(descriptor, key) ?? key);
        const materialized = view.materialized;
        return [{
            schema, name, qualified: `${schema}.${name}`,
            query: view.query.trim().replace(/;\s*$/, ""),
            materialized,
            roles: materialized ? [...(view.roles ?? DEFAULT_VIEW_ROLES)] : [],
            idColumns,
            // A materialized view's own `indexes`, on its stored rows.
            indexes: materialized
                ? buildTableIndexSpecs(descriptor)
                    .map(spec => collectionIndexStatement({ ...spec, table: viewRowsName(name) }).replace(/;$/, ""))
                : []
        }];
    });
    const named = (query: string, view: { schema: string; name: string }) =>
        new RegExp(`(^|[^A-Za-z0-9_$"])"?${escapeRegExp(view.name)}"?([^A-Za-z0-9_$"]|$)`).test(query);
    const withDependencies = declared.map(view => ({
        ...view,
        dependsOn: declared.filter(other => other !== view && named(view.query, other)).map(other => other.qualified)
    }));

    // Depth-first, so every view lands after what it reads; a cycle is two
    // queries naming each other, which Postgres refuses to create anyway.
    const ordered: typeof withDependencies = [];
    const placed = new Set<string>();
    const visiting = new Set<string>();
    const place = (view: typeof withDependencies[number]): void => {
        if (placed.has(view.qualified)) return;
        if (visiting.has(view.qualified)) {
            throw new Error(`The views ${[...visiting].join(", ")} read each other; a view cannot be created before the view it reads.`);
        }
        visiting.add(view.qualified);
        for (const dependency of view.dependsOn) {
            const target = withDependencies.find(other => other.qualified === dependency);
            if (target) place(target);
        }
        visiting.delete(view.qualified);
        placed.add(view.qualified);
        ordered.push(view);
    };
    for (const view of withDependencies) place(view);

    return ordered.map(view => ({
        ...view,
        hash: createHash("sha256")
            // `gated`: a materialized view is its stored rows behind a view
            // that serves them to its roles (0.29.0 created the bare matview).
            .update(JSON.stringify([view.qualified, view.query, view.materialized, view.idColumns,
                ...(view.materialized ? ["gated", view.roles, view.indexes] : [])]))
            .digest("hex")
            .slice(0, 16)
    }));
}

function escapeRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Refuse two relations — tables, junctions and enum types share one namespace
 * per schema, because every table owns a row type of its own name — that are
 * distinct in full but one name after Postgres keeps the first 63 bytes.
 *
 * `a_table_with_a_really_long_name_that_goes_on_and_on_and_on_forever` with an
 * enum column and a many-to-many truncated its table, its enum type and its
 * junction to the same identifier: the push failed with `type "…" already
 * exists` and no validator mentioned the length. A name that already works is
 * never touched — only a collision that cannot be created refuses.
 */
function assertNoTruncationCollisions(tables: TablePlan[], enums: EnumPlan[]): void {
    const owners = new Map<string, string>();
    const claim = (schema: string, name: string, what: string): void => {
        const key = `${schema}.${toPostgresIdentifier(name)}`;
        const first = owners.get(key);
        if (first === undefined) {
            owners.set(key, what);
            return;
        }
        throw new Error(
            `The ${what} and the ${first} both become "${schema}"."${toPostgresIdentifier(name)}" in Postgres, ` +
            "which keeps only the first 63 bytes of an identifier — and a table, a junction table and an enum " +
            "type share one namespace (every table owns a row type of its name). The push would fail with " +
            "\"already exists\". Give the collection a shorter `table`, or the enum's property a shorter " +
            "`columnName` (an enum type is named <table>_<column>)."
        );
    };
    for (const table of tables) {
        claim(table.schema, table.table, table.kind === "junction" ? `junction table "${table.table}"` : `table "${table.table}"`);
    }
    for (const e of enums) claim(e.schema, e.name, `enum type "${e.name}"`);
}

/**
 * Refuse two many-to-many relations that resolve to one junction table with
 * different key columns.
 *
 * A default `through` is named after the two tables, so `posts.tags` and
 * `posts.featuredTags` both resolve to `posts_tags` — one keyed by `tag_id`,
 * the other by `featured_tag_id`. One table is created, from whichever came
 * first, so the other relation read and wrote a column that was never there.
 * The two sides of one link (`posts.tags` and `tags.posts`) share a junction
 * legitimately, and they name the same two columns — so the comparison is of
 * the (column, endpoint) pairs, in either order.
 */
function assertOneJunctionShape(
    seen: Map<string, { keys: string; claim: string }>,
    junctionTable: string,
    descriptor: TableDescriptor,
    relation: RelationOfKind<"manyToMany">,
    target: TableDescriptor
): void {
    const sourceTable = descriptor.table;
    const targetTable = target.table;
    const { sourceKey, targetKey } = relation.through;
    const keys = JSON.stringify([[sourceKey, sourceTable], [targetKey, targetTable]].sort());
    const claim = `the relation "${relation.name}" of table "${descriptor.slug}" ` +
        `("${sourceKey}" → ${sourceTable}, "${targetKey}" → ${targetTable})`;
    const first = seen.get(junctionTable);
    if (!first) {
        seen.set(junctionTable, { keys, claim });
        return;
    }
    if (first.keys === keys) return;
    throw new Error(
        `Two many-to-many relations resolve to the junction table "${junctionTable}" with different key ` +
        `columns: ${first.claim} and ${claim}. Only one table is created, so one of them would read ` +
        "and write columns that do not exist. Give the second its own junction — " +
        `\`through: { table: "${sourceTable}_${toSnakeCase(relation.name)}" }\` — or, if both are meant to ` +
        "be one link, declare it once."
    );
}

/** One table the plan creates: a table's own, or a junction its relations imply. */
type TableEntry =
    | { kind: "table"; descriptor: TableDescriptor }
    | { kind: "junction"; junction: TableJunction };

/** Where a junction's pivot column lands. */
const junctionSite = (junction: TableJunction, column: ColumnDescriptor): DefinedColumnSite => ({
    schema: junction.schema,
    table: junction.table,
    owner: junction.table,
    propName: column.key,
    column: column.column
});

// ── A collection's table ─────────────────────────────────────────────────────

function planCollectionTable(
    descriptor: TableDescriptor,
    resolvePolicyTable: ResolvePolicyTable,
    targetOf: (slug: string) => TableDescriptor,
    triggerFunctionNeeded: { value: boolean }
): TablePlan {
    const { schema, table, slug } = descriptor;
    const auth = descriptor.auth !== undefined;
    const columns: ColumnPlan[] = [];
    const triggers: TriggerPlan[] = [];

    // In the plan's order, read from the descriptor (`plannedColumnEntries`).
    for (const entry of plannedColumnEntries(descriptor, targetOf)) {
        if (entry.kind === "link") {
            columns.push(planLinkColumn(entry, descriptor, targetOf));
            continue;
        }
        columns.push(planDescribedColumn(entry.column, {
            site: describedSite(descriptor, entry.column),
            slug,
            auth,
            triggers,
            triggerFunctionNeeded
        }));
    }

    // ── Auth columns the collection file never mentions ──────────────────────
    // `db push` is declarative: Atlas diffs the database against exactly what
    // is emitted and drops anything else. The scaffold's users collection
    // describes 12 columns while auth needs 14, so `is_anonymous` and
    // `tokens_valid_after` read as unmanaged drift and a push run after the
    // server had started once planned to DROP them.
    if (auth) {
        const declared = new Set(columns.map(c => c.column));
        for (const spec of AUTH_USERS_COLUMNS) {
            if (declared.has(spec.column)) continue;
            columns.push({
                key: spec.column,
                column: spec.column,
                type: authColumnType(spec.type),
                nullable: spec.notNull !== true,
                primaryKey: false,
                unique: false,
                sqlDefinition: authUsersColumnSql(spec),
                source: { kind: "auth", slug: slug }
            });
        }
    }

    // ── The opt-in search column ─────────────────────────────────────────────
    // Last, so it reads as what it is: derived from the columns above it.
    // Postgres recomputes it on every write of a source column and rejects any
    // attempt to write it directly, which is what makes it impossible for the
    // index to drift from the row.
    const search = buildTableSearchColumnSpec(descriptor);
    if (search) {
        columns.push({
            key: search.column,
            column: search.column,
            type: { kind: "tsvector" },
            nullable: true,
            primaryKey: false,
            unique: false,
            generated: { expression: search.expression, stored: true },
            sqlDefinition: searchColumnTypeSql(search.expression, "tsvector"),
            source: { kind: "search", slug: slug }
        });
        if (search.fuzzy) {
            columns.push({
                key: search.fuzzy.column,
                column: search.fuzzy.column,
                type: { kind: "text" },
                nullable: true,
                primaryKey: false,
                unique: false,
                generated: { expression: search.fuzzy.expression, stored: true },
                sqlDefinition: searchColumnTypeSql(search.fuzzy.expression, "text"),
                source: { kind: "search", slug: slug }
            });
        }
    }

    const primaryKey = planPrimaryKey(descriptor, columns);

    const policyTable = resolvePolicyTable(descriptor.slug) ?? policyTableFromDescriptor(descriptor);
    const injected = new Set(tableInjectedRules(policyTable).map(rule => rule.name));
    const policies = withoutLiveSupersededNames(tableEffectiveRules(policyTable).flatMap((rule, index) =>
        compileTableSecurityRule(
            policyTable,
            rule,
            resolvePolicyTable,
            Boolean(rule.name && injected.has(rule.name)),
            rule.name ?? `#${index}`
        )));

    // ── Tenancy ──────────────────────────────────────────────────────────────
    // The policy is already above — `tableEffectiveRules` injects it, so
    // it compiles, names and renders like every other rule. What is left is the
    // half a rule cannot express: the column is NOT NULL, and it is indexed.
    const tenantIndexes = applyTenantColumnEffects(descriptor, columns, primaryKey);
    const keepTenant = planKeepTenantTrigger(descriptor, columns);
    if (keepTenant) triggers.push(keepTenant);

    // Last among the columns, because it reads a nullability the two passes
    // above can still change.
    settleDefaultOnDelete(descriptor, columns);

    // After every other index, because the foreign-key ones defer to them: a
    // declared index or the tenant index that already leads with the column
    // serves the same lookups, and a second one would only cost writes.
    const indexes = [...buildTableIndexSpecs(descriptor), ...tenantIndexes];
    indexes.push(...planForeignKeyIndexes(schema, table, columns, primaryKey, indexes, column => {
        // A `belongsTo` whose author opted out keeps its constraint and loses
        // only the index. Asked of the relation, not the column: the column a
        // declared property owns carries no relation of its own.
        const relation = linkRelationOf(descriptor, column);
        if (!relation?.index) return undefined;
        // A link declared without its constraint is joined on all the same:
        // its column is indexed as a foreign key's would be. A link into a
        // view is not: nothing can be joined there by key.
        return column.foreignKey?.column
            ?? (writtenWithoutConstraint(descriptor, relation, targetOf(relation.target)) ? column.column : undefined);
    }));

    return {
        schema,
        table,
        qualified: `${schema}.${table}`,
        declaredSchema: declaredSchemaOf(descriptor),
        varName: getTableVarName(table),
        kind: "collection",
        slug,
        columns,
        primaryKey,
        indexes,
        search,
        vector: buildTableVectorIndexPlan(descriptor),
        vectorColumns: buildTableVectorColumnSpecs(descriptor),
        policies,
        triggers,
        auth
    };
}

/**
 * The table's primary key, as the column names {@link TablePlan.primaryKey}
 * lists — and the columns adjusted to state it one way only.
 *
 * One `isId` property is a key column of its own, declared inline
 * (`"id" INTEGER PRIMARY KEY`, `.primaryKey()`), which is how
 * {@link planPropertyColumn} planned it. Several are one composite key, and a
 * composite key cannot be said column by column: two inline `PRIMARY KEY`
 * clauses are two primary keys, which Postgres refuses. So each member stops
 * being a key of its own, keeps NOT NULL (the constraint implies it, and every
 * emitter spells it on the column so the three read the same), and the table
 * gets one `PRIMARY KEY (a, b)` over the list returned here — the shape a
 * junction's key has always had.
 *
 * A table that declares no key gets an implicit `id TEXT PRIMARY KEY`,
 * which is what `getPrimaryKeys` reads back.
 */
function planPrimaryKey(descriptor: TableDescriptor, columns: ColumnPlan[]): string[] {
    const keyNames = descriptor.primaryKey;

    if (keyNames.length > 1) {
        return keyNames.map(name => {
            const column = columns.find(c => c.source.propName === name && !c.columnOwnedByProperty);
            if (!column) {
                throw new Error(
                    `Column "${name}" of table "${descriptor.slug}" is part of the primary key, and it puts ` +
                    "no column on this table, so it cannot be part of the table's primary key. Mark the " +
                    "column that holds it `.primaryKey()` instead."
                );
            }
            column.primaryKey = false;
            column.nullable = false;
            return column.column;
        });
    }

    // With a default the database fills. Nothing else can: the key is not a
    // property, so the admin form has no field for it, and REST, the SDK and
    // the socket send none. Without one, every insert into a collection that
    // declares no key — the quickstart's first one among them — was refused
    // as a missing `id`. The column stays TEXT so a table created before this
    // keeps its type, and boot's ensure adds the default to it: a DEFAULT binds
    // only future writes, so it is the one change it makes to an existing
    // column. A key the caller does supply still wins over the default.
    if (!columns.some(c => c.primaryKey)) {
        columns.unshift({
            key: "id",
            column: "id",
            type: { kind: "text" },
            nullable: false,
            primaryKey: true,
            unique: false,
            default: { kind: "sql", expression: IMPLICIT_ID_DEFAULT },
            source: { kind: "implicit-id", slug: descriptor.slug }
        });
    }
    return columns.filter(c => c.primaryKey).map(c => c.column);
}

/** What {@link planDescribedColumn} needs about the table the column lands on. */
interface DescribedColumnContext {
    /** Where the column lands — the trigger and an unnamed enum are named after it. */
    site: DefinedColumnSite;
    /** The slug the plan records as the column's source: the table's, or a junction's table name. */
    slug: string;
    /** Whether `auth-users-columns` owns this table's columns. */
    auth: boolean;
    /** Collected `BEFORE UPDATE` triggers, appended to. */
    triggers: TriggerPlan[];
    triggerFunctionNeeded: { value: boolean };
}

/**
 * The two schema effects a `tenant` declaration has that a policy cannot state.
 *
 * The policy itself is injected as an ordinary `SecurityRule`
 * (`buildTenantSecurityRule`) and compiled above with every other rule, so
 * nothing here touches `policies`. What is left is the column:
 *
 * - **`NOT NULL`.** A row whose tenant is NULL belongs to nobody, and the
 *   restrictive policy compares the column to the caller's tenant — a
 *   comparison against NULL is never true. Such a row is therefore invisible to
 *   every caller, forever, including the one who wrote it. The write path
 *   refuses to create one (`TENANT_REQUIRED`); this is the same statement made
 *   where a raw `INSERT`, a seed and a migration can also hear it.
 * - **An index.** The tenancy predicate is ANDed into *every* statement against
 *   the table, so an unindexed tenant column turns every read into a sequential
 *   scan filtered by tenant. It is the one index a tenant-scoped table cannot
 *   be without, and the one people most reliably forget — which is the whole
 *   argument for deriving it rather than documenting it.
 *
 * The index goes through `deriveIndexName` like every other index, so it is a
 * Rebase-managed name (`_ix_<fingerprint>`), it is in the Atlas diff, and the
 * doctor recognises it. Because that name is a fingerprint of the index's
 * semantics, an author who has *already* declared a plain btree index on the
 * tenant column derives byte-for-byte the same name — so the two are the same
 * object and this adds nothing rather than colliding.
 *
 * Throws when the field names no column. `planSchema` throws rather than
 * guessing, and the alternative here is a table with a tenancy policy over a
 * column that does not exist: `CREATE POLICY` fails, RLS stays enabled, and the
 * collection denies every row.
 */
function applyTenantColumnEffects(
    descriptor: TableDescriptor,
    columns: ColumnPlan[],
    primaryKey: string[]
): CollectionIndexSpec[] {
    const tenant = tenantOf(descriptor);
    if (!tenant) return [];
    const { schema, table } = descriptor;

    const column = findTenantColumn(descriptor, columns, tenant.field);
    if (!column) {
        throw new Error(
            `Table "${descriptor.slug}" declares \`tenant: { field: "${tenant.field}" }\`, and ` +
            "no column of that key is created on it. `tenant` says what a column means; it does not " +
            "create one. Declare the column, or name the one that holds the tenant id."
        );
    }

    // The leading column of the primary key is already NOT NULL and already
    // indexed by `<table>_pkey`. Saying either again would make `db push` plan
    // a constraint and an index the database has no reason to hold. A later
    // column of a composite key is NOT NULL too, but `<table>_pkey` cannot
    // serve a lookup on it alone, so it still gets its index.
    if (primaryKey[0] === column.column) return [];

    column.nullable = false;

    const withoutName = {
        schema,
        table,
        method: "btree" as const,
        unique: false,
        keys: [{ column: column.column, direction: "asc" as const, nulls: "last" as const }],
        include: [],
        predicate: null,
        reason: TENANT_INDEX_REASON
    };
    return [{ ...withoutName, indexName: deriveIndexName(withoutName) }];
}

/**
 * The trigger that keeps a row in its tenant, or nothing when the collection
 * declares no `tenant`. See `tenant-keep-trigger.ts` for why a policy cannot.
 */
function planKeepTenantTrigger(
    descriptor: TableDescriptor,
    columns: ColumnPlan[]
): TriggerPlan | undefined {
    const tenant = tenantOf(descriptor);
    if (!tenant) return undefined;
    const column = findTenantColumn(descriptor, columns, tenant.field);
    if (!column) return undefined;
    const { schema, table } = descriptor;
    return {
        schema,
        table,
        column: column.column,
        name: toPostgresIdentifier(keepTenantTriggerName(table)),
        kind: "keep-tenant",
        bypassRoles: [...tenant.bypassRoles]
    };
}

/**
 * A btree on each foreign-key column of one table, where nothing already
 * serves the lookup — see `foreignKeyIndexSpec` for why the column needs one.
 * `linkColumn` names the column a planned column links by, or nothing for a
 * column that wants no such index (an opted-out link, a plain column).
 *
 * Skipped, so that no table ever carries two indexes doing one job, when the
 * column already leads:
 *
 * - the primary key — `<table>_pkey` is a btree over the key in key order, so
 *   its first column is indexed and the rest are not (a junction's
 *   `(post_id, tag_id)` key serves `post_id`, and `tag_id` gets an index);
 * - a UNIQUE on the column (`validation.unique`, on the relation or on the
 *   property that owns the column) — Postgres backs it with a btree;
 * - another planned index that leads with it ({@link leadsWithColumn}) — one
 *   the collection declares in `indexes:`, or the tenant index.
 *
 * Only the plan is consulted, never the catalogue: `db push` renders this from
 * the collections alone, and boot has to reach the same set with the same
 * names, or Atlas would plan to drop what boot built.
 */
function planForeignKeyIndexes(
    schema: string,
    table: string,
    columns: ColumnPlan[],
    primaryKey: string[],
    planned: readonly CollectionIndexSpec[],
    linkColumn: (column: ColumnPlan) => string | undefined
): CollectionIndexSpec[] {
    const created = columns.filter(c => !c.columnOwnedByProperty);
    const derived: CollectionIndexSpec[] = [];
    for (const column of columns) {
        const name = linkColumn(column);
        if (name === undefined) continue;
        if (primaryKey[0] === name) continue;
        if (created.some(c => c.column === name && c.unique)) continue;
        if ([...planned, ...derived].some(spec => leadsWithColumn(spec, name))) continue;
        derived.push(foreignKeyIndexSpec(schema, table, name));
    }
    return derived;
}

/**
 * The planned column a `tenant.field` names.
 *
 * The descriptor's `tenant.field` is a column key — a `belongsTo` named as
 * the tenant was resolved to its foreign-key column when the table compiled —
 * so the planned column is the one with that column's SQL name.
 *
 * Only columns that are created count. A relation whose column a declared
 * column owns keeps an entry for its constraint alone, under the same SQL
 * name; when the relation was declared first, NOT NULL landed on that entry,
 * nothing rendered it, and the tenant column stayed nullable.
 */
function findTenantColumn(
    descriptor: TableDescriptor,
    columns: ColumnPlan[],
    field: string
): ColumnPlan | undefined {
    const tenantColumn = columnByKey(descriptor, field);
    if (!tenantColumn) return undefined;
    return columns.find(c => !c.columnOwnedByProperty && c.column === tenantColumn.column);
}

/**
 * The `ON DELETE` a link gets when the author did not say, decided from the
 * column as it will be created.
 *
 * {@link planLinkColumn} sees only its own link's nullability, and two later facts change the premise: `tenant` makes
 * its column NOT NULL, and a declared property that owns a relation's column
 * decides that column's nullability itself. Defaulting before either produced
 * `NOT NULL … ON DELETE SET NULL` — a parent's delete that can only fail, and
 * fails with 23502 naming the child's column rather than as the foreign-key
 * refusal it is. An `onDelete` the author wrote is theirs and is kept.
 */
function settleDefaultOnDelete(descriptor: TableDescriptor, columns: ColumnPlan[]): void {
    for (const column of columns) {
        const fk = column.foreignKey;
        // An `onDelete` the author wrote is theirs.
        if (!fk || linkRelationOf(descriptor, column)?.onDelete !== undefined) continue;
        const created = columns.find(c => c.column === column.column && !c.columnOwnedByProperty) ?? column;
        const onDelete = defaultBelongsToOnDelete(!created.nullable);
        if (onDelete === fk.onDelete) continue;
        column.foreignKey = foreignKeyPlan({
            schema: fk.schema,
            table: fk.table,
            column: fk.column,
            targetSchema: fk.targetSchema,
            targetTable: fk.targetTable,
            targetColumn: fk.targetColumn,
            onDelete,
            onUpdate: fk.onUpdate
        });
    }
}

/**
 * The column a `belongsTo` link plans, from its descriptor — one of the three
 * forms {@link plannedColumnEntries} hands over:
 *
 * - `absorbed`: the bound column is nothing but the foreign key, so this entry
 *   IS the column, typed as the target's key;
 * - `constraint`: the bound column is planned on its own; this entry carries
 *   the constraint alone (`columnOwnedByProperty`, skipped as a column by the
 *   renderers) and states the same type and nullability, so one column never
 *   reads two ways in the plan;
 * - `derived`: the relation derives the column, typed as the target's key.
 *
 * `constraint: false` keeps the column and plans no `FOREIGN KEY`; neither
 * does a link into a view (Postgres refuses one), which the descriptor already
 * records as `constraint: false`.
 */
function planLinkColumn(
    entry: Extract<PlannedColumnEntry, { kind: "link" }>,
    descriptor: TableDescriptor,
    targetOf: (slug: string) => TableDescriptor
): ColumnPlan {
    const { relation, column, form } = entry;
    const { schema, table, slug } = descriptor;
    const target = targetOf(relation.target);
    const via = `relation "${slug}.${relation.name}"`;
    const targetKey = tableKeyTarget(target, via);
    const ownsColumn = form === "constraint";
    const required = !column.nullable && column.primaryKey !== true;

    // Only a *derived* column name can be affected by the change to
    // `generateForeignKeyName`; one the author wrote is theirs.
    const legacyKey = legacyForeignKeyName(relation.name);
    const derivedName = relation.localKey === generateForeignKeyName(relation.name);

    return {
        key: column.key,
        column: relation.localKey,
        type: ownsColumn ? describedPgType(column, describedSite(descriptor, column)) : targetKey.type,
        nullable: column.nullable,
        primaryKey: false,
        // UNIQUE on a link is a one-to-one. The constraint-only entry leaves
        // it to the column planned beside it.
        unique: !ownsColumn && column.unique === true,
        columnOwnedByProperty: ownsColumn || undefined,
        legacyColumn: derivedName && legacyKey !== relation.localKey ? legacyKey : undefined,
        foreignKey: relation.constraint ? foreignKeyPlan({
            schema,
            table,
            column: relation.localKey,
            targetSchema: target.schema,
            targetTable: target.table,
            targetColumn: targetKey.column,
            onDelete: relation.onDelete ?? defaultBelongsToOnDelete(required),
            onUpdate: relation.onUpdate
        }) : undefined,
        source: { kind: "relation", propName: relation.name, slug }
    };
}

/** The `belongsTo` a planned link column stands for, or `undefined` for any other column. */
const linkRelationOf = (descriptor: TableDescriptor, column: ColumnPlan): BelongsToDescriptor | undefined => {
    if (column.source.kind !== "relation" || !column.source.propName) return undefined;
    const relation = relationOf(descriptor, column.source.propName);
    return relation?.kind === "belongsTo" ? relation : undefined;
};

/**
 * An auth-owned column's declared SQL type, as a tag.
 *
 * `auth-users-columns` states these as SQL because that is the grammar its three
 * creators write in; the plan needs the tag so nothing downstream has to parse a
 * type back apart. Deliberately exhaustive rather than a fallback: a column auth
 * adds with a type nobody mapped should say so here, not turn into `TEXT` in a
 * table the login flow reads.
 */
const AUTH_COLUMN_TYPES: Record<string, PgType> = {
    "TEXT": { kind: "text" },
    "TEXT[]": { kind: "array", of: { kind: "text" } },
    "BOOLEAN": { kind: "boolean" },
    "JSONB": { kind: "jsonb" },
    "TIMESTAMP WITH TIME ZONE": { kind: "timestamptz" }
};

const authColumnType = (sqlType: string): PgType => {
    const mapped = AUTH_COLUMN_TYPES[sqlType];
    if (!mapped) {
        throw new Error(
            `\`auth-users-columns\` declares a column of type "${sqlType}", which the schema plan ` +
            "has no tag for. Add it to `AUTH_COLUMN_TYPES` in schema/plan/plan-schema.ts."
        );
    }
    return mapped;
};

// ── A junction table ─────────────────────────────────────────────────────────

/**
 * Which declaring side a junction is planned from.
 *
 * With one side, that side — as it always was, so a junction only one end
 * declares keeps the key every database already has. With both ends declaring
 * it, the planner used to take whichever it reached first, and the two doors
 * reach them in different orders: `db push` loads files by name, boot walks the
 * bundle's array. The same junction was keyed `(a_id, b_id)` by one and
 * `(b_id, a_id)` by the other, and a push against a boot-built database rebuilt
 * the key. Now the side whose table sorts first (then its junction column),
 * which is the order `db push` already used wherever a file is named after its
 * table. Compared by SQL table name, not slug: that is what every key in the
 * field was created by.
 */
function canonicalJunctionSide(junction: TableJunction): TableJunctionSide {
    const [first, ...rest] = junction.declaringSides;
    if (rest.length === 0) return first ?? junction.endpoints[0];
    return [...junction.declaringSides].sort((a, b) => {
        const left = a.descriptor.table;
        const right = b.descriptor.table;
        if (left !== right) return left < right ? -1 : 1;
        return a.junctionColumn < b.junctionColumn ? -1 : a.junctionColumn > b.junctionColumn ? 1 : 0;
    })[0];
}

function planJunctionTable(
    junction: TableJunction,
    targetOf: (slug: string) => TableDescriptor,
    resolvePolicyTable: ResolvePolicyTable,
    triggerFunctionNeeded: { value: boolean }
): TablePlan {
    const { relation, descriptor: source } = canonicalJunctionSide(junction);
    const { table } = junction;
    // Junctions live in `public`, full stop — `resolveTableJunctions` says so,
    // so it is where the tables are created and where the derived RLS
    // policies are applied. Inheriting the endpoint's schema put the junction
    // of any m2m onto `users` in `rebase` while its policies were still created
    // against `public.<junction>`: RLS enabled on one table, rows in another.
    const schema = junction.schema;
    const target = targetOf(relation.target);
    const { sourceKey: sourceColumn, targetKey: targetColumn } = relation.through;
    // Every declaring side agrees on the edge's lifetime; the first one wins.
    const onDelete = relation.onDelete ?? "CASCADE";

    const legacyFor = (endpoint: TableDescriptor, column: string): string | undefined => {
        // A junction column's default name is derived from the endpoint
        // table's slug — normally plural, so this is where the
        // singularization change lands: a `categories` endpoint used to give
        // `categorie_id` and now gives `category_id`. Recorded, not used.
        const slug = toSnakeCase(endpoint.slug);
        const legacy = legacyForeignKeyName(slug);
        return column === generateForeignKeyName(slug) && legacy !== column ? legacy : undefined;
    };

    const via = `relation "${source.slug}.${relation.name}"`;
    const endpoint = (endpointTable: TableDescriptor, column: string): ColumnPlan => {
        const key = tableKeyTarget(endpointTable, via);
        return {
            key: column,
            column,
            type: key.type,
            nullable: false,
            // Part of the composite key on {@link TablePlan.primaryKey}, not a
            // key of its own — an inline `PRIMARY KEY` here would be a second one.
            primaryKey: false,
            unique: false,
            legacyColumn: legacyFor(endpointTable, column),
            // Postgres refuses a foreign key into a view.
            foreignKey: endpointTable.kind === "view" ? undefined : foreignKeyPlan({
                schema,
                table,
                column,
                targetSchema: endpointTable.schema,
                targetTable: endpointTable.table,
                targetColumn: key.column,
                onDelete
            }),
            source: { kind: "junction-key" }
        };
    };

    const columns = [endpoint(source, sourceColumn), endpoint(target, targetColumn)];

    // ── The junction's own columns ───────────────────────────────────────────
    // `pivot`: the `role` on a membership, the `position` on a tag. Planned by
    // the same {@link planDescribedColumn} the tables use, so a pivot column
    // gets exactly the type, nullability, default, UNIQUE and enum type it
    // would get on a table.
    //
    // Not supported here, and deliberately: `indexes`, `search`, `vector` and
    // links — a pivot holds plain columns.
    const triggers: TriggerPlan[] = [];
    const keyColumns = new Set([sourceColumn, targetColumn]);
    for (const pivotColumn of junction.pivot) {
        // A pivot column on a key column would be a second definition of it;
        // the compiler leaves it out, and so does this.
        if (keyColumns.has(pivotColumn.column)) continue;
        columns.push(planDescribedColumn(pivotColumn, {
            site: junctionSite(junction, pivotColumn),
            slug: table,
            auth: false,
            triggers,
            triggerFunctionNeeded
        }));
    }

    // Junction tables are generated tables like any other: locked by default,
    // with derived policies — reads follow the endpoints' visibility, writes
    // follow the declaring side's update rules. Without them they were the one
    // kind of generated table with no RLS at all.
    const junctionTable = junctionPolicyTable(junction);
    const policies = withoutLiveSupersededNames(tableJunctionRules(junction).flatMap((rule, index) =>
        compileTableSecurityRule(junctionTable, rule, resolvePolicyTable, false, rule.name ?? `#${index}`)));

    return {
        schema,
        table,
        qualified: `${schema}.${table}`,
        varName: getTableVarName(table),
        kind: "junction",
        declaringSlugs: junction.declaringSides.map(side => side.descriptor.slug),
        columns,
        primaryKey: [sourceColumn, targetColumn],
        // Always, and with no opt-out: the junction is the platform's table,
        // not the author's. The key covers lookups by `sourceColumn`; the
        // reverse side of the link — `tags → posts` — filters on
        // `targetColumn`, which only this index serves.
        indexes: planForeignKeyIndexes(schema, table, columns, [sourceColumn, targetColumn], [],
            column => (column.source.kind === "junction-key" ? column.foreignKey?.column : undefined)),
        vectorColumns: [],
        policies,
        triggers,
        auth: false
    };
}

// ── Drizzle relations ────────────────────────────────────────────────────────

/**
 * The `relations(...)` entries the generated file carries.
 *
 * Both sides of a link must share a `relationName` or Drizzle cannot pair them;
 * `tableRelationName` is the rule, and each side derives it independently.
 */
function planRelations(
    tables: readonly TableDescriptor[],
    tableEntries: ReadonlyMap<string, TableEntry>,
    targetOf: (slug: string) => TableDescriptor
): RelationPlan[] {
    const plans: RelationPlan[] = [];
    const keyOf = (descriptor: TableDescriptor, via: string): string => tableKeyTarget(descriptor, via).key;

    // Every relation whose foreign key lives on its target's table, grouped by
    // that target's slug, in table order and each table's relations in order.
    // Built once: a scan per table over every other table's relations is N²
    // in the table count.
    const fkOnTargetBySlug = new Map<string, Array<{ other: TableDescriptor; otherRel: RelationOfKind<"hasOne" | "hasMany"> }>>();
    for (const other of tables) {
        for (const otherRel of other.relations) {
            if (otherRel.kind !== "hasOne" && otherRel.kind !== "hasMany") continue;
            const list = fkOnTargetBySlug.get(otherRel.target) ?? [];
            list.push({ other, otherRel });
            fkOnTargetBySlug.set(otherRel.target, list);
        }
    }

    for (const [tableName, entry] of tableEntries) {
        const tableVar = getTableVarName(tableName);

        if (entry.kind === "junction") {
            // The side the junction was first reached from.
            const { relation, descriptor: source } = entry.junction.endpoints[0];
            const target = targetOf(relation.target);
            const via = `relation "${source.slug}.${relation.name}"`;
            // Each `one()` here pairs with a `many(junction, { relationName })`
            // on its endpoint, so each takes the name that endpoint's own
            // relation derives. The far side is the target's many-to-many
            // through this same junction; only a junction nothing points back
            // through needs the synthesized name.
            const owningRelationName = tableRelationName(relation, source, targetOf);
            const inverse = target.relations.find(r =>
                r.kind === "manyToMany" && bareTableName(r.through.table) === bareTableName(tableName));
            const inverseRelationName = inverse
                ? tableRelationName(inverse, target, targetOf)
                : `${tableName}_${relation.through.targetKey}`;
            plans.push({
                tableVar,
                key: relation.through.sourceKey,
                kind: "one",
                targetVar: getTableVarName(source.table),
                relationName: owningRelationName,
                fields: [relation.through.sourceKey],
                references: [keyOf(source, via)]
            });
            // A self-referencing link is its own inverse: one name, one
            // endpoint table, and drizzle refuses two relations named alike.
            if (inverseRelationName === owningRelationName) continue;
            // The file declares no variable for a view to pair with.
            if (target.kind === "view") continue;
            plans.push({
                tableVar,
                key: relation.through.targetKey,
                kind: "one",
                targetVar: getTableVarName(target.table),
                relationName: inverseRelationName,
                fields: [relation.through.targetKey],
                references: [keyOf(target, via)]
            });
            continue;
        }

        const descriptor = entry.descriptor;
        // An alias entry for the same foreign key would otherwise emit twice.
        const emitted = new Set<string>();
        for (const relation of descriptor.relations) {
            const target = targetOf(relation.target);
            // A link into a view is not a relation this file can describe: it
            // declares no table for one.
            if (target.kind === "view") continue;
            const targetVar = getTableVarName(target.table);
            const relationName = tableRelationName(relation, descriptor, targetOf);
            const dedupe = `${relationName}::${relation.kind}`;
            if (emitted.has(dedupe)) continue;
            emitted.add(dedupe);
            const via = `relation "${descriptor.slug}.${relation.name}"`;

            switch (relation.kind) {
                case "belongsTo":
                    plans.push({
                        tableVar,
                        key: relation.name,
                        kind: "one",
                        targetVar,
                        relationName,
                        // The generated object is keyed by the column's KEY:
                        // `user_id` is exposed as `userId`, and emitting the
                        // column produces a file that does not compile.
                        fields: [servedKeyOf(descriptor, relation.localKey)],
                        references: [keyOf(target, via)]
                    });
                    break;
                case "hasOne":
                    // The foreign key lives on the TARGET table, so this side
                    // states the join from its own end: its source key against
                    // the target's foreign key, under the owning side's name.
                    // Drizzle has no `one()` paired by `relationName` alone,
                    // and a bare `one(target)` is paired by table, which throws
                    // once the target has two links back here or the link is to
                    // its own table.
                    plans.push({
                        tableVar,
                        key: relation.name,
                        kind: "one",
                        targetVar,
                        relationName,
                        fields: [relation.sourceKey ? servedKeyOf(descriptor, relation.sourceKey) : keyOf(descriptor, via)],
                        references: [servedKeyOf(target, relation.foreignKey)],
                        nullable: true
                    });
                    break;
                case "hasMany":
                    plans.push({ tableVar, key: relation.name, kind: "many", targetVar, relationName });
                    break;
                case "manyToMany":
                    plans.push({
                        tableVar,
                        key: relation.name,
                        kind: "many",
                        targetVar: getTableVarName(relation.through.table),
                        relationName
                    });
                    break;
                case "via":
                    // A join chain is resolved at query time, not modelled as a
                    // Drizzle relation.
                    break;
            }
        }

        // Reciprocals the far side declares and this one does not. Drizzle
        // needs both halves of a pair to exist for a relational query to work.
        for (const { other, otherRel } of fkOnTargetBySlug.get(descriptor.slug) ?? []) {
            if (other.slug === descriptor.slug) continue;
            const relationName = tableRelationName(otherRel, other, targetOf);
            const dedupe = `${relationName}::belongsTo`;
            if (emitted.has(dedupe)) continue;
            emitted.add(dedupe);
            const otherVar = getTableVarName(other.table);
            const fieldKey = servedKeyOf(descriptor, otherRel.foreignKey);
            plans.push({
                tableVar,
                key: `_synth_${otherVar}_${fieldKey}`,
                kind: "one",
                targetVar: otherVar,
                relationName,
                fields: [fieldKey],
                // The column the far side points at: its primary key,
                // unless the link names another one with `sourceKey`.
                references: [otherRel.sourceKey
                    ? servedKeyOf(other, otherRel.sourceKey)
                    : keyOf(other, `relation "${other.slug}.${otherRel.name}"`)]
            });
        }
    }

    return plans;
}

export { SET_UPDATED_AT_FN };
