import { getPropertyInPath } from "../../util";
import { ArrayProperty, DataType, Entity, EntityReference, CollectionRegistryController, GeoPoint, Properties, Property, Vector } from "@rebasepro/types";
import { AuthController, AdminCollection } from "@rebasepro/cms-types";
import { isPropertyBuilder } from "@rebasepro/common";
import { unflattenObject } from "./transforms";
import { ColumnTarget, importColumns } from "./import_columns";
import { inferTypeFromValue, readNumberExactly } from "@rebasepro/inference";
import { mergeDeep } from "@rebasepro/utils";

/** What the conversion asks of the collection registry: the collection a reference points into. */
export type ImportCollectionLookup = Pick<CollectionRegistryController, "getCollection">;

/**
 * Why a cell could not be converted to its property's type. Each one is a
 * translation key under `import_problem_`.
 */
export type ImportProblemReason =
    | "not_a_number"
    | "number_leading_zero"
    | "number_too_precise"
    | "not_a_boolean"
    | "not_a_date"
    | "ambiguous_date"
    | "not_a_vector"
    | "not_a_map"
    | "not_a_geopoint";

/**
 * A cell the import could not convert to the type of the property it maps
 * to. It is left out of the row — the property's default applies — and shown
 * to the person importing before anything is written.
 */
export type ImportConversionProblem = {
    /** The row's index among the file's data rows, from 0. */
    row: number;
    /** The column, as the file names it. */
    column: string;
    /** The property the column maps to. */
    property: string;
    /** The type that property holds. */
    expected: DataType;
    /** The cell, as it was read from the file. */
    value: unknown;
    reason: ImportProblemReason;
};

/** Reports one cell that did not convert; the cell is then left out. */
export type ImportProblemListener = (problem: { reason: ImportProblemReason }) => void;

/**
 * How a column writes the dates whose day and month are both numbers
 * (`05/01/2024`): day first, month first, or — when the column holds both —
 * each date by the only order that can read it.
 */
export type SlashDateOrder = "dmy" | "mdy" | "each";

/**
 * Convert every row of an imported file, and list each cell that did not
 * convert. The previews call this, so the list is in front of the person
 * importing before the first row is written.
 */
export function convertImportData(authController: AuthController,
    navigation: ImportCollectionLookup,
    data: object[],
    idColumn: string | undefined,
    headersMapping: Record<string, string | null>,
    properties: Properties,
    path: string,
    defaultValues: Record<string, any>): { entities: Entity<any>[], problems: ImportConversionProblem[] } {
    const problems: ImportConversionProblem[] = [];
    const dateOrders = slashDateOrdersByColumn(data, properties, mappedColumnTarget(headersMapping));
    const entities = data.map((row, index) => convertDataToEntity(authController, navigation,
        row as Record<string, unknown>, idColumn, headersMapping, properties, path, defaultValues,
        (problem) => problems.push({ row: index, ...problem }),
        dateOrders));
    return { entities, problems };
}

export function convertDataToEntity(authController: AuthController,
    navigation: ImportCollectionLookup,
    data: Record<any, any>,
    idColumn: string | undefined,
    headersMapping: Record<string, string | null>,
    properties: Properties,
    path: string,
    defaultValues: Record<string, any>,
    onProblem?: (problem: Omit<ImportConversionProblem, "row">) => void,
    dateOrders?: Record<string, SlashDateOrder | undefined>): Entity<any> {
    const flatObject = flattenEntry(data, properties, mappedColumnTarget(headersMapping));
    if (idColumn)
        delete flatObject[idColumn];
    // One accumulator, written in place: spreading it once per column made
    // converting a row quadratic in its column count. No prototype, so a
    // `__proto__` key is a key here; `unflattenObject` refuses it below.
    const mappedKeysObject: Record<string, unknown> = Object.create(null);
    for (const [key, value] of Object.entries(flatObject)) {
        // The mapping is keyed by the column's flat name — `address.street`
        // is one key, not a path — and `null` is "Do not import this
        // property". A column the mapping does not mention keeps its name.
        const mappedKey = Object.prototype.hasOwnProperty.call(headersMapping, key)
            ? headersMapping[key]
            : key;
        if (mappedKey === null) {
            continue;
        }
        // A blank cell is a value nobody filled in, not an empty one: it
        // sets nothing, so the default chosen for the property applies. An
        // empty spreadsheet cell already arrives without a key.
        if (value === "") {
            continue;
        }

        const mappedProperty = getPropertyInPath(properties, mappedKey);
        // `getPropertyInPath` answers `in`, so a `toString` column finds
        // `Object.prototype.toString`: a declared property is an object.
        if (!mappedProperty || typeof mappedProperty !== "object") {
            continue;
        }
        let reason: ImportProblemReason | undefined;
        const processedValue = processValueMapping(authController, value, navigation, mappedProperty,
            (problem) => { reason ??= problem.reason; },
            dateOrders && Object.hasOwn(dateOrders, key) ? dateOrders[key] : undefined);
        // A cell that did not convert is not imported as `null`, `0` or
        // `false` in its place: it is left out, and reported.
        if (reason !== undefined) {
            onProblem?.({ column: key, property: mappedKey, expected: mappedProperty.type, value, reason });
            continue;
        }
        mappedKeysObject[mappedKey] = processedValue;
    }

    const values = mergeDeep(defaultValues ?? {}, unflattenObject(mappedKeysObject));
    let id = idColumn ? data[idColumn] : undefined;
    if (typeof id === "string") {
        id = id.trim();
    } else if (typeof id === "number") {
        id = id.toString();
    } else if (typeof id === "boolean") {
        id = id.toString();
    } else if (id instanceof Date) {
        id = id.toISOString();
    } else if (id && "toString" in id) {
        id = id.toString();
    }

    return {
        id,
        values,
        path: path
    };
}

