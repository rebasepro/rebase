import { describe, expect, test } from "@jest/globals";
import type { Properties } from "@rebasepro/types";
import { createCsvExportWriter } from "../../src/data_export/export/export";

/**
 * A collection that declares its key as a property named `id` and sets no
 * `propertiesOrder` exported two `id` columns: the export's own, and the
 * property's. A file with a duplicate header is one the import refuses.
 */
function headerRow(properties: Properties, propertiesOrder?: string[]): string {
    const writer = createCsvExportWriter({
        properties,
        propertiesOrder,
        additionalHeaders: undefined,
        flattenArrays: false,
        dateExportType: "string"
    });
    writer.addPage([{ id: "p-1", path: "products", values: { id: "p-1", name: "Lamp" } }]);
    return writer.finish().join("").split("\r\n")[0];
}

describe("the id column", () => {
    test("is written once when the key is declared as a property", () => {
        expect(headerRow({ id: { type: "string", isId: "manual" }, name: { type: "string" } })).toBe("\"id\",\"name\"");
    });

    test("is written once when propertiesOrder names it", () => {
        expect(headerRow({ id: { type: "string", isId: "manual" }, name: { type: "string" } }, ["id", "name"])).toBe("\"id\",\"name\"");
    });

    test("is written for a collection that does not declare it", () => {
        expect(headerRow({ name: { type: "string" } })).toBe("\"id\",\"name\"");
    });
});
