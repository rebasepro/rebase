/**
 * Introspection logic — pure functions and the pipeline that transforms
 * raw PostgreSQL metadata into Rebase collection definition files.
 *
 * This module contains NO side-effects: no fs writes, no pg.Client creation,
 * no process.exit.  It is imported by introspect-db.ts (the CLI entry-point)
 * and consumed directly by tests.
 */

// ── Typed interfaces for SQL query results ────────────────────────────

export interface TableRow {
    table_name: string;
}

export interface TableColumn {
    table_name: string;
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
}

export interface EnumValue {
    enum_name: string;
    enum_value: string;
    sort_order: number;
}

export interface PrimaryKeyRow {
    table_name: string;
    column_name: string;
}

export interface ForeignKeyRow {
    table_name: string;
    column_name: string;
    foreign_table_name: string;
    foreign_column_name: string;
}

export interface TableMeta {
    name: string;
    columns: TableColumn[];
    pks: string[];
    fks: ForeignKeyRow[];
}

// ── Irregular plurals that naive rules can't handle ───────────────────

const IRREGULAR_SINGULARS: Record<string, string> = {
    people: "person",
    children: "child",
    men: "man",
    women: "woman",
    mice: "mouse",
    geese: "goose",
    teeth: "tooth",
    feet: "foot",
    data: "datum",
    media: "medium",
    criteria: "criterion",
    phenomena: "phenomenon",
};

/** Words ending in 's' that are already singular. */
const UNCOUNTABLE = new Set([
    "status", "campus", "virus", "bus", "plus", "census",
    "diagnosis", "analysis", "basis", "crisis", "thesis",
    "synopsis", "parenthesis", "hypothesis", "emphasis",
    "news", "series", "species", "means", "athletics",
    "economics", "electronics", "mathematics", "physics",
    "politics", "statistics",
]);

export function singularize(word: string): string {
    const lower = word.toLowerCase();

    // Check irregular forms
    if (IRREGULAR_SINGULARS[lower]) {
        // Preserve the original casing of the first character
        const singular = IRREGULAR_SINGULARS[lower];
        return word[0] === word[0].toUpperCase()
            ? singular.charAt(0).toUpperCase() + singular.slice(1)
            : singular;
    }

    // Check uncountable
    if (UNCOUNTABLE.has(lower)) return word;

    // Latin/Greek -es endings (diagnosis -> diagnosis is uncountable, but "addresses" -> "address")
    if (lower.endsWith("ices") && lower.length > 5) {
        // e.g. "indices" -> "index", "vertices" -> "vertex"
        return word.slice(0, -4) + "ex";
    }
    if (lower.endsWith("ies") && lower.length > 3) {
        return word.slice(0, -3) + "y";
    }
    if (lower.endsWith("ves")) {
        // e.g. "wolves" -> "wolf", "leaves" -> "leaf"
        return word.slice(0, -3) + "f";
    }
    if (lower.endsWith("ches") || lower.endsWith("shes") || lower.endsWith("sses") || lower.endsWith("xes") || lower.endsWith("zes")) {
        return word.slice(0, -2);
    }
    if (lower.endsWith("ses") && !lower.endsWith("sses")) {
        // e.g. "responses" -> "response", "databases" -> "database"
        return word.slice(0, -1);
    }
    if (lower.endsWith("s") && !lower.endsWith("ss") && !lower.endsWith("us") && !lower.endsWith("is")) {
        return word.slice(0, -1);
    }

    return word;
}

/**
 * Convert a snake_case name to a human-readable Title Case label.
 * e.g. "created_at" -> "Created At", "customer_id" -> "Customer Id"
 */
