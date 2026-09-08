import { CollectionConfig, NumberProperty, Property, ResolvedRelation, RelationProperty, SecurityOperation, SecurityRule, StringProperty, isPostgresCollectionConfig, DateProperty, ArrayProperty, MapProperty, ReferenceProperty, VectorProperty, BinaryProperty, isManyToMany, type ResolvedManyToMany, type ResolvedBelongsTo, type ResolvedForeignKeyOnTarget, hasForeignKeyOnTarget } from "@rebasepro/types";
import { buildSearchColumnSpec } from "./search-column";
import { defaultBelongsToOnDelete } from "./generate-postgres-ddl-logic";
import { buildCollectionIndexSpecs, renderPredicate, type CollectionIndexSpec } from "./collection-index";
import {
    assertSinglePrimaryKey,
    declaresEnumType,
    enumLabelsOf,
    getPrimaryKeyName,
    idColumnDefault,
    isIdProperty,
    primaryKeyColumnBuilder,
    resolveColumnName
} from "./column-plan-helpers";
import { getEnumVarName, getTableName, getTableVarName, resolveCollectionRelations, findRelation, fieldKeyForColumn, securityRuleToConditions, policyToPostgres, getEffectiveSecurityRules, resolveJunctionSpecs, getJunctionSecurityRules, getJunctionCollectionConfig, resolveStringColumnLength, relationalCollections, sortCollectionsBySlug } from "@rebasepro/common";
import { toSnakeCase, getPolicyNamesForRule } from "@rebasepro/utils";
import { logger } from "@rebasepro/server";
// --- Helper Functions ---

/**
 * Resolve the SQL column name for a property.
 * Uses the explicit `columnName` when set (e.g. from introspection),
 * falling back to `toSnakeCase(propName)` for manually-authored collections.
 */
const JS_IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

/**
 * A string literal for the generated schema file.
 *
 * Column names, table names and enum values are all written into this file as
 * literals, and none of them is constrained to be quote-free: a Postgres
 * identifier only has to be quoted, and `O'Brien` is an ordinary enum value.
 * Interpolating them raw ended the literal early — for enum values, inside
 * single quotes, where an apostrophe is not an edge case.
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
 * Given a raw DB column name (e.g. "client_id"), the Drizzle property key that
 * maps to it.
 *
 * One line, because the rule is shared: the Drizzle object key is the wire
 * name, and {@link fieldKeyForColumn} is the one definition of what a column is
 * named on the wire. This used to be a private copy that fell back to the
 * column verbatim, which is how a derived foreign key ended up served as
 * `author_id` beside a hand-authored `displayName`.
 */
const resolvePropertyKeyForColumn = (collection: CollectionConfig, column: string): string =>
    fieldKeyForColumn(collection, column);

/**
 * The drizzle-orm builders this file emitted, collected as they are written.
 *
 * The import list used to be a fixed roster plus three property-scanning
 * heuristics (`hasUuid` read `isId`/`autoValue` only), so `columnType: "uuid"`
 * on a plain string emitted `uuid("ext")` and imported nothing — a generated
 * file that does not compile, for a property the JSON and editor paths both
 * accept. `smallint` was in neither the roster nor a heuristic. Deriving the
 * list from what was actually emitted makes that class of bug unrepresentable:
 * the only way to use a builder is to record it here.
 */
type BuilderUses = Set<string>;

/**
 * Record a builder and hand back its name, so a call site cannot use one
 * silently. Named `needs` rather than `use` because `use` is a React hook name
 * and the repo's lint rules read it as one.
 */
const needs = (uses: BuilderUses | undefined, builder: string): string => {
    uses?.add(builder);
    return builder;
};

/**
 * The `.references(...)` clause a foreign key column carries.
 *
 * The `(): AnyPgColumn =>` annotation is not optional decoration and it is
 * emitted on every reference rather than only the self-referential ones. A
 * `belongsTo` pointing at its own table — a comment thread, a category tree —
 * produces `.references(() => posts.id)` inside the initializer of `posts`, and
 * TypeScript cannot infer a type for a `const` that appears in its own
 * initializer (TS7022). Drizzle documents the annotation as the fix; applying it
 * everywhere means the generated line does not depend on whether the author
 * happened to point the relation at another table.
 */
const referencesClause = (
    targetTableVar: string,
    targetIdField: string,
    options: { onDelete: string; onUpdate?: string }
): string => {
    const parts = [
        options.onUpdate ? `onUpdate: "${options.onUpdate}"` : "",
        `onDelete: "${options.onDelete}"`
    ].filter(Boolean);
    return `.references((): AnyPgColumn => ${member(targetTableVar, targetIdField)}, { ${parts.join(", ")} })`;
};

/**
 * The `belongsTo` whose foreign key column this *scalar* property declares.
 *
 * A collection may declare the column itself — `postId: { type: "number",
 * columnName: "post_id" }` — beside the relation that uses it. The relation then
 * emits nothing (the property owns the column), and before this the property
 * emitted a plain integer with no `.references()`: that project got no foreign
 * key at all on the Drizzle side while `db push` created one.
 */
const belongsToOwnedByProperty = (
    collection: CollectionConfig,
    propName: string
): { relation: ResolvedBelongsTo; property: Property } | undefined => {
    const resolved = resolveCollectionRelations(collection);
    for (const [relationPropName, raw] of Object.entries(collection.properties ?? {})) {
        const candidate = raw as Property;
        if (candidate?.type !== "relation") continue;
        if (relationPropName === propName) continue;
        const relProp = candidate as RelationProperty;
        const relation = findRelation(resolved, relProp.relation?.relationName ?? relationPropName);
        if (!relation || relation.kind !== "belongsTo") continue;
        if (fieldKeyForColumn(collection, relation.localKey) !== propName) continue;
        return { relation, property: candidate };
    }
    return undefined;
};

/**
 * The Drizzle column declaration a property compiles to, or `null` when the
 * property puts no column on *this* table (an inverse relation, whose column
 * lives on the target). Exported so it can be checked against its DDL twin
 * `getSqlColumnType` directly — the two disagreeing is what left `geopoint`
 * with a database column and no Drizzle key.
 *
 * `uses` collects the drizzle-orm builders the returned line needs; see
 * {@link BuilderUses}. Optional so a caller checking one column need not care,
 * and always passed by {@link generateSchema}, which turns it into the import.
 */
