/**
 * @jest-environment jsdom
 */
import {
    getEntityPreviewKeys,
    getEntityTitlePropertyKey,
    resolveTitleToString
} from "../../src/util/previews";
import type { CollectionConfig, Property } from "@rebasepro/types";
import type { AuthController, PropertyConfig } from "@rebasepro/admin-types";

const mockAuthController = {
    user: { uid: "test" },
    initialLoading: false
} as unknown as AuthController;

const fields: Record<string, PropertyConfig> = {};

// ---------------------------------------------------------------------------
// getEntityPreviewKeys
// ---------------------------------------------------------------------------
describe("getEntityPreviewKeys", () => {
    it("returns previewProperties when explicitly passed", () => {
        const collection: CollectionConfig = {
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
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields, ["title", "status"]);
        expect(result).toEqual(["title", "status"]);
    });

    it("falls back to collection.previewProperties when no explicit list", () => {
        const collection: CollectionConfig = {
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
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).toEqual(["body"]);
    });

    it("auto-selects up to 3 non-reference, non-relation, non-id properties", () => {
        const collection: CollectionConfig = {
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
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).toHaveLength(3);
        expect(result).toEqual(["title", "body", "count"]);
    });

    it("excludes reference properties from auto-selection", () => {
        const collection: CollectionConfig = {
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
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("author");
    });

    it("excludes relation properties from auto-selection", () => {
        const collection: CollectionConfig = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property,
                tags: { type: "relation",
name: "Tags" } as Property
            }
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("tags");
    });

    it("excludes id properties from auto-selection", () => {
        const collection: CollectionConfig = {
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
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("id");
    });

    it("excludes hidden properties from auto-selection", () => {
        const collection: CollectionConfig = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property,
                secret: { type: "string",
name: "Secret",
admin: { hideFromCollection: true } } as Property,
                body: { type: "string",
name: "Body" } as Property
            }
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("secret");
        expect(result).toContain("title");
        expect(result).toContain("body");
    });

    it("respects the limit parameter", () => {
        const collection: CollectionConfig = {
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
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields, undefined, 2);
        expect(result).toHaveLength(2);
    });

    it("filters out previewProperties that don't exist in collection properties", () => {
        const collection: CollectionConfig = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" } as Property
            }
        } as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields, ["title", "nonexistent"]);
        expect(result).toEqual(["title"]);
    });

    // -----------------------------------------------------------------------
    // Values that have no one-line form. The card is a fixed-height box; a
    // property that renders as a document or a table cannot fill a line of it.
    // -----------------------------------------------------------------------

    /** The shape that produced the bug: an author whose third column is a bio. */
    const authorsCollection = {
        id: "authors",
        name: "Authors",
        path: "authors",
        propertiesOrder: ["id", "name", "email", "picture", "bio", "twitter"],
        properties: {
            id: { type: "string",
name: "ID",
isId: "uuid" },
            name: { type: "string",
name: "Name" },
            email: { type: "string",
name: "Email" },
            picture: { type: "string",
name: "Picture",
storage: { storagePath: "author_pictures/" } },
            bio: { type: "string",
name: "Bio",
admin: { markdown: true } },
            twitter: { type: "string",
name: "Twitter" }
        }
    } as unknown as CollectionConfig;

    it("does not spend a card line on a Markdown field when plain ones remain", () => {
        const result = getEntityPreviewKeys(mockAuthController, authorsCollection, fields);
        expect(result).not.toContain("bio");
        expect(result).toEqual(["name", "email", "twitter"]);
    });

    it("falls back to a Markdown field when it is all there is", () => {
        const collection = {
            id: "articles",
            name: "Articles",
            path: "articles",
            properties: {
                body: { type: "string",
name: "Body",
admin: { markdown: true } }
            }
        } as unknown as CollectionConfig;

        expect(getEntityPreviewKeys(mockAuthController, collection, fields)).toEqual(["body"]);
    });

    it("still returns a Markdown field when the collection asks for it by name", () => {
        const result = getEntityPreviewKeys(mockAuthController, authorsCollection, fields, ["bio"]);
        expect(result).toEqual(["bio"]);
    });

    it("excludes maps and arrays of maps, which render as tables", () => {
        const collection = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                title: { type: "string",
name: "Title" },
                address: { type: "map",
name: "Address",
properties: { street: { type: "string",
name: "Street" } } },
                contacts: { type: "array",
name: "Contacts",
of: { type: "map",
name: "Contact",
properties: {} } },
                tags: { type: "array",
name: "Tags",
of: { type: "string",
name: "Tag" } }
            }
        } as unknown as CollectionConfig;

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("address");
        expect(result).not.toContain("contacts");
        expect(result).toEqual(["title", "tags"]);
    });

    it("orders long text after short text regardless of propertiesOrder", () => {
        // `propertiesOrder` states the column order of the collection table. It
        // is not a claim that the first columns summarise a record, and reading
        // it as one is what put a biography on an author card.
        const collection = {
            id: "test",
            name: "Test",
            path: "test",
            propertiesOrder: ["description", "status"],
            properties: {
                description: { type: "string",
name: "Description",
admin: { multiline: true } },
                status: { type: "string",
name: "Status" }
            }
        } as unknown as CollectionConfig;

        expect(getEntityPreviewKeys(mockAuthController, collection, fields)).toEqual(["status", "description"]);
    });
});