/**
 * Where a column lands under the import's mapping: the property the mapping
 * names for it, `null` for "Do not import this property", and the property
 * with the column's own name when the mapping does not mention the column.
 */
export function mappedColumnTarget(headersMapping: Record<string, string | null>): ColumnTarget {
    return (column) => Object.hasOwn(headersMapping, column) ? headersMapping[column] : column;
}

/**
 * The cells of one imported row by column name (`address.street`): each
 * value that is not split into columns of its own (see `importColumns`).
 * Without `properties`, every object is split.
 */
export function flattenEntry(obj: Record<string, unknown>,
    properties?: Properties,
    targetOf: ColumnTarget = (column) => column): Record<string, unknown> {
    const cells: Record<string, unknown> = {};
    for (const { column, value, split } of importColumns(obj, properties, targetOf)) {
        if (!split) cells[column] = value;
    }
    return cells;
}

/**
 * Convert one cell to the type of the property it lands in.
 *
 * A cell is converted only when the property's type can hold what it says:
 * text becomes a number when it spells one exactly (`readNumberExactly`, the
 * same answer the inference uses), a boolean when it says yes or no, a date
 * when it names a day. Anything else is reported to `onProblem`, and the
 * result is `null` — the caller leaves such a cell out rather than writing
 * that `null`, a `0` or a `false` in its place.
 *
 * @param dateOrder how the cell's column writes day/month dates, when it
 * writes them with numbers only (see `slashDateOrdersByColumn`).
 */
