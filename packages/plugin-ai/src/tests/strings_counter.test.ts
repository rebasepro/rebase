import { countStringCharacters } from "../utils/strings_counter";
import type { Properties } from "@rebasepro/types";

describe("countStringCharacters", () => {
    it("counts characters in a string property", () => {
        const values = { title: "Hello World" };
        const properties: Properties = {
            title: { name: "title",
type: "string" }
        };
        expect(countStringCharacters(values, properties)).toBe(11);
    });

    it("counts characters in a number property (stringified)", () => {
        const values = { price: 12345 };
        const properties: Properties = {
            price: { name: "price",
type: "number" }
        };
        expect(countStringCharacters(values, properties)).toBe(5);
    });

    it("skips disabled properties", () => {
        const values = { title: "Hello",
hidden: "Secret" };
        const properties: Properties = {
            title: { name: "title",
type: "string" },
            hidden: { name: "hidden",
type: "string",
admin: { disabled: true } }
        };
        expect(countStringCharacters(values, properties)).toBe(5);
    });

    it("counts array of strings", () => {
        const values = { tags: ["hello", "world", "test"] };
        const properties: Properties = {
            tags: {
                name: "tags",
                type: "array",
                of: { name: "tag",
type: "string" }
            }
        };
        // "hello" (5) + "world" (5) + "test" (4) = 14
        expect(countStringCharacters(values, properties)).toBe(14);
    });

    it("recurses into map properties", () => {
        const values = {
            address: { city: "New York",
country: "USA" }
        };
        const properties: Properties = {
            address: {
                name: "address",
                type: "map",
                properties: {
                    city: { name: "city",
type: "string" },
                    country: { name: "country",
type: "string" }
                }
            }
        };
        // "New York" (8) + "USA" (3) = 11
        expect(countStringCharacters(values, properties)).toBe(11);
    });

    it("returns 0 for empty values", () => {
        const properties: Properties = {
            title: { name: "title",
type: "string" }
        };
        expect(countStringCharacters({}, properties)).toBe(0);
    });

    it("handles mixed property types", () => {
        const values = {
            title: "Hello",
            count: 42,
            active: true,
            tags: ["a", "bb"]
        };
        const properties: Properties = {
            title: { name: "title",
type: "string" },
            count: { name: "count",
type: "number" },
            active: { name: "active",
type: "boolean" },
            tags: {
                name: "tags",
                type: "array",
                of: { name: "tag",
type: "string" }
            }
        };
        // "Hello" (5) + "42" (2) + "a" (1) + "bb" (2) = 10
        expect(countStringCharacters(values, properties)).toBe(10);
    });

    it("handles null values in array gracefully", () => {
        const values = { tags: [null, "hello", null] };
        const properties: Properties = {
            tags: {
                name: "tags",
                type: "array",
                of: { name: "tag",
type: "string" }
            }
        };
        // null?.length = 0, "hello" = 5, null?.length = 0
        expect(countStringCharacters(values, properties)).toBe(5);
    });
});
