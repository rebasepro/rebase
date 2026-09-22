import { describe, expect, test } from "@jest/globals";
import { Properties } from "@rebasepro/types";
import { cleanPropertiesFromImport } from "../../src/collection_editor/ui/collection_editor/import/clean_import_data";

/**
 * Creating a collection from a file guesses its id column the same way an
 * import into an existing one does. The guessed column is dropped from the new
 * collection's properties and becomes each row's id, so a `width` column picked
 * for containing "id" lost the property and collapsed every two rows of the
 * same width into one record.
 */
describe("cleanPropertiesFromImport id column", () => {

    const inferred = (keys: string[]): Properties =>
        Object.fromEntries(keys.map(key => [key, { type: "string" }]));

    test.each([["width"], ["video"], ["provider"], ["monkey"]])("does not pick %j", (key) => {
        expect(cleanPropertiesFromImport(inferred([key, "title"])).idColumn).toBeUndefined();
    });

    test("picks a first column named id", () => {
        expect(cleanPropertiesFromImport(inferred(["id", "title"])).idColumn).toEqual("id");
    });
});
