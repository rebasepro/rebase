import { CollectionConfig, NumberProperty, Property, Relation, RelationProperty, SecurityOperation, SecurityRule, StringProperty, isPostgresCollectionConfig, DateProperty, ArrayProperty, MapProperty, ReferenceProperty, VectorProperty, BinaryProperty } from "@rebasepro/types";
import { getEnumVarName, getTableName, resolveCollectionRelations, findRelation, securityRuleToConditions, policyToPostgres, getEffectiveSecurityRules, getInjectedSecurityRules, resolveJunctionSpecs, getJunctionSecurityRules, getJunctionCollectionConfig } from "@rebasepro/common";
import { toSnakeCase, getPolicyNamesForRule } from "@rebasepro/utils";

// --- Helper Functions ---

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
            return { name: idPropEntry[0], type: prop.type === "number" ? "number" : "string", isUuid };
        }
    }
    const idProp = collection.properties?.["id"] as unknown as Property | undefined;
    if (idProp?.type === "number") {
        return { name: "id", type: "number", isUuid: false };
    }
    const isUuid = idProp?.type === "string" && "isId" in idProp && (idProp as unknown as StringProperty).isId === "uuid";
    return { name: "id", type: "string", isUuid: isUuid ?? false };
};

const isNumericId = (collection: CollectionConfig): boolean => {
    return getPrimaryKeyProp(collection).type === "number";
};

const getPrimaryKeyName = (collection: CollectionConfig): string => {
    return getPrimaryKeyProp(collection).name;
};

const isIdProperty = (propName: string, prop: Property, collection: CollectionConfig): boolean => {
    if ("isId" in prop && Boolean(prop.isId)) return true;
    const hasExplicitId = Object.values(collection.properties ?? {}).some(p => "isId" in (p as unknown as object) && Boolean((p as unknown as Record<string, unknown>).isId));
    return !hasExplicitId && propName === "id";
};


type ResolveCollection = (slug: string) => CollectionConfig | undefined;

const generatePolicyDdl = (collection: CollectionConfig, rule: SecurityRule, resolveCollection: ResolveCollection): string => {
    const tableName = getTableName(collection);
    const ops: readonly SecurityOperation[] = rule.operations && rule.operations.length > 0
        ? rule.operations
        : [rule.operation ?? "all"];

    const policyNames = getPolicyNamesForRule(rule, tableName);

    return ops.map((op, opIdx) => {
        return generateSinglePolicyDdl(collection, rule, op, policyNames[opIdx], resolveCollection);
    }).join("");
};

const generateSinglePolicyDdl = (collection: CollectionConfig, rule: SecurityRule, operation: SecurityOperation, policyName: string, resolveCollection: ResolveCollection): string => {
    const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
    const tableName = getTableName(collection);
    const mode = (rule.mode ?? "permissive").toUpperCase();
    const operationUpper = operation.toUpperCase();
    const pgRoles = rule.pgRoles ? [...rule.pgRoles].sort() : ["public"];

    const needsUsing = operation !== "insert";
    const needsWithCheck = operation !== "select" && operation !== "delete";

    // Desugar the rule (access / ownerField / roles / structured condition / raw
    // SQL) into the shared PolicyExpression model, then compile to SQL. This is
    // the same normalization the client-side evaluator uses, so DDL and UI agree.
    const { usingExpr, withCheckExpr } = securityRuleToConditions(rule);

    let usingClause = needsUsing && usingExpr ? policyToPostgres(usingExpr, collection, { resolveCollection }) : null;
    let withCheckClause = needsWithCheck && withCheckExpr ? policyToPostgres(withCheckExpr, collection, { resolveCollection }) : null;

    if (!usingClause && needsUsing) {
        usingClause = "false";
    }
    if (!withCheckClause && needsWithCheck) {
        withCheckClause = "false";
    }

    let ddl = `DROP POLICY IF EXISTS "${policyName}" ON "${schema}"."${tableName}";\n`;
    ddl += `CREATE POLICY "${policyName}" ON "${schema}"."${tableName}" AS ${mode} FOR ${operationUpper} TO ${pgRoles.map(r => `"${r}"`).join(", ")}`;
    if (usingClause) ddl += ` USING (${usingClause})`;
    if (withCheckClause) ddl += ` WITH CHECK (${withCheckClause})`;
    return `${ddl};\n`;
};