export function humanize(snakeName: string): string {
    return snakeName
        .replace(/_/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Convert a snake_case table name to a camelCase + "Collection" variable name.
 * e.g. "company_token" -> "companyTokenCollection"
 */
export function toCollectionVarName(tableName: string): string {
    return tableName.replace(/_([a-z])/g, (_g, letter: string) => letter.toUpperCase()) + "Collection";
}

export function getIconForTable(tableName: string): string {
    const table = tableName.toLowerCase();
    if (table.includes("user") || table.includes("account") || table.includes("member") || table.includes("customer") || table.includes("client") || table.includes("patient")) return "Users";
    if (table.includes("post") || table.includes("article") || table.includes("blog") || table.includes("page")) return "FileText";
    if (table.includes("product") || table.includes("item")) return "Package";
    if (table.includes("order") || table.includes("cart") || table.includes("purchase") || table.includes("invoice")) return "ShoppingCart";
    if (table.includes("setting") || table.includes("config")) return "Settings";
    if (table.includes("tag") || table.includes("categor")) return "Tag";
    if (table.includes("image") || table.includes("photo") || table.includes("media") || table.includes("asset")) return "Image";
    if (table.includes("notification") || table.includes("message") || table.includes("email")) return "Mail";
    if (table.includes("log") || table.includes("audit") || table.includes("event")) return "Activity";
    if (table.includes("subscription") || table.includes("plan") || table.includes("billing")) return "CreditCard";
    if (table.includes("comment") || table.includes("review") || table.includes("feedback")) return "MessageCircle";
    return "Database";
}

/**
 * Map a PostgreSQL data type to a Rebase property type.
 */
export function mapPgType(dataType: string): string {
    const dt = dataType.toLowerCase();

    // Interval MUST be checked before numeric ("interval" contains "int")
    if (dt === "interval") return "string";

    // Array types MUST be checked before numeric ("_int4" contains "int")
    if (dt === "array" || dt.startsWith("_")) return "json";

    // Numeric types
    if (
        dt.includes("int") ||        // integer, smallint, bigint
        dt.includes("numeric") ||
        dt.includes("decimal") ||
        dt.includes("serial") ||     // serial, bigserial
        dt === "real" ||
        dt === "float4" ||
        dt === "float8" ||
        dt === "double precision" ||
        dt === "money"
    ) {
        return "number";
    }

    // Boolean
    if (dt.includes("bool")) return "boolean";

    // Date / Time
    if (dt.includes("time") || dt.includes("date")) return "date";

    // JSON
    if (dt === "json" || dt === "jsonb") return "json";

    // Binary
    if (dt === "bytea") return "string";

    // Network types
    if (dt === "inet" || dt === "cidr" || dt === "macaddr" || dt === "macaddr8") return "string";

    // UUID
    if (dt === "uuid") return "string";

    // Text/varchar/char — default to string
    return "string";
}

// ── Build the enum map from query results ─────────────────────────────

export function buildEnumMap(enumValues: EnumValue[]): Map<string, string[]> {
    const enumMap = new Map<string, string[]>();
    for (const ev of enumValues) {
        const existing = enumMap.get(ev.enum_name);
        if (existing) {
            existing.push(ev.enum_value);
        } else {
            enumMap.set(ev.enum_name, [ev.enum_value]);
        }
    }
    return enumMap;
}

// ── Build the tables map from raw query results ───────────────────────

export function buildTablesMap(
    tables: TableRow[],
    columns: TableColumn[],
    pks: PrimaryKeyRow[],
    fks: ForeignKeyRow[]
): Map<string, TableMeta> {
    const tablesMap = new Map<string, TableMeta>();
    for (const t of tables) {
        tablesMap.set(t.table_name, {
            name: t.table_name,
            columns: columns.filter((c) => c.table_name === t.table_name),
            pks: pks.filter((pk) => pk.table_name === t.table_name).map((pk) => pk.column_name),
            fks: fks.filter((fk) => fk.table_name === t.table_name)
        });
    }
    return tablesMap;
}

// ── Identify join tables ──────────────────────────────────────────────

export function identifyJoinTables(tablesMap: Map<string, TableMeta>): Set<string> {
    const joinTables = new Set<string>();
    for (const [tableName, meta] of tablesMap.entries()) {
        if (meta.fks.length === 2) {
            const isLikelyJoinTable = meta.columns.every((c) =>
                meta.fks.some((fk) => fk.column_name === c.column_name) ||
                c.column_name === "id" ||
                c.column_name === "created_at" ||
                c.column_name === "updated_at"
            );

            if (isLikelyJoinTable) {
                joinTables.add(tableName);
            }
        }
    }
    return joinTables;
}

// ── Generate collection file content ──────────────────────────────────

export interface GeneratedFile {
    tableName: string;
    fileName: string;
    content: string;
}

/**
 * Generate the full TypeScript file content for a single collection.
 * Pure function — no I/O.
 */
export function generateCollectionFile(
    tableName: string,
    meta: TableMeta,
    allFks: ForeignKeyRow[],
    joinTables: Set<string>,
    tablesMap: Map<string, TableMeta>,
    enumMap: Map<string, string[]>,
): string {
    const collectionName = humanize(tableName);
    const singular = singularize(collectionName);
    const icon = getIconForTable(tableName);

    const imports = new Set<string>(['import { PostgresCollection } from "@rebasepro/types";']);

    let propsOutput = ``;
    const propertiesOrder: string[] = [];

    // Detect composite primary keys
    const isCompositePk = meta.pks.length > 1;

    // Map columns
    for (const col of meta.columns) {
        // Skip foreign keys since we handle them as relations
        if (meta.fks.some((fk) => fk.column_name === col.column_name)) continue;

        propertiesOrder.push(col.column_name);

        // Check if this column uses a PostgreSQL enum type
        const colEnumValues = enumMap.get(col.udt_name);
        const isEnumColumn = col.data_type === "USER-DEFINED" && colEnumValues !== undefined;

        const propType = isEnumColumn ? "string" : mapPgType(col.data_type);
        let extra = "";

        const colNameLower = col.column_name.toLowerCase();

        // Enum values — generate real enumValues from the PG enum
        if (isEnumColumn && colEnumValues) {
            const enumEntries = colEnumValues
                .map((v) => `{ id: "${v}", label: "${humanize(v)}" }`)
                .join(", ");
            extra = `\n            enumValues: [${enumEntries}],`;
        }

        // Date auto-value heuristics
        if (propType === "date") {
            if (colNameLower === "created_at" || colNameLower === "createdat") {
                extra = `\n            autoValue: "on_create",\n            readOnly: true,\n            hideFromCollection: true,`;
            } else if (colNameLower === "updated_at" || colNameLower === "updatedat") {
                extra = `\n            autoValue: "on_update",\n            readOnly: true,\n            hideFromCollection: true,`;
            } else if (col.column_default && (col.column_default.includes("now()") || col.column_default.includes("CURRENT_TIMESTAMP"))) {
                extra = `\n            autoValue: "on_create",\n            readOnly: true,`;
            }
        }

        // String sub-type heuristics (skip if already handled as enum)
        if (propType === "string" && !isEnumColumn) {
            if (colNameLower.includes("image") || colNameLower.includes("avatar") || colNameLower.includes("photo") || colNameLower.includes("logo") || colNameLower.includes("cover")) {
                extra = `\n            storage: {\n                storagePath: "${tableName}/${col.column_name}"\n            },`;
            } else if (colNameLower === "description" || colNameLower === "summary" || colNameLower === "excerpt") {
                extra = `\n            multiline: true,`;
            } else if (colNameLower === "content" || colNameLower === "body") {
                extra = `\n            multiline: true,\n            markdown: true,`;
            } else if (col.data_type === "text") {
                extra = `\n            multiline: true,`;
            }
        }

        // Identify IDs
        if (meta.pks.includes(col.column_name)) {
            if (isCompositePk) {
                extra += `\n            // Part of composite primary key (${meta.pks.join(", ")})`;
            } else if (propType === "number") {
                extra += `\n            isId: "increment",`;
            } else if (col.data_type.toLowerCase() === "uuid") {
                extra += `\n            isId: "uuid",`;
            } else {
                extra += `\n            isId: "uuid", // Verify if this is a UUID or CUID`;
            }
        }

        if (col.is_nullable === "NO" && !meta.pks.includes(col.column_name) && !col.column_default) {
            extra += `\n            validation: {\n                required: true\n            },`;
        }

        const humanName = humanize(col.column_name);

        propsOutput += `
        ${col.column_name}: {
            name: "${humanName}",
            type: "${propType}",${extra}
        },`;
    }

    // Map Owning Relations (from this table's FKs to other tables)
    for (const fk of meta.fks) {
        const targetTableName = fk.foreign_table_name;
        if (!joinTables.has(targetTableName)) {
            const relName = fk.column_name.replace(/_id$/, "");
            // Push the relation property key, not the FK column name
            propertiesOrder.push(relName);

            const targetCollectionCamel = toCollectionVarName(targetTableName);
            imports.add(`import ${targetCollectionCamel} from "./${targetTableName}";`);

            const relHumanName = humanize(relName);

            propsOutput += `
        ${relName}: {
            name: "${relHumanName}",
            type: "relation",
            target: () => ${targetCollectionCamel},
            cardinality: "one",
            direction: "owning",
            localKey: "${fk.column_name}",
            // mapped from foreign key: ${fk.column_name} -> ${targetTableName}(${fk.foreign_column_name})
        },`;
        }
    }

    // Map Inverse Relations (1-to-many where OTHER table points to THIS table)
    const inverseFks = allFks.filter((fk) => fk.foreign_table_name === tableName && !joinTables.has(fk.table_name));
    for (const fk of inverseFks) {
        const sourceTableName = fk.table_name;
        propertiesOrder.push(sourceTableName);

        const targetCollectionCamel = toCollectionVarName(sourceTableName);
        imports.add(`import ${targetCollectionCamel} from "./${sourceTableName}";`);

        const inverseRelName = fk.column_name.replace(/_id$/, "");
        const relHumanName = humanize(sourceTableName);

        propsOutput += `
        ${sourceTableName}: {
            name: "${relHumanName}",
            type: "relation",
            target: () => ${targetCollectionCamel},
            cardinality: "many",
            direction: "inverse",
            inverseRelationName: "${inverseRelName}",
            foreignKeyOnTarget: "${fk.column_name}"
        },`;
    }

    // Map Many-to-Many Relations (Join Tables)
    const relatedJoinTables = Array.from(joinTables).filter((jt) => {
        const jtMeta = tablesMap.get(jt);
        return jtMeta ? jtMeta.fks.some((fk) => fk.foreign_table_name === tableName) : false;
    });

    for (const jt of relatedJoinTables) {
        const jtMeta = tablesMap.get(jt);
        if (!jtMeta) continue;

        const joinFks = jtMeta.fks;

        // Handle self-referencing M2M: both FKs point to the same table
        const selfRefFks = joinFks.filter((fk) => fk.foreign_table_name === tableName);
        if (selfRefFks.length === 2) {
            // Self-referencing M2M — generate a single owning relation
            const thisFk = selfRefFks[0];
            const otherFk = selfRefFks[1];

            const relPropName = `${tableName}_via_${otherFk.column_name.replace(/_id$/, "")}`;
            propertiesOrder.push(relPropName);

            // Self-ref: import is the same collection (use a lazy reference)
            const relHumanName = humanize(otherFk.column_name.replace(/_id$/, ""));

            propsOutput += `
        ${relPropName}: {
            name: "${relHumanName}",
            type: "relation",
            target: () => ${tableName}Collection,
            cardinality: "many",
            direction: "owning",
            through: {
                table: "${jt}",
                sourceColumn: "${thisFk.column_name}",
                targetColumn: "${otherFk.column_name}"
            }
        },`;
            continue;
        }

        const otherFk = joinFks.find((fk) => fk.foreign_table_name !== tableName);

        if (otherFk) {
            const targetTableName = otherFk.foreign_table_name;
            propertiesOrder.push(targetTableName);

            const targetCollectionCamel = toCollectionVarName(targetTableName);
            imports.add(`import ${targetCollectionCamel} from "./${targetTableName}";`);

            // Determine direction (alphabetically first table is owning)
            const direction = tableName < targetTableName ? "owning" : "inverse";

            const thisFk = joinFks.find((fk) => fk.foreign_table_name === tableName);
            const relHumanName = humanize(targetTableName);

            let throughCode = "";
            if (direction === "owning" && thisFk) {
                throughCode = `\n            through: {\n                table: "${jt}",\n                sourceColumn: "${thisFk.column_name}",\n                targetColumn: "${otherFk.column_name}"\n            }`;
            } else if (direction === "inverse") {
                throughCode = `\n            // Make sure the target collection configures the 'through' property.`;
            }

            propsOutput += `
        ${targetTableName}: {
            name: "${relHumanName}",
            type: "relation",
            target: () => ${targetCollectionCamel},
            cardinality: "many",
            direction: "${direction}",${throughCode}
        },`;
        }
    }

    const fileContent = `${Array.from(imports).join("\n")}

const ${tableName}Collection: PostgresCollection = {
    name: "${collectionName}",
    singularName: "${singular}",
    slug: "${tableName}",
    table: "${tableName}",
    icon: "${icon}",
    group: "App",
    properties: {${propsOutput}
    },
    propertiesOrder: ${JSON.stringify(propertiesOrder, null, 8).replace(/]$/, "    ]")}
};

export default ${tableName}Collection;
`;

    return fileContent;
}

/**
 * Generate the content for an index.ts file that re-exports all collections.
 */
export function generateIndexContent(fileNames: string[]): string {
    const sorted = [...fileNames].sort();
    let content = "";
    for (const f of sorted) {
        content += `export { default as ${f} } from "./${f}";\n`;
    }
    return content;
}

/**
 * Merge new exports into existing index.ts content.
 * Returns the merged content string.
 */
export function mergeIndexContent(existingContent: string, newFileNames: string[]): string {
    const existingExports = new Set(
        [...existingContent.matchAll(/export\s+\{[^}]+\}\s+from\s+"\.\/([^"]+)"/g)].map((m) => m[1])
    );
    const sorted = [...newFileNames].sort();
    let merged = existingContent.trimEnd() + "\n";
    for (const f of sorted) {
        if (!existingExports.has(f)) {
            merged += `export { default as ${f} } from "./${f}";\n`;
        }
    }
    return merged;
}

/**
 * Safely extract the host portion of a database URL for logging.
 */
export function safeHostFromUrl(url: string): string {
    return url.includes("@") ? url.split("@")[1] : "(local connection)";
}