// ---------------------------------------------------------------------------
// getEntityTitlePropertyKey
// ---------------------------------------------------------------------------
describe("getEntityTitlePropertyKey", () => {
    it("returns the explicit display.title when set", () => {
        const collection: CollectionConfig = {
            id: "test",
            name: "Test",
            path: "test",
            display: { title: "name" },
            properties: {
                name: { type: "string",
name: "Name" } as Property,
                body: { type: "string",
name: "Body",
admin: { multiline: true } } as Property
            }
        } as CollectionConfig;

        expect(getEntityTitlePropertyKey(collection)).toBe("name");
    });

    it("auto-detects first single-line text field as title", () => {
        const collection: CollectionConfig = {
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
admin: { multiline: true } } as Property
            }
        } as CollectionConfig;

        expect(getEntityTitlePropertyKey(collection)).toBe("title");
    });

    it("skips multiline text fields", () => {
        const collection: CollectionConfig = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                description: { type: "string",
name: "Description",
admin: { multiline: true } } as Property,
                name: { type: "string",
name: "Name" } as Property
            }
        } as CollectionConfig;

        expect(getEntityTitlePropertyKey(collection)).toBe("name");
    });

    it("skips markdown text fields", () => {
        const collection: CollectionConfig = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                content: { type: "string",
name: "Content",
admin: { markdown: true } } as Property,
                slug: { type: "string",
name: "Slug" } as Property
            }
        } as CollectionConfig;

        expect(getEntityTitlePropertyKey(collection)).toBe("slug");
    });

    it("skips storage text fields", () => {
        const collection: CollectionConfig = {
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
        } as CollectionConfig;

        expect(getEntityTitlePropertyKey(collection)).toBe("label");
    });

    it("skips isId fields", () => {
        const collection: CollectionConfig = {
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
        } as CollectionConfig;

        expect(getEntityTitlePropertyKey(collection)).toBe("name");
    });

    it("returns undefined when no suitable title field exists", () => {
        const collection: CollectionConfig = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                count: { type: "number",
name: "Count" } as Property,
                flag: { type: "boolean",
name: "Flag" } as Property
            }
        } as CollectionConfig;

        expect(getEntityTitlePropertyKey(collection)).toBeUndefined();
    });

    it("skips hidden properties when auto-detecting title", () => {
        const collection: CollectionConfig = {
            id: "test",
            name: "Test",
            path: "test",
            properties: {
                secret: { type: "string",
name: "Secret",
admin: { hideFromCollection: true } } as Property,
                name: { type: "string",
name: "Name" } as Property
            }
        } as CollectionConfig;

        expect(getEntityTitlePropertyKey(collection)).toBe("name");
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
            isEntityReference: () => true
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

