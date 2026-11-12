import { describe, expect, it } from "@jest/globals";
import { declaredSchemaOf } from "../src/table";

describe("declaredSchemaOf", () => {
    it("is undefined for public, the schema nothing declares", () => {
        expect(declaredSchemaOf({ schema: "public" })).toBeUndefined();
    });

    it("names any other schema", () => {
        expect(declaredSchemaOf({ schema: "billing" })).toBe("billing");
    });
});