export const getDrizzleColumn = (
    propName: string,
    prop: Property,
    collection: CollectionConfig,
    collections: CollectionConfig[],
    uses?: BuilderUses
): string | null => {

    const colName = resolveColumnName(propName, prop);
    const isId = isIdProperty(propName, prop, collection);
    let columnDefinition: string;

    switch (prop.type) {
        case "string": {
            const stringProp = prop as unknown as StringProperty;
            if (stringProp.enum) {
                // Throws on an empty list, here as well as at the declaration:
                // the column referenced an enum variable the file never
                // declared, which is a `schema.generated.ts` that does not
                // compile (TS2552).
                enumLabelsOf(propName, prop, collection);
                const enumName = getEnumVarName(getTableName(collection), propName);
                columnDefinition = `${enumName}(${quote(colName)})`;
            } else if ("isId" in stringProp && stringProp.isId === "uuid") {
                columnDefinition = `${needs(uses, "uuid")}(${quote(colName)})`;
            } else if (stringProp.columnType === "uuid") {
                columnDefinition = `${needs(uses, "uuid")}(${quote(colName)})`;
            } else if (stringProp.columnType === "char") {
                columnDefinition = `${needs(uses, "char")}(${quote(colName)}, { length: ${resolveStringColumnLength(stringProp)} })`;
            } else if (stringProp.columnType === "varchar") {
                // The length is not optional decoration: `varchar("col")` with
                // no length is an UNBOUNDED varchar in Postgres, which is what
                // this emitted while the DDL generator emitted VARCHAR(255) for
                // the very same property.
                columnDefinition = `${needs(uses, "varchar")}(${quote(colName)}, { length: ${resolveStringColumnLength(stringProp)} })`;
            } else {
                // `text` is the default, and the only length-unbounded choice.
                // Ask for `varchar` explicitly if you want the length constraint.
                columnDefinition = `${needs(uses, "text")}(${quote(colName)})`;
            }
            break;
        }
        case "number": {
            const numProp = prop as unknown as NumberProperty;

            // An identity column, and its width is INTEGER — `columnType` is
            // not read here, on purpose. Every column that points at a numeric
            // primary key is INTEGER (`primaryKeyColumnType`), so a BIGINT
            // identity would be referenced by int4 foreign keys: the int8/int4
            // truncation `ensure-collection-tables` documents. The DDL
            // generator has always emitted `INTEGER GENERATED BY DEFAULT AS
            // IDENTITY` for this and ignored `columnType`; this side honoured
            // it, so the same property was int8 in `schema.generated.ts` and
            // int4 in the database — and with `columnType: "bigserial"` the
            // emitted `.generatedByDefaultAsIdentity()` is not a method that
            // exists, so the file did not compile at all.
            if ("isId" in numProp && numProp.isId === "increment") {
                columnDefinition = `${needs(uses, "integer")}(${quote(colName)}).generatedByDefaultAsIdentity()`;
                break;
            }

            let baseType = (numProp.validation?.integer || isId)
                ? `${needs(uses, "integer")}(${quote(colName)})`
                : `${needs(uses, "numeric")}(${quote(colName)})`;
            if (numProp.columnType) {
                if (numProp.columnType === "double precision") baseType = `${needs(uses, "doublePrecision")}(${quote(colName)})`;
                // `bigint` and `bigserial` are the only pg-core builders that
                // *require* a config argument: without `mode`, drizzle cannot
                // know whether to hand back a `number` or a `bigint`, and the
                // emitted call does not typecheck.
                //
                // This is why `schema.generated.ts` drifted. Regenerating it
                // produced a file that would not compile, so the bigint lines
                // were hand-patched — and every regeneration after that looked
                // like a large, alarming diff nobody wanted to ship. The file
                // then sat stale for long enough that a security fix to two RLS
                // policies never reached production.
                //
                // `number` rather than `bigint`: these are counters and byte
                // totals that every caller already treats as numbers, and
                // switching the runtime type would be a breaking change to
                // every consumer of the generated schema.
                else if (numProp.columnType === "bigint" || numProp.columnType === "bigserial") {
                    baseType = `${needs(uses, numProp.columnType)}(${quote(colName)}, { mode: "number" })`;
                }
                else baseType = `${needs(uses, numProp.columnType)}(${quote(colName)})`;
            }

            columnDefinition = baseType;
            break;
        }
        case "boolean":
            columnDefinition = `${needs(uses, "boolean")}(${quote(colName)})`;
            break;
        case "date": {
            const dateProp = prop as DateProperty;
            if (dateProp.columnType === "date") {
                columnDefinition = `${needs(uses, "date")}(${quote(colName)}, { mode: 'string' })`;
            } else if (dateProp.columnType === "time") {
                columnDefinition = `${needs(uses, "time")}(${quote(colName)})`;
            } else {
                columnDefinition = `${needs(uses, "timestamp")}(${quote(colName)}, { withTimezone: true, mode: 'string' })`;
            }
            // autoValue: database-level default for initial value on INSERT
            if (dateProp.autoValue === "on_create" || dateProp.autoValue === "on_update") {
                columnDefinition += ".default(sql`now()`)";
            }
            break;
        }
        case "map": {
            const mapProp = prop as MapProperty;
            if (mapProp.columnType === "json") {
                columnDefinition = `${needs(uses, "json")}(${quote(colName)})`;
            } else {
                columnDefinition = `${needs(uses, "jsonb")}(${quote(colName)})`;
            }
            break;
        }
        case "geopoint": {
            // `{ latitude, longitude }`, which is what the OpenAPI schema, the
            // generated TS type and the admin's field binding all describe.
            // This arm did not exist: `geopoint` fell to `default: return null`
            // and the caller dropped the column, so the DDL generator created a
            // column the Drizzle table had no key for — and every write to it
            // was silently discarded with a 201.
            columnDefinition = `${needs(uses, "jsonb")}(${quote(colName)})`;
            break;
        }
        case "array": {
            const arrayProp = prop as ArrayProperty;
            let colType = arrayProp.columnType;
            if (!colType && arrayProp.of && !Array.isArray(arrayProp.of)) {
                const ofProp = arrayProp.of as Property;
                if (ofProp.type === "string") {
                    colType = "text[]";
                } else if (ofProp.type === "number") {
                    colType = ofProp.validation?.integer ? "integer[]" : "numeric[]";
                } else if (ofProp.type === "boolean") {
                    colType = "boolean[]";
                }
            }

            if (colType === "json") {
                columnDefinition = `${needs(uses, "json")}(${quote(colName)})`;
            } else if (colType === "text[]") {
                columnDefinition = `${needs(uses, "text")}(${quote(colName)}).array()`;
            } else if (colType === "integer[]") {
                columnDefinition = `${needs(uses, "integer")}(${quote(colName)}).array()`;
            } else if (colType === "boolean[]") {
                columnDefinition = `${needs(uses, "boolean")}(${quote(colName)}).array()`;
            } else if (colType === "numeric[]") {
                columnDefinition = `${needs(uses, "numeric")}(${quote(colName)}).array()`;
            } else {
                columnDefinition = `${needs(uses, "jsonb")}(${quote(colName)})`;
            }
            break;
        }
        case "vector": {
            const vp = prop as VectorProperty;
            columnDefinition = `${needs(uses, "vector")}(${quote(colName)}, { dimensions: ${vp.dimensions} })`;
            break;
        }
        case "binary": {
            columnDefinition = `${needs(uses, "customType")}({ dataType() { return 'bytea'; } })(${quote(colName)})`;
            break;
        }
        case "relation": {
            const refProp = prop as RelationProperty;
            const resolvedRelations = resolveCollectionRelations(collection);
            const relation = findRelation(resolvedRelations, refProp.relation?.relationName ?? propName);

            // Only `belongsTo` puts a column on this table; every other kind
            // is a column on the target, a junction row, or a join chain.
            if (!relation || relation.kind !== "belongsTo") {
                return null;
            }

            // If a property of its own already declares this foreign key, that
            // property emits the column (and, since `belongsToOwnedByProperty`,
            // its `.references()`), and this relation must not emit a second
            // key for it. Asked of the *field key*, not the column: a property
            // declared `authorId` with `columnName: "author_id"` did not answer
            // to `properties["author_id"]`, so both sides emitted and the table
            // carried two Drizzle keys pointing at one column.
            const fkFieldKey = fieldKeyForColumn(collection, relation.localKey);
            if (collection.properties[fkFieldKey] && propName !== fkFieldKey) {
                return null;
            }

            let targetCollection: CollectionConfig;
            try {
                targetCollection = relation.target();
            } catch {
                return null; // Cannot resolve target
            }

            const fkColumnName = relation.localKey;
            const targetTableVar = getTableVarName(getTableName(targetCollection));
            const targetIdField = getPrimaryKeyName(targetCollection);
            // `quote`, like every other column literal in this file: a column
            // name only has to be quotable in Postgres, and this one is derived
            // from a relation the author wrote.
            const baseColumn = `${needs(uses, primaryKeyColumnBuilder(targetCollection))}(${quote(fkColumnName)})`;

            const required = prop.validation?.required;
            // Same default as the DDL generator, lowercased for Drizzle's
            // option literal. The two files describe the same constraint; a
            // default that differs between them makes `db push` plan a rewrite
            // of every required foreign key on every run.
            const onDelete = relation.onDelete ?? defaultBelongsToOnDelete(required).toLowerCase();
            needs(uses, "type AnyPgColumn");
            let columnDef = `${baseColumn}${referencesClause(targetTableVar, targetIdField, { onDelete, onUpdate: relation.onUpdate })}`;

            if (required) {
                columnDef += ".notNull()";
            }

            // Key by the wire name, column by `localKey`. They are two different
            // names for one thing and the generated line is where they meet:
            // `authorId: integer("author_id")`.
            return `    ${propKey(fkFieldKey)}: ${columnDef}`;
        }
        case "reference": {
            const refProp = prop as ReferenceProperty;
            const targetCollection = collections.find(c => c.slug === refProp.path || getTableName(c) === refProp.path);
            if (!targetCollection) {
                columnDefinition = `${needs(uses, "text")}(${quote(colName)})`;
                break;
            }

            const targetTableVar = getTableVarName(getTableName(targetCollection));
            const targetIdField = getPrimaryKeyName(targetCollection);
            const baseColumn = `${needs(uses, primaryKeyColumnBuilder(targetCollection))}(${quote(colName)})`;

            const required = prop.validation?.required;
            // The same rule as `belongsTo`, from the same function. This arm
            // hardcoded `cascade`, which is the retention policy the project
            // deliberately moved away from — so a required `reference` deleted
            // its children here and refused the delete everywhere else.
            const onDelete = defaultBelongsToOnDelete(required).toLowerCase();
            needs(uses, "type AnyPgColumn");

            columnDefinition = `${baseColumn}${referencesClause(targetTableVar, targetIdField, { onDelete })}`;
            if (required) {
                columnDefinition += ".notNull()";
            }
            // Skip the standard notNull() handling below because we did it here with references
            return `    ${propKey(propName)}: ${columnDefinition}`;
        }
        default:
            // Not `return null`. A `null` here means "this property puts no
            // column on this table", which is true of an inverse relation and
            // false of everything else — and the caller cannot tell the two
            // apart, so a type this switch simply forgot produced a table
            // missing a column while the DDL generator happily created one.
            // That is how `geopoint` stayed unpersistable: writes to it were
            // dropped before the SQL was built, forever, with a 201. A property
            // type nobody mapped is a generator bug, and it says so here rather
            // than at some caller's next INSERT.
            throw new Error(
                `No Postgres column mapping for property '${propName}' of type ` +
                `'${(prop as Property).type}' in collection '${collection.slug}'. ` +
                "Add a case to `getDrizzleColumn` (and to `getSqlColumnType`, which must agree)."
            );
    }

    // ── The tail every scalar column shares ──────────────────────────────────
    //
    // In the DDL generator's order — PRIMARY KEY, DEFAULT, UNIQUE, NOT NULL —
    // and applying the same two rules it applies, which this file did not:
    //
    //  • `validation.unique` holds for every type. This honoured it on `string`
    //    and `number` only, so a unique `date` or `map` was UNIQUE in the
    //    database and not in the file drizzle-kit plans from.
    //  • a primary key gets neither UNIQUE nor NOT NULL. Both are already
    //    implied, and emitting them made drizzle-kit plan an extra constraint
    //    against a database `db push` had built without one.
    if (isId) {
        columnDefinition += ".primaryKey()";
    }

    // One reading of `isId`, shared with the DDL generator and boot-ensure.
    const idDefault = idColumnDefault(propName, prop, collection);
    if (idDefault?.kind === "uuid") {
        columnDefinition += ".defaultRandom()";
    } else if (idDefault?.kind === "sql") {
        columnDefinition += `.default(sql\`${idDefault.expression}\`)`;
    }

    // A plain property that carries a relation's foreign key column gets the
    // constraint the relation would have emitted.
    const owned = belongsToOwnedByProperty(collection, propName);
    if (owned) {
        try {
            const targetCollection = owned.relation.target();
            const onDelete = owned.relation.onDelete
                ?? defaultBelongsToOnDelete(owned.property.validation?.required).toLowerCase();
            needs(uses, "type AnyPgColumn");
            columnDefinition += referencesClause(
                getTableVarName(getTableName(targetCollection)),
                getPrimaryKeyName(targetCollection),
                { onDelete, onUpdate: owned.relation.onUpdate }
            );
        } catch {
            // An unresolvable target emits no constraint, exactly as the
            // relation arm above returns early for one.
        }
    }

    if (!isId && prop.validation?.unique) {
        columnDefinition += ".unique()";
    }

    if (!isId && prop.validation?.required) {
        columnDefinition += ".notNull()";
    }

    return `    ${propKey(propName)}: ${columnDefinition}`;
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
 *   `.raw`. So a policy written as `email ~ '^admin\.user@corp\.com$'` reaches
 *   the database as `^admin.user@corp.com$`, where every `\.` now matches any
 *   character. A `USING` clause is a security boundary and that one silently
 *   widened it — the SQL file emitted by the DDL generator kept the backslashes
 *   while this path dropped them, so the two disagreed about who could read the
 *   table.
 *
 * Escaping here rather than in the compiler: the clause is correct SQL, and it
 * is only this destination that has an opinion about backslashes.
 */
const wrapSql = (clause: string): string =>
    `sql\`${clause.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${")}\``;

/**
 * Generates a deterministic hash based on the rule configuration.
 */

/**
 * Generates Drizzle pgPolicy() calls from a declarative SecurityRule definition.
 *
 * Supports the full spectrum:
 * - Convenience shortcuts: ownerField, access, roles
 * - Raw SQL: using, withCheck
 * - Mode: permissive (default) or restrictive
 * - operations[] array: generates one policy per operation
 * - Combinations: roles + ownerField, roles + raw SQL, etc.
 */
type ResolveCollection = (slug: string) => CollectionConfig | undefined;

const generatePolicyCode = (collection: CollectionConfig, rule: SecurityRule, index: number, resolveCollection: ResolveCollection): string => {
    const tableName = getTableName(collection);
    // Resolve operations: operations[] takes precedence over operation (singular)
    const ops: readonly SecurityOperation[] = rule.operations && rule.operations.length > 0
        ? rule.operations
        : [rule.operation ?? "all"];

    const policyNames = getPolicyNamesForRule(rule, tableName);

    // Generate one pgPolicy per operation
    return ops.map((op, opIdx) => {
        return generateSinglePolicyCode(collection, rule, op, policyNames[opIdx], resolveCollection);
    }).join("");
};

/**
 * Generates a single pgPolicy() call for one specific operation.
 */
const generateSinglePolicyCode = (collection: CollectionConfig, rule: SecurityRule, operation: SecurityOperation, policyName: string, resolveCollection: ResolveCollection): string => {
    const mode = rule.mode ?? "permissive";

    // Determine which clauses this operation needs:
    // SELECT, DELETE → USING only
    // INSERT → WITH CHECK only
    // UPDATE, ALL → both USING and WITH CHECK
    const needsUsing = operation !== "insert";
    const needsWithCheck = operation !== "select" && operation !== "delete";

    // Desugar the rule (access / ownerField / roles / structured condition / raw
    // SQL) into the shared PolicyExpression model, then compile to SQL — the same
    // normalization the DDL generator and the client-side evaluator use.
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);

    let usingClause = needsUsing && usingExpr ? wrapSql(policyToPostgres(usingExpr, collection, { resolveCollection })) : null;
    let withCheckClause = needsWithCheck && withCheckExpr ? wrapSql(policyToPostgres(withCheckExpr, collection, { resolveCollection })) : null;

    // Fallback: if we still have no clauses, deny all (safety net)
    if (!usingClause && needsUsing) {
        usingClause = "sql`false`";
    }
    if (!withCheckClause && needsWithCheck) {
        withCheckClause = "sql`false`";
    }

    // Build the policy options object
    const parts: string[] = [];
    parts.push(`as: "${mode}"`);
    parts.push(`for: "${operation}"`);
    const toRoles = rule.pgRoles ? [...rule.pgRoles].sort() : ["public"];
    parts.push(`to: [${toRoles.map(r => `"${r}"`).join(", ")}]`);
    if (usingClause) parts.push(`using: ${usingClause}`);
    if (withCheckClause) parts.push(`withCheck: ${withCheckClause}`);

    return `    pgPolicy(${quote(policyName)}, { ${parts.join(", ")} }),\n`;
};

