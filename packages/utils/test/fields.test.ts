import { isDefaultFieldConfigId } from "../src/fields";

describe("isDefaultFieldConfigId", () => {
    const validIds = [
        "text_field",
        "multiline",
        "markdown",
        "url",
        "email",
        "switch",
        "select",
        "multi_select",
        "number_input",
        "number_select",
        "multi_number_select",
        "file_upload",
        "multi_file_upload",
        "reference_as_string",
        "reference",
        "multi_references",
        "relation",
        "date_time",
        "group",
        "key_value",
        "repeat",
        "custom_array",
        "block",
    ];

    it.each(validIds)("returns true for known field config id: '%s'", (id) => {
        expect(isDefaultFieldConfigId(id)).toBe(true);
    });

    it("returns false for unknown field config ids", () => {
        expect(isDefaultFieldConfigId("unknown")).toBe(false);
        expect(isDefaultFieldConfigId("")).toBe(false);
        expect(isDefaultFieldConfigId("text")).toBe(false);
        expect(isDefaultFieldConfigId("TEXT_FIELD")).toBe(false);
        expect(isDefaultFieldConfigId("TextField")).toBe(false);
    });

    it("is case-sensitive", () => {
        expect(isDefaultFieldConfigId("Text_Field")).toBe(false);
        expect(isDefaultFieldConfigId("SWITCH")).toBe(false);
    });

    it("does not match partial ids", () => {
        expect(isDefaultFieldConfigId("text_")).toBe(false);
        expect(isDefaultFieldConfigId("multi")).toBe(false);
        expect(isDefaultFieldConfigId("file")).toBe(false);
    });
});
