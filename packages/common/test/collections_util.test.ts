import { sortProperties, getPrimaryKeys } from "../src/util/collections";
import { CollectionConfig, Properties } from "@rebasepro/types";

describe("collections utils", () => {
    describe("sortProperties", () => {
        const properties: Properties = {
            c: { name: "C", type: "string" },
            a: { name: "A", type: "string" },
            b: { name: "B", type: "string" }
        };

        it("should return properties in original order if no order provided", () => {
            const result = sortProperties(properties);
            expect(Object.keys(result)).toEqual(["c", "a", "b"]);
        });

        it("should sort properties according to provided order", () => {
            const result = sortProperties(properties, ["a", "b", "c"]);
            expect(Object.keys(result)).toEqual(["a", "b", "c"]);
        });

        it("should append missing properties at the end", () => {
            const result = sortProperties(properties, ["b"]);
            expect(Object.keys(result)).toEqual(["b", "c", "a"]);
        });

        it("should handle nested map properties", () => {
            const nestedProperties: Properties = {
                user: {
                    name: "User",
                    type: "map",
                    properties: {
                        lastName: { name: "Last Name", type: "string" },
                        firstName: { name: "First Name", type: "string" }
                    },
                    propertiesOrder: ["firstName", "lastName"]
                }
            };

            const result = sortProperties(nestedProperties);
            const userProp = result.user as any;
            expect(Object.keys(userProp.properties)).toEqual(["firstName", "lastName"]);
        });
    });

    describe("getPrimaryKeys", () => {
        it("should return ['id'] if no properties have isId", () => {
            const collection = {
                properties: {
                    name: { name: "Name", type: "string" }
                }
            } as any as CollectionConfig;
            expect(getPrimaryKeys(collection)).toEqual(["id"]);
        });

        it("should return properties marked with isId", () => {
            const collection = {
                properties: {
                    sku: { name: "SKU", type: "string", isId: true },
                    name: { name: "Name", type: "string" }
                }
            } as any as CollectionConfig;
            expect(getPrimaryKeys(collection)).toEqual(["sku"]);
        });

        it("should return multiple properties if multiple have isId", () => {
            const collection = {
                properties: {
                    orgId: { name: "Org ID", type: "string", isId: true },
                    userId: { name: "User ID", type: "string", isId: true },
                    name: { name: "Name", type: "string" }
                }
            } as any as CollectionConfig;
            expect(getPrimaryKeys(collection)).toEqual(["orgId", "userId"]);
        });
    });
});
