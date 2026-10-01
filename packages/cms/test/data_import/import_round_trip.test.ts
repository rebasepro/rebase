import { describe, expect, test } from "@jest/globals";
import { importIntoNewCollection, lostCells } from "./fixtures/pipeline";

/**
 * A file imported into a new collection keeps every value it holds. Each
 * fixture is a shape that once lost data on the way in, silently.
 */
describe("creating a collection from a file keeps every value", () => {

    // The nested keys are slugged (`streetName` → `streetname`) for the
    // schema, and the mapping from the file's key to the slug was computed
    // for the children and then dropped: only `country`, already a slug,
    // survived the import.
    test.each([["p_nested_camel.json"], ["q_nested_camel.csv"]])("nested camelCase, capitalised and spaced keys (%s)", async (file) => {
        const result = await importIntoNewCollection(file);
        expect(lostCells(result)).toEqual([]);
        expect(result.entities[0].values).toMatchObject({ address: { streetname: "Main St", city: "Oslo" } });
    });
});
