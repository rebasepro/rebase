import { describe, expect, test } from "@jest/globals";
import { Properties } from "@rebasepro/types";
import { guessIdColumn } from "../../src/data_import/utils/id_column";

/**
 * The column the import picks as the row id before the user touches the
 * mapping. It is removed from the values and sent as the id of an upsert, so a
 * wrong guess overwrites whichever records happen to have that id.
 */
describe("guessIdColumn", () => {

    const properties: Properties = {
        width: { type: "number" },
        video: { type: "string" },
        title: { type: "string" }
    };

    const identity = (headers: string[]) =>
        Object.fromEntries(headers.map(h => [h, h]));

    // Each of these used to be picked because the header merely contained "id"
    // or "key": `width=100` then overwrote the record whose id is 100.
    test.each([
        ["width"],
        ["video"],
        ["provider"],
        ["hockey"],
        ["monkey"],
        ["keywords"],
        ["idea"]
    ])("does not pick %j, which only contains \"id\" or \"key\"", (header) => {
        const headers = [header, "title"];
        expect(guessIdColumn(headers, identity(headers), properties)).toBeUndefined();
    });

    test.each([["id"], ["ID"], ["Id"], [" id "]])("picks a first column named %j", (header) => {
        const headers = [header, "title"];
        expect(guessIdColumn(headers, identity(headers), properties)).toEqual(header);
    });

    test("picks the first column when it maps onto the collection's id property", () => {
        const withSku: Properties = {
            sku: { type: "string", isId: "manual" },
            title: { type: "string" }
        };
        expect(guessIdColumn(["sku", "title"], { sku: "sku", title: "title" }, withSku)).toEqual("sku");
        // Through the header mapping: "SKU code" was slugified onto `sku`.
        expect(guessIdColumn(["SKU code", "title"], { "SKU code": "sku", title: "title" }, withSku)).toEqual("SKU code");
    });

    test("does not pick a first column that maps onto an ordinary property", () => {
        const withKey: Properties = {
            key: { type: "string" },
            value: { type: "string" }
        };
        expect(guessIdColumn(["key", "value"], { key: "key", value: "value" }, withKey)).toBeUndefined();
    });

    test("only the first column is a candidate", () => {
        const headers = ["title", "id"];
        expect(guessIdColumn(headers, identity(headers), properties)).toBeUndefined();
    });

    test("no headers, no id", () => {
        expect(guessIdColumn([], {}, properties)).toBeUndefined();
    });
});