export function processValueMapping(authController: AuthController,
    value: any,
    navigation: ImportCollectionLookup,
    property?: Property,
    onProblem?: ImportProblemListener,
    dateOrder?: SlashDateOrder): any {
    if (value === null) return null;

    if (property === undefined) return value;
    const usedProperty: Property | null = property;
    if (usedProperty === null) return value;
    const from = inferTypeFromValue(value);
    const to = usedProperty.type;
    const refuse = (reason: ImportProblemReason) => {
        onProblem?.({ reason });
        return null;
    };

    if (to === "vector") {
        let items: unknown[] | undefined;
        if (Array.isArray(value)) {
            items = value;
        } else if (isObjectValue(value)) {
            // A JSON file holds the vector as the object the export wrote.
            if (!Array.isArray(value.value)) return refuse("not_a_vector");
            items = value.value;
        } else if (typeof value === "string") {
            let cleaned = value.trim();
            if (cleaned.startsWith("{")) {
                // A CSV cell holds it as that object's JSON, `{"value":[…]}`.
                const object = readJsonObjectCell(cleaned);
                if (!object || !Array.isArray(object.value)) return refuse("not_a_vector");
                items = object.value;
            } else {
                if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
                    cleaned = cleaned.slice(1, -1);
                }
                if (cleaned === "") return null;
                items = cleaned.split(",");
            }
        }
        if (items === undefined) return value;
        const numbers = items.map(item => typeof item === "number"
            ? item
            : typeof item === "string" ? readNumberExactly(item) : undefined);
        // An item that is not a number used to become 0 (or NaN): a vector
        // with a made-up coordinate.
        if (numbers.some(item => item === undefined || !Number.isFinite(item))) return refuse("not_a_vector");
        return new Vector(numbers as number[]);
    }

    if (to === "map" || to === "geopoint") {
        // The export writes a map and a geopoint as the JSON of the object in
        // a CSV cell — and each item of an array of maps the same way — and
        // as the object itself in a JSON file; that is what either reads as.
        // Kept as text, a map was stored as a JSON string and a geopoint
        // refused the whole batch at the server.
        if (typeof value === "string" && value.trim() === "") return null;
        const object = typeof value === "string" ? readJsonObjectCell(value) : isObjectValue(value) ? value : undefined;
        if (usedProperty.type === "geopoint") {
            const { latitude, longitude } = object ?? {};
            return typeof latitude === "number" && typeof longitude === "number"
                && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
                ? new GeoPoint(latitude, longitude)
                : refuse("not_a_geopoint");
        }
        if (!object) return refuse("not_a_map");
        if (usedProperty.type !== "map" || !usedProperty.properties) return object;
        // A map that arrives whole — an item of an array of maps — has its
        // declared fields converted like the columns of a row: its dates
        // were left as the text or epoch number the export wrote.
        const fields: Record<string, unknown> = { ...object };
        for (const [key, fieldProperty] of Object.entries(usedProperty.properties)) {
            if (!Object.hasOwn(object, key) || isPropertyBuilder(fieldProperty)) continue;
            fields[key] = processValueMapping(authController, object[key], navigation, fieldProperty, onProblem, dateOrder);
        }
        return fields;
    }

    if (from === "string" && to === "array" && typeof value === "string") {
        return processValueMapping(authController, splitListCell(value), navigation, usedProperty, onProblem, dateOrder);
    } else if (from === "string" && to === "boolean" && typeof value === "string") {
        // A blank cell is no value; anything else unreadable is reported.
        if (value.trim() === "") return null;
        const read = readBooleanCell(value);
        return read === undefined ? refuse("not_a_boolean") : read;
    } else if (from === "array" && to === "string") {
        // A CSV cell only arrives as an array when its text was the canonical
        // JSON of one (`mapJsonParse`), so this is that text again.
        return JSON.stringify(value);
    }

    if (from === "array" && Array.isArray(value) && usedProperty.type === "array") {
        const of = usedProperty.of;
        if (usedProperty.oneOf) {
            const oneOf = usedProperty.oneOf;
            return value.map(item => convertBlock(item, oneOf,
                (blockValue, blockProperty) => processValueMapping(authController, blockValue, navigation, blockProperty, onProblem, dateOrder)));
        }
        if (Array.isArray(of)) {
            // A fixed list: each position has a property of its own.
            return value.map((item, index) => index < of.length && !isPropertyBuilder(of[index])
                ? processValueMapping(authController, item, navigation, of[index], onProblem, dateOrder)
                : item);
        }
        if (of && !isPropertyBuilder(of)) {
            return value.map(item => processValueMapping(authController, item, navigation, of, onProblem, dateOrder));
        }
    }

    if (from === "string" && to === "number" && typeof value === "string") {
        // A blank cell is no value — not a real zero, which `Number("")` is.
        const trimmed = value.trim();
        if (trimmed === "") return null;
        const read = readNumberExactly(trimmed);
        if (read !== undefined) return read;
        return refuse(whyNotANumber(trimmed));
    } else if (from === "number" && to === "boolean") {
        if (value === 1) return true;
        if (value === 0) return false;
        return refuse("not_a_boolean");
    } else if (from === "boolean" && to === "number") {
        return value ? 1 : 0;
    } else if (from === "boolean" && to === "string") {
        return value ? "true" : "false";
    } else if (from === "number" && to === "string" && typeof value === "number") {
        return value.toString();
    } else if (from === "string" && to === "date" && typeof value === "string") {
        const read = readDateCell(value, dateOrder, isTimeOfDay(usedProperty));
        return read instanceof Date ? read : refuse(read);
    } else if (value instanceof Date && to === "string") {
        return value.toISOString();
    } else if (from === "number" && to === "date" && typeof value === "number") {
        const read = dateFromEpoch(value, isTimeOfDay(usedProperty));
        return read ?? refuse("not_a_date");
    } else if (from === "string" && to === "reference" && typeof value === "string") {
        // Parse optional database name in format: database_name:::path/to/entity
        // or simple format: path/to/entity
        let databaseId: string | undefined = undefined;
        let referencePath = value;

        if (value.includes(":::")) {
            const [dbName, pathPart] = value.split(":::");
            if (dbName && dbName !== "(default)") {
                databaseId = dbName;
            }
            referencePath = pathPart;
        }

        // split value into path and entityId (entityId is the last part of the path, after the last /)
        const path = referencePath.split("/").slice(0, -1).join("/");
        const entityId = referencePath.split("/").slice(-1)[0];

        // If no explicit database was provided in the string, try to get it from the collection
        if (databaseId === undefined) {
            const targetCollection: AdminCollection<any> | undefined = navigation.getCollection(path);
            databaseId = targetCollection?.databaseId;
        }

        return new EntityReference({ id: entityId,
path,
databaseId });

    } else if (from === to) {
        return value;
    }

    return value;
}

