import { Properties, Property } from "@rebasepro/types";
import { isPrototypePollutingKey, slugify } from "@rebasepro/utils";
import { getPropertyInPath } from "../../util";

/**
 * Whether a property's value is an object the import takes whole, from one
 * column: a geopoint, a vector, or a map that declares no fields (a key-value
 * map). These are the values the export writes as objects — in a JSON file
 * as the object, in a CSV cell as its JSON — and splitting one into
 * `location.latitude` columns left it in columns no property holds: it was
 * dropped without a word.
 *
 * Any other object is read one column per key: a map with declared fields
 * field by field, as the export writes it, and an object no property takes
 * so that its keys can be mapped one by one.
 */
export function takesObjectWhole(property: Property): boolean {
    return property.type === "geopoint"
        || property.type === "vector"
        || (property.type === "map" && property.properties === undefined);
}

/** One column of an imported row, as the mapping step lists it. */
export type ImportColumn = {
    /** The column's name: a key of the row, or `parent.key` below one. */
    column: string;
    value: unknown;
    /** The property path it lands in, or `null` for none. */
    target: string | null;
    /** Its value is an object that is read as one column per key, listed after it. */
    split: boolean;
};

/**
 * Where a column lands: the property path for it, or `null` for none. A
 * column below another is given that parent; a top-level one is not.
 */
export type ColumnTarget = (column: string, key: string, parent?: Pick<ImportColumn, "column" | "target">) => string | null;

function isObjectCell(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/** The declared property at a path, and nothing inherited (`toString`). */
function propertyAt(properties: Properties | undefined, path: string | null): Property | undefined {
    if (!properties || path === null) return undefined;
    const property = getPropertyInPath(properties, path);
    return property !== null && typeof property === "object" ? property : undefined;
}

/**
 * The columns of one imported row, parents before their children.
 *
 * Each key of the row is a column. A key whose value is an object is also
 * read as one column per key of that object (`address.street`) — unless the
 * property it lands in takes the object whole (see {@link takesObjectWhole}).
 *
 * The mapping step lists these columns and the conversion reads them, so both
 * get them from here: a list built one way and rows read another is a mapping
 * whose keys match nothing.
 */
export function importColumns(row: Record<string, unknown>,
    properties: Properties | undefined,
    targetOf: ColumnTarget): ImportColumn[] {
    const columns: ImportColumn[] = [];
    const walk = (object: Record<string, unknown>, parent?: Pick<ImportColumn, "column" | "target">) => {
        for (const key of Object.keys(object)) {
            // Keys come from the uploaded file, so a `__proto__` key would be
            // the prototype setter wherever it is used as one (class 22).
            if (isPrototypePollutingKey(key)) {
                console.warn(`Skipping column "${key}": a header may not reach the prototype chain`);
                continue;
            }
            const column = parent === undefined ? key : `${parent.column}.${key}`;
            const value = object[key];
            const target = targetOf(column, key, parent);
            const property = propertyAt(properties, target);
            const splitValue = isObjectCell(value) && !(property && takesObjectWhole(property))
                ? value
                : undefined;
            columns.push({ column, value, target, split: splitValue !== undefined });
            if (splitValue) walk(splitValue, { column, target });
        }
    };
    walk(row);
    return columns;
}

/**
 * The mapping the import starts from: each column of the file onto the
 * property with its name, or with its name slugged (`First Name` →
 * `first_name`); a column below a map onto that map's field. A column that
 * matches nothing keeps its own name, for the person importing to map.
 */
export function buildHeadersMappingFromData(rows: object[], properties?: Properties): Record<string, string> {
    const headersMapping: Record<string, string> = {};
    const targetOf: ColumnTarget = (column, key, parent) => {
        if (Object.hasOwn(headersMapping, column)) return headersMapping[column];
        const parentProperty = parent && propertyAt(properties, parent.target);
        const siblings = parent === undefined
            ? properties
            : parentProperty?.type === "map" ? parentProperty.properties : undefined;
        const slug = slugify(key);
        const name = siblings && !Object.hasOwn(siblings, key) && Object.hasOwn(siblings, slug) ? slug : key;
        return parent === undefined ? name : `${parent.target ?? parent.column}.${name}`;
    };
    for (const row of rows) {
        if (!row) continue;
        for (const { column, target } of importColumns(row as Record<string, unknown>, properties, targetOf)) {
            headersMapping[column] ??= target ?? column;
        }
    }
    return headersMapping;
}