/**
 * Computes a deterministic shared relation name for Drizzle.
 *
 * Drizzle requires both sides of a relation (owning + inverse) to use the
 * exact same `relationName` string so it can pair them. Each collection
 * definition may use a different local `relationName`, so we need a canonical
 * form that both sides can independently compute.
 *
 * Strategy: `{owningTable}_{foreignKey}`
 *   - owning  side → `{thisTable}_{localKey}`           e.g. "jobs_company_id"
 *   - inverse side → `{targetTable}_{foreignKeyOnTarget}` e.g. "jobs_company_id"
 *
 * For M2M with junction tables the owning relation name is already shared via
 * the junction table wiring, so we keep it as-is.
 *
 * Falls back to the local relation name when the counterpart can't be resolved.
 */
const computeSharedRelationName = (
    rel: ResolvedRelation,
    sourceCollection: CollectionConfig,
    _collections: CollectionConfig[]
): string => {
    const fallback = rel.relationName ?? toSnakeCase(rel.target().slug);

    // Both sides of a link must derive the same name, so each resolves the
    // column to its Drizzle property key and builds the name from the table
    // that actually owns it.
    if (rel.kind === "belongsTo") {
        const normalisedKey = resolvePropertyKeyForColumn(sourceCollection, rel.localKey);
        return `${getTableName(sourceCollection)}_${normalisedKey}`;
    }

    if (rel.kind === "hasMany" || rel.kind === "hasOne") {
        // The owning table is the *target*; the column is foreignKeyOnTarget.
        try {
            const targetCollection = rel.target();
            const normalisedFK = resolvePropertyKeyForColumn(targetCollection, rel.foreignKeyOnTarget);
            return `${getTableName(targetCollection)}_${normalisedFK}`;
        } catch {
            return fallback;
        }
    }

    // manyToMany is named through its junction wiring; `via` is not emitted as
    // a Drizzle relation at all. Both keep the local name.
    return fallback;
};

