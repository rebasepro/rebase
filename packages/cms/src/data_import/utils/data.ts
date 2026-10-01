import { getPropertyInPath } from "../../util";
import { DataType, Entity, EntityReference, CollectionRegistryController, GeoPoint, Properties, Property, Vector } from "@rebasepro/types";
import { AuthController, AdminCollection } from "@rebasepro/cms-types";
import { isPropertyBuilder } from "@rebasepro/common";
import { unflattenObject } from "./transforms";
import { inferTypeFromValue, readNumberExactly } from "@rebasepro/inference";
import { isPrototypePollutingKey, mergeDeep } from "@rebasepro/utils";

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
    navigation: CollectionRegistryController,
    data: object[],
    idColumn: string | undefined,
    headersMapping: Record<string, string | null>,
    properties: Properties,
    path: string,
    defaultValues: Record<string, any>): { entities: Entity<any>[], problems: ImportConversionProblem[] } {
    const problems: ImportConversionProblem[] = [];
    const dateOrders = slashDateOrdersByColumn(data);
    const entities = data.map((row, index) => convertDataToEntity(authController, navigation,
        row as Record<string, unknown>, idColumn, headersMapping, properties, path, defaultValues,
        (problem) => problems.push({ row: index, ...problem }),
        dateOrders));
    return { entities, problems };
}

export function convertDataToEntity(authController: AuthController,
    navigation: CollectionRegistryController,
    data: Record<any, any>,
    idColumn: string | undefined,
    headersMapping: Record<string, string | null>,
    properties: Properties,
    path: string,
    defaultValues: Record<string, any>,
    onProblem?: (problem: Omit<ImportConversionProblem, "row">) => void,
    dateOrders?: Record<string, SlashDateOrder | undefined>): Entity<any> {
    const flatObject = flattenEntry(data);
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

export function flattenEntry(obj: Record<string, unknown>, parent = ""): Record<string, unknown> {
    return Object.keys(obj).reduce<Record<string, unknown>>((acc, key) => {
        // Keys come from the uploaded file, so `acc[key] = …` is the class-22
        // primitive when the key is `__proto__`; refuse the column instead.
        if (isPrototypePollutingKey(key)) {
            console.warn(`Skipping column "${key}": a header may not reach the prototype chain`);
            return acc;
        }
        const prefixedKey = parent ? `${parent}.${key}` : key;

        if (typeof obj[key] === "object" && !(obj[key] instanceof Date) && obj[key] !== null && !Array.isArray(obj[key])) {
            Object.assign(acc, flattenEntry(obj[key] as Record<string, unknown>, prefixedKey));
        } else {
            acc[prefixedKey] = obj[key];
        }

        return acc;
    }, {});
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
    navigation: CollectionRegistryController,
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
        if (value && typeof value === "object" && "value" in value && Array.isArray(value.value)) {
            return new Vector(value.value);
        }
        let items: unknown[] | undefined;
        if (Array.isArray(value)) {
            items = value;
        } else if (typeof value === "string") {
            let cleaned = value.trim();
            if (cleaned.startsWith("[") && cleaned.endsWith("]")) {
                cleaned = cleaned.slice(1, -1);
            }
            if (cleaned === "") return null;
            items = cleaned.split(",");
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

    if ((to === "map" || to === "geopoint") && typeof value === "string") {
        // The export writes a map and a geopoint as the JSON of the object —
        // and each item of an array of maps the same way — so that is what a
        // cell holding one reads as. Kept as text, a map was stored as a JSON
        // string and a geopoint refused the whole batch at the server.
        if (value.trim() === "") return null;
        const parsed = readJsonObjectCell(value);
        if (to === "map") return parsed ?? refuse("not_a_map");
        const { latitude, longitude } = parsed ?? {};
        return typeof latitude === "number" && typeof longitude === "number"
            && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180
            ? new GeoPoint(latitude, longitude)
            : refuse("not_a_geopoint");
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

    if (from === "array" && to === "array" && Array.isArray(value) && usedProperty.of && !Array.isArray(usedProperty.of) && !isPropertyBuilder(usedProperty.of)) {
        return value.map(v => processValueMapping(authController, v, navigation, usedProperty.of as Property, onProblem, dateOrder));
    } else if (from === "string" && to === "number" && typeof value === "string") {
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
        const read = readDateCell(value, dateOrder);
        return read instanceof Date ? read : refuse(read);
    } else if (value instanceof Date && to === "string") {
        return value.toISOString();
    } else if (from === "number" && to === "date" && typeof value === "number") {
        const read = dateFromEpoch(value);
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

function dateFromEpoch(epoch: number): Date | undefined {
    if (!Number.isFinite(epoch)) return undefined;
    const date = new Date(Math.abs(epoch) < EPOCH_SECONDS_BELOW ? epoch * 1000 : epoch);
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
function readDateCell(cell: string, order: SlashDateOrder | undefined): Date | ImportProblemReason {
    const text = cell.trim();
    if (/^-?\d+$/.test(text)) {
        return dateFromEpoch(Number(text)) ?? "not_a_date";
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
export function slashDateOrdersByColumn(data: object[]): Record<string, SlashDateOrder | undefined> {
    const seen: Record<string, { dayFirst: boolean, monthFirst: boolean }> = {};
    for (const row of data) {
        for (const [column, value] of Object.entries(flattenEntry(row as Record<string, unknown>))) {
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
