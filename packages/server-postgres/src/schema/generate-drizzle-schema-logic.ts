import { CollectionConfig, NumberProperty, Property, ResolvedRelation, RelationProperty, SecurityOperation, SecurityRule, StringProperty, isPostgresCollectionConfig, DateProperty, ArrayProperty, MapProperty, ReferenceProperty, VectorProperty, BinaryProperty, isManyToMany, type ResolvedManyToMany, type ResolvedBelongsTo, type ResolvedForeignKeyOnTarget, hasForeignKeyOnTarget } from "@rebasepro/types";
import { getPrimaryKeys } from "../services/collection-helpers";
import { buildSearchColumnSpec } from "./search-column";
import { defaultBelongsToOnDelete } from "./generate-postgres-ddl-logic";
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

const resolveColumnName = (propName: string, prop?: Property | null): string => {
    if (prop && "columnName" in prop && typeof prop.columnName === "string") {
        return prop.columnName;
    }
    return toSnakeCase(propName);
};

const getPrimaryKeyProp = (collection: CollectionConfig): { name: string, type: "string" | "number", isUuid: boolean } => {
    if (collection.properties) {
        const idPropEntry = Object.entries(collection.properties).find(([_, prop]) => "isId" in (prop as unknown as object) && Boolean((prop as unknown as Record<string, unknown>).isId));
        if (idPropEntry) {
            const prop = idPropEntry[1] as unknown as Property;
            const isUuid = prop.type === "string" && "isId" in prop && (prop as unknown as StringProperty).isId === "uuid";
            return { name: idPropEntry[0],
type: prop.type === "number" ? "number" : "string",
isUuid };
        }
    }
    // Fallback
    const idProp = collection.properties?.["id"] as unknown as Property | undefined;
    if (idProp?.type === "number") {
        return { name: "id",
type: "number",
isUuid: false };
    }
    const isUuid = idProp?.type === "string" && "isId" in idProp && (idProp as unknown as StringProperty).isId === "uuid";
    return { name: "id",
type: "string",
isUuid: isUuid ?? false };
};

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

const isNumericId = (collection: CollectionConfig): boolean => {
    return getPrimaryKeyProp(collection).type === "number";
};

const getPrimaryKeyName = (collection: CollectionConfig): string => {
    return getPrimaryKeyProp(collection).name;
};

const isIdProperty = (propName: string, prop: Property, collection: CollectionConfig): boolean => {
    if ("isId" in prop && Boolean(prop.isId)) return true;

    // We only fallback to "id" if NO property is explicitly marked with `isId: true` or a generator string
    const hasExplicitId = Object.values(collection.properties ?? {}).some(p => "isId" in (p as unknown as object) && Boolean((p as unknown as Record<string, unknown>).isId));
    return !hasExplicitId && propName === "id";
};

/**
 * The Drizzle column declaration a property compiles to, or `null` when the
 * property puts no column on *this* table (an inverse relation, whose column
 * lives on the target). Exported so it can be checked against its DDL twin
 * `getSqlColumnType` directly — the two disagreeing is what left `geopoint`
 * with a database column and no Drizzle key.
 */
