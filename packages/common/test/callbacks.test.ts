import { buildPropertyCallbacks } from "../src/util/callbacks";
import type { Properties, Property } from "@rebasepro/types";

describe("buildPropertyCallbacks", () => {
    it("returns undefined when no properties have callbacks", () => {
        const properties: Properties = {
            title: { name: "title",
type: "string" },
            count: { name: "count",
type: "number" }
        };
        expect(buildPropertyCallbacks(properties)).toBeUndefined();
    });

    it("returns CollectionCallbacks with afterRead when a property has afterRead", () => {
        const properties: Properties = {
            title: {
                name: "title",
                type: "string",
                callbacks: {
                    afterRead: ({ value }) => (value as string).toUpperCase()
                }
            } as Property
        };

        const callbacks = buildPropertyCallbacks(properties);
        expect(callbacks).toBeDefined();
        expect(callbacks?.afterRead).toBeDefined();
        expect(callbacks?.beforeSave).toBeUndefined();
    });

    it("returns CollectionCallbacks with beforeSave when a property has beforeSave", () => {
        const properties: Properties = {
            slug: {
                name: "slug",
                type: "string",
                callbacks: {
                    beforeSave: ({ value }) => (value as string).toLowerCase()
                }
            } as Property
        };

        const callbacks = buildPropertyCallbacks(properties);
        expect(callbacks).toBeDefined();
        expect(callbacks?.beforeSave).toBeDefined();
        expect(callbacks?.afterRead).toBeUndefined();
    });

    it("returns both afterRead and beforeSave when properties have both", () => {
        const properties: Properties = {
            title: {
                name: "title",
                type: "string",
                callbacks: {
                    afterRead: ({ value }) => value
                }
            } as Property,
            slug: {
                name: "slug",
                type: "string",
                callbacks: {
                    beforeSave: ({ value }) => value
                }
            } as Property
        };

        const callbacks = buildPropertyCallbacks(properties);
        expect(callbacks).toBeDefined();
        expect(callbacks?.afterRead).toBeDefined();
        expect(callbacks?.beforeSave).toBeDefined();
    });

    it("afterRead callback transforms snapshot values", async () => {
        const properties: Properties = {
            title: {
                name: "title",
                type: "string",
                callbacks: {
                    afterRead: ({ value }) => (value as string).toUpperCase()
                }
            } as Property
        };

        const callbacks = buildPropertyCallbacks(properties);
        const result = await callbacks?.afterRead?.({
            row: { id: "1",
title: "hello" }
        } as never);

        expect((result as Record<string, unknown>)?.title).toBe("HELLO");
    });

    it("beforeSave callback transforms values", async () => {
        const properties: Properties = {
            slug: {
                name: "slug",
                type: "string",
                callbacks: {
                    beforeSave: ({ value }) => (value as string).toLowerCase().replace(/\s+/g, "-")
                }
            } as Property
        };

        const callbacks = buildPropertyCallbacks(properties);
        const result = await callbacks?.beforeSave?.({
            values: { slug: "Hello World" },
            previousValues: { slug: "old" }
        } as never);

        expect((result as Record<string, unknown>)?.slug).toBe("hello-world");
    });

    it("properties without callbacks pass through unchanged", async () => {
        const properties: Properties = {
            title: {
                name: "title",
                type: "string",
                callbacks: {
                    afterRead: ({ value }) => (value as string).toUpperCase()
                }
            } as Property,
            description: { name: "description",
type: "string" }
        };

        const callbacks = buildPropertyCallbacks(properties);
        const result = await callbacks?.afterRead?.({
            row: {
                id: "1",
                title: "hello",
                description: "unchanged"
            }
        } as never);

        expect((result as Record<string, unknown>)?.title).toBe("HELLO");
        expect((result as Record<string, unknown>)?.description).toBe("unchanged");
    });

    it("handles nested map properties with callbacks", () => {
        const properties: Properties = {
            address: {
                name: "address",
                type: "map",
                properties: {
                    city: {
                        name: "city",
                        type: "string",
                        callbacks: {
                            beforeSave: ({ value }) => value
                        }
                    } as Property
                }
            }
        };

        const callbacks = buildPropertyCallbacks(properties);
        expect(callbacks).toBeDefined();
        expect(callbacks?.beforeSave).toBeDefined();
    });

    it("handles array properties with callbacks", () => {
        const properties: Properties = {
            tags: {
                name: "tags",
                type: "array",
                of: {
                    name: "tag",
                    type: "string",
                    callbacks: {
                        afterRead: ({ value }) => value
                    }
                } as Property
            }
        };

        const callbacks = buildPropertyCallbacks(properties);
        expect(callbacks).toBeDefined();
        expect(callbacks?.afterRead).toBeDefined();
    });

    it("returns undefined for empty properties", () => {
        expect(buildPropertyCallbacks({})).toBeUndefined();
    });

    it("returns undefined for undefined input", () => {
        expect(buildPropertyCallbacks(undefined as unknown as Properties)).toBeUndefined();
    });
});
