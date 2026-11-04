import { describe, expect, jest, test } from "@jest/globals";
import { unflattenObject } from "../../src/data_import/utils/transforms";

describe("UnflattenObject function", () => {

    test("keeps the nested columns when a plain column shares their name, in either order", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => undefined);
        // A plain cell first: writing an index into its text threw, and the
        // whole file failed to read.
        expect(unflattenObject({ tags: "a;b", "tags[0]": "a", "tags[1]": "b" })).toEqual({ tags: ["a", "b"] });
        expect(unflattenObject({ "tags[0]": "a", tags: "a;b" })).toEqual({ tags: ["a"] });
        expect(unflattenObject({ address: "Main St 1", "address.city": "Lisbon" })).toEqual({ address: { city: "Lisbon" } });
        // An empty plain cell is no conflict worth reporting.
        warn.mockClear();
        expect(unflattenObject({ tags: "", "tags[0]": "a" })).toEqual({ tags: ["a"] });
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    test("reads an indexed column whose name has a hyphen", () => {
        expect(unflattenObject({ "my-tags[0]": "a", "my-tags[1]": "b" })).toEqual({ "my-tags": ["a", "b"] });
    });

    test("Unflattens dotted and indexed keys into nested objects and arrays", () => {
        const input = {
            key1: "value1",
            "key2.key3": "value3",
            "array[0]": "valueA",
            "array[1]": "valueB",
            "key4.key5.key6": "value6"
        };

        const output = unflattenObject(input);

        expect(output).toEqual({
            key1: "value1",
            key2: {
                key3: "value3"
            },
            array: ["valueA", "valueB"],
            key4: {
                key5: {
                    key6: "value6"
                }
            }
        });
    });

    test("Multiple arrays test", () => {
        const input = {
            "images[0]": "dadaki/B000P0MDMS-576916726.jpg",
            "images[1]": "dadaki/B000P0MDMS-1415254616.jpg",
            "available_locales[0]": "fr",
            "available_locales[1]": "it"
        };

        const output = unflattenObject(input);

        expect(output).toEqual({
            images: [
                "dadaki/B000P0MDMS-576916726.jpg",
                "dadaki/B000P0MDMS-1415254616.jpg"
            ],
            available_locales: ["fr", "it"]
        });
    });

    test("Unflattens deeply nested and mixed object/array keys", () => {
        const input = {
            keyA: "value1",
            "keyB.keyC.keyD": "value2",
            "keyE[0]": "value3",
            "keyE[1]": "value4",
            "keyF.keyG[0]": "value5",
            "keyF.keyG[1]": "value6",
            "keyH.keyI[0].keyJ": "value7",
            "keyH.keyI[1].keyJ": "value8"
        };

        const output = unflattenObject(input);

        expect(output).toEqual({
            keyA: "value1",
            keyB: {
                keyC: {
                    keyD: "value2"
                }
            },
            keyE: ["value3", "value4"],
            keyF: {
                keyG: ["value5", "value6"]
            },
            keyH: {
                keyI: [
                    { keyJ: "value7" },
                    { keyJ: "value8" }
                ]
            }
        });
    });

});