/**
 * The declared `indexes:` block, as Drizzle table extras.
 *
 * These reached `schema.sql` and the boot-time ensure and never reached
 * `schema.generated.ts` — `index` was not so much as imported — so a developer
 * running drizzle-kit against the generated file got a plan that DROPPED every
 * index the project owns. The names come from {@link deriveIndexName} through
 * the spec, so they are the same objects the other two emitters create rather
 * than a second set beside them.
 */
const indexExtras = (
    collection: CollectionConfig,
    uses: BuilderUses
): string[] => {
    const specs: CollectionIndexSpec[] = buildCollectionIndexSpecs(collection, resolveColumnName);
    return specs.map(spec => {
        const builder = spec.unique ? needs(uses, "uniqueIndex") : needs(uses, "index");
        // The spec holds COLUMN names; the generated table is keyed by field
        // name (`authorId` for `author_id`), and `fieldKeyForColumn` is the one
        // definition of that mapping.
        const column = (name: string): string => member("table", fieldKeyForColumn(collection, name));
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
        // gets the INCLUDE — `schema.sql` and boot-ensure both emit it — this
        // one file cannot say so.
        const covering = spec.include.length > 0
            ? ` // INCLUDE (${spec.include.join(", ")}) — drizzle cannot express it; schema.sql does`
            : "";
        return `    ${builder}(${quote(spec.indexName)})${on}${where},${covering}`;
    });
};

