/**
 * @jest-environment jsdom
 */
import {
    getEntityPreviewKeys,
    getEntityTitlePropertyKey,
    resolveTitleToString
} from "../../src/util/previews";
import type { AdminCollection, AuthController, PropertyConfig, CollectionConfig, Property } from "@rebasepro/cms-types";
import { fakeAuthController, fakeUser } from "../helpers/fakes";

const mockAuthController = fakeAuthController({ user: fakeUser("test") });

const fields: Record<string, PropertyConfig> = {};

// ---------------------------------------------------------------------------
// getEntityPreviewKeys
// ---------------------------------------------------------------------------
describe("getEntityPreviewKeys", () => {
    it("returns previewProperties when explicitly passed", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                title: { type: "string",
name: "Title" },
                body: { type: "string",
name: "Body" },
                status: { type: "string",
name: "Status" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields, ["title", "status"]);
        expect(result).toEqual(["title", "status"]);
    });

    it("falls back to collection.previewProperties when no explicit list", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            previewProperties: ["body"],
            properties: {
                title: { type: "string",
name: "Title" },
                body: { type: "string",
name: "Body" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).toEqual(["body"]);
    });

    it("auto-selects up to 3 non-reference, non-relation, non-id properties", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                title: { type: "string",
name: "Title" },
                body: { type: "string",
name: "Body" },
                count: { type: "number",
name: "Count" },
                extra: { type: "string",
name: "Extra" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).toHaveLength(3);
        expect(result).toEqual(["title", "body", "count"]);
    });

    it("excludes reference properties from auto-selection", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                title: { type: "string",
name: "Title" },
                author: { type: "reference",
name: "Author",
path: "users" },
                body: { type: "string",
name: "Body" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("author");
    });

    it("excludes relation properties from auto-selection", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                title: { type: "string",
name: "Title" },
                tags: { type: "relation",
name: "Tags" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("tags");
    });

    it("excludes id properties from auto-selection", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                id: { type: "string",
name: "ID",
isId: true },
                title: { type: "string",
name: "Title" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("id");
    });

    it("excludes hidden properties from auto-selection", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                title: { type: "string",
name: "Title" },
                secret: { type: "string",
name: "Secret",
admin: { hideFromCollection: true } },
                body: { type: "string",
name: "Body" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("secret");
        expect(result).toContain("title");
        expect(result).toContain("body");
    });

    it("respects the limit parameter", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                a: { type: "string",
name: "A" },
                b: { type: "string",
name: "B" },
                c: { type: "string",
name: "C" },
                d: { type: "string",
name: "D" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields, undefined, 2);
        expect(result).toHaveLength(2);
    });

    it("filters out previewProperties that don't exist in collection properties", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                title: { type: "string",
name: "Title" }
            }
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields, ["title", "nonexistent"]);
        expect(result).toEqual(["title"]);
    });

    // -----------------------------------------------------------------------
    // Values that have no one-line form. The card is a fixed-height box; a
    // property that renders as a document or a table cannot fill a line of it.
    // -----------------------------------------------------------------------

    /** The shape that produced the bug: an author whose third column is a bio. */
    const authorsCollection: AdminCollection = {
        slug: "authors",
        name: "Authors",
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
    };

    it("does not spend a card line on a Markdown field when plain ones remain", () => {
        const result = getEntityPreviewKeys(mockAuthController, authorsCollection, fields);
        expect(result).not.toContain("bio");
        expect(result).toEqual(["name", "email", "twitter"]);
    });

    it("falls back to a Markdown field when it is all there is", () => {
        const collection: AdminCollection = {
            slug: "articles",
            name: "Articles",
            properties: {
                body: { type: "string",
name: "Body",
admin: { markdown: true } }
            }
        };

        expect(getEntityPreviewKeys(mockAuthController, collection, fields)).toEqual(["body"]);
    });

    it("still returns a Markdown field when the collection asks for it by name", () => {
        const result = getEntityPreviewKeys(mockAuthController, authorsCollection, fields, ["bio"]);
        expect(result).toEqual(["bio"]);
    });

    it("excludes maps and arrays of maps, which render as tables", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
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
        };

        const result = getEntityPreviewKeys(mockAuthController, collection, fields);
        expect(result).not.toContain("address");
        expect(result).not.toContain("contacts");
        expect(result).toEqual(["title", "tags"]);
    });

    it("orders long text after short text regardless of propertiesOrder", () => {
        // `propertiesOrder` states the column order of the collection table. It
        // is not a claim that the first columns summarise a record, and reading
        // it as one is what put a biography on an author card.
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            propertiesOrder: ["description", "status"],
            properties: {
                description: { type: "string",
name: "Description",
admin: { multiline: true } },
                status: { type: "string",
name: "Status" }
            }
        };

        expect(getEntityPreviewKeys(mockAuthController, collection, fields)).toEqual(["status", "description"]);
    });
});

// ---------------------------------------------------------------------------
// getEntityTitlePropertyKey
// ---------------------------------------------------------------------------
describe("getEntityTitlePropertyKey", () => {
    it("returns the explicit display.title when set", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            display: { title: "name" },
            properties: {
                name: { type: "string",
name: "Name" },
                body: { type: "string",
name: "Body",
admin: { multiline: true } }
            }
        };

        expect(getEntityTitlePropertyKey(collection)).toBe("name");
    });

    it("auto-detects first single-line text field as title", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                count: { type: "number",
name: "Count" },
                title: { type: "string",
name: "Title" },
                body: { type: "string",
name: "Body",
admin: { multiline: true } }
            }
        };

        expect(getEntityTitlePropertyKey(collection)).toBe("title");
    });

    it("skips multiline text fields", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                description: { type: "string",
name: "Description",
admin: { multiline: true } },
                name: { type: "string",
name: "Name" }
            }
        };

        expect(getEntityTitlePropertyKey(collection)).toBe("name");
    });

    it("skips markdown text fields", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                content: { type: "string",
name: "Content",
admin: { markdown: true } },
                slug: { type: "string",
name: "Slug" }
            }
        };

        expect(getEntityTitlePropertyKey(collection)).toBe("slug");
    });

    it("skips storage text fields", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                attachment: { type: "string",
name: "File",
storage: { bucket: "test" } },
                label: { type: "string",
name: "Label" }
            }
        };

        expect(getEntityTitlePropertyKey(collection)).toBe("label");
    });

    it("skips isId fields", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                id: { type: "string",
name: "ID",
isId: true },
                name: { type: "string",
name: "Name" }
            }
        };

        expect(getEntityTitlePropertyKey(collection)).toBe("name");
    });

    it("returns undefined when no suitable title field exists", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                count: { type: "number",
name: "Count" },
                flag: { type: "boolean",
name: "Flag" }
            }
        };

        expect(getEntityTitlePropertyKey(collection)).toBeUndefined();
    });

    it("skips hidden properties when auto-detecting title", () => {
        const collection: AdminCollection = {
            slug: "test",
            name: "Test",
            properties: {
                secret: { type: "string",
name: "Secret",
admin: { hideFromCollection: true } },
                name: { type: "string",
name: "Name" }
            }
        };

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

