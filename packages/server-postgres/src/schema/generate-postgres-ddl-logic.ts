import { CollectionConfig, NumberProperty, Property, ResolvedRelation, RelationProperty, SecurityOperation, SecurityRule, StringProperty, isPostgresCollectionConfig, DateProperty, ArrayProperty, MapProperty, ReferenceProperty, VectorProperty, BinaryProperty, isManyToMany, type ResolvedManyToMany, type ResolvedBelongsTo } from "@rebasepro/types";
import { getEnumVarName, getTableName, resolveCollectionRelations, findRelation, securityRuleToConditions, policyToPostgres, getEffectiveSecurityRules, getInjectedSecurityRules, resolveJunctionSpecs, getJunctionSecurityRules, getJunctionCollectionConfig, resolveStringColumnLength, relationalCollections } from "@rebasepro/common";
import { toSnakeCase, getPolicyNamesForRule, generateForeignKeyName, legacyForeignKeyName, toPostgresIdentifier } from "@rebasepro/utils";
import { AUTH_USERS_COLUMNS, authUsersColumnDefinition, authUsersColumnSql, isAuthCollection } from "./auth-users-columns";
import {
    buildSearchColumnSpec,
    searchColumnDefinition,
    fuzzyColumnDefinition,
    searchIndexStatements,
    searchHelperFunctions,
    searchExtensionStatements,
    type SearchColumnSpec
} from "./search-column";
import { REBASE_SCHEMA } from "@rebasepro/types";

// --- Helper Functions ---

export const resolveColumnName = (propName: string, prop?: Property | null): string => {
    if (prop && "columnName" in prop && typeof prop.columnName === "string") {
        return prop.columnName;
    }
    return toSnakeCase(propName);
};

