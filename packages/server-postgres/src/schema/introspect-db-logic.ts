/**
 * Introspection logic — pure functions and the pipeline that transforms
 * raw PostgreSQL metadata into Rebase collection definition files.
 *
 * This module contains NO side-effects: no fs writes, no pg.Client creation,
 * no process.exit.  It is imported by introspect-db.ts (the CLI entry-point)
 * and consumed directly by tests.
 */
import { inferPropertyFromData } from "./introspect-db-inference";
import { humanize } from "./introspect-db-naming";

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
    atttypmod: number | null;
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
    phenomena: "phenomenon"
};

/** Words ending in 's' that are already singular. */
const UNCOUNTABLE = new Set([
    "status", "campus", "virus", "bus", "plus", "census",
    "diagnosis", "analysis", "basis", "crisis", "thesis",
    "synopsis", "parenthesis", "hypothesis", "emphasis",
    "news", "series", "species", "means", "athletics",
    "economics", "electronics", "mathematics", "physics",
    "politics", "statistics"
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
    if (dt === "array" || dt.startsWith("_")) return "array";

    // Numeric types
    if (
        dt.includes("int") || // integer, smallint, bigint
        dt.includes("numeric") ||
        dt.includes("decimal") ||
        dt.includes("serial") || // serial, bigserial
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
    if (dt === "json" || dt === "jsonb") return "map";

    // Binary
    if (dt === "bytea") return "binary";

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

// ── Property ordering heuristics ──────────────────────────────────────

/**
 * Property metadata used to compute display priority.
 * Keeps computePropertyPriority free of any TableMeta coupling.
 */
export interface PropertyOrderingContext {
    /** The resolved Rebase property type (e.g. "string", "number", "date", "relation"). */
    propType: string;
    /** Whether this column is a primary key. */
    isPk: boolean;
    /** Whether this column is an enum (USER-DEFINED with matching values). */
    isEnum: boolean;
    /** Whether this is a storage/file-upload field (detected from column name). */
    isStorage: boolean;
    /** The PostgreSQL data_type (e.g. "text", "character varying", "jsonb"). */
    pgDataType: string;
    /** The original column index in PostgreSQL (for stable tiebreaking). */
    originalIndex: number;
}

// — Tier 0: Identity (0–9) ————————————————————————————————————————————
const IDENTITY_EXACT: Record<string, number> = {
    id: 0,
    uuid: 1,
    _id: 2
};

// — Tier 1: Title / Name — the "display column" (10–19) ———————————————
const TITLE_EXACT: Record<string, number> = {
    name: 10,
    title: 11,
    label: 12,
    display_name: 13,
    displayname: 13,
    headline: 14,
    subject: 15,
    heading: 16
};

// — Tier 2: Human identity fields (20–29) —————————————————————————————
const HUMAN_IDENTITY_EXACT: Record<string, number> = {
    first_name: 20,
    firstname: 20,
    last_name: 21,
    lastname: 21,
    full_name: 22,
    fullname: 22,
    given_name: 22,
    family_name: 23,
    middle_name: 24,
    username: 25,
    user_name: 25,
    email: 26,
    email_address: 26,
    phone: 27,
    phone_number: 27,
    mobile: 27
};

// — Tier 3: Core descriptors (30–39) ——————————————————————————————————
const DESCRIPTOR_EXACT: Record<string, number> = {
    slug: 30,
    code: 31,
    sku: 32,
    reference: 33,
    ref: 33,
    type: 34,
    kind: 34,
    status: 35,
    state: 35,
    role: 36,
    category: 37,
    group: 38,
    priority: 39,
    order: 39,
    sort_order: 39,
    position: 39
};

// — Tier 12: System timestamps (120–129) ——————————————————————————————
const SYSTEM_TIMESTAMP_EXACT: Record<string, number> = {
    created_at: 120,
    createdat: 120,
    creation_date: 120,
    inserted_at: 121,
    updated_at: 122,
    updatedat: 122,
    modified_at: 122,
    last_modified: 122,
    deleted_at: 123,
    deletedat: 123,
    archived_at: 124
};

// — Pattern-based rules for partial matches ———————————————————————————
const TITLE_PATTERNS = ["name", "title", "label"];
const LONG_TEXT_NAMES = new Set(["description", "summary", "excerpt", "abstract", "overview", "bio", "biography", "about"]);
const RICH_CONTENT_NAMES = new Set(["content", "body", "html", "markup", "text", "article_body", "post_body"]);
const MEDIA_PATTERNS = ["image", "avatar", "photo", "logo", "cover", "thumbnail", "banner", "icon", "picture", "poster"];
const JSON_MAP_NAMES = new Set(["metadata", "meta", "config", "configuration", "settings", "options", "preferences", "data", "payload", "attributes", "extra", "additional_info"]);

/**
 * Compute a numeric priority score for a property.
 * Lower scores appear first in the generated `propertiesOrder` array.
 *
 * The system uses 14 tiers (0–139), with the original column index
 * added as a fractional tiebreaker (originalIndex / 10000) to
 * guarantee stable ordering within the same tier.
 *
 * Pure function — no side effects.
 */
export function computePropertyPriority(
    columnName: string,
    ctx: PropertyOrderingContext
): number {
    // Normalize camelCase/PascalCase to snake_case, then lowercase
    const col = columnName.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
    const tiebreaker = ctx.originalIndex / 10000;

    // ── Tier 0: Primary key identity fields
    if (ctx.isPk) {
        const exactScore = IDENTITY_EXACT[col];
        return (exactScore ?? 5) + tiebreaker;
    }

    // ── Tier 12: System timestamps (check early to prevent false matches)
    const systemTs = SYSTEM_TIMESTAMP_EXACT[col];
    if (systemTs !== undefined) {
        return systemTs + tiebreaker;
    }

    // ── Tier 1: Title / Name exact matches
    const titleExact = TITLE_EXACT[col];
    if (titleExact !== undefined) {
        return titleExact + tiebreaker;
    }

    // ── Tier 2: Human identity exact matches
    const humanExact = HUMAN_IDENTITY_EXACT[col];
    if (humanExact !== undefined) {
        return humanExact + tiebreaker;
    }

    // ── Tier 3: Core descriptor exact matches
    const descriptorExact = DESCRIPTOR_EXACT[col];
    if (descriptorExact !== undefined) {
        return descriptorExact + tiebreaker;
    }

    // ── Tier 1b: Title-like partial matches (e.g. "product_name", "page_title")
    // Score 17–19 so they rank after exact matches but still in tier 1.
    for (const pattern of TITLE_PATTERNS) {
        if (col.includes(pattern) && col !== pattern) {
            return 17 + tiebreaker;
        }
    }

    // ── Tier 9: Media / file upload fields (check before general strings)
    if (ctx.isStorage) {
        return 90 + tiebreaker;
    }
    for (const pattern of MEDIA_PATTERNS) {
        if (col.includes(pattern)) {
            return 91 + tiebreaker;
        }
    }
    if (col.endsWith("_url") || col.endsWith("_uri") || col.endsWith("_link")) {
        return 92 + tiebreaker;
    }

    // ── Tier 7: Long text fields
    if (LONG_TEXT_NAMES.has(col)) {
        return 70 + tiebreaker;
    }

    // ── Tier 8: Rich content fields
    if (RICH_CONTENT_NAMES.has(col)) {
        return 80 + tiebreaker;
    }

    // ── Tier 10: JSON / Map types
    if (ctx.propType === "map") {
        return JSON_MAP_NAMES.has(col) ? 100 + tiebreaker : 105 + tiebreaker;
    }

    // ── Tier 11: Array types
    if (ctx.propType === "array") {
        return 110 + tiebreaker;
    }

    // ── Tier 6: Owning relations
    if (ctx.propType === "relation") {
        return 60 + tiebreaker;
    }

    // ── Tier 4: Short text, enums, booleans — "quick glance" fields
    if (ctx.isEnum) {
        return 40 + tiebreaker;
    }
    if (ctx.propType === "boolean") {
        return 45 + tiebreaker;
    }
    if (ctx.propType === "string" && ctx.pgDataType !== "text") {
        // Short string (varchar, char, uuid that's not a PK)
        return 42 + tiebreaker;
    }

    // ── Tier 5: Numbers & user-facing dates
    if (ctx.propType === "number") {
        return 50 + tiebreaker;
    }
    if (ctx.propType === "date") {
        // A date that isn't a system timestamp (already handled above)
        return 55 + tiebreaker;
    }

    // ── Tier 7b: text data_type that didn't match long-text names
    if (ctx.propType === "string" && ctx.pgDataType === "text") {
        return 75 + tiebreaker;
    }

    // ── Tier 13: Fallback / unknown
    return 130 + tiebreaker;
}

/**
 * Sort a `propertiesOrder` array using the priority heuristic.
 * Returns a new sorted array; does not mutate the input.
 *
 * @param entries - Array of { key, columnName, propType, ... } objects
 *                  carrying the information needed to compute priority.
 */
export interface PropertyOrderEntry {
    /** The property key in the generated collection (may differ from columnName for relations). */
    key: string;
    /** The ordering context for this property. */
    ctx: PropertyOrderingContext;
}

export function sortPropertiesOrder(entries: PropertyOrderEntry[]): string[] {
    return [...entries]
        .sort((a, b) => computePropertyPriority(a.key, a.ctx) - computePropertyPriority(b.key, b.ctx))
        .map((e) => e.key);
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
    sampleData?: Record<string, unknown>[]
): string {
    const collectionName = humanize(tableName);
    const singular = singularize(collectionName);
    const icon = getIconForTable(tableName);

    const imports = new Set<string>(['import { PostgresCollectionConfig } from "@rebasepro/types";']);

    let propsOutput = "";
    let relationsOutput = "";
    const orderEntries: PropertyOrderEntry[] = [];
    const propertyBlocks = new Map<string, string>();
    let columnIndex = 0;

    // Detect composite primary keys
    const isCompositePk = meta.pks.length > 1;

    // Map columns
    for (const col of meta.columns) {
        // Skip foreign keys since we handle them as relations
        // Exception: Do not skip if it's part of the primary key!
        if (meta.fks.some((fk) => fk.column_name === col.column_name) && !meta.pks.includes(col.column_name)) continue;

        const currentIndex = columnIndex++;

        // Check if this column uses a PostgreSQL enum type
        const colEnumValues = enumMap.get(col.udt_name);
        const isEnumColumn = col.data_type === "USER-DEFINED" && colEnumValues !== undefined;
        const isVectorColumn = col.udt_name === "vector";

        const propType = isEnumColumn ? "string" : (isVectorColumn ? "vector" : mapPgType(col.data_type));
        let extra = "";

        const colNameLower = col.column_name.toLowerCase();

        // ── Data Inference Engine ────────────────────────────────────────────
        let finalPropType = propType;
        let inferenceExtra = "";

        if (!isEnumColumn && sampleData && sampleData.length > 0) {
            const values = sampleData.map(r => r[col.column_name]);
            const inferred = inferPropertyFromData(col.column_name, col.data_type, propType, values, meta.pks.includes(col.column_name));
            if (inferred.propType) finalPropType = inferred.propType;
            if (inferred.extra) inferenceExtra = inferred.extra;
        }

        // Enum values — generate real enum from the PG enum
        if (isEnumColumn && colEnumValues) {
            const enumEntries = colEnumValues
                .map((v) => `{ id: "${v}", label: "${humanize(v)}" }`)
                .join(", ");
            extra += `\n            enum: [${enumEntries}],`;
        }

        // Date auto-value heuristics
        if (finalPropType === "date") {
            if (colNameLower === "created_at" || colNameLower === "createdat") {
                extra += "\n            autoValue: \"on_create\",\n            ui: {\n                readOnly: true,\n                hideFromCollection: true\n            },";
            } else if (colNameLower === "updated_at" || colNameLower === "updatedat") {
                extra += "\n            autoValue: \"on_update\",\n            ui: {\n                readOnly: true,\n                hideFromCollection: true\n            },";
            } else if (col.column_default && (col.column_default.includes("now()") || col.column_default.includes("CURRENT_TIMESTAMP"))) {
                extra += "\n            autoValue: \"on_create\",\n            ui: {\n                readOnly: true\n            },";
            }
        }

        // Array/Map heuristics (Fallback if not inferred)
        if (finalPropType === "array" && !inferenceExtra.includes("of: {")) {
            let innerType = "string";
            let colType = "";
            if (col.udt_name.startsWith("_")) {
                const baseType = col.udt_name.substring(1);
                innerType = mapPgType(baseType);
                if (innerType === "string") colType = "text[]";
                else if (innerType === "number") colType = col.udt_name === "_numeric" ? "numeric[]" : "integer[]";
                else if (innerType === "boolean") colType = "boolean[]";
            }
            if (colType) {
                extra += `\n            columnType: "${colType}",`;
            }
            extra += `\n            of: { name: "${humanize(col.column_name)} Item", type: "${innerType}" },`;
        } else if (finalPropType === "map" && !inferenceExtra.includes("keyValue: true") && !inferenceExtra.includes("properties: {")) {
            extra += "\n            keyValue: true,";
        }

        // String sub-type heuristics (Fallback if not handled by inference or enum)
        if (finalPropType === "string" && !isEnumColumn && !inferenceExtra) {
            const isUrl = colNameLower.endsWith("_url") || colNameLower.endsWith("_uri") || colNameLower.endsWith("_link");
            const isMedia = colNameLower.includes("image") || colNameLower.includes("avatar") || colNameLower.includes("photo") || colNameLower.includes("logo") || colNameLower.includes("cover");

            if (isMedia) {
                extra += `\n            storage: {\n                storagePath: "${tableName}/${col.column_name}"\n            },`;
            } else if (isUrl) {
                extra += "\n            ui: {\n                url: true\n            },";
            } else if (colNameLower === "description" || colNameLower === "summary" || colNameLower === "excerpt") {
                extra += "\n            multiline: true,";
            } else if (colNameLower === "content" || colNameLower === "body") {
                extra += "\n            multiline: true,\n            markdown: true,";
            } else if (col.data_type === "text") {
                extra += "\n            multiline: true,";
            }
        }

        // Append inference results
        if (inferenceExtra) {
            extra += inferenceExtra;
            if (!extra.endsWith(",")) extra += ",";
        }

        // Identify IDs (unless already inferred as UUID/CUID by inferenceEngine)
        if (meta.pks.includes(col.column_name)) {
            if (isCompositePk) {
                extra += `\n            // Part of composite primary key (${meta.pks.join(", ")})`;
            } else if (finalPropType === "number" && !inferenceExtra.includes("isId:")) {
                extra += "\n            isId: \"increment\",";
            } else if (col.data_type.toLowerCase() === "uuid" && !inferenceExtra.includes("isId:")) {
                extra += "\n            isId: \"uuid\",";
            } else if (!inferenceExtra.includes("isId:")) {
                extra += "\n            isId: \"uuid\", // Verify if this is a UUID or CUID";
            }
        }

        if (finalPropType === "vector") {
            const dims = col.atttypmod && col.atttypmod > 0 ? col.atttypmod : 1536;
            extra += `\n            dimensions: ${dims},`;
        }

        if (col.is_nullable === "NO" && !meta.pks.includes(col.column_name) && !col.column_default) {
            if (extra.includes("validation: {")) {
                extra = extra.replace("validation: {", "validation: {\n                required: true,");
            } else {
                extra += "\n            validation: {\n                required: true\n            },";
            }
        }

        const humanName = humanize(col.column_name);

        orderEntries.push({
            key: col.column_name,
            ctx: {
                propType: finalPropType,
                isPk: meta.pks.includes(col.column_name),
                isEnum: isEnumColumn,
                isStorage: extra.includes("storage: {") || inferenceExtra.includes("storage: {"),
                pgDataType: col.data_type,
                originalIndex: currentIndex
            }
        });

        propertyBlocks.set(col.column_name, `
        ${col.column_name}: {
            name: "${humanName}",
            columnName: "${col.column_name}",
            type: "${finalPropType}",${extra}
        },`);
    }

    // Map Owning Relations (from this table's FKs to other tables)
    for (const fk of meta.fks) {
        const targetTableName = fk.foreign_table_name;
        if (!joinTables.has(targetTableName)) {
            let relName = fk.column_name.replace(/_id$/, "");
            if (meta.pks.includes(fk.column_name) && relName === fk.column_name) {
                // If the FK is also the PK and its name doesn't imply a relation (like "id"),
                // use the target table name to avoid conflicting with the PK property.
                relName = targetTableName;
            }
            // Push the relation property key, not the FK column name
            orderEntries.push({
                key: relName,
                ctx: {
                    propType: "relation",
                    isPk: false,
                    isEnum: false,
                    isStorage: false,
                    pgDataType: "",
                    originalIndex: columnIndex++
                }
            });

            const targetCollectionCamel = toCollectionVarName(targetTableName);
            imports.add(`import ${targetCollectionCamel} from "./${targetTableName}";`);

            const relHumanName = humanize(relName);

            propertyBlocks.set(relName, `
        ${relName}: {
            name: "${relHumanName}",
            type: "relation",
            target: () => ${targetCollectionCamel},
            cardinality: "one",
            direction: "owning",
            localKey: "${fk.column_name}",
            // mapped from foreign key: ${fk.column_name} -> ${targetTableName}(${fk.foreign_column_name})
        },`);
        }
    }

    // Map Inverse Relations (1-to-many where OTHER table points to THIS table)
    // These go into the `relations` array so they render as subcollection tabs.
    const inverseFks = allFks.filter((fk) => fk.foreign_table_name === tableName && !joinTables.has(fk.table_name));
    for (const fk of inverseFks) {
        const sourceTableName = fk.table_name;

        const targetCollectionCamel = toCollectionVarName(sourceTableName);
        imports.add(`import ${targetCollectionCamel} from "./${sourceTableName}";`);

        const inverseRelName = fk.column_name.replace(/_id$/, "");

        relationsOutput += `
        {
            relationName: "${sourceTableName}",
            target: () => ${targetCollectionCamel},
            cardinality: "many",
            direction: "inverse",
            inverseRelationName: "${inverseRelName}",
            foreignKeyOnTarget: "${fk.column_name}"
        },`;
    }

    // Map Many-to-Many Relations (Join Tables)
    // These also go into the `relations` array so they render as subcollection tabs.
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

            relationsOutput += `
        {
            relationName: "${relPropName}",
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

            const targetCollectionCamel = toCollectionVarName(targetTableName);
            imports.add(`import ${targetCollectionCamel} from "./${targetTableName}";`);

            // Determine direction (alphabetically first table is owning)
            const direction = tableName < targetTableName ? "owning" : "inverse";

            const thisFk = joinFks.find((fk) => fk.foreign_table_name === tableName);

            let throughCode = "";
            if (direction === "owning" && thisFk) {
                throughCode = `\n            through: {\n                table: "${jt}",\n                sourceColumn: "${thisFk.column_name}",\n                targetColumn: "${otherFk.column_name}"\n            },`;
            } else if (direction === "inverse") {
                throughCode = "\n            // Make sure the target collection configures the 'through' property.";
            }

            relationsOutput += `
        {
            relationName: "${targetTableName}",
            target: () => ${targetCollectionCamel},
            cardinality: "many",
            direction: "${direction}",${throughCode}
        },`;
        }
    }

    const relationsBlock = relationsOutput
        ? `\n    relations: [${relationsOutput}\n    ],`
        : "";

    const sortedPropertiesOrder = sortPropertiesOrder(orderEntries);
    for (const key of sortedPropertiesOrder) {
        propsOutput += propertyBlocks.get(key) || "";
    }

    const collectionVarName = toCollectionVarName(tableName);
    const fileContent = `${Array.from(imports).join("\n")}

const ${collectionVarName}: PostgresCollectionConfig = {
    name: "${collectionName}",
    singularName: "${singular}",
    slug: "${tableName}",
    table: "${tableName}",
    icon: "${icon}",
    properties: {${propsOutput}
    },${relationsBlock}
    propertiesOrder: ${JSON.stringify(sortedPropertiesOrder, null, 8).replace(/]$/, "    ]")}
};

export default ${collectionVarName};
`;

    return fileContent;
}

/**
 * Generate the content for an index.ts file that re-exports all collections.
 */
export function generateIndexContent(fileNames: string[]): string {
    const sorted = [...fileNames].sort();
    let imports = "";
    let arrayElements = "";
    for (const f of sorted) {
        const varName = toCollectionVarName(f);
        imports += `import ${varName} from "./${f}";\n`;
        arrayElements += `    ${varName},\n`;
    }
    return `${imports}\nexport const collections = [\n${arrayElements}];\n`;
}

/**
 * Merge new exports into existing index.ts content.
 * Returns the merged content string.
 */
export function mergeIndexContent(existingContent: string, newFileNames: string[]): string {
    const existingImports = new Set(
        [...existingContent.matchAll(/import\s+([a-zA-Z0-9_]+)\s+from\s+"\.\/([^"]+)"/g)].map((m) => m[2])
    );
    const sorted = [...newFileNames].sort();

    let newImports = "";
    let newElements = "";

    for (const f of sorted) {
        if (!existingImports.has(f)) {
            const varName = toCollectionVarName(f);
            newImports += `import ${varName} from "./${f}";\n`;
            newElements += `    ${varName},\n`;
        }
    }

    if (!newImports) return existingContent;

    // Simple injection logic:
    // Add new imports below the last import or at the top
    const importRegex = /import\s+.*?;/g;
    let lastImportMatch;
    let match;
    while ((match = importRegex.exec(existingContent)) !== null) {
        lastImportMatch = match;
    }

    let contentWithImports = existingContent;
    if (lastImportMatch) {
        const pos = lastImportMatch.index + lastImportMatch[0].length;
        contentWithImports = existingContent.slice(0, pos) + "\n" + newImports.trimEnd() + existingContent.slice(pos);
    } else {
        contentWithImports = newImports + "\n" + existingContent;
    }

    // Inject into the `collections = [...]` array
    const arrayRegex = /export\s+const\s+collections\s*=\s*\[([\s\S]*?)\];/;
    return contentWithImports.replace(arrayRegex, (fullMatch, arrayContent) => {
        let mergedArray = arrayContent.trimEnd();
        if (mergedArray && !mergedArray.endsWith(",")) mergedArray += ",";
        if (mergedArray) mergedArray += "\n";
        mergedArray += newElements.trimEnd();
        return `export const collections = [\n    ${mergedArray.trim()}\n];`;
    });
}

/**
 * Safely extract the host portion of a database URL for logging.
 */
export function safeHostFromUrl(url: string): string {
    return url.includes("@") ? url.split("@")[1] : "(local connection)";
}
