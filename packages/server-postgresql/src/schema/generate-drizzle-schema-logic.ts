import { CollectionConfig, NumberProperty, Property, Relation, RelationProperty, SecurityOperation, SecurityRule, StringProperty, isPostgresCollectionConfig, DateProperty, ArrayProperty, MapProperty, ReferenceProperty, VectorProperty, BinaryProperty } from "@rebasepro/types";
import { getPrimaryKeys } from "../services/collection-helpers";
import { getEnumVarName, getTableName, getTableVarName, resolveCollectionRelations, findRelation, securityRuleToConditions, policyToPostgres } from "@rebasepro/common";
import { toSnakeCase } from "@rebasepro/utils";
import { createHash } from "crypto";
import { logger } from "@rebasepro/server-core";
import { getEffectiveSecurityRules } from "./auth-default-policies";
// --- Helper Functions ---

/**
 * Resolve the SQL column name for a property.
 * Uses the explicit `columnName` when set (e.g. from introspection),
 * falling back to `toSnakeCase(propName)` for manually-authored collections.
 */
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
 * Given a raw DB column name (e.g. "client_id"), find the Drizzle property key
 * on the collection that maps to that column. A property matches if:
 *   (a) it has an explicit `columnName` equal to the given column, OR
 *   (b) its snake_case form equals the given column.
 *
 * Returns the property key (the Drizzle object key) if found, or the original
 * column name as a fallback.
 */
const resolvePropertyKeyForColumn = (collection: CollectionConfig, column: string): string => {
    if (!collection.properties) return column;
    for (const [propKey, prop] of Object.entries(collection.properties)) {
        const p = prop as Property;
        // Explicit columnName match
        if ("columnName" in p && typeof (p as unknown as Record<string, unknown>).columnName === "string") {
            if ((p as unknown as Record<string, unknown>).columnName === column) return propKey;
        }
        // Convention match: snake_case(propKey) === column
        if (toSnakeCase(propKey) === column) return propKey;
        // Exact match (propKey is already the column name)
        if (propKey === column) return propKey;
    }
    return column;
};

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