export const getPrimaryKeyProp = (collection: CollectionConfig): { name: string, type: "string" | "number", isUuid: boolean } => {
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

export const isNumericId = (collection: CollectionConfig): boolean => {
    return getPrimaryKeyProp(collection).type === "number";
};

export const getPrimaryKeyName = (collection: CollectionConfig): string => {
    return getPrimaryKeyProp(collection).name;
};

/** The column type a junction holds for one endpoint's primary key. */
const junctionKeyType = (collection: CollectionConfig): string =>
    isNumericId(collection) ? "INTEGER" : (getPrimaryKeyProp(collection).isUuid ? "UUID" : "TEXT");

export const isIdProperty = (propName: string, prop: Property, collection: CollectionConfig): boolean => {
    if ("isId" in prop && Boolean(prop.isId)) return true;
    const hasExplicitId = Object.values(collection.properties ?? {}).some(p => "isId" in (p as unknown as object) && Boolean((p as unknown as Record<string, unknown>).isId));
    return !hasExplicitId && propName === "id";
};


type ResolveCollection = (slug: string) => CollectionConfig | undefined;

/**
 * Render statements produced by {@link generatePolicyStatements} back into the
 * exact string the DDL/policies files have always carried: each statement on
 * its own line, terminated by a newline. Keeping the string form derived from
 * the statement array means the two can never drift — the boot-time applier and
 * the generated `policies.sql` emit the same SQL, from the same source.
 */
const statementsToDdl = (statements: string[]): string => statements.map(s => `${s}\n`).join("");

const generatePolicyDdl = (collection: CollectionConfig, rule: SecurityRule, resolveCollection: ResolveCollection): string =>
    statementsToDdl(generatePolicyStatements(collection, rule, resolveCollection));

/**
 * The individual SQL statements a single security rule compiles to: a
 * `DROP POLICY IF EXISTS` / `CREATE POLICY` pair per operation, each a complete
 * statement (terminated by `;`, no trailing newline).
 *
 * This is the primitive the boot-time RLS applier runs one statement at a time
 * (the runtime's DB handle speaks the extended query protocol, which forbids
 * multiple commands in one execute), while `db push` writes the joined string.
 */
export const generatePolicyStatements = (collection: CollectionConfig, rule: SecurityRule, resolveCollection: ResolveCollection): string[] => {
    const tableName = getTableName(collection);
    const ops: readonly SecurityOperation[] = rule.operations && rule.operations.length > 0
        ? rule.operations
        : [rule.operation ?? "all"];

    const policyNames = getPolicyNamesForRule(rule, tableName);

    return ops.flatMap((op, opIdx) => {
        return generateSinglePolicyStatements(collection, rule, op, policyNames[opIdx], resolveCollection);
    });
};

const generateSinglePolicyStatements = (collection: CollectionConfig, rule: SecurityRule, operation: SecurityOperation, policyName: string, resolveCollection: ResolveCollection): string[] => {
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

    const drop = `DROP POLICY IF EXISTS "${policyName}" ON "${schema}"."${tableName}";`;
    let create = `CREATE POLICY "${policyName}" ON "${schema}"."${tableName}" AS ${mode} FOR ${operationUpper} TO ${pgRoles.map(r => `"${r}"`).join(", ")}`;
    if (usingClause) create += ` USING (${usingClause})`;
    if (withCheckClause) create += ` WITH CHECK (${withCheckClause})`;
    create += ";";
    return [drop, create];
};

/**
 * Single-quote escaping for a SQL string literal (PostgreSQL doubles the
 * quote). Enum labels come straight from user-authored collection config, so a
 * label like `it's` closes the literal early and the whole generated file stops
 * parsing at the `CREATE TYPE`. Lives here rather than next to its other caller
 * because ensure-collection-tables already imports from this module — the
 * reverse would be a cycle.
 */
export const quoteSqlLiteral = (value: string): string => `'${value.replace(/'/g, "''")}'`;

export const getSqlColumnType = (propName: string, prop: Property, collection: CollectionConfig, collections: CollectionConfig[]): string => {
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
            // Width comes from `validation.max` when the property states one.
            // It used to be a hardcoded 255 here and *absent* on the Drizzle
            // path, so the same property produced a bounded column down one
            // generator and an unbounded one down the other.
            if (stringProp.columnType === "char") {
                return `CHAR(${resolveStringColumnLength(stringProp)})`;
            }
            if (stringProp.columnType === "varchar") {
                return `VARCHAR(${resolveStringColumnLength(stringProp)})`;
            }
            // `text` is the default. The two generators disagreed here before:
            // this one emitted VARCHAR(255) while the drizzle path emitted a bare
            // `varchar()`, which Postgres treats as unbounded — so the same
            // property produced a capped column down one path and an uncapped one
            // down the other.
            return "TEXT";
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
            const relation = findRelation(resolvedRelations, refProp.relation?.relationName ?? propName);
            if (relation?.kind !== "belongsTo") {
                throw new Error(`Relation ${propName} does not put a column on this table (only \`belongsTo\` does)`);
            }
            let targetCollection: CollectionConfig;
            try {
                targetCollection = relation.target();
            } catch {
                return "TEXT";
            }
            const pkProp = getPrimaryKeyProp(targetCollection);
            return pkProp.type === "number" ? "INTEGER" : (pkProp.isUuid ? "UUID" : "TEXT");
        }
        case "reference": {
            const refProp = prop as ReferenceProperty;
            const targetCollection = collections.find(c => c.slug === refProp.path || getTableName(c) === refProp.path);
            if (!targetCollection) return "TEXT";
            const pkProp = getPrimaryKeyProp(targetCollection);
            return pkProp.type === "number" ? "INTEGER" : (pkProp.isUuid ? "UUID" : "TEXT");
        }
        default:
            return "TEXT";
    }
};