const getSqlColumnType = (propName: string, prop: Property, collection: CollectionConfig, collections: CollectionConfig[]): string => {
    switch (prop.type) {
        case "string": {
            const stringProp = prop as StringProperty;
            if (stringProp.enum) {
                const tableName = getTableName(collection);
                const colName = resolveColumnName(propName, prop);
                const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
                return `"${schema}"."${tableName}_${colName}"`;
            }
            if (stringProp.isId === "uuid" || stringProp.columnType === "uuid") {
                return "UUID";
            }
            if (stringProp.columnType === "text" || stringProp.ui?.markdown || stringProp.ui?.multiline) {
                return "TEXT";
            }
            if (stringProp.columnType === "char") {
                return "CHAR(255)";
            }
            return "VARCHAR(255)";
        }
        case "number": {
            const numProp = prop as NumberProperty;
            const isId = isIdProperty(propName, prop, collection);
            if ("isId" in numProp && numProp.isId === "increment") {
                return "INTEGER GENERATED BY DEFAULT AS IDENTITY";
            }
            if (numProp.columnType) {
                if (numProp.columnType === "double precision") return "DOUBLE PRECISION";
                return numProp.columnType.toUpperCase();
            }
            return (numProp.validation?.integer || isId) ? "INTEGER" : "NUMERIC";
        }
        case "boolean":
            return "BOOLEAN";
        case "date": {
            const dateProp = prop as DateProperty;
            if (dateProp.columnType === "date") return "DATE";
            if (dateProp.columnType === "time") return "TIME";
            return "TIMESTAMP WITH TIME ZONE";
        }
        case "map": {
            const mapProp = prop as MapProperty;
            return mapProp.columnType === "json" ? "JSON" : "JSONB";
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
            if (colType === "json") return "JSON";
            if (colType === "text[]") return "TEXT[]";
            if (colType === "integer[]") return "INTEGER[]";
            if (colType === "boolean[]") return "BOOLEAN[]";
            if (colType === "numeric[]") return "NUMERIC[]";
            return "JSONB";
        }
        case "vector": {
            const vp = prop as VectorProperty;
            return `VECTOR(${vp.dimensions})`;
        }
        case "binary": {
            return "BYTEA";
        }
        case "relation": {
            const refProp = prop as RelationProperty;
            const resolvedRelations = resolveCollectionRelations(collection);
            const relation = findRelation(resolvedRelations, refProp.relationName ?? propName);
            if (!relation || relation.direction !== "owning" || relation.cardinality !== "one") {
                throw new Error(`Relation ${propName} is not an owning one-to-one/many-to-one relation`);
            }
            let targetCollection: CollectionConfig;
            try {
                targetCollection = relation.target();
            } catch {
                return "VARCHAR(255)";
            }
            const pkProp = getPrimaryKeyProp(targetCollection);
            return pkProp.type === "number" ? "INTEGER" : (pkProp.isUuid ? "UUID" : "VARCHAR(255)");
        }
        case "reference": {
            const refProp = prop as ReferenceProperty;
            const targetCollection = collections.find(c => c.slug === refProp.path || getTableName(c) === refProp.path);
            if (!targetCollection) return "VARCHAR(255)";
            const pkProp = getPrimaryKeyProp(targetCollection);
            return pkProp.type === "number" ? "INTEGER" : (pkProp.isUuid ? "UUID" : "VARCHAR(255)");
        }
        default:
            return "VARCHAR(255)";
    }
};

