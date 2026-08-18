import { rewriteLegacyRlsFunctions } from "@rebasepro/types";
import type {
    ArrayProperty,
    NumberProperty,
    PostgresProperties,
    Property,
    Relation,
    SecurityOperation,
    SecurityRule,
    StringProperty,
    TableColumnInfo,
    TableMetadata
} from "@rebasepro/types";
import { firstFreeKey, prettifyIdentifier, toWireKey } from "@rebasepro/utils";

/**
 * A collection as introspection can describe it: the table, its columns, the
 * relations its foreign keys imply, and the RLS policies already on it.
 *
 * Deliberately not `Partial<AdminCollection>`, which is what this returned
 * while it lived in `@rebasepro/studio`. `propertiesOrder` is the only admin
 * key it produces, and naming the admin view model for one field would put
 * `@rebasepro/admin-types` on the dependency path of a package the backend
 * loads.
 */
export interface IntrospectedCollection {
    name: string;
    slug: string;
    table: string;
    properties: PostgresProperties;
    propertiesOrder: string[];
    relations?: Relation[];
    securityRules?: SecurityRule[];
}

/**
 * Maps a PostgreSQL column data type to a Rebase property type.
 */
function pgTypeToRebaseProperty(column: TableColumnInfo): Property | null {
    const {
        column_name,
        data_type,
        udt_name,
        is_nullable,
        column_default,
        character_maximum_length,
        enum_values
    } = column;

    const required = is_nullable === "NO";
    const prettifiedName = prettifyIdentifier(column_name);

    // Detect if this column is a primary key (auto-generated id)
    const isAutoId = column_default != null && (
        column_default.includes("nextval") ||
        column_default.includes("gen_random_uuid") ||
        column_default.includes("uuid_generate") ||
        column_default.includes("identity")
    );

    // USER-DEFINED = PostgreSQL enums
    if (data_type === "USER-DEFINED" && enum_values && enum_values.length > 0) {
        return {
            type: "string",
            name: prettifiedName,
            enum: enum_values.map((v: string) => ({ id: v,
label: prettifyIdentifier(v) })),
            validation: required ? { required: true } : undefined
        } as StringProperty;
    }

    const dt = data_type.toLowerCase();
    switch (dt) {
        case "character varying":
        case "varchar":
        case "text":
        case "char":
        case "character":
        case "citext": {
            let colType: "varchar" | "text" | "char" = "varchar";
            if (dt === "text" || dt === "citext") colType = "text";
            if (dt === "char" || dt === "character") colType = "char";
            // Carry the declared width across. Dropping it made introspection
            // lossy in the one direction that costs data: a `character
            // varying(500)` column read back as a bare `varchar` regenerates as
            // `VARCHAR(255)`, narrowing a column that already holds longer
            // values. TEXT has no width, and reporting one would invent a limit
            // the database does not have.
            const declaredLength = colType === "text" ? null : character_maximum_length;
            const prop: StringProperty = {
                type: "string",
                name: prettifiedName,
                columnType: colType,
                validation: required || declaredLength
                    ? {
                        ...(required ? { required: true } : {}),
                        ...(declaredLength ? { max: declaredLength } : {})
                    }
                    : undefined
            };
            if (isAutoId) {
                prop.isId = "manual";
            }
            return prop;
        }

        case "uuid": {
            const prop: StringProperty = {
                type: "string",
                name: prettifiedName,
                validation: required ? { required: true } : undefined
            };
            if (isAutoId) {
                prop.isId = "uuid";
            }
            return prop;
        }

        case "integer":
        case "bigint":
        case "smallint": {
            const colType = dt === "bigint" ? "bigint" : "integer";
            const prop: NumberProperty = {
                type: "number",
                name: prettifiedName,
                columnType: colType,
                validation: {
                    ...(required ? { required: true } : {}),
                    integer: true
                }
            };
            if (isAutoId) {
                prop.isId = "increment";
            }
            return prop;
        }

        case "serial":
        case "bigserial":
        case "smallserial": {
            const colType = dt === "bigserial" ? "bigserial" : "serial";
            return {
                type: "number",
                name: prettifiedName,
                columnType: colType,
                isId: "increment",
                validation: {
                    ...(required ? { required: true } : {}),
                    integer: true
                }
            } as NumberProperty;
        }

        case "numeric":
        case "decimal":
        case "real":
        case "double precision": {
            let colType: "numeric" | "real" | "double precision" = "numeric";
            if (dt === "real") colType = "real";
            if (dt === "double precision") colType = "double precision";
            return {
                type: "number",
                name: prettifiedName,
                columnType: colType,
                validation: required ? { required: true } : undefined
            };
        }

        case "boolean":
            return {
                type: "boolean",
                name: prettifiedName,
                validation: required ? { required: true } : undefined
            };

        case "timestamp with time zone":
        case "timestamp without time zone":
        case "timestamp":
        case "timestamptz":
        case "date":
        case "time with time zone":
        case "time without time zone":
        case "time": {
            let colType: "timestamp" | "date" | "time" = "timestamp";
            if (dt.startsWith("date")) colType = "date";
            if (dt.startsWith("time ") || dt === "time") colType = "time";
            return {
                type: "date",
                name: prettifiedName,
                columnType: colType,
                validation: required ? { required: true } : undefined
            };
        }

        case "jsonb":
        case "json":
            return {
                type: "map",
                name: prettifiedName,
                columnType: dt === "jsonb" ? "jsonb" : "json",
                keyValue: true,
                properties: {}
            };

        case "array":
        case "ARRAY": {
            let innerType = "string";
            let colType: ArrayProperty["columnType"] = undefined;
            if (udt_name === "_text" || udt_name === "_varchar") {
                innerType = "string";
                colType = "text[]";
            } else if (udt_name === "_int4" || udt_name === "_int2" || udt_name === "_int8") {
                innerType = "number";
                colType = "integer[]";
            } else if (udt_name === "_bool") {
                innerType = "boolean";
                colType = "boolean[]";
            } else if (udt_name === "_numeric") {
                innerType = "number";
                colType = "numeric[]";
            }
            return {
                type: "array",
                name: prettifiedName,
                columnType: colType,
                of: { type: innerType }
            } as ArrayProperty;
        }

        default:
            // Fallback: treat unknown types as string
            return {
                type: "string",
                name: prettifiedName,
                validation: required ? { required: true } : undefined
            };
    }
}

