/**
 * @jest-environment jsdom
 */
import {
    getSnapshotPreviewKeys,
    getSnapshotTitlePropertyKey,
    resolveTitleToString
} from "../../src/util/previews";
import type { AuthController, SnapshotCollection, PropertyConfig, Property } from "@rebasepro/types";

const mockAuthController = {
    user: { uid: "test" },
    initialLoading: false
} as unknown as AuthController;

const fields: Record<string, PropertyConfig> = {};

// ---------------------------------------------------------------------------
// getSnapshotPreviewKeys
// ---------------------------------------------------------------------------
describe("getSnapshotPreviewKeys", () => {
    it("returns previewProperties when explicitly passed", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property,
                body: { type: "string",
name: "Body" } as Property,
                status: { type: "string",
name: "Status" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields, ["title", "status"]);
        expect(result).toEqual(["title", "status"]);
    });

    it("falls back to collection.previewProperties when no explicit list", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            previewProperties: ["body"],
            properties: {
                title: { type: "string",
name: "Title" } as Property,
                body: { type: "string",
name: "Body" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields);
        expect(result).toEqual(["body"]);
    });

    it("auto-selects up to 3 non-reference, non-relation, non-id properties", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property,
                body: { type: "string",
name: "Body" } as Property,
                count: { type: "number",
name: "Count" } as Property,
                extra: { type: "string",
name: "Extra" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields);
        expect(result).toHaveLength(3);
        expect(result).toEqual(["title", "body", "count"]);
    });

    it("excludes reference properties from auto-selection", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property,
                author: { type: "reference",
name: "Author",
path: "users" } as Property,
                body: { type: "string",
name: "Body" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("author");
    });

    it("excludes relation properties from auto-selection", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property,
                tags: { type: "relation",
name: "Tags" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("tags");
    });

    it("excludes id properties from auto-selection", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                id: { type: "string",
name: "ID",
isId: true } as unknown as Property,
                title: { type: "string",
name: "Title" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("id");
    });

    it("excludes hidden properties from auto-selection", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property,
                secret: { type: "string",
name: "Secret",
ui: { hideFromCollection: true } } as Property,
                body: { type: "string",
name: "Body" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("secret");
        expect(result).toContain("title");
        expect(result).toContain("body");
    });

    it("respects the limit parameter", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                a: { type: "string",
name: "A" } as Property,
                b: { type: "string",
name: "B" } as Property,
                c: { type: "string",
name: "C" } as Property,
                d: { type: "string",
name: "D" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields, undefined, 2);
        expect(result).toHaveLength(2);
    });

    it("filters out previewProperties that don't exist in collection properties", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property
            }
        } as SnapshotCollection;

        const result = getSnapshotPreviewKeys(mockAuthController, collection, fields, ["title", "nonexistent"]);
        expect(result).toEqual(["title"]);
    });
});

// ---------------------------------------------------------------------------
// getSnapshotTitlePropertyKey
// ---------------------------------------------------------------------------
describe("getSnapshotTitlePropertyKey", () => {
    it("returns explicit titleProperty when set", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            titleProperty: "name",
            properties: {
                name: { type: "string",
name: "Name" } as Property,
                body: { type: "string",
name: "Body",
ui: { multiline: true } } as Property
            }
        } as SnapshotCollection;

        expect(getSnapshotTitlePropertyKey(collection, fields)).toBe("name");
    });

    it("auto-detects first single-line text field as title", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                count: { type: "number",
name: "Count" } as Property,
                title: { type: "string",
name: "Title" } as Property,
                body: { type: "string",
name: "Body",
ui: { multiline: true } } as Property
            }
        } as SnapshotCollection;

        expect(getSnapshotTitlePropertyKey(collection, fields)).toBe("title");
    });

    it("skips multiline text fields", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                description: { type: "string",
name: "Description",
ui: { multiline: true } } as Property,
                name: { type: "string",
name: "Name" } as Property
            }
        } as SnapshotCollection;

        expect(getSnapshotTitlePropertyKey(collection, fields)).toBe("name");
    });

    it("skips markdown text fields", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                content: { type: "string",
name: "Content",
ui: { markdown: true } } as Property,
                slug: { type: "string",
name: "Slug" } as Property
            }
        } as SnapshotCollection;

        expect(getSnapshotTitlePropertyKey(collection, fields)).toBe("slug");
    });

    it("skips storage text fields", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                attachment: { type: "string",
name: "File",
storage: { bucket: "test" } } as unknown as Property,
                label: { type: "string",
name: "Label" } as Property
            }
        } as SnapshotCollection;

        expect(getSnapshotTitlePropertyKey(collection, fields)).toBe("label");
    });

    it("skips isId fields", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                id: { type: "string",
name: "ID",
isId: true } as unknown as Property,
                name: { type: "string",
name: "Name" } as Property
            }
        } as SnapshotCollection;

        expect(getSnapshotTitlePropertyKey(collection, fields)).toBe("name");
    });

    it("returns undefined when no suitable title field exists", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                count: { type: "number",
name: "Count" } as Property,
                flag: { type: "boolean",
name: "Flag" } as Property
            }
        } as SnapshotCollection;

        expect(getSnapshotTitlePropertyKey(collection, fields)).toBeUndefined();
    });

    it("skips hidden properties when auto-detecting title", () => {
        const collection: SnapshotCollection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                secret: { type: "string",
name: "Secret",
ui: { hideFromCollection: true } } as Property,
                name: { type: "string",
name: "Name" } as Property
            }
        } as SnapshotCollection;

        expect(getSnapshotTitlePropertyKey(collection, fields)).toBe("name");
    });
});

describe("resolveTitleToString", () => {
    it("handles primitives correctly", () => {
        expect(resolveTitleToString("hello")).toBe("hello");
        expect(resolveTitleToString(123)).toBe("123");
        expect(resolveTitleToString(true)).toBe("true");
        expect(resolveTitleToString(null)).toBe("");
        expect(resolveTitleToString(undefined)).toBe("");
    });

    it("handles relation objects correctly", () => {
        const relationWithEagerValues = {
            __type: "relation",
            id: "author-1",
            path: "authors",
            data: {
                id: "author-1",
                path: "authors",
                values: {
                    name: "John Doe",
                    bio: "Writer"
                }
            }
        };
        expect(resolveTitleToString(relationWithEagerValues)).toBe("John Doe");

        const relationWithIdOnly = {
            __type: "relation",
            id: "author-2",
            path: "authors"
        };
        expect(resolveTitleToString(relationWithIdOnly)).toBe("author-2");
    });

    it("handles reference objects correctly", () => {
        const reference = {
            id: "ref-1",
            path: "refs",
            isSnapshotReference: () => true
        };
        expect(resolveTitleToString(reference)).toBe("ref-1");
    });

    it("handles dates correctly", () => {
        const date = new Date("2026-06-17T00:00:00.000Z");
        expect(resolveTitleToString(date)).toBe(date.toLocaleDateString());
    });

    it("handles generic objects fallback using properties", () => {
        const customObj = {
            title: "My Special Title",
            description: "Some desc"
        };
        expect(resolveTitleToString(customObj)).toBe("My Special Title");

        const anotherObj = {
            name: "Object Name"
        };
        expect(resolveTitleToString(anotherObj)).toBe("Object Name");
    });
});