export const generatePostgresDdl = async (
    collections: CollectionConfig[],
    options: { includePolicies?: boolean } = { includePolicies: true }
): Promise<string> => {
    let ddl = "-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.\n\n";

    // 1. Create custom schemas
    const uniqueSchemas = Array.from(new Set([
        "auth",
        ...collections.map(c => isPostgresCollectionConfig(c) ? c.schema : undefined).filter(Boolean)
    ]));
    uniqueSchemas.forEach(schema => {
        if (schema) ddl += `CREATE SCHEMA IF NOT EXISTS "${schema}";\n`;
    });
    if (uniqueSchemas.length > 0) ddl += "\n";

    // 2. Generate Enums
    collections.forEach(collection => {
        const collectionTable = getTableName(collection);
        const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
        Object.entries(collection.properties ?? {}).forEach(([propName, prop]) => {
            if (("enum" in prop) && (prop.type === "string" || prop.type === "number") && prop.enum) {
                const enumDbName = `${collectionTable}_${resolveColumnName(propName, prop)}`;
                const values = Array.isArray(prop.enum)
                    ? (prop.enum as (string | number | { id: string | number })[]).map((v: string | number | { id: string | number }) =>
                        String(typeof v === "object" && v !== null && "id" in v ? v.id : v)
                    )
                    : Object.keys(prop.enum);
                if (values.length > 0) {
                    ddl += `CREATE TYPE "${schema}"."${enumDbName}" AS ENUM (${values.map(v => `'${v}'`).join(", ")});\n`;
                }
            }
        });
    });
    if (ddl.endsWith(";\n")) ddl += "\n";

    // Junction policy derivation needs every declaring side of each junction,
    // not just the first relation that reached it in the walk below.
    const junctionSpecs = resolveJunctionSpecs(collections);

    const allTablesToGenerate = new Map<string, {
        collection: CollectionConfig,
        isJunction?: boolean,
        relation?: Relation,
        sourceCollection?: CollectionConfig
    }>();

    // Identify all tables
    for (const collection of collections) {
        const tableName = getTableName(collection);
        if (tableName) {
            allTablesToGenerate.set(tableName, { collection });
        }

        const resolvedRelations = resolveCollectionRelations(collection);
        for (const relation of Object.values(resolvedRelations)) {
            if (relation.through) {
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
        }
    }

    // 3. Generate tables
    const fkStatements: string[] = [];
    // Policies are emitted after every CREATE TABLE, like the FK constraints:
    // a policy may reference other tables (a junction's derived policies always
    // reference both endpoints; `policy.existsIn` references a join table), and
    // CREATE POLICY validates those relations at creation time.
    const policyStatements: string[] = [];
    for (const [tableName, {
        collection,
        isJunction,
        relation,
        sourceCollection
    }] of allTablesToGenerate.entries()) {
        const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
        const baseTableName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;

        if (isJunction && relation && sourceCollection && relation.through) {
            const targetCollection = relation.target();
            const sourceTable = getTableName(sourceCollection);
            const targetTable = getTableName(targetCollection);
            const sourceSchema = isPostgresCollectionConfig(sourceCollection) && sourceCollection.schema ? sourceCollection.schema : "public";
            const targetSchema = isPostgresCollectionConfig(targetCollection) && targetCollection.schema ? targetCollection.schema : "public";
            const { sourceColumn, targetColumn } = relation.through;

            const sourceColType = isNumericId(sourceCollection) ? "INTEGER" : (getPrimaryKeyProp(sourceCollection).isUuid ? "UUID" : "VARCHAR(255)");
            const targetColType = isNumericId(targetCollection) ? "INTEGER" : (getPrimaryKeyProp(targetCollection).isUuid ? "UUID" : "VARCHAR(255)");
            const sourceId = getPrimaryKeyName(sourceCollection);
            const targetId = getPrimaryKeyName(targetCollection);

            const onDelete = relation.onDelete ?? "CASCADE";

            ddl += `CREATE TABLE "${schema}"."${baseTableName}" (\n`;
            ddl += `  "${sourceColumn}" ${sourceColType} NOT NULL,\n`;
            ddl += `  "${targetColumn}" ${targetColType} NOT NULL,\n`;
            ddl += `  PRIMARY KEY ("${sourceColumn}", "${targetColumn}")\n`;
            ddl += `);\n\n`;

            fkStatements.push(`ALTER TABLE "${schema}"."${baseTableName}" ADD CONSTRAINT "${baseTableName}_${sourceColumn}_fkey" FOREIGN KEY ("${sourceColumn}") REFERENCES "${sourceSchema}"."${sourceTable}" ("${sourceId}") ON DELETE ${onDelete.toUpperCase()};`);
            fkStatements.push(`ALTER TABLE "${schema}"."${baseTableName}" ADD CONSTRAINT "${baseTableName}_${targetColumn}_fkey" FOREIGN KEY ("${targetColumn}") REFERENCES "${targetSchema}"."${targetTable}" ("${targetId}") ON DELETE ${onDelete.toUpperCase()};`);

            if (options.includePolicies) {
                // Junction tables are generated tables like any other: locked by
                // default, with derived policies — reads follow the endpoints'
                // visibility, writes follow the declaring side's update rules.
                // Without this they were the one kind of generated table with no
                // RLS at all, readable and writable by every signed-in user.
                ddl += `ALTER TABLE "${schema}"."${baseTableName}" ENABLE ROW LEVEL SECURITY;\n`;
                ddl += `\n`;

                const spec = junctionSpecs.get(baseTableName);
                if (spec) {
                    const junctionCollection = getJunctionCollectionConfig(spec);
                    const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
                    getJunctionSecurityRules(spec).forEach((rule: SecurityRule) => {
                        policyStatements.push(generatePolicyDdl(junctionCollection, rule, resolveCollection));
                    });
                }
            }
        } else if (!isJunction) {
            ddl += `CREATE TABLE "${schema}"."${baseTableName}" (\n`;
            const columns: string[] = [];

            Object.entries(collection.properties ?? {}).forEach(([propName, prop]) => {
                if (prop.type === "relation") {
                    const refProp = prop as RelationProperty;
                    const resolvedRelations = resolveCollectionRelations(collection);
                    const relInfo = findRelation(resolvedRelations, refProp.relationName ?? propName);

                    if (!relInfo || relInfo.direction !== "owning" || relInfo.cardinality !== "one" || !relInfo.localKey) {
                        return;
                    }

                    if (collection.properties[relInfo.localKey] && propName !== relInfo.localKey) {
                        return;
                    }

                    let targetCollection: CollectionConfig;
                    try {
                        targetCollection = relInfo.target();
                    } catch {
                        return;
                    }

                    const targetTable = getTableName(targetCollection);
                    const targetSchema = isPostgresCollectionConfig(targetCollection) && targetCollection.schema ? targetCollection.schema : "public";
                    const targetId = getPrimaryKeyName(targetCollection);
                    const fkColType = getSqlColumnType(propName, prop, collection, collections);
                    
                    const onUpdate = relInfo.onUpdate ? ` ON UPDATE ${relInfo.onUpdate.toUpperCase()}` : "";
                    const required = prop.validation?.required;
                    const onDeleteVal = relInfo.onDelete ?? (required ? "CASCADE" : "SET NULL");
                    
                    let colDef = `  "${relInfo.localKey}" ${fkColType}`;
                    if (required) colDef += " NOT NULL";
                    columns.push(colDef);

                    fkStatements.push(`ALTER TABLE "${schema}"."${baseTableName}" ADD CONSTRAINT "${baseTableName}_${relInfo.localKey}_fkey" FOREIGN KEY ("${relInfo.localKey}") REFERENCES "${targetSchema}"."${targetTable}" ("${targetId}") ON DELETE ${onDeleteVal.toUpperCase()}${onUpdate};`);
                } else if (prop.type === "reference") {
                    const refProp = prop as ReferenceProperty;
                    const targetCollection = collections.find(c => c.slug === refProp.path || getTableName(c) === refProp.path);
                    const colName = resolveColumnName(propName, prop);
                    const colType = getSqlColumnType(propName, prop, collection, collections);
                    const required = prop.validation?.required;

                    if (!targetCollection) {
                        let colDef = `  "${colName}" ${colType}`;
                        if (required) colDef += " NOT NULL";
                        columns.push(colDef);
                    } else {
                        const targetTable = getTableName(targetCollection);
                        const targetSchema = isPostgresCollectionConfig(targetCollection) && targetCollection.schema ? targetCollection.schema : "public";
                        const targetId = getPrimaryKeyName(targetCollection);
                        const onDelete = required ? "CASCADE" : "SET NULL";

                        let colDef = `  "${colName}" ${colType}`;
                        if (required) colDef += " NOT NULL";
                        columns.push(colDef);

                        fkStatements.push(`ALTER TABLE "${schema}"."${baseTableName}" ADD CONSTRAINT "${baseTableName}_${colName}_fkey" FOREIGN KEY ("${colName}") REFERENCES "${targetSchema}"."${targetTable}" ("${targetId}") ON DELETE ${onDelete.toUpperCase()};`);
                    }
                } else {
                    const colName = resolveColumnName(propName, prop);
                    const colType = getSqlColumnType(propName, prop, collection, collections);
                    let colDef = `  "${colName}" ${colType}`;

                    if (isIdProperty(propName, prop, collection)) {
                        colDef += " PRIMARY KEY";
                    }

                    if ("isId" in prop && prop.isId !== "manual" && prop.isId !== true && prop.isId !== "increment") {
                        if (prop.isId === "uuid") {
                            colDef += " DEFAULT gen_random_uuid()";
                        } else if (prop.isId === "cuid") {
                            colDef += " DEFAULT cuid()";
                        } else if (typeof prop.isId === "string") {
                            colDef += ` DEFAULT ${prop.isId}`;
                        }
                    }

                    if (!isIdProperty(propName, prop, collection) && prop.validation?.unique) {
                        colDef += " UNIQUE";
                    }

                    if (prop.type === "date") {
                        const dateProp = prop as DateProperty;
                        if (dateProp.autoValue === "on_create" || dateProp.autoValue === "on_update") {
                            colDef += " DEFAULT now()";
                        }
                    }

                    if (prop.validation?.required && !colDef.includes("PRIMARY KEY")) {
                        colDef += " NOT NULL";
                    }

                    columns.push(colDef);
                }
            });

            // Backwards compatibility: add default id primary key if missing
            const hasPk = columns.some(c => c.includes("PRIMARY KEY"));
            if (!hasPk) {
                columns.unshift('  "id" VARCHAR(255) PRIMARY KEY');
            }

            ddl += columns.join(",\n");
            ddl += `\n);\n\n`;

            if (options.includePolicies) {
                // Enable RLS and add Policies. No FORCE: authenticated requests
                // run as the non-owner `rebase_user` role, which plain ENABLE
                // already binds. The owner (server context) must bypass — it is
                // the trusted plane (auth flows, dataAsAdmin).
                ddl += `ALTER TABLE "${schema}"."${baseTableName}" ENABLE ROW LEVEL SECURITY;\n`;
                ddl += `\n`;

                const securityRules = getEffectiveSecurityRules(collection);
                if (securityRules.length > 0) {
                    const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
                    securityRules.forEach((rule: SecurityRule) => {
                        policyStatements.push(generatePolicyDdl(collection, rule, resolveCollection));
                    });
                }
            }
        }
    }

    if (fkStatements.length > 0) {
        ddl += "-- Foreign Key Constraints\n";
        ddl += fkStatements.join("\n") + "\n\n";
    }

    if (policyStatements.length > 0) {
        ddl += "-- Row Level Security Policies\n";
        ddl += policyStatements.join("");
        ddl += "\n";
    }

    return ddl;
};

export const generatePostgresPoliciesDdl = (collections: CollectionConfig[]): string => {
    let ddl = "-- This file contains RLS policies generated by Rebase. Applied separately from migrations.\n\n";

    const allTablesToGenerate = new Map<string, {
        collection: CollectionConfig
    }>();

    for (const collection of collections) {
        const tableName = getTableName(collection);
        if (tableName) {
            allTablesToGenerate.set(tableName, { collection });
        }
    }

    for (const [tableName, { collection }] of allTablesToGenerate.entries()) {
        const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
        const baseTableName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;

        // No FORCE: user requests run as the non-owner `rebase_user` role
        // (plain ENABLE binds them); the owner is the trusted server context.
        ddl += `ALTER TABLE "${schema}"."${baseTableName}" ENABLE ROW LEVEL SECURITY;\n`;
        ddl += `\n`;

        const securityRules = getEffectiveSecurityRules(collection);
        if (securityRules.length > 0) {
            const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
            const injectedNames = new Set(getInjectedSecurityRules(collection).map((rule) => rule.name));

            securityRules.forEach((rule: SecurityRule) => {
                // Say which policies the author did not write. They are permissive,
                // so they OR with the declared rules and widen the final ACL beyond
                // what `securityRules` reads like — and re-appear after any manual
                // DROP, because a push asserts the declared state.
                if (rule.name && injectedNames.has(rule.name)) {
                    ddl += `-- Injected by Rebase (not from this collection's securityRules).\n`;
                    ddl += `-- Set \`disableDefaultPolicies: true\` on "${collection.slug}" to drop these and own its RLS outright.\n`;
                }
                ddl += generatePolicyDdl(collection, rule, resolveCollection);
            });
            ddl += "\n";
        }
    }

    // Junction tables are generated from `through` relations, not declared as
    // collections, so the walk above never sees them. They get the same
    // treatment as any generated table: locked by default, with derived
    // policies — reads follow the endpoints, writes follow the declaring
    // side's update rules.
    const junctionSpecs = resolveJunctionSpecs(collections);
    for (const spec of junctionSpecs.values()) {
        ddl += `ALTER TABLE "${spec.schema}"."${spec.table}" ENABLE ROW LEVEL SECURITY;\n`;
        ddl += `\n`;

        const junctionRules = getJunctionSecurityRules(spec);
        if (junctionRules.length === 0) continue;

        const junctionCollection = getJunctionCollectionConfig(spec);
        const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
        const declaringSlugs = spec.declaringSides.map(s => s.collection.slug).join('", "');

        ddl += `-- Derived by Rebase for the junction "${spec.table}" (no collection declares it).\n`;
        ddl += `-- Reads require both endpoint rows to be visible; writes follow the update\n`;
        ddl += `-- rules of "${declaringSlugs}". Set \`disableDefaultPolicies: true\` on the\n`;
        ddl += `-- declaring collection(s) to drop these and police the junction yourself.\n`;
        junctionRules.forEach((rule: SecurityRule) => {
            ddl += generatePolicyDdl(junctionCollection, rule, resolveCollection);
        });
        ddl += "\n";
    }

    return ddl;
};