export const generatePostgresDdl = async (
    allCollections: CollectionConfig[],
    options: { includePolicies?: boolean } = { includePolicies: true }
): Promise<string> => {
    // Only the collections this engine stores. See `relationalCollections`.
    const collections = relationalCollections(allCollections);
    let ddl = "-- This file is auto-generated by the Rebase DDL generator. Do not edit manually.\n\n";

    // 1. Create custom schemas.
    //
    // `rebase` is unconditional and load-bearing. The RLS helper functions live
    // in it, so the migration preamble creates it — which puts it in Atlas's
    // replayed state, and anything in that state but absent from this desired
    // schema gets a `DROP SCHEMA … CASCADE` planned against it. That would take
    // the auth tables. It used to appear here only when some collection
    // happened to declare `schema: "rebase"`; the scaffold's users collection
    // does, which is why nobody hit it, but nothing guaranteed it.
    const uniqueSchemas = Array.from(new Set([
        REBASE_SCHEMA,
        ...collections.map(c => isPostgresCollectionConfig(c) ? c.schema : undefined).filter(Boolean)
    ]));
    uniqueSchemas.forEach(schema => {
        if (schema) ddl += `CREATE SCHEMA IF NOT EXISTS "${schema}";\n`;
    });
    if (uniqueSchemas.length > 0) ddl += "\n";

    // 1b. Search support, for collections that opted in.
    //
    // Extensions and helper functions come before every CREATE TABLE because a
    // generated column's expression is resolved at creation time: a table whose
    // search column calls `rebase_search_text` cannot be created before that
    // function exists. Both are `IF NOT EXISTS` / `OR REPLACE`, so a file
    // replayed against a live database is a no-op here.
    const searchSpecs = collections
        .map(c => buildSearchColumnSpec(c))
        .filter((s): s is SearchColumnSpec => s !== undefined);

    if (searchSpecs.length > 0) {
        const extensions = Array.from(new Set(searchSpecs.flatMap(searchExtensionStatements)));
        const helpers = Array.from(new Set(searchSpecs.flatMap(searchHelperFunctions)));
        ddl += "-- Full-text search support (collections declaring a `search` block)\n";
        extensions.forEach(s => { ddl += `${s}\n`; });
        if (extensions.length > 0) ddl += "\n";
        helpers.forEach(s => { ddl += `${s}\n\n`; });
    }

    // 2. Generate Enums
    //
    // The enum type name is derived from table + column, so two collections
    // mapped onto the same table — or two properties whose `columnName`
    // resolves to the same column — land on the same name. `CREATE TYPE` has no
    // IF NOT EXISTS, so emitting it twice aborts the whole file on the second
    // statement. Dedupe by name, matching planCollectionSchemaEnsure.
    const emittedEnums = new Set<string>();
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
                if (values.length > 0 && !emittedEnums.has(`${schema}.${enumDbName}`)) {
                    emittedEnums.add(`${schema}.${enumDbName}`);
                    ddl += `CREATE TYPE "${schema}"."${enumDbName}" AS ENUM (${values.map(quoteSqlLiteral).join(", ")});\n`;
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
        relation?: ResolvedRelation,
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
            if (isManyToMany(relation)) {
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
    // Indexes follow the tables for the same reason the FK constraints do: the
    // table has to exist first.
    const indexStatements: string[] = [];
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

        if (isJunction && relation && sourceCollection && isManyToMany(relation)) {
            const targetCollection = relation.target();
            const sourceTable = getTableName(sourceCollection);
            const targetTable = getTableName(targetCollection);
            const sourceSchema = isPostgresCollectionConfig(sourceCollection) && sourceCollection.schema ? sourceCollection.schema : "public";
            const targetSchema = isPostgresCollectionConfig(targetCollection) && targetCollection.schema ? targetCollection.schema : "public";
            const { sourceColumn, targetColumn } = relation.through;

            // TEXT, matching the string default: a junction column has to have the
            // same type as the primary key it references.
            const sourceColType = isNumericId(sourceCollection) ? "INTEGER" : (getPrimaryKeyProp(sourceCollection).isUuid ? "UUID" : "TEXT");
            const targetColType = isNumericId(targetCollection) ? "INTEGER" : (getPrimaryKeyProp(targetCollection).isUuid ? "UUID" : "TEXT");
            const sourceId = getPrimaryKeyName(sourceCollection);
            const targetId = getPrimaryKeyName(targetCollection);

            const onDelete = relation.onDelete ?? "CASCADE";

            ddl += `CREATE TABLE "${schema}"."${baseTableName}" (\n`;
            ddl += `  "${sourceColumn}" ${sourceColType} NOT NULL,\n`;
            ddl += `  "${targetColumn}" ${targetColType} NOT NULL,\n`;
            ddl += `  PRIMARY KEY ("${sourceColumn}", "${targetColumn}")\n`;
            ddl += `);\n\n`;

            fkStatements.push(`ALTER TABLE "${schema}"."${baseTableName}" ADD CONSTRAINT "${toPostgresIdentifier(`${baseTableName}_${sourceColumn}_fkey`)}" FOREIGN KEY ("${sourceColumn}") REFERENCES "${sourceSchema}"."${sourceTable}" ("${sourceId}") ON DELETE ${onDelete.toUpperCase()};`);
            fkStatements.push(`ALTER TABLE "${schema}"."${baseTableName}" ADD CONSTRAINT "${toPostgresIdentifier(`${baseTableName}_${targetColumn}_fkey`)}" FOREIGN KEY ("${targetColumn}") REFERENCES "${targetSchema}"."${targetTable}" ("${targetId}") ON DELETE ${onDelete.toUpperCase()};`);

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
                    const relInfo = findRelation(resolvedRelations, refProp.relation?.relationName ?? propName);

                    if (relInfo?.kind !== "belongsTo") {
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

                    fkStatements.push(`ALTER TABLE "${schema}"."${baseTableName}" ADD CONSTRAINT "${toPostgresIdentifier(`${baseTableName}_${relInfo.localKey}_fkey`)}" FOREIGN KEY ("${relInfo.localKey}") REFERENCES "${targetSchema}"."${targetTable}" ("${targetId}") ON DELETE ${onDeleteVal.toUpperCase()}${onUpdate};`);
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

                        fkStatements.push(`ALTER TABLE "${schema}"."${baseTableName}" ADD CONSTRAINT "${toPostgresIdentifier(`${baseTableName}_${colName}_fkey`)}" FOREIGN KEY ("${colName}") REFERENCES "${targetSchema}"."${targetTable}" ("${targetId}") ON DELETE ${onDelete.toUpperCase()};`);
                    }
                } else {
                    const colName = resolveColumnName(propName, prop);

                    // On an auth collection, the columns auth reads and writes
                    // are defined once, in `auth-users-columns`, and every
                    // creator of this table emits that definition. Before this,
                    // the desired state here was built from the collection file
                    // alone — which knows nothing of `is_anonymous` or
                    // `tokens_valid_after` — so `db push` and the runtime
                    // disagreed about `email`'s nullability and about which
                    // columns exist at all.
                    const authDefinition = isAuthCollection(collection)
                        ? authUsersColumnDefinition(colName)
                        : undefined;
                    if (authDefinition && !isIdProperty(propName, prop, collection)) {
                        columns.push(`  "${colName}" ${authDefinition}`);
                        return;
                    }

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

            // ── Auth columns the collection file never mentions ──────────────
            // `db push` is declarative: Atlas diffs the database against exactly
            // what is emitted here and drops anything else. The scaffold's users
            // collection describes 12 columns while auth needs 14, so
            // `is_anonymous` and `tokens_valid_after` — created at boot by
            // `ensureAuthTablesExist` — read as unmanaged drift, and a push run
            // after the server had started once planned to DROP them. The
            // destructive gate catches it, which makes it a data-loss prompt on
            // the auth table rather than silent damage; either way the desired
            // state was wrong. Emit the full contract so the two agree.
            if (isAuthCollection(collection)) {
                const declared = new Set(
                    Object.entries(collection.properties ?? {})
                        .map(([name, prop]) => resolveColumnName(name, prop))
                );
                for (const spec of AUTH_USERS_COLUMNS) {
                    if (declared.has(spec.column)) continue;
                    columns.push(`  "${spec.column}" ${authUsersColumnSql(spec)}`);
                }
            }

            // ── The opt-in search column ─────────────────────────────────────
            // Last, so it reads as what it is: derived from the columns above
            // it. Postgres recomputes it on every write of a source column and
            // rejects any attempt to write it directly, which is the property
            // that makes it impossible for the index to drift from the row.
            const searchSpec = buildSearchColumnSpec(collection);
            if (searchSpec) {
                columns.push(`  ${searchColumnDefinition(searchSpec)}`);
                const fuzzyDef = fuzzyColumnDefinition(searchSpec);
                if (fuzzyDef) columns.push(`  ${fuzzyDef}`);
                indexStatements.push(...searchIndexStatements(searchSpec));
            }

            // Backwards compatibility: add default id primary key if missing
            const hasPk = columns.some(c => c.includes("PRIMARY KEY"));
            if (!hasPk) {
                columns.unshift('  "id" TEXT PRIMARY KEY');
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

    if (indexStatements.length > 0) {
        ddl += "-- Indexes\n";
        ddl += indexStatements.join("\n") + "\n\n";
    }

    if (policyStatements.length > 0) {
        ddl += "-- Row Level Security Policies\n";
        ddl += policyStatements.join("");
        ddl += "\n";
    }

    return ddl;
};

/** The RLS statements one declared collection's table needs, ready to run. */
/**
 * A foreign key, as both its parts and the statement that creates it.
 *
 * `ALTER TABLE … ADD CONSTRAINT` has no `IF NOT EXISTS`, so a caller applying
 * these has to skip by name — hence the name is a field and not only a substring
 * of the SQL.
 */
export interface ForeignKeyPlan {
    constraintName: string;
    schema: string;
    /** Bare table name, no schema prefix. */
    table: string;
    column: string;
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
    sql: string;
}

/** A column a `relation` or `reference` property owns on its own table. */
export interface RelationalColumnPlan {
    schema: string;
    /** Bare table name, no schema prefix. */
    table: string;
    column: string;
    /** Postgres type, exactly as the DDL generator declares it. */
    type: string;
    /** Absent when the target collection is not part of this bundle. */
    foreignKey?: ForeignKeyPlan;
    /**
     * What this column would have been called before `generateForeignKeyName`
     * learned to singularize — set only when the two differ and the column name
     * is the derived default rather than one the author wrote.
     *
     * Carried so the boot-time ensure can notice a database provisioned under
     * the old rule. It is never used to name anything.
     */
    legacyColumn?: string;
}

/** The table behind a many-to-many `through` relation. */
export interface JunctionTablePlan {
    schema: string;
    /** Bare table name, no schema prefix. */
    table: string;
    columns: { name: string; type: string; legacyName?: string }[];
    /** Both endpoint columns plus the composite primary key. */
    createTable: string;
    foreignKeys: ForeignKeyPlan[];
}

const schemaOfCollection = (collection: CollectionConfig): string =>
    isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";

const bareTableName = (name: string): string => (name.includes(".") ? name.split(".").pop()! : name);

/**
 * Truncate a derived identifier the way Postgres does: to 63 bytes, silently.
 *
 * This is not cosmetic, and not really a naming choice at all — it is agreeing
 * with the name the database ALREADY stored. `ADD CONSTRAINT` on a longer name
 * succeeds and records the truncated form, so the untruncated name this used to
 * derive matched nothing in the catalogue. Boot-ensure compares its planned
 * constraints against `readExistingSchema`, which reads catalogue names, so the
 * comparison could never hit: every boot re-issued `ADD CONSTRAINT` for the same
 * constraint, forever, and got "already exists" every time. Non-fatal (foreign
 * keys are the one action allowed to fail) and therefore permanent — an error in
 * the log on every restart of a project whose table and column names happened to
 * be long.
 *
 * Byte length, not string length: NAMEDATALEN is 64 bytes, and a multi-byte
 * character straddling the boundary would be cut mid-sequence by `slice(0, 63)`.
 */
// Moved to `@rebasepro/utils` so the search-column builder derives index names
// under the same 63-byte rule this file derives constraint names under. Two
// copies of a truncation rule is two rules the moment one of them is edited.

const foreignKeyPlan = (
    args: Omit<ForeignKeyPlan, "constraintName" | "sql"> & { onDelete: string; onUpdate?: string }
): ForeignKeyPlan => {
    const constraintName = toPostgresIdentifier(`${args.table}_${args.column}_fkey`);
    const onUpdate = args.onUpdate ? ` ON UPDATE ${args.onUpdate.toUpperCase()}` : "";
    return {
        constraintName,
        schema: args.schema,
        table: args.table,
        column: args.column,
        targetSchema: args.targetSchema,
        targetTable: args.targetTable,
        targetColumn: args.targetColumn,
        sql:
            `ALTER TABLE "${args.schema}"."${args.table}" ADD CONSTRAINT "${constraintName}" ` +
            `FOREIGN KEY ("${args.column}") REFERENCES "${args.targetSchema}"."${args.targetTable}" ` +
            `("${args.targetColumn}") ON DELETE ${args.onDelete.toUpperCase()}${onUpdate};`
    };
};

/**
 * The FK columns the declared collections own — one entry per `relation`
 * (`belongsTo` side) or `reference` property.
 *
 * Split out of {@link generatePostgresDdl} so the boot-time schema ensure can
 * create the same columns with the same names, types and constraints. Before
 * this it skipped them outright, which was survivable only because `db push`
 * always followed; on a managed tenant nothing follows, so a table arrived
 * without the column its own collection reads and wrote 400 on every insert.
 *
 * A relation whose target is not in the bundle yields no column at all (the
 * generator returns early on an unresolvable target); a `reference` whose target
 * is unknown yields the column without a constraint. Both mirror the generator
 * exactly — a divergence here is a schema fork between boot and `db push`.
 */
export const planRelationalColumns = (allCollections: CollectionConfig[]): RelationalColumnPlan[] => {
    const collections = relationalCollections(allCollections);
    const plans: RelationalColumnPlan[] = [];

    for (const collection of collections) {
        const tableName = getTableName(collection);
        if (!tableName) continue;
        const schema = schemaOfCollection(collection);
        const table = bareTableName(tableName);

        for (const [propName, rawProp] of Object.entries(collection.properties ?? {})) {
            const prop = rawProp as Property;

            if (prop.type === "relation") {
                const refProp = prop as RelationProperty;
                const resolvedRelations = resolveCollectionRelations(collection);
                const relInfo = findRelation(resolvedRelations, refProp.relation?.relationName ?? propName);
                if (relInfo?.kind !== "belongsTo") continue;
                // The relation and an explicit FK property can both be declared;
                // the explicit one owns the column.
                if (collection.properties[relInfo.localKey] && propName !== relInfo.localKey) continue;

                let targetCollection: CollectionConfig;
                try {
                    targetCollection = relInfo.target();
                } catch {
                    continue;
                }
                if (!targetCollection) continue;

                const required = prop.validation?.required;
                // Only a *derived* column name can be affected by the change to
                // `generateForeignKeyName`; one the author wrote is theirs.
                const relationName = refProp.relation?.relationName ?? propName;
                const legacyKey = legacyForeignKeyName(relationName);
                const derived = relInfo.localKey === generateForeignKeyName(relationName);
                plans.push({
                    schema,
                    table,
                    column: relInfo.localKey,
                    legacyColumn: derived && legacyKey !== relInfo.localKey ? legacyKey : undefined,
                    type: getSqlColumnType(propName, prop, collection, collections),
                    foreignKey: foreignKeyPlan({
                        schema,
                        table,
                        column: relInfo.localKey,
                        targetSchema: schemaOfCollection(targetCollection),
                        targetTable: bareTableName(getTableName(targetCollection)),
                        targetColumn: getPrimaryKeyName(targetCollection),
                        onDelete: relInfo.onDelete ?? (required ? "CASCADE" : "SET NULL"),
                        onUpdate: relInfo.onUpdate
                    })
                });
            } else if (prop.type === "reference") {
                const refProp = prop as ReferenceProperty;
                const targetCollection = collections.find(
                    c => c.slug === refProp.path || getTableName(c) === refProp.path
                );
                const column = resolveColumnName(propName, prop);
                const type = getSqlColumnType(propName, prop, collection, collections);
                const required = prop.validation?.required;

                plans.push({
                    schema,
                    table,
                    column,
                    type,
                    foreignKey: targetCollection
                        ? foreignKeyPlan({
                            schema,
                            table,
                            column,
                            targetSchema: schemaOfCollection(targetCollection),
                            targetTable: bareTableName(getTableName(targetCollection)),
                            targetColumn: getPrimaryKeyName(targetCollection),
                            onDelete: required ? "CASCADE" : "SET NULL"
                        })
                        : undefined
                });
            }
        }
    }

    return plans;
};

/**
 * The junction tables a bundle's many-to-many relations imply.
 *
 * Derived from {@link resolveJunctionSpecs}, the same source the junction RLS
 * comes from, so a table created here always has policies planned for it — a
 * junction with row-level security left off is readable and writable by every
 * signed-in user, which is why the two must ship together.
 */
export const planJunctionTables = (allCollections: CollectionConfig[]): JunctionTablePlan[] => {
    const collections = relationalCollections(allCollections);
    const plans: JunctionTablePlan[] = [];

    for (const spec of resolveJunctionSpecs(collections).values()) {
        const [source, target] = spec.endpoints;
        // A junction column's default name is derived from the endpoint
        // collection's slug — which is normally plural, so this is where the
        // singularization change actually lands: a `categories` endpoint used
        // to give `categorie_id` and now gives `category_id`. Recorded, not
        // used, so boot-ensure can recognise a table built under the old rule.
        const legacyFor = (endpoint: typeof source): string | undefined => {
            const slug = toSnakeCase(endpoint.collection.slug ?? endpoint.collection.name ?? "");
            const legacy = legacyForeignKeyName(slug);
            const derived = endpoint.junctionColumn === generateForeignKeyName(slug);
            return derived && legacy !== endpoint.junctionColumn ? legacy : undefined;
        };
        const columns = [
            { name: source.junctionColumn, type: junctionKeyType(source.collection), legacyName: legacyFor(source) },
            { name: target.junctionColumn, type: junctionKeyType(target.collection), legacyName: legacyFor(target) }
        ];
        // Every declaring side agrees on the edge's lifetime; the first one wins,
        // as it does in the generator's walk.
        const onDelete = spec.declaringSides[0]?.relation.onDelete ?? "CASCADE";

        plans.push({
            schema: spec.schema,
            table: spec.table,
            columns,
            createTable:
                `CREATE TABLE IF NOT EXISTS "${spec.schema}"."${spec.table}" (` +
                columns.map(c => `"${c.name}" ${c.type} NOT NULL`).join(", ") +
                `, PRIMARY KEY (${columns.map(c => `"${c.name}"`).join(", ")}));`,
            foreignKeys: [source, target].map((endpoint, i) =>
                foreignKeyPlan({
                    schema: spec.schema,
                    table: spec.table,
                    column: columns[i].name,
                    targetSchema: schemaOfCollection(endpoint.collection),
                    targetTable: bareTableName(getTableName(endpoint.collection)),
                    targetColumn: getPrimaryKeyName(endpoint.collection),
                    onDelete
                })
            )
        });
    }

    return plans;
};

export interface CollectionPolicyPlan {
    /** The table's schema (e.g. `public`, `rebase`). */
    schema: string;
    /** The bare table name, no schema prefix. */
    table: string;
    /** `schema.table` — matches the keys `readExistingSchema` returns. */
    qualified: string;
    /** `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` — locked by default. */
    enableRls: string;
    /** `DROP POLICY IF EXISTS` / `CREATE POLICY` statements, in order. */
    policyStatements: string[];
}

/**
 * The per-table RLS plan for the *declared* collections, as executable
 * statements — what the managed runtime applies at boot so a freshly
 * provisioned tenant database serves data instead of 401ing every read.
 *
 * Mirrors {@link generatePostgresPoliciesDdl} exactly (same
 * `generatePolicyStatements`, same enable-RLS, same effective rules, same
 * derived junction rules), so boot and `db push` produce identical policies from
 * identical collections.
 *
 * Junction tables are included, and have to be: boot creates them now
 * ({@link planJunctionTables}), and a junction with RLS left off is readable and
 * writable by every signed-in user. A junction whose table is still absent is
 * skipped by the applier, not planned away here.
 */
export const planCollectionPolicies = (allCollections: CollectionConfig[]): CollectionPolicyPlan[] => {
    // A store with no RLS gets no policies planned for it — `supportsRLS` is
    // false for exactly the engines `relationalCollections` filters out.
    const collections = relationalCollections(allCollections);
    const resolveCollection: ResolveCollection = (slug) => collections.find(c => c.slug === slug || getTableName(c) === slug);
    const plans: CollectionPolicyPlan[] = [];
    const seen = new Set<string>();

    for (const collection of collections) {
        const tableName = getTableName(collection);
        if (!tableName) continue;
        const schema = isPostgresCollectionConfig(collection) && collection.schema ? collection.schema : "public";
        const baseTableName = tableName.includes(".") ? tableName.split(".").pop()! : tableName;
        const qualified = `${schema}.${baseTableName}`;
        if (seen.has(qualified)) continue;
        seen.add(qualified);

        const policyStatements: string[] = [];
        for (const rule of getEffectiveSecurityRules(collection)) {
            policyStatements.push(...generatePolicyStatements(collection, rule, resolveCollection));
        }

        plans.push({
            schema,
            table: baseTableName,
            qualified,
            enableRls: `ALTER TABLE "${schema}"."${baseTableName}" ENABLE ROW LEVEL SECURITY;`,
            policyStatements
        });
    }

    // Junctions are derived from `through` relations rather than declared, so
    // the walk above never sees them.
    for (const spec of resolveJunctionSpecs(collections).values()) {
        const qualified = `${spec.schema}.${spec.table}`;
        if (seen.has(qualified)) continue;
        seen.add(qualified);

        const junctionCollection = getJunctionCollectionConfig(spec);
        const policyStatements: string[] = [];
        for (const rule of getJunctionSecurityRules(spec)) {
            policyStatements.push(...generatePolicyStatements(junctionCollection, rule, resolveCollection));
        }

        plans.push({
            schema: spec.schema,
            table: spec.table,
            qualified,
            enableRls: `ALTER TABLE "${spec.schema}"."${spec.table}" ENABLE ROW LEVEL SECURITY;`,
            policyStatements
        });
    }

    return plans;
};

export const generatePostgresPoliciesDdl = (allCollections: CollectionConfig[]): string => {
    // Also the expectation `checkPolicyDrift` reconciles the database against,
    // so a non-SQL collection filtered out here is one the drift report cannot
    // invent a missing policy for.
    const collections = relationalCollections(allCollections);
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

