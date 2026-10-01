/**
 * The collection editor's "create a collection from a file" path, end to end,
 * on a fixture file — the same calls the dialog makes, in the same order:
 *
 *   file_to_json      CSV: parseCsvToObjects → mapJsonParse → unflattenObject
 *                     JSON: JSON.parse, order = keys of the first row
 *   onImportDataSet   buildEntityPropertiesFromData → cleanPropertiesFromImport
 *   mapping complete  the id column leaves the properties
 *   preview           convertDataToEntity per row
 *
 * The fixtures are messy real-world shapes (zip codes, SKUs, sparse columns,
 * nested camelCase keys…) that once lost data on this path.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Properties } from "@rebasepro/types";
import { AuthController } from "@rebasepro/cms-types";
import { buildEntityPropertiesFromData } from "@rebasepro/inference";
import { parseCsvToObjects } from "../../../src/data_import/utils/csv";
import { mapJsonParse, unflattenObject } from "../../../src/data_import/utils/transforms";
import { getInferenceType } from "../../../src/data_import/utils/get_import_inference_type";
import { convertDataToEntity, flattenEntry } from "../../../src/data_import/utils/data";
import { cleanPropertiesFromImport } from "../../../src/collection_editor/ui/collection_editor/import/clean_import_data";

export type LoadedFile = { data: object[]; propertiesOrder: string[] };

export function loadFixture(name: string): LoadedFile {
    const text = readFileSync(join(__dirname, name), "utf8");
    if (name.endsWith(".json")) {
        const data = JSON.parse(text) as object[];
        return { data, propertiesOrder: data.length > 0 ? Object.keys(data[0]) : [] };
    }
    const { headers, data } = parseCsvToObjects(text);
    return { data: data.map(mapJsonParse).map(unflattenObject), propertiesOrder: headers };
}

const auth = {} as AuthController;
const navigation = { getCollection: () => undefined } as unknown as Parameters<typeof convertDataToEntity>[1];

export async function importIntoNewCollection(name: string) {
    const loaded = loadFixture(name);
    const inferred = await buildEntityPropertiesFromData(loaded.data, getInferenceType);
    const cleaned = cleanPropertiesFromImport(inferred);
    const properties: Properties = { ...cleaned.properties };
    if (cleaned.idColumn) delete properties[cleaned.idColumn];
    const entities = loaded.data.map(row => convertDataToEntity(auth, navigation, row as Record<string, unknown>,
        cleaned.idColumn, cleaned.headersMapping, properties, "TEMP_PATH", {}));
    return { loaded, inferred, properties, headersMapping: cleaned.headersMapping, idColumn: cleaned.idColumn, entities };
}

function valueAt(obj: unknown, path: string): unknown {
    return path.split(".").reduce<unknown>((o, k) => (o == null || typeof o !== "object" ? undefined : (o as Record<string, unknown>)[k]), obj);
}

/**
 * Whether an imported value is the file's value: the same, the text a CSV
 * cell was written as (a canonical `10.5` cell arrives as a number and a text
 * property gives back `"10.5"`), or the number a text spells when the number
 * keeps all of it (`10.00` → 10, but never `02134` → 2134 or a SKU rounded).
 */
function sameValue(out: unknown, original: unknown): boolean {
    if (JSON.stringify(out) === JSON.stringify(original)) return true;
    if (typeof out === "string" && (typeof original === "number" || typeof original === "boolean")) {
        return String(original) === out;
    }
    if (typeof out === "number" && typeof original === "string") {
        const text = original.trim();
        const digits = text.split(/[eE]/)[0].replace(/\D/g, "").replace(/^0+/, "");
        return Number(text) === out && !/^-?0\d/.test(text) && digits.length <= 15;
    }
    if (Array.isArray(out) && Array.isArray(original)) {
        return out.length === original.length && out.every((item, i) => sameValue(item, original[i]));
    }
    return false;
}

/**
 * Every non-blank cell of the file, and what the imported row holds for it,
 * where the two differ — empty when nothing was lost or changed on the way.
 */
export function lostCells(result: Awaited<ReturnType<typeof importIntoNewCollection>>): string[] {
    const lost: string[] = [];
    result.loaded.data.forEach((row, i) => {
        const flat = flattenEntry(row as Record<string, unknown>);
        for (const [key, value] of Object.entries(flat)) {
            if (key === result.idColumn) continue;
            if (value === "" || value === null || value === undefined) continue;
            const mapped = Object.hasOwn(result.headersMapping, key) ? result.headersMapping[key] : key;
            const out = mapped ? valueAt(result.entities[i].values, mapped) : undefined;
            if (!sameValue(out, value)) {
                lost.push(`row ${i} '${key}': ${JSON.stringify(value)} -> ${JSON.stringify(out)}`);
            }
        }
    });
    return lost;
}