/** An object read from a file, as opposed to a list, a date or a primitive. */
function isObjectValue(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value) && !(value instanceof Date);
}

/**
 * One item of a block list (`oneOf`): the object the export wrote — or, in a
 * CSV whose lists were written one cell per item, that object's JSON — with
 * its value converted to the property its type names.
 */
function convertBlock(item: unknown,
    oneOf: NonNullable<ArrayProperty["oneOf"]>,
    convert: (value: unknown, property: Property) => unknown): unknown {
    const block = typeof item === "string" ? readJsonObjectCell(item) : isObjectValue(item) ? item : undefined;
    if (!block) return item;
    const typeField = oneOf.typeField ?? "type";
    const valueField = oneOf.valueField ?? "value";
    const type = block[typeField];
    const blockProperty = typeof type === "string" && Object.hasOwn(oneOf.properties, type) ? oneOf.properties[type] : undefined;
    if (!blockProperty || isPropertyBuilder(blockProperty) || !Object.hasOwn(block, valueField)) return block;
    return { ...block, [valueField]: convert(block[valueField], blockProperty) };
}

/** A cell holding the JSON of an object, read; `undefined` for anything else. */
function readJsonObjectCell(cell: string): Record<string, unknown> | undefined {
    const trimmed = cell.trim();
    if (!trimmed.startsWith("{")) return undefined;
    try {
        const parsed: unknown = JSON.parse(trimmed);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed as Record<string, unknown>
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * The items of a list cell: a JSON array as written (the export writes lists
 * that way), otherwise the text split on commas. Each item is trimmed and an
 * empty one dropped, so `news, sports` is two tags rather than one with a
 * leading space, and a blank cell is no tags rather than one empty tag.
 */
function splitListCell(cell: string): unknown[] {
    const trimmed = cell.trim();
    if (trimmed.startsWith("[")) {
        try {
            const parsed: unknown = JSON.parse(trimmed);
            if (Array.isArray(parsed)) return parsed;
        } catch (e) {
            // Not JSON after all: a list that happens to start with a bracket.
        }
    }
    return trimmed.split(",")
        .map(item => item.trim())
        .filter(item => item !== "");
}

/**
 * A boolean cell as spreadsheets and people write it: Excel and Sheets export
 * `TRUE`/`FALSE`, and `yes`/`no` and `1`/`0` are common by hand. Anything
 * unreadable is absent — `null`, as a number cell is — rather than a confident
 * `false`.
 */
function readBooleanCell(cell: string): boolean | undefined {
    const normalised = cell.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalised)) return true;
    if (["false", "0", "no", "n"].includes(normalised)) return false;
    return undefined;
}

/** Why a text is not a number `readNumberExactly` accepts. */
function whyNotANumber(text: string): ImportProblemReason {
    // A leading zero is an identifier — a zip code, a product code — and
    // more than 15 significant digits is more than a double holds: `Number()`
    // would read both, and change them.
    if (/^-?0\d/.test(text) && Number.isFinite(Number(text))) return "number_leading_zero";
    if (/^-?\d+(\.\d+)?$/.test(text)) return "number_too_precise";
    return "not_a_number";
}

/**
 * Below this, an epoch number is in seconds: 1e11 seconds is the year 5138,
 * and 1e11 milliseconds is March 1973.
 */
const EPOCH_SECONDS_BELOW = 1e11;

/** One day, in milliseconds. */
const DAY_MS = 86_400_000;

/** Whether a property holds a time of day — a time on 1970-01-01, in UTC. */
function isTimeOfDay(property: Property): boolean {
    return property.type === "date" && property.columnType === "time";
}

/**
 * @param timeOfDay the number lands in a time-of-day property. The export
 * writes such a time as the milliseconds since that midnight, a number below
 * one day; read as epoch seconds, 12:30 was a day in 1971 at 20:00.
 */