const getDrizzleColumn = (propName: string, prop: Property, collection: CollectionConfig, collections: CollectionConfig[]): string | null => {

    const colName = resolveColumnName(propName, prop);
    let columnDefinition: string;

    switch (prop.type) {
        case "string": {
            const stringProp = prop as unknown as StringProperty;
            if (stringProp.enum) {
                const enumName = getEnumVarName(getTableName(collection), propName);
                columnDefinition = `${enumName}("${colName}")`;
            } else if ("isId" in stringProp && stringProp.isId === "uuid") {
                columnDefinition = `uuid("${colName}")`;
            } else if (stringProp.columnType === "uuid") {
                columnDefinition = `uuid("${colName}")`;
            } else if (stringProp.columnType === "text" || stringProp.ui?.markdown || stringProp.ui?.multiline) {
                columnDefinition = `text("${colName}")`;
            } else if (stringProp.columnType === "char") {
                columnDefinition = `char("${colName}")`;
            } else {
                columnDefinition = `varchar("${colName}")`;
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

            let baseType = (numProp.validation?.integer || isId) ? `integer("${colName}")` : `numeric("${colName}")`;
            if (numProp.columnType) {
                if (numProp.columnType === "double precision") baseType = `doublePrecision("${colName}")`;
                else baseType = `${numProp.columnType}("${colName}")`;
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
            columnDefinition = `boolean("${colName}")`;
            break;
        case "date": {
            const dateProp = prop as DateProperty;
            if (dateProp.columnType === "date") {
                columnDefinition = `date("${colName}", { mode: 'string' })`;
            } else if (dateProp.columnType === "time") {
                columnDefinition = `time("${colName}")`;
            } else {
                columnDefinition = `timestamp("${colName}", { withTimezone: true, mode: 'string' })`;
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
                columnDefinition = `json("${colName}")`;
            } else {
                columnDefinition = `jsonb("${colName}")`;
            }
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
                columnDefinition = `json("${colName}")`;
            } else if (colType === "text[]") {
                columnDefinition = `text("${colName}").array()`;
            } else if (colType === "integer[]") {
                columnDefinition = `integer("${colName}").array()`;
            } else if (colType === "boolean[]") {
                columnDefinition = `boolean("${colName}").array()`;
            } else if (colType === "numeric[]") {
                columnDefinition = `numeric("${colName}").array()`;
            } else {
                columnDefinition = `jsonb("${colName}")`;
            }
            break;
        }
        case "vector": {
            const vp = prop as VectorProperty;
            columnDefinition = `vector("${colName}", { dimensions: ${vp.dimensions} })`;
            break;
        }
        case "binary": {
            columnDefinition = `customType({ dataType() { return 'bytea'; } })("${colName}")`;
            break;
        }
        case "relation": {
            const refProp = prop as RelationProperty;
            const resolvedRelations = resolveCollectionRelations(collection);
            const relation = findRelation(resolvedRelations, refProp.relationName ?? propName);

            // Only owning one-to-one/many-to-one relations create a column here.
            if (!relation || relation.direction !== "owning" || relation.cardinality !== "one") {
                return null;
            }

            // The localKey property is the source of truth for the FK column name.
            if (!relation.localKey) {
                logger.warn(`Could not generate column for owning relation '${relation.relationName}' on '${collection.name}': 'localKey' is not defined.`);
                return null;
            }

            // If the localKey property is defined elsewhere in the properties, it will be handled there.
            // This logic is for when the relation property itself defines the FK.
            if (collection.properties[relation.localKey] && propName !== relation.localKey) {
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
            const baseColumn = pkProp.type === "number" ? `integer("${fkColumnName}")` : (pkProp.isUuid ? `uuid("${fkColumnName}")` : `varchar("${fkColumnName}")`);

            const onUpdate = relation.onUpdate ? `onUpdate: "${relation.onUpdate}"` : "";
            const required = prop.validation?.required;
            const onDeleteVal = relation.onDelete ?? (required ? "cascade" : "set null");
            const onDelete = `onDelete: \"${onDeleteVal}\"`;

            const refOptionsParts = [onUpdate, onDelete].filter(Boolean);
            const refOptions = refOptionsParts.length > 0 ? `{ ${refOptionsParts.join(", ")} }` : "";

            let columnDef = `${baseColumn}.references(() => ${targetTableVar}.${targetIdField}${refOptions ? `, ${refOptions}` : ""})`;

            if (required) {
                columnDef += ".notNull()";
            }

            return `    ${relation.localKey}: ${columnDef}`;
        }
        case "reference": {
            const refProp = prop as ReferenceProperty;
            const targetCollection = collections.find(c => c.slug === refProp.path || getTableName(c) === refProp.path);
            if (!targetCollection) {
                columnDefinition = `varchar("${colName}")`;
                break;
            }

            const pkProp = getPrimaryKeyProp(targetCollection);
            const targetTableVar = getTableVarName(getTableName(targetCollection));
            const targetIdField = pkProp.name;
            const baseColumn = pkProp.type === "number" ? `integer("${colName}")` : (pkProp.isUuid ? `uuid("${colName}")` : `varchar("${colName}")`);

            const required = prop.validation?.required;
            const onDelete = required ? "cascade" : "set null";
            const refOptions = `{ onDelete: "${onDelete}" }`;

            columnDefinition = `${baseColumn}.references(() => ${targetTableVar}.${targetIdField}, ${refOptions})`;
            if (required) {
                columnDefinition += ".notNull()";
            }
            // Skip the standard notNull() handling below because we did it here with references
            return `    ${propName}: ${columnDefinition}`;
        }
        default:
            return null;
    }

    if (prop.validation?.required) {
        columnDefinition += ".notNull()";
    }

    return `    ${propName}: ${columnDefinition}`;
};

/**
 * Wraps a compiled SQL clause in a Drizzle `sql\`...\`` template literal.
 */
const wrapSql = (clause: string): string => `sql\`${clause}\``;

/**
 * Generates a deterministic hash based on the rule configuration.
 */
const getPolicyNameHash = (rule: SecurityRule): string => {
    const data = JSON.stringify({
        a: rule.access,
        m: rule.mode,
        op: rule.operation,
        ops: rule.operations?.slice().sort(),
        own: rule.ownerField,
        rol: rule.roles?.slice().sort(),
        pg: rule.pgRoles?.slice().sort(),
        u: rule.using,
        w: rule.withCheck,
        c: rule.condition,
        ch: rule.check
    });
    return createHash("sha1").update(data).digest("hex").substring(0, 7);
};

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
const generatePolicyCode = (collection: CollectionConfig, rule: SecurityRule, index: number): string => {
    const tableName = getTableName(collection);
    // Resolve operations: operations[] takes precedence over operation (singular)
    const ops: readonly SecurityOperation[] = rule.operations && rule.operations.length > 0
        ? rule.operations
        : [rule.operation ?? "all"];

    const ruleHash = getPolicyNameHash(rule);

    // Generate one pgPolicy per operation
    return ops.map((op, opIdx) => {
        const policyName = rule.name
            ? (ops.length > 1 ? `${rule.name}_${op}` : rule.name)
            : `${tableName}_${op}_${ruleHash}${ops.length > 1 ? `_${opIdx}` : ""}`;

        return generateSinglePolicyCode(collection, rule, op, policyName);
    }).join("");
};

/**
 * Generates a single pgPolicy() call for one specific operation.
 */
const generateSinglePolicyCode = (collection: CollectionConfig, rule: SecurityRule, operation: SecurityOperation, policyName: string): string => {
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

    let usingClause = needsUsing && usingExpr ? wrapSql(policyToPostgres(usingExpr, collection)) : null;
    let withCheckClause = needsWithCheck && withCheckExpr ? wrapSql(policyToPostgres(withCheckExpr, collection)) : null;

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

    return `    pgPolicy("${policyName}", { ${parts.join(", ")} }),\n`;
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
    rel: Relation,
    sourceCollection: CollectionConfig,
    _collections: CollectionConfig[]
): string => {
    const fallback = rel.relationName ?? toSnakeCase(rel.target().slug);

    // --- owning one (belongs-to) ---
    if (rel.direction === "owning" && rel.cardinality === "one" && rel.localKey) {
        // Normalise the localKey to the actual Drizzle property name so that
        // the owning side produces the same relation name as the inverse side
        // (which resolves foreignKeyOnTarget via the same helper).
        const normalisedKey = resolvePropertyKeyForColumn(sourceCollection, rel.localKey);
        return `${getTableName(sourceCollection)}_${normalisedKey}`;
    }

    // --- inverse many (one-to-many has-many) ---
    if (rel.direction === "inverse" && rel.cardinality === "many" && rel.foreignKeyOnTarget) {
        // The owning table is the *target*, the FK column is foreignKeyOnTarget.
        // Resolve to the Drizzle property key on the target so it matches the
        // owning side's normalised localKey.
        try {
            const targetCollection = rel.target();
            const normalisedFK = resolvePropertyKeyForColumn(targetCollection, rel.foreignKeyOnTarget);
            return `${getTableName(targetCollection)}_${normalisedFK}`;
        } catch {
            return fallback;
        }
    }

    // --- inverse one (one-to-one inverse) ---
    if (rel.direction === "inverse" && rel.cardinality === "one") {
        if (rel.foreignKeyOnTarget) {
            // FK lives on the target table — resolve to Drizzle property key
            try {
                const targetCollection = rel.target();
                const normalisedFK = resolvePropertyKeyForColumn(targetCollection, rel.foreignKeyOnTarget);
                return `${getTableName(targetCollection)}_${normalisedFK}`;
            } catch {
                return fallback;
            }
        }
        // No explicit foreignKeyOnTarget — try to find the corresponding owning relation
        try {
            const targetCollection = rel.target();
            const targetResolvedRelations = resolveCollectionRelations(targetCollection);
            const correspondingRelation = Object.values(targetResolvedRelations).find(targetRel =>
                targetRel.direction === "owning" &&
                targetRel.cardinality === "one" &&
                targetRel.localKey &&
                targetRel.target().slug === sourceCollection.slug
            );
            if (correspondingRelation && correspondingRelation.localKey) {
                return `${getTableName(targetCollection)}_${correspondingRelation.localKey}`;
            }
        } catch {
            // ignore
        }
        return fallback;
    }

    // --- M2M owning (through) — keep local name (already shared via junction wiring) ---
    // --- M2M inverse — keep local name ---
    // --- joinPath — not emitted as Drizzle relations ---
    return fallback;
};

// --- Main Schema Generation Logic ---
export const generateSchema = async (collections: CollectionConfig[], stripPolicies = false): Promise<string> => {
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

    // Always import pgPolicy and sql — RLS is enabled on every table (secure by default)
    const pgCoreImports = ["primaryKey", "pgTable", "integer", "varchar", "text", "char", "boolean", "timestamp", "date", "time", "jsonb", "json", "pgEnum", "numeric", "real", "doublePrecision", "bigint", "serial", "bigserial", "pgPolicy"];
    if (hasUuid) pgCoreImports.push("uuid");
    if (hasVector) pgCoreImports.push("vector");
    if (hasBinary) pgCoreImports.push("customType");

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
        relation?: Relation,
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
                    schemaContent += `export const ${enumVarName} = pgEnum(\"${enumDbName}\", [${values.map(v => `'${v}'`).join(", ")}]);\n`;
                    if (!exportedEnumVars.includes(enumVarName)) exportedEnumVars.push(enumVarName);
                }
            }
        });
    });
    schemaContent += "\n";

    // 2. Identify all tables (collections and junction tables only)
    for (const collection of collections) {
        const tableName = getTableName(collection);
        if (tableName) {
            allTablesToGenerate.set(tableName, { collection });
        }

        const resolvedRelations = resolveCollectionRelations(collection);
        for (const relation of Object.values(resolvedRelations)) {
            if (relation.through) { // Standard M2M junction table
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
        if (isJunction && relation && sourceCollection && relation.through) {
            const targetCollection = relation.target();
            const schema = (isPostgresCollectionConfig(targetCollection) ? targetCollection.schema : undefined) || (isPostgresCollectionConfig(sourceCollection) ? sourceCollection.schema : undefined);
            const tableCreator = schema ? `${schema}Schema.table` : "pgTable";
            const baseTableName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;
            const {
                sourceColumn,
                targetColumn
            } = relation.through;

            const onDelete = relation.onDelete ?? "cascade";
            const refOptions = `{ onDelete: \"${onDelete}\" }`;

            const sourceColType = isNumericId(sourceCollection) ? "integer" : (getPrimaryKeyProp(sourceCollection).isUuid ? "uuid" : "varchar");
            const targetColType = isNumericId(targetCollection) ? "integer" : (getPrimaryKeyProp(targetCollection).isUuid ? "uuid" : "varchar");
            const sourceId = getPrimaryKeyName(sourceCollection);
            const targetId = getPrimaryKeyName(targetCollection);

            schemaContent += `export const ${tableVarName} = ${tableCreator}(\"${baseTableName}\", {\n`;
            schemaContent += `    ${sourceColumn}: ${sourceColType}(\"${sourceColumn}\").notNull().references(() => ${getTableVarName(getTableName(sourceCollection))}.${sourceId}, ${refOptions}),\n`;
            schemaContent += `    ${targetColumn}: ${targetColType}(\"${targetColumn}\").notNull().references(() => ${getTableVarName(getTableName(targetCollection))}.${targetId}, ${refOptions}),\n`;
            schemaContent += "}, (table) => ({\n";
            schemaContent += `    pk: primaryKey({ columns: [table.${sourceColumn}, table.${targetColumn}] })\n`;
            schemaContent += "}));\n\n";
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

            // Backwards compatibility: if no id/primary key column is found in properties, but `id` wasn't explicitly provided
            // We should generate a basic id column if one was completely omitted.
            const hasIdColumn = Array.from(columns).some(col => col.includes(".primaryKey()"));
            if (!hasIdColumn) {
                columns.add("    id: varchar(\"id\").primaryKey()");
            }

            schemaContent += `${Array.from(columns).join(",\n")}`;

            const securityRules = getEffectiveSecurityRules(collection);
            if (!stripPolicies && securityRules.length > 0) {
                schemaContent += "\n}, (table) => ([\n";
                securityRules.forEach((rule: SecurityRule, idx: number) => {
                    schemaContent += generatePolicyCode(collection, rule, idx);
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
            if (relationInfo && relationInfo.relation && relationInfo.sourceCollection && relationInfo.relation.through) {
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
                        if (targetRel.direction === "inverse" &&
                            targetRel.cardinality === "many" &&
                            targetRel.inverseRelationName === owningRelationName) {
                            inverseRelationName = targetRel.relationName ?? null;
                            break;
                        }
                    }
                } catch {
                    // ignore — inverse side may not exist
                }

                // Source side one(): pairs with owning table's many(junctionTable, { relationName })
                tableRelations.push(`    "${relation.through.sourceColumn}": one(${sourceTableVar}, {\n        fields: [${tableVarName}.${relation.through.sourceColumn}],\n        references: [${sourceTableVar}.${sourceId}],\n        relationName: \"${owningRelationName}\"\n    })`);

                // Target side one(): pairs with inverse table's many(junctionTable, { relationName })
                // Always emit a relationName to avoid collisions with the source-side's owningRelationName.
                // When no inverse relation exists on the target collection, synthesize a unique name.
                const targetRelationName = inverseRelationName
                    ? inverseRelationName
                    : `${tableName}_${relation.through.targetColumn}`;
                tableRelations.push(`    "${relation.through.targetColumn}": one(${targetTableVar}, {\n        fields: [${tableVarName}.${relation.through.targetColumn}],\n        references: [${targetTableVar}.${targetId}],\n        relationName: "${targetRelationName}"\n    })`);
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
                    const deduplicationKey = `${drizzleRelationName}::${rel.direction}`;
                    if (emittedRelationNames.has(deduplicationKey)) continue;
                    emittedRelationNames.add(deduplicationKey);

                    if (rel.cardinality === "one") {
                        if (rel.direction === "owning" && rel.localKey) {
                            tableRelations.push(`    "${relationKey}": one(${targetTableVar}, {\n        fields: [${tableVarName}.${rel.localKey}],\n        references: [${targetTableVar}.${getPrimaryKeyName(target)}],\n        relationName: \"${drizzleRelationName}\"\n    })`);
                        } else if (rel.direction === "inverse") {
                            // Inverse one-to-one: the FK lives on the TARGET table, not here.
                            // Drizzle pairs inverse relations via `relationName` alone — specifying
                            // `fields`/`references` on the inverse side is invalid and causes
                            // `normalizeRelation` to crash with "Cannot read properties of
                            // undefined (reading 'referencedTable')".
                            tableRelations.push(`    "${relationKey}": one(${targetTableVar}, {\n        relationName: \"${drizzleRelationName}\"\n    })`);
                        }
                    } else if (rel.cardinality === "many") {
                        if (rel.direction === "inverse" && rel.foreignKeyOnTarget) {
                            // One-to-many inverse relation
                            tableRelations.push(`    "${relationKey}": many(${targetTableVar}, { relationName: \"${drizzleRelationName}\" })`);
                        } else if (rel.through) {
                            // Many-to-many owning relation with explicit junction table
                            const junctionTableVar = getTableVarName(rel.through.table);
                            tableRelations.push(`    "${relationKey}": many(${junctionTableVar}, { relationName: \"${drizzleRelationName}\" })`);
                        } else if (rel.direction === "inverse" && rel.inverseRelationName) {
                            // Many-to-many inverse relation - find the corresponding owning relation's junction table
                            try {
                                const targetCollection = rel.target();
                                const targetResolvedRelations = resolveCollectionRelations(targetCollection);

                                // Find the corresponding owning many-to-many relation on the target
                                const correspondingRelation = Object.values(targetResolvedRelations).find(targetRel =>
                                    targetRel.direction === "owning" &&
                                    targetRel.cardinality === "many" &&
                                    targetRel.through &&
                                    targetRel.relationName === rel.inverseRelationName
                                );

                                if (correspondingRelation && correspondingRelation.through) {
                                    const junctionTableVar = getTableVarName(correspondingRelation.through.table);
                                    tableRelations.push(`    "${relationKey}": many(${junctionTableVar}, { relationName: \"${drizzleRelationName}\" })`);
                                } else {
                                    logger.warn(`Could not find corresponding owning many-to-many relation for inverse relation '${relationKey}' on '${collection.name}'`);
                                }
                            } catch (e) {
                                logger.warn(`Could not resolve inverse many-to-many relation '${relationKey}'`, { error: e });
                            }
                        }
                        // joinPath relations don't generate Drizzle relations - they use existing user tables
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
                    if (otherRel.direction === "inverse" && otherRel.foreignKeyOnTarget) {
                        try {
                            const otherTarget = otherRel.target();
                            if (otherTarget.slug === collection.slug) {
                                const drizzleRelationName = computeSharedRelationName(otherRel, otherCollection, collections);
                                const deduplicationKey = `${drizzleRelationName}::owning`;

                                if (!emittedRelationNames.has(deduplicationKey)) {
                                    const otherTableVar = getTableVarName(getTableName(otherCollection));
                                    // Resolve foreignKeyOnTarget to the Drizzle property key
                                    // on THIS collection (the owning table). The raw FK column
                                    // name (e.g. "client_id") may differ from the property key
                                    // (e.g. "clientId") when `columnName` is set.
                                    const drizzleFieldKey = resolvePropertyKeyForColumn(collection, otherRel.foreignKeyOnTarget);
                                    const synthKey = `_synth_${otherTableVar}_${drizzleFieldKey}`;
                                    tableRelations.push(`    "${synthKey}": one(${otherTableVar}, {\n        fields: [${tableVarName}.${drizzleFieldKey}],\n        references: [${otherTableVar}.${getPrimaryKeyName(otherCollection)}],\n        relationName: \"${drizzleRelationName}\"\n    })`);
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