/**
 * Builds a collection description from PostgreSQL table metadata.
 * This is used when creating a new collection from an existing database table.
 */
export function buildCollectionFromTableMetadata(
    tableName: string,
    metadata: TableMetadata
): IntrospectedCollection {
    const properties: Record<string, Property> = {};
    const propertiesOrder: string[] = [];
    // Introspection can only ever produce two shapes: a foreign key on this
    // table, or a junction between two. Both are named by their kind.
    const relations: Array<{
        id: string;
        relationName: string;
        target: string;
        kind: "belongsTo" | "manyToMany";
        localKey?: string;
        through?: { table: string; sourceColumn: string; targetColumn: string };
    }> = [];
    const securityRules: SecurityRule[] = [];

    // Parse columns
    for (const column of metadata.columns) {
        const property = pgTypeToRebaseProperty(column);
        if (property) {
            const propRecord = property as unknown as Record<string, unknown>;
            Object.keys(propRecord).forEach(key => propRecord[key] === undefined && delete propRecord[key]);

            // The key is the wire name; `columnName` carries the column. This
            // used to key by the column and rely on the two being the same
            // string, which is what put `user_id` on the API of an imported
            // collection and `displayName` on the API of an authored one.
            //
            // `columnName` is stamped unconditionally rather than left to the
            // snake_case default, because the default is not the inverse of
            // camel-casing for every name — the mapping has to be recorded, not
            // recomputed.
            //
            // First free candidate: `user_id` and `userId` as two real columns
            // camel-case to one key, and one of them would otherwise overwrite
            // the other and be silently dropped.
            const key = firstFreeKey(
                [toWireKey(column.column_name), column.column_name],
                { has: (candidate: string) => candidate in properties }
            );
            if (key !== column.column_name) propRecord.columnName = column.column_name;
            properties[key] = property;
            propertiesOrder.push(key);
        }
    }

    // Parse Outgoing Foreign Keys -> Many-to-One / One-to-One
    if (metadata.foreignKeys) {
        for (const fk of metadata.foreignKeys) {
            const relName = toWireKey(
                fk.column_name.endsWith("_id")
                    ? fk.column_name.substring(0, fk.column_name.length - 3)
                    : fk.column_name
            );
            relations.push({
                id: fk.column_name,
                relationName: relName,
                target: fk.foreign_table_name, // Will be hydrated later
                kind: "belongsTo",
                localKey: fk.column_name
            });
        }
    }

    // Parse Incoming Junctions -> Many-to-Many
    if (metadata.junctions) {
        for (const junction of metadata.junctions) {
            const relName = junction.target_table_name; // E.g., 'roles'
            relations.push({
                id: junction.target_table_name + "_relation",
                relationName: relName,
                target: junction.target_table_name, // Will be hydrated later
                kind: "manyToMany",
                through: {
                    table: junction.junction_table_name,
                    sourceColumn: junction.source_column_name,
                    targetColumn: junction.target_column_name
                }
            });
        }
    }

    // Parse RLS Policies
    if (metadata.policies) {
        for (const policy of metadata.policies) {
            // Attempt to map typical cmds to operations.
            // Postgres cmd: SELECT, INSERT, UPDATE, DELETE, ALL
            let operations: SecurityOperation[] = [];
            switch (policy.cmd) {
                case "ALL": operations = ["all"]; break;
                case "SELECT": operations = ["select"]; break;
                case "INSERT": operations = ["insert"]; break;
                case "UPDATE": operations = ["update"]; break;
                case "DELETE": operations = ["delete"]; break;
            }
            // Normalised on the way in, the same way `sqlToPolicy` normalises
            // what the admin UI reads back. Without it, importing a table from a
            // database provisioned before 1.0 copies `auth.uid()` straight into
            // the project's config — a call to a function the framework no
            // longer creates, which then boots with a legacy-helper warning
            // forever and holds the `auth` schema open.
            const qual = policy.qual ? rewriteLegacyRlsFunctions(policy.qual) : undefined;
            const withCheck = policy.with_check ? rewriteLegacyRlsFunctions(policy.with_check) : undefined;
            if (qual) {
                securityRules.push({
                    name: policy.policy_name,
                    operations,
                    roles: policy.roles ?? [],
                    using: qual,
                    ...(withCheck ? { withCheck } : {})
                });
            } else {
                securityRules.push({
                    name: policy.policy_name,
                    operations,
                    roles: policy.roles ?? []
                });
            }
        }
    }

    return {
        name: prettifyIdentifier(tableName),
        slug: tableName,
        table: tableName,
        properties: properties as PostgresProperties,
        propertiesOrder,
        // `target` is still a slug here — the caller hydrates it into a thunk.
        ...(relations.length > 0 ? { relations: relations as unknown as Relation[] } : {}),
        ...(securityRules.length > 0 ? { securityRules } : {})
    };
}