function dateFromEpoch(epoch: number, timeOfDay = false): Date | undefined {
    if (!Number.isFinite(epoch)) return undefined;
    const inMilliseconds = (timeOfDay && epoch >= 0 && epoch < DAY_MS) || Math.abs(epoch) >= EPOCH_SECONDS_BELOW;
    const date = new Date(inMilliseconds ? epoch : epoch * 1000);
    return isNaN(date.getTime()) ? undefined : date;
}

/** `05/01/2024`, `5.1.2024`, `05-01-2024`: day and month as numbers, year last. */
const SLASH_DATE = /^(\d{1,2})([/.-])(\d{1,2})\2(\d{4})$/;

/**
 * Whether a date that names no time is the day it names in UTC — as an ISO
 * `2024-01-05` already is — rather than local midnight, which `new Date()`
 * makes of `5 Jan 2024`.
 */
function utcDay(date: Date): Date {
    return new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
}

function validUtcDate(year: number, month: number, day: number): Date | undefined {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
        ? date
        : undefined;
}

/**
 * Read a date cell. `new Date()` never throws, so its failures used to import
 * as an Invalid Date (sent as `null`); it reads `05/01/2024` month first
 * wherever the file came from, an epoch in seconds as milliseconds (1970), and
 * `5 Jan 2024` at local midnight where `2024-01-05` is UTC midnight.
 */
function readDateCell(cell: string, order: SlashDateOrder | undefined, timeOfDay = false): Date | ImportProblemReason {
    const text = cell.trim();
    if (/^-?\d+$/.test(text)) {
        return dateFromEpoch(Number(text), timeOfDay) ?? "not_a_date";
    }
    const slash = SLASH_DATE.exec(text);
    if (slash) {
        const first = Number(slash[1]);
        const second = Number(slash[3]);
        const year = Number(slash[4]);
        let dayFirst: boolean;
        if (order === "dmy" || order === "mdy") {
            dayFirst = order === "dmy";
        } else if (order === "each") {
            // The column writes both orders; only a date that just one order
            // can read is placed.
            if (first > 12 === second > 12) return "ambiguous_date";
            dayFirst = first > 12;
        } else {
            dayFirst = first > 12 || (second <= 12 && localeWritesDayFirst());
        }
        const date = dayFirst ? validUtcDate(year, second, first) : validUtcDate(year, first, second);
        return date ?? "not_a_date";
    }
    const date = new Date(text);
    if (isNaN(date.getTime())) return "not_a_date";
    const namesATime = /\d:\d/.test(text);
    return namesATime || /^\d{4}-\d{2}-\d{2}$/.test(text) ? date : utcDay(date);
}

/** Whether this browser's locale writes the day before the month. */
function localeWritesDayFirst(): boolean {
    const parts = new Intl.DateTimeFormat().formatToParts(new Date(2000, 10, 22));
    const day = parts.findIndex(part => part.type === "day");
    const month = parts.findIndex(part => part.type === "month");
    return day >= 0 && month >= 0 && day < month;
}

/**
 * For each column of the file, how it writes day/month dates with numbers
 * only, when its values say: a first number past 12 is a day, so the column
 * is day first; a second number past 12, month first; both, and each date
 * is read by the only order that fits it. A column that never says is read
 * in the order of the browser's locale.
 */
export function slashDateOrdersByColumn(data: object[],
    properties?: Properties,
    targetOf?: ColumnTarget): Record<string, SlashDateOrder | undefined> {
    const seen: Record<string, { dayFirst: boolean, monthFirst: boolean }> = {};
    for (const row of data) {
        for (const [column, value] of Object.entries(flattenEntry(row as Record<string, unknown>, properties, targetOf))) {
            if (typeof value !== "string") continue;
            const slash = SLASH_DATE.exec(value.trim());
            if (!slash) continue;
            const entry = Object.hasOwn(seen, column) ? seen[column] : (seen[column] = { dayFirst: false, monthFirst: false });
            if (Number(slash[1]) > 12) entry.dayFirst = true;
            if (Number(slash[3]) > 12) entry.monthFirst = true;
        }
    }
    const orders: Record<string, SlashDateOrder | undefined> = {};
    for (const [column, { dayFirst, monthFirst }] of Object.entries(seen)) {
        orders[column] = dayFirst && monthFirst ? "each" : dayFirst ? "dmy" : monthFirst ? "mdy" : undefined;
    }
    return orders;
}
