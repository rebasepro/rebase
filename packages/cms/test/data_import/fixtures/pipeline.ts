/**
 * Fixture files, read the way the import reads them:
 *
 *   CSV   parseCsvToObjects → mapJsonParse → unflattenObject
 *   JSON  JSON.parse, order = keys of the first row
 *
 * The fixtures are messy real-world shapes (zip codes, SKUs, sparse columns,
 * nested camelCase keys…) that once lost data on the way in. They used to be
 * run through the collection editor's "create a collection from a file" path
 * too; that editor is gone, and what remains is importing into an existing
 * table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsvToObjects } from "../../../src/data_import/utils/csv";
import { mapJsonParse, unflattenObject } from "../../../src/data_import/utils/transforms";

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