// --- Main Schema Generation Logic ---
export const generateSchema = async (allCollections: CollectionConfig[], stripPolicies = false): Promise<string> => {
    // A Firestore or MongoDB collection has no table to generate, and generating
    // one for it is not merely wasted output: `db push` would create it, and
    // `rebase doctor` would then report the store the collection actually reads
    // from as drift. Non-SQL collections leave the toolchain here, once, rather
    // than being filtered again in each stage below.
    //
    // Sorted here rather than in the writer: the output is order-dependent and
    // `rebase doctor` regenerates it in memory to diff against the file on
    // disk. With the sort in the writer only, a project whose file order
    // differed from its slug order was reported stale forever.
    const collections = sortCollectionsBySlug(relationalCollections(allCollections));
    // Two `isId` properties used to emit two `.primaryKey()` columns, which is
    // a table drizzle-kit refuses to push. Refused here by the same helper the
    // DDL generator and boot-ensure call.
    collections.forEach(assertSinglePrimaryKey);

    // Every drizzle-orm/pg-core builder the file below actually emits. The
    // import line is written from this, at the end, rather than from a fixed
    // roster plus heuristics — see {@link BuilderUses}.
    const uses: BuilderUses = new Set();
    // The body is assembled first and the header composed around it, because
    // the header cannot be written until the body has said what it needs.
    let body = "";

    const uniqueSchemas = Array.from(new Set(
        collections.map(c => isPostgresCollectionConfig(c) ? c.schema : undefined).filter(Boolean)
    ));

    let schemaDeclarations = "";
    if (uniqueSchemas.length > 0) {
        needs(uses, "pgSchema");
        uniqueSchemas.forEach(schema => {
            schemaDeclarations += `export const ${schema}Schema = pgSchema("${schema}");\n`;
        });
        schemaDeclarations += "\n";
    }

    const exportedTableVars: string[] = [];
    const exportedEnumVars: string[] = [];
    const exportedRelationVars: string[] = [];

    const allTablesToGenerate = new Map<string, {
        collection: CollectionConfig,
        isJunction?: boolean,
        relation?: ResolvedRelation,
        sourceCollection?: CollectionConfig
    }>();

    // 1. Generate Enums
    collections.forEach(collection => {
        const collectionPath = getTableName(collection);
        const collectionSchema = isPostgresCollectionConfig(collection) ? collection.schema : undefined;
        Object.entries(collection.properties ?? {}).forEach(([propName, prop]) => {
            if (!("enum" in prop) || !prop.enum) return;
            if (prop.type !== "string" && prop.type !== "number") return;
            // Refuses an empty list whatever the type, then declares a type
            // only for the string ones. A `number` enum's column is NUMERIC or
            // INTEGER on all three paths, so the type it used to create was
            // referenced by nothing and only gave drizzle-kit something to drop.
            const values = enumLabelsOf(propName, prop as Property, collection);
            if (!declaresEnumType(prop as Property)) return;

            const enumVarName = getEnumVarName(collectionPath, propName);
            const enumDbName = `${collectionPath}_${resolveColumnName(propName, prop as Property)}`;
            // A collection with `schema: "app"` gets `CREATE TYPE "app"."…"`
            // from the DDL generator, so the type has to be declared in the
            // same schema here — `pgEnum` is `public` and nothing else.
            // Unqualified, the runtime and drizzle-kit looked for a type that
            // does not exist in `public`.
            const declaration = collectionSchema
                ? `${collectionSchema}Schema.enum(${quote(enumDbName)}, [${values.map(v => quote(v)).join(", ")}])`
                : `${needs(uses, "pgEnum")}(${quote(enumDbName)}, [${values.map(v => quote(v)).join(", ")}])`;
            body += `export const ${enumVarName} = ${declaration};\n`;
            if (!exportedEnumVars.includes(enumVarName)) exportedEnumVars.push(enumVarName);
        });
    });
    body += "\n";

    // Junction policy derivation needs every declaring side of each junction,
    // not just the first relation that reached it in the walk below.
    const junctionSpecs = resolveJunctionSpecs(collections);

    // 2. Identify all tables (collections and junction tables only)
    for (const collection of collections) {
        const tableName = getTableName(collection);
        if (tableName) {
            allTablesToGenerate.set(tableName, { collection });
        }

        const resolvedRelations = resolveCollectionRelations(collection);
        for (const relation of Object.values(resolvedRelations)) {
            if (isManyToMany(relation)) { // Standard M2M junction table
                const junctionTableName = relation.through.table;
                if (!allTablesToGenerate.has(junctionTableName)) {
                    allTablesToGenerate.set(junctionTableName, {
                        collection: {
                            table: junctionTableName,
                            properties: {}
                        } as CollectionConfig,
                        isJunction: true,
                        relation: relation,
                        sourceCollection: collection
                    });
                }
            }
            // joinPath relations use existing user-controlled tables - no generation needed
        }
    }

    // 3. Generate pgTable definitions for all unique tables
    for (const [tableName, {
        collection,
        isJunction,
        relation,
        sourceCollection
    }] of allTablesToGenerate.entries()) {
        const tableVarName = getTableVarName(tableName);
        if (isJunction && relation && sourceCollection && isManyToMany(relation)) {
            const targetCollection = relation.target();
            // Junctions live in `public`, full stop — `resolveJunctionSpecs`
            // hardcodes that, so it is where `planJunctionTables` CREATEs them
            // and where the derived RLS policies are applied. Inheriting the
            // endpoint's schema here (as this used to) put the junction of any
            // m2m onto `users` in `rebase`, while its policies were still
            // created against `public.<junction>` — RLS enabled on one table,
            // rows written to another. The three generators have to agree, and
            // the other two already did.
            const tableCreator = needs(uses, "pgTable");
            const baseTableName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;
            const {
                sourceColumn,
                targetColumn
            } = relation.through;

            const onDelete = relation.onDelete ?? "cascade";

            // `text`, matching the string default: a junction column must have the
            // same type as the primary key it references. One helper, because
            // this ladder was written out three times.
            const sourceColType = needs(uses, primaryKeyColumnBuilder(sourceCollection));
            const targetColType = needs(uses, primaryKeyColumnBuilder(targetCollection));
            const sourceId = getPrimaryKeyName(sourceCollection);
            const targetId = getPrimaryKeyName(targetCollection);
            needs(uses, "type AnyPgColumn");

            body += `export const ${tableVarName} = ${tableCreator}(\"${baseTableName}\", {\n`;
            // The junction block was the one place these three helpers were not
            // applied, so a junction column containing a space or a hyphen —
            // both legal in Postgres — produced a file that does not parse.
            body += `    ${propKey(sourceColumn)}: ${sourceColType}(${quote(sourceColumn)}).notNull()${referencesClause(getTableVarName(getTableName(sourceCollection)), sourceId, { onDelete })},\n`;
            body += `    ${propKey(targetColumn)}: ${targetColType}(${quote(targetColumn)}).notNull()${referencesClause(getTableVarName(getTableName(targetCollection)), targetId, { onDelete })},\n`;
            body += "}, (table) => ([\n";
            body += `    ${needs(uses, "primaryKey")}({ columns: [${member("table", sourceColumn)}, ${member("table", targetColumn)}] }),\n`;

            // Junctions are generated tables like any other: locked by default,
            // with derived policies (reads follow the endpoints, writes follow
            // the declaring side's update rules). RLS is enabled regardless of
            // policy stripping — a bare junction must default-deny, not fail open.
            const junctionSpec = junctionSpecs.get(baseTableName);
            if (!stripPolicies && junctionSpec) {
                const junctionCollection = getJunctionCollectionConfig(junctionSpec);
                const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
                getJunctionSecurityRules(junctionSpec).forEach((rule: SecurityRule, idx: number) => {
                    needs(uses, "pgPolicy");
                    body += generatePolicyCode(junctionCollection, rule, idx, resolveCollection);
                });
            }
            body += "])).enableRLS();\n\n";
        } else if (!isJunction) {
            const schema = isPostgresCollectionConfig(collection) ? collection.schema : undefined;
            const tableCreator = schema ? `${schema}Schema.table` : needs(uses, "pgTable");
            const baseTableName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;
            body += `export const ${tableVarName} = ${tableCreator}(\"${baseTableName}\", {\n`;
            const columns = new Set<string>();
            Object.entries(collection.properties ?? {}).forEach(([propName, prop]) => {
                const columnString = getDrizzleColumn(propName, prop as Property, collection, collections, uses);
                if (columnString) columns.add(columnString);

            });

            // The opt-in search column. Declared with its real generation
            // expression rather than as a bare custom type: `schema.generated.ts`
            // is what a developer running drizzle-kit themselves diffs against,
            // and a column declared without its expression reads to drizzle-kit
            // as one it should alter.
            const searchSpec = buildSearchColumnSpec(collection);
            if (searchSpec) {
                columns.add(
                    `    ${propKey(searchSpec.column)}: ${needs(uses, "customType")}({ dataType() { return 'tsvector'; } })(${quote(searchSpec.column)})` +
                    `.generatedAlwaysAs(sql\`${searchSpec.expression}\`)`
                );
                if (searchSpec.fuzzy) {
                    columns.add(
                        `    ${propKey(searchSpec.fuzzy.column)}: ${needs(uses, "text")}(${quote(searchSpec.fuzzy.column)})` +
                        `.generatedAlwaysAs(sql\`${searchSpec.fuzzy.expression}\`)`
                    );
                }
            }

            // A collection that declares no primary key gets an implicit one:
            // `id TEXT PRIMARY KEY`. The DDL generator emits the same column,
            // and `derivePrimaryKeys` reads it back.
            const hasIdColumn = Array.from(columns).some(col => col.includes(".primaryKey()"));
            if (!hasIdColumn) {
                columns.add(`    id: ${needs(uses, "text")}("id").primaryKey()`);
            }

            body += `${Array.from(columns).join(",\n")}`;

            const securityRules = stripPolicies ? [] : getEffectiveSecurityRules(collection);
            const extras: string[] = [...indexExtras(collection, uses)];
            if (securityRules.length > 0) {
                const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
                securityRules.forEach((rule: SecurityRule, idx: number) => {
                    needs(uses, "pgPolicy");
                    // `generatePolicyCode` returns one line per policy, already
                    // indented and comma-terminated.
                    extras.push(generatePolicyCode(collection, rule, idx, resolveCollection).replace(/\n$/, ""));
                });
            }

            if (extras.length > 0) {
                body += "\n}, (table) => ([\n";
                body += `${extras.join("\n")}\n`;
                body += "])).enableRLS();\n\n";
            } else {
                // No explicit policies and no declared indexes — RLS enabled with
                // deny-all default (Postgres denies everything when RLS is on and
                // no permissive policies exist).
                body += "\n}).enableRLS();\n\n";
            }
        }
        if (!exportedTableVars.includes(tableVarName)) exportedTableVars.push(tableVarName);
    }

    // 4. Generate Drizzle Relations
    for (const [tableName, {
        collection,
        isJunction
    }] of allTablesToGenerate.entries()) {
        const tableVarName = getTableVarName(tableName);
        const tableRelations: string[] = [];

        if (isJunction) {
            const relationInfo = Array.from(allTablesToGenerate.values()).find(v => v.isJunction && getTableName(v.collection) === tableName);
            if (relationInfo && relationInfo.relation && relationInfo.sourceCollection && isManyToMany(relationInfo.relation)) {
                const {
                    relation,
                    sourceCollection
                } = relationInfo;
                const targetCollection = relation.target();
                const sourceTableVar = getTableVarName(getTableName(sourceCollection));
                const targetTableVar = getTableVarName(getTableName(targetCollection));
                const sourceId = getPrimaryKeyName(sourceCollection);
                const targetId = getPrimaryKeyName(targetCollection);

                if (!relation?.through)
                    throw new Error("Internal, the relation should have a through property. Relations passed to this script should sanitized first with sanitizeRelation().");

                // The owning relation's name — used on the source side of the junction
                const owningRelationName = relation.relationName ?? toSnakeCase(getTableName(targetCollection));

                // Find the inverse relation name on the target collection (if any)
                // This is needed so the junction's target-side one() can pair with the
                // inverse many() on the target table.
                let inverseRelationName: string | null = null;
                try {
                    const targetRelations = resolveCollectionRelations(targetCollection);
                    for (const [, targetRel] of Object.entries(targetRelations)) {
                        if (targetRel.kind !== "belongsTo" &&
                            targetRel.cardinality === "many" &&
                            targetRel.relationName === owningRelationName) {
                            inverseRelationName = targetRel.relationName ?? null;
                            break;
                        }
                    }
                } catch {
                    // ignore — inverse side may not exist
                }

                // Source side one(): pairs with owning table's many(junctionTable, { relationName })
                tableRelations.push(`    ${quote(relation.through.sourceColumn)}: one(${sourceTableVar}, {\n        fields: [${member(tableVarName, relation.through.sourceColumn)}],\n        references: [${member(sourceTableVar, sourceId)}],\n        relationName: ${quote(owningRelationName)}\n    })`);

                // Target side one(): pairs with inverse table's many(junctionTable, { relationName })
                // Always emit a relationName to avoid collisions with the source-side's owningRelationName.
                // When no inverse relation exists on the target collection, synthesize a unique name.
                const targetRelationName = inverseRelationName
                    ? inverseRelationName
                    : `${tableName}_${relation.through.targetColumn}`;
                tableRelations.push(`    ${quote(relation.through.targetColumn)}: one(${targetTableVar}, {\n        fields: [${member(tableVarName, relation.through.targetColumn)}],\n        references: [${member(targetTableVar, targetId)}],\n        relationName: ${quote(targetRelationName)}\n    })`);
            }
        } else {
            const resolvedRelations = resolveCollectionRelations(collection);
            // Defensive safety net: track emitted `drizzleRelationName` values
            // to prevent duplicate one()/many() entries in the generated schema.
            // The root deduplication happens inside resolveCollectionRelations,
            // but this guards against any future regressions in that utility.
            const emittedRelationNames = new Set<string>();
            for (const [relationKey, rel] of Object.entries(resolvedRelations)) {
                try {
                    const target = rel.target();
                    const targetTableVar = getTableVarName(getTableName(target));

                    // Compute a deterministic shared relationName for Drizzle.
                    // Both sides of an owning/inverse pair MUST share the same
                    // relationName, otherwise Drizzle cannot pair them.
                    //
                    // Strategy: use "{ownerTable}_{foreignKey}" which is
                    // computable from either side:
                    //   - owning side:  {thisTable}_{localKey}
                    //   - inverse side: {targetTable}_{foreignKeyOnTarget}
                    const drizzleRelationName = computeSharedRelationName(rel, collection, collections);

                    // Skip if we've already emitted a relation with this drizzleRelationName
                    // for this table — prevents duplicate definitions when
                    // resolveCollectionRelations returns alias entries for the same FK.
                    const deduplicationKey = `${drizzleRelationName}::${rel.kind}`;
                    if (emittedRelationNames.has(deduplicationKey)) continue;
                    emittedRelationNames.add(deduplicationKey);

                    switch (rel.kind) {
                        case "belongsTo": {
                            // `localKey` is a COLUMN name; the generated Drizzle
                            // object is keyed by PROPERTY. They differ whenever
                            // the property is camelCase — `user_id` is exposed
                            // as `userId` — and emitting the column produces a
                            // schema that does not compile. The three other
                            // emission sites normalise; this one did not.
                            const localFieldKey = resolvePropertyKeyForColumn(collection, rel.localKey);
                            tableRelations.push(`    ${quote(relationKey)}: one(${targetTableVar}, {\n        fields: [${member(tableVarName, localFieldKey)}],\n        references: [${member(targetTableVar, getPrimaryKeyName(target))}],\n        relationName: ${quote(drizzleRelationName)}\n    })`);
                            break;
                        }

                        case "hasOne":
                            // The foreign key lives on the TARGET table, so this
                            // side has no `fields`/`references` to give — and
                            // drizzle has no third form. It was emitted as
                            // `one(target, { relationName })`, which is not a
                            // `RelationConfig` (TS2345) *and* not something the
                            // runtime survives: `createOne` reads
                            // `config.fields.reduce(...)` unconditionally, so
                            // building the relational config threw "Cannot read
                            // properties of undefined (reading 'reduce')" —
                            // every generated schema with a `hasOne` inverse
                            // broke drizzle's relational queries outright.
                            //
                            // A bare `one(target)` is the documented FK-less
                            // form: `normalizeRelation` pairs it with the
                            // `belongsTo` on the target that points back here.
                            // The cost is that drizzle can no longer be told
                            // *which* link to pair when a pair of tables has
                            // several — it says so, loudly, rather than
                            // guessing.
                            tableRelations.push(`    ${quote(relationKey)}: one(${targetTableVar})`);
                            break;

                        case "hasMany":
                            tableRelations.push(`    ${quote(relationKey)}: many(${targetTableVar}, { relationName: ${quote(drizzleRelationName)} })`);
                            break;

                        case "manyToMany": {
                            // Both sides point at the junction. This used to have a
                            // second arm that searched the *target's* relations for an
                            // owning many-to-many whose name matched, to borrow its
                            // junction table — unnecessary now that each side names
                            // its own.
                            const junctionTableVar = getTableVarName(rel.through.table);
                            tableRelations.push(`    ${quote(relationKey)}: many(${junctionTableVar}, { relationName: ${quote(drizzleRelationName)} })`);
                            break;
                        }

                        case "via":
                            // A join chain is resolved at query time, not modelled
                            // as a Drizzle relation.
                            break;
                    }
                } catch (e) {
                    logger.warn(`Could not generate relation ${relationKey} for ${collection.name}`, { error: e });
                }
            }

            // Synthesize missing reciprocal relations
            for (const otherCollection of collections) {
                if (otherCollection.slug === collection.slug) continue;

                const otherRelations = resolveCollectionRelations(otherCollection);
                for (const [otherKey, otherRel] of Object.entries(otherRelations)) {
                    if (hasForeignKeyOnTarget(otherRel)) {
                        try {
                            const otherTarget = otherRel.target();
                            if (otherTarget.slug === collection.slug) {
                                const drizzleRelationName = computeSharedRelationName(otherRel, otherCollection, collections);
                                const deduplicationKey = `${drizzleRelationName}::belongsTo`;

                                if (!emittedRelationNames.has(deduplicationKey)) {
                                    const otherTableVar = getTableVarName(getTableName(otherCollection));
                                    // Resolve foreignKeyOnTarget to the Drizzle property key
                                    // on THIS collection (the owning table). The raw FK column
                                    // name (e.g. "client_id") may differ from the property key
                                    // (e.g. "clientId") when `columnName` is set.
                                    const drizzleFieldKey = resolvePropertyKeyForColumn(collection, otherRel.foreignKeyOnTarget);
                                    // The column the far side points at: its
                                    // primary key, unless the link names another
                                    // one with `sourceKey`.
                                    const referencedKey = otherRel.sourceKey
                                        ? resolvePropertyKeyForColumn(otherCollection, otherRel.sourceKey)
                                        : getPrimaryKeyName(otherCollection);
                                    const synthKey = `_synth_${otherTableVar}_${drizzleFieldKey}`;
                                    tableRelations.push(`    ${quote(synthKey)}: one(${otherTableVar}, {\n        fields: [${member(tableVarName, drizzleFieldKey)}],\n        references: [${member(otherTableVar, referencedKey)}],\n        relationName: ${quote(drizzleRelationName)}\n    })`);
                                    emittedRelationNames.add(deduplicationKey);
                                }
                            }
                        } catch (e) {
                            // ignore
                        }
                    }
                }
            }
        }

        if (tableRelations.length > 0) {
            const relVarName = `${tableVarName}Relations`;
            body += `export const ${relVarName} = drizzleRelations(${tableVarName}, ({ one, many }) => ({\n${tableRelations.join(",\n")}\n}));\n\n`;
            if (!exportedRelationVars.includes(relVarName)) exportedRelationVars.push(relVarName);
        }
    }

    // ── The header, written last because the body decides what is in it ──────
    //
    // Sorted, and derived entirely from what was emitted: a builder used
    // without being imported is what made six inputs produce a
    // `schema.generated.ts` that does not compile.
    const pgCoreImports = Array.from(uses).sort((a, b) =>
        a.replace(/^type /, "").localeCompare(b.replace(/^type /, "")));

    let schemaContent = "// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.\n\n";
    schemaContent += `import { ${pgCoreImports.join(", ")} } from 'drizzle-orm/pg-core';\n`;
    schemaContent += "import { relations as drizzleRelations, sql } from 'drizzle-orm';\n\n";
    schemaContent += schemaDeclarations;
    schemaContent += body;

    // <<< ADDED: Final aggregated exports block
    const tablesExport = `export const tables = { ${exportedTableVars.join(", ")} };\n`;
    const enumsExport = `export const enums = { ${exportedEnumVars.join(", ")} };\n`;
    const relationsExport = `export const relations = { ${exportedRelationVars.join(", ")} };\n\n`;
    schemaContent += tablesExport + enumsExport + relationsExport;

    return schemaContent;
};