export const getDrizzleColumn = (propName: string, prop: Property, collection: CollectionConfig, collections: CollectionConfig[]): string | null => {

    const colName = resolveColumnName(propName, prop);
    let columnDefinition: string;

    switch (prop.type) {
        case "string": {
            const stringProp = prop as unknown as StringProperty;
            if (stringProp.enum) {
                const enumName = getEnumVarName(getTableName(collection), propName);
                columnDefinition = `${enumName}(${quote(colName)})`;
            } else if ("isId" in stringProp && stringProp.isId === "uuid") {
                columnDefinition = `uuid(${quote(colName)})`;
            } else if (stringProp.columnType === "uuid") {
                columnDefinition = `uuid(${quote(colName)})`;
            } else if (stringProp.columnType === "char") {
                columnDefinition = `char(${quote(colName)}, { length: ${resolveStringColumnLength(stringProp)} })`;
            } else if (stringProp.columnType === "varchar") {
                // The length is not optional decoration: `varchar("col")` with
                // no length is an UNBOUNDED varchar in Postgres, which is what
                // this emitted while the DDL generator emitted VARCHAR(255) for
                // the very same property.
                columnDefinition = `varchar(${quote(colName)}, { length: ${resolveStringColumnLength(stringProp)} })`;
            } else {
                // `text` is the default, and the only length-unbounded choice.
                // Ask for `varchar` explicitly if you want the length constraint.
                columnDefinition = `text(${quote(colName)})`;
            }
            if (isIdProperty(propName, prop, collection)) {
                columnDefinition += ".primaryKey()";
            }
            if ("isId" in stringProp && stringProp.isId !== "manual" && stringProp.isId !== true) {
                if (stringProp.isId === "uuid") {
                    columnDefinition += ".defaultRandom()";
                } else if (stringProp.isId === "cuid") {
                    columnDefinition += ".default(sql`cuid()`)";
                } else if (typeof stringProp.isId === "string") {
                    const sqlContent = stringProp.isId.startsWith("sql`") && stringProp.isId.endsWith("`")
                        ? stringProp.isId.substring(4, stringProp.isId.length - 1)
                        : stringProp.isId;
                    columnDefinition += `.default(sql\`${sqlContent}\`)`;
                }
            }
            if (stringProp.validation?.unique) {
                columnDefinition += ".unique()";
            }
            break;
        }
        case "number": {
            const numProp = prop as unknown as NumberProperty;
            const isId = isIdProperty(propName, prop, collection);

            let baseType = (numProp.validation?.integer || isId) ? `integer(${quote(colName)})` : `numeric(${quote(colName)})`;
            if (numProp.columnType) {
                if (numProp.columnType === "double precision") baseType = `doublePrecision(${quote(colName)})`;
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
                    baseType = `${numProp.columnType}(${quote(colName)}, { mode: "number" })`;
                }
                else baseType = `${numProp.columnType}(${quote(colName)})`;
            }

            if ("isId" in numProp && numProp.isId === "increment") {
                columnDefinition = `${baseType}.generatedByDefaultAsIdentity()`;
            } else if ("isId" in numProp && typeof numProp.isId === "string" && numProp.isId !== "manual") {
                columnDefinition = baseType;
                const sqlContent = numProp.isId.startsWith("sql`") && numProp.isId.endsWith("`")
                    ? numProp.isId.substring(4, numProp.isId.length - 1)
                    : numProp.isId;
                columnDefinition += `.default(sql\`${sqlContent}\`)`;
            } else {
                columnDefinition = baseType;
            }

            if (isId) {
                columnDefinition += ".primaryKey()";
            }
            if (numProp.validation?.unique) {
                columnDefinition += ".unique()";
            }
            break;
        }
        case "boolean":
            columnDefinition = `boolean(${quote(colName)})`;
            break;
        case "date": {
            const dateProp = prop as DateProperty;
            if (dateProp.columnType === "date") {
                columnDefinition = `date(${quote(colName)}, { mode: 'string' })`;
            } else if (dateProp.columnType === "time") {
                columnDefinition = `time(${quote(colName)})`;
            } else {
                columnDefinition = `timestamp(${quote(colName)}, { withTimezone: true, mode: 'string' })`;
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
                columnDefinition = `json(${quote(colName)})`;
            } else {
                columnDefinition = `jsonb(${quote(colName)})`;
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
            columnDefinition = `jsonb(${quote(colName)})`;
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
                columnDefinition = `json(${quote(colName)})`;
            } else if (colType === "text[]") {
                columnDefinition = `text(${quote(colName)}).array()`;
            } else if (colType === "integer[]") {
                columnDefinition = `integer(${quote(colName)}).array()`;
            } else if (colType === "boolean[]") {
                columnDefinition = `boolean(${quote(colName)}).array()`;
            } else if (colType === "numeric[]") {
                columnDefinition = `numeric(${quote(colName)}).array()`;
            } else {
                columnDefinition = `jsonb(${quote(colName)})`;
            }
            break;
        }
        case "vector": {
            const vp = prop as VectorProperty;
            columnDefinition = `vector(${quote(colName)}, { dimensions: ${vp.dimensions} })`;
            break;
        }
        case "binary": {
            columnDefinition = `customType({ dataType() { return 'bytea'; } })(${quote(colName)})`;
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
            // property emits the column and this relation must not emit a second
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
            const pkProp = getPrimaryKeyProp(targetCollection);
            const targetIdField = pkProp.name;
            // `quote`, like every other column literal in this file: a column
            // name only has to be quotable in Postgres, and this one is derived
            // from a relation the author wrote.
            const baseColumn = pkProp.type === "number"
                ? `integer(${quote(fkColumnName)})`
                : (pkProp.isUuid ? `uuid(${quote(fkColumnName)})` : `text(${quote(fkColumnName)})`);

            const onUpdate = relation.onUpdate ? `onUpdate: "${relation.onUpdate}"` : "";
            const required = prop.validation?.required;
            // Same default as the DDL generator, lowercased for Drizzle's
            // option literal. The two files describe the same constraint; a
            // default that differs between them makes `db push` plan a rewrite
            // of every required foreign key on every run.
            const onDeleteVal = relation.onDelete ?? defaultBelongsToOnDelete(required).toLowerCase();
            const onDelete = `onDelete: \"${onDeleteVal}\"`;

            const refOptionsParts = [onUpdate, onDelete].filter(Boolean);
            const refOptions = refOptionsParts.length > 0 ? `{ ${refOptionsParts.join(", ")} }` : "";

            let columnDef = `${baseColumn}.references(() => ${member(targetTableVar, targetIdField)}${refOptions ? `, ${refOptions}` : ""})`;

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
                columnDefinition = `text(${quote(colName)})`;
                break;
            }

            const pkProp = getPrimaryKeyProp(targetCollection);
            const targetTableVar = getTableVarName(getTableName(targetCollection));
            const targetIdField = pkProp.name;
            const baseColumn = pkProp.type === "number" ? `integer(${quote(colName)})` : (pkProp.isUuid ? `uuid(${quote(colName)})` : `text(${quote(colName)})`);

            const required = prop.validation?.required;
            const onDelete = required ? "cascade" : "set null";
            const refOptions = `{ onDelete: "${onDelete}" }`;

            columnDefinition = `${baseColumn}.references(() => ${member(targetTableVar, targetIdField)}, ${refOptions})`;
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

    if (prop.validation?.required) {
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
    let schemaContent = "// This file is auto-generated by the Rebase Drizzle generator. Do not edit manually.\n\n";


    const hasUuid = collections.some(c =>
        c.properties && Object.values(c.properties).some(
            (p: Property) => p.type === "string" && ((p as unknown as Record<string, unknown>).autoValue === "uuid" || (p as unknown as Record<string, unknown>).isId === "uuid")
        )
    );

    const hasVector = collections.some(c =>
        c.properties && Object.values(c.properties).some(
            (p: Property) => p.type === "vector"
        )
    );

    const hasBinary = collections.some(c =>
        c.properties && Object.values(c.properties).some(
            (p: Property) => p.type === "binary"
        )
    );

    // drizzle ships no `tsvector` builder, so an opted-in search column reaches
    // the schema the same way `bytea` does — through `customType`.
    const hasSearch = collections.some(c => buildSearchColumnSpec(c) !== undefined);

    // Always import pgPolicy and sql — RLS is enabled on every table (secure by default)
    const pgCoreImports = ["primaryKey", "pgTable", "integer", "varchar", "text", "char", "boolean", "timestamp", "date", "time", "jsonb", "json", "pgEnum", "numeric", "real", "doublePrecision", "bigint", "serial", "bigserial", "pgPolicy"];
    if (hasUuid) pgCoreImports.push("uuid");
    if (hasVector) pgCoreImports.push("vector");
    if (hasBinary || hasSearch) pgCoreImports.push("customType");

    const uniqueSchemas = Array.from(new Set(
        collections.map(c => isPostgresCollectionConfig(c) ? c.schema : undefined).filter(Boolean)
    ));
    if (uniqueSchemas.length > 0) {
        pgCoreImports.push("pgSchema");
    }

    schemaContent += `import { ${pgCoreImports.join(", ")} } from 'drizzle-orm/pg-core';\n`;
    schemaContent += "import { relations as drizzleRelations, sql } from 'drizzle-orm';\n\n";

    uniqueSchemas.forEach(schema => {
        schemaContent += `export const ${schema}Schema = pgSchema("${schema}");\n`;
    });
    if (uniqueSchemas.length > 0) {
        schemaContent += "\n";
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
        Object.entries(collection.properties ?? {}).forEach(([propName, prop]) => {

            if (("enum" in prop) && (prop.type === "string" || prop.type === "number") && prop.enum) {
                const enumVarName = getEnumVarName(collectionPath, propName);
                const enumDbName = `${collectionPath}_${resolveColumnName(propName, prop)}`;
                const values = Array.isArray(prop.enum)
                    ? (prop.enum as (string | number | { id: string | number })[]).map((v: string | number | { id: string | number }) =>
                        String(typeof v === "object" && v !== null && "id" in v ? v.id : v)
                    )
                    : Object.keys(prop.enum);
                if (values.length > 0) {
                    schemaContent += `export const ${enumVarName} = pgEnum(${quote(enumDbName)}, [${values.map(v => quote(v)).join(", ")}]);\n`;
                    if (!exportedEnumVars.includes(enumVarName)) exportedEnumVars.push(enumVarName);
                }
            }
        });
    });
    schemaContent += "\n";

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
            const tableCreator = "pgTable";
            const baseTableName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;
            const {
                sourceColumn,
                targetColumn
            } = relation.through;

            const onDelete = relation.onDelete ?? "cascade";
            const refOptions = `{ onDelete: \"${onDelete}\" }`;

            // `text`, matching the string default: a junction column must have the
            // same type as the primary key it references.
            const sourceColType = isNumericId(sourceCollection) ? "integer" : (getPrimaryKeyProp(sourceCollection).isUuid ? "uuid" : "text");
            const targetColType = isNumericId(targetCollection) ? "integer" : (getPrimaryKeyProp(targetCollection).isUuid ? "uuid" : "text");
            const sourceId = getPrimaryKeyName(sourceCollection);
            const targetId = getPrimaryKeyName(targetCollection);

            schemaContent += `export const ${tableVarName} = ${tableCreator}(\"${baseTableName}\", {\n`;
            // The junction block was the one place these three helpers were not
            // applied, so a junction column containing a space or a hyphen —
            // both legal in Postgres — produced a file that does not parse.
            schemaContent += `    ${propKey(sourceColumn)}: ${sourceColType}(${quote(sourceColumn)}).notNull().references(() => ${member(getTableVarName(getTableName(sourceCollection)), sourceId)}, ${refOptions}),\n`;
            schemaContent += `    ${propKey(targetColumn)}: ${targetColType}(${quote(targetColumn)}).notNull().references(() => ${member(getTableVarName(getTableName(targetCollection)), targetId)}, ${refOptions}),\n`;
            schemaContent += "}, (table) => ([\n";
            schemaContent += `    primaryKey({ columns: [${member("table", sourceColumn)}, ${member("table", targetColumn)}] }),\n`;

            // Junctions are generated tables like any other: locked by default,
            // with derived policies (reads follow the endpoints, writes follow
            // the declaring side's update rules). RLS is enabled regardless of
            // policy stripping — a bare junction must default-deny, not fail open.
            const junctionSpec = junctionSpecs.get(baseTableName);
            if (!stripPolicies && junctionSpec) {
                const junctionCollection = getJunctionCollectionConfig(junctionSpec);
                const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
                getJunctionSecurityRules(junctionSpec).forEach((rule: SecurityRule, idx: number) => {
                    schemaContent += generatePolicyCode(junctionCollection, rule, idx, resolveCollection);
                });
            }
            schemaContent += "])).enableRLS();\n\n";
        } else if (!isJunction) {
            const schema = isPostgresCollectionConfig(collection) ? collection.schema : undefined;
            const tableCreator = schema ? `${schema}Schema.table` : "pgTable";
            const baseTableName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;
            schemaContent += `export const ${tableVarName} = ${tableCreator}(\"${baseTableName}\", {\n`;
            const columns = new Set<string>();
            Object.entries(collection.properties ?? {}).forEach(([propName, prop]) => {
                const columnString = getDrizzleColumn(propName, prop as Property, collection, collections);
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
                    `    ${propKey(searchSpec.column)}: customType({ dataType() { return 'tsvector'; } })(${quote(searchSpec.column)})` +
                    `.generatedAlwaysAs(sql\`${searchSpec.expression}\`)`
                );
                if (searchSpec.fuzzy) {
                    columns.add(
                        `    ${propKey(searchSpec.fuzzy.column)}: text(${quote(searchSpec.fuzzy.column)})` +
                        `.generatedAlwaysAs(sql\`${searchSpec.fuzzy.expression}\`)`
                    );
                }
            }

            // A collection that declares no primary key gets an implicit one:
            // `id TEXT PRIMARY KEY`. The DDL generator emits the same column,
            // and `derivePrimaryKeys` reads it back.
            const hasIdColumn = Array.from(columns).some(col => col.includes(".primaryKey()"));
            if (!hasIdColumn) {
                columns.add("    id: text(\"id\").primaryKey()");
            }

            schemaContent += `${Array.from(columns).join(",\n")}`;

            const securityRules = getEffectiveSecurityRules(collection);
            if (!stripPolicies && securityRules.length > 0) {
                schemaContent += "\n}, (table) => ([\n";
                const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
                securityRules.forEach((rule: SecurityRule, idx: number) => {
                    schemaContent += generatePolicyCode(collection, rule, idx, resolveCollection);
                });
                schemaContent += "])).enableRLS();\n\n";
            } else {
                // No explicit policies — RLS enabled with deny-all default (Postgres denies
                // everything when RLS is on and no permissive policies exist).
                schemaContent += "\n}).enableRLS();\n\n";
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
                            // The foreign key lives on the TARGET table. Drizzle pairs
                            // the two sides by `relationName` alone — giving
                            // `fields`/`references` here is invalid and crashes
                            // `normalizeRelation` with "Cannot read properties of
                            // undefined (reading 'referencedTable')".
                            // A `relationName` is authored, and a `"` in one
                            // closed this string literal early — in a file that
                            // is compiled and imported by the server.
                            tableRelations.push(`    ${quote(relationKey)}: one(${targetTableVar}, {\n        relationName: ${quote(drizzleRelationName)}\n    })`);
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
            schemaContent += `export const ${relVarName} = drizzleRelations(${tableVarName}, ({ one, many }) => ({\n${tableRelations.join(",\n")}\n}));\n\n`;
            if (!exportedRelationVars.includes(relVarName)) exportedRelationVars.push(relVarName);
        }
    }

    // <<< ADDED: Final aggregated exports block
    const tablesExport = `export const tables = { ${exportedTableVars.join(", ")} };\n`;
    const enumsExport = `export const enums = { ${exportedEnumVars.join(", ")} };\n`;
    const relationsExport = `export const relations = { ${exportedRelationVars.join(", ")} };\n\n`;
    schemaContent += tablesExport + enumsExport + relationsExport;

    return schemaContent;
};

