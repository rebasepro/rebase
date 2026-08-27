
import type { AdminCollection } from "@rebasepro/cms-types";
import {
    getTitlePropertyCandidates,
    getTitlePropertyKey,
    getTitlePropertyKeyForValues,
    looksLikeIdentifierValue
} from "../../src/collections/title-property";

describe("Title property resolution", () => {

    describe("identifiers never fill the title slot", () => {

        it("ranks a userSelect below a real name", () => {
            // Regression: `auth_user_id` is declared before `full_name` and is a
            // plain string, so "first non-id string" picked the auth user UUID.
            // A user picker resolves to a person, so it stays a candidate — but
            // only behind every plain text field.
            const collection: AdminCollection = {
                name: "Talents",
                slug: "talents",
                table: "talents",
                properties: {
                    id: { name: "ID",
type: "string",
isId: "uuid" },
                    auth_user_id: { name: "Auth User ID",
type: "string",
userSelect: true },
                    full_name: { name: "Full Name",
type: "string" },
                    email: { name: "Email",
type: "string" }
                }
            };
            expect(getTitlePropertyCandidates(collection)).toEqual(["full_name", "email", "auth_user_id"]);
        });

        it("skips the primary key even when it is not called `id`", () => {
            const collection: AdminCollection = {
                name: "Devices",
                slug: "devices",
                table: "devices",
                properties: {
                    serial: { name: "Serial",
type: "string",
isId: "uuid" },
                    model: { name: "Model",
type: "string" }
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("model");
        });

        it("skips uuid columns and declared foreign keys", () => {
            const collection: AdminCollection = {
                name: "Orders",
                slug: "orders",
                table: "orders",
                properties: {
                    id: { name: "ID",
type: "string",
isId: "uuid" },
                    external_ref: { name: "External ref",
type: "string",
columnType: "uuid" },
                    customer_id: { name: "Customer id",
type: "string" },
                    customer: {
                        name: "Customer",
                        type: "relation",
                        relation: {
                            kind: "belongsTo",
                            target: "customers",
                            localKey: "customer_id",
                        }
                    },
                    reference: { name: "Reference",
type: "string" }
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("reference");
        });

        it("skips a foreign key whose column name was left to be inferred", () => {
            const collection: AdminCollection = {
                name: "Posts",
                slug: "posts",
                table: "posts",
                properties: {
                    id: { name: "ID",
type: "string",
isId: "uuid" },
                    author_id: { name: "Author id",
type: "string" },
                    author: {
                        name: "Author",
                        type: "relation",
                        relation: {
                            kind: "belongsTo",
                            target: "users",
                        }
                    },
                    headline: { name: "Headline",
type: "string" }
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("headline");
        });
    });

    describe("ranking", () => {

        it("prefers a name-like key over an earlier plain string", () => {
            const collection: AdminCollection = {
                name: "Products",
                slug: "products",
                table: "products",
                properties: {
                    sku: { name: "SKU",
type: "string" },
                    title: { name: "Title",
type: "string" }
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("title");
        });

        it("prefers plain text over email, enum, description and relation", () => {
            const collection: AdminCollection = {
                name: "Leads",
                slug: "leads",
                table: "leads",
                properties: {
                    owner: {
 name: "Owner",
type: "relation",
    relation: {
        kind: "belongsTo",
        target: "users",
    }
},
                    bio: { name: "Bio",
type: "string",
admin: { multiline: true } },
                    status: {
                        name: "Status",
                        type: "string",
                        enum: { new: "New",
won: "Won" }
                    },
                    email: { name: "Email",
type: "string",
email: true },
                    company: { name: "Company",
type: "string" }
                }
            };
            expect(getTitlePropertyCandidates(collection))
                .toEqual(["company", "email", "status", "bio", "owner"]);
        });

        it("falls back to a relation when the collection holds no text", () => {
            const collection: AdminCollection = {
                name: "Posts tags",
                slug: "posts_tags",
                table: "posts_tags",
                properties: {
                    id: { name: "ID",
type: "string",
isId: "uuid" },
                    tag: {
 name: "Tag",
type: "relation",
    relation: {
        kind: "belongsTo",
        target: "tags",
        localKey: "tag_id",
    }
}
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("tag");
        });

        it("honours an explicit display.title", () => {
            const collection: AdminCollection = {
                name: "Talents",
                slug: "talents",
                table: "talents",
                display: { title: "email" },
                properties: {
                    full_name: { name: "Full Name",
type: "string" },
                    email: { name: "Email",
type: "string" }
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("email");
        });

        it("honours a display.title that names a later property", () => {
            const collection: AdminCollection = {
                name: "Talents",
                slug: "talents-declared",
                table: "talents",
                display: { title: "email" },
                properties: {
                    full_name: { name: "Full Name",
type: "string" },
                    email: { name: "Email",
type: "string" }
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("email");
        });

        it("resolves a declared title that points into a map", () => {
            // `properties[path]` is a flat lookup, so a dotted title silently
            // fell through to the ranking and a collection got whichever
            // property the ranking liked — even though the dotted form has been
            // documented as valid the whole time.
            const collection: AdminCollection = {
                name: "People",
                slug: "people",
                table: "people",
                display: { title: "profile.display_name" },
                properties: {
                    nickname: { name: "Nickname",
type: "string" },
                    profile: {
                        name: "Profile",
                        type: "map",
                        properties: {
                            display_name: { name: "Display name",
type: "string" }
                        }
                    }
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("profile.display_name");
        });

        it("ignores hidden and image properties", () => {
            const collection: AdminCollection = {
                name: "Assets",
                slug: "assets",
                table: "assets",
                properties: {
                    internal_code: {
                        name: "Internal code",
                        type: "string",
                        admin: { hideFromCollection: true }
                    },
                    picture: {
                        name: "Picture",
                        type: "string",
                        storage: { storagePath: "assets" }
                    },
                    caption: { name: "Caption",
type: "string" }
                }
            };
            expect(getTitlePropertyKey(collection)).toBe("caption");
        });
    });

    describe("explicit propertiesOrder", () => {

        it("keeps the declared order instead of reranking", () => {
            const collection: AdminCollection = {
                name: "Databases",
                slug: "databases",
                table: "databases",
                properties: {
                    id: { name: "ID",
type: "string",
isId: "uuid" },
                    project: {
 name: "Project",
type: "relation",
    relation: {
        kind: "belongsTo",
        target: "projects",
    }
},
                    connection_string: { name: "Connection string",
type: "string" }
                },
                propertiesOrder: ["id", "project", "connection_string"]
            };
            expect(getTitlePropertyKey(collection)).toBe("project");
        });

        it("still skips identifiers declared first", () => {
            const collection: AdminCollection = {
                name: "Talents",
                slug: "talents",
                table: "talents",
                properties: {
                    id: { name: "ID",
type: "string",
isId: "uuid" },
                    external_ref: { name: "External ref",
type: "string",
columnType: "uuid" },
                    tenant_id: { name: "Tenant id",
type: "string" },
                    tenant: {
                        name: "Tenant",
                        type: "relation",
                        relation: {
                            kind: "belongsTo",
                            target: "tenants",
                            localKey: "tenant_id",
                        }
                    },
                    full_name: { name: "Full Name",
type: "string" }
                },
                propertiesOrder: ["id", "external_ref", "tenant_id", "full_name"]
            };
            expect(getTitlePropertyKey(collection)).toBe("full_name");
        });

        it("lets a declared user picker win, since it renders the person", () => {
            const collection: AdminCollection = {
                name: "Assignments",
                slug: "assignments",
                table: "assignments",
                properties: {
                    id: { name: "ID",
type: "string",
isId: "uuid" },
                    assignee: { name: "Assignee",
type: "string",
userSelect: true },
                    notes: { name: "Notes",
type: "string" }
                },
                propertiesOrder: ["id", "assignee", "notes"]
            };
            expect(getTitlePropertyKey(collection)).toBe("assignee");
        });
    });

    describe("value-aware resolution", () => {

        const collection: AdminCollection = {
            name: "Talents",
            slug: "talents",
            table: "talents",
            properties: {
                id: { name: "ID",
type: "string",
isId: "uuid" },
                full_name: { name: "Full Name",
type: "string" },
                email: { name: "Email",
type: "string" }
            }
        };

        it("uses the top candidate when it holds a value", () => {
            expect(getTitlePropertyKeyForValues(collection, {
                full_name: "Priscila Alaniz",
                email: "palaniz@peersocial.com.mx"
            })).toBe("full_name");
        });

        it("falls through when the top candidate is empty", () => {
            expect(getTitlePropertyKeyForValues(collection, {
                full_name: "",
                email: "palaniz@peersocial.com.mx"
            })).toBe("email");
        });

        it("falls through when the top candidate holds an id", () => {
            expect(getTitlePropertyKeyForValues(collection, {
                full_name: "fdda6c2a-5310-4b0c-87cc-a13eb36e5167",
                email: "palaniz@peersocial.com.mx"
            })).toBe("email");
        });

        it("keeps the top candidate when nothing has a usable value", () => {
            expect(getTitlePropertyKeyForValues(collection, {})).toBe("full_name");
        });
    });

    describe("looksLikeIdentifierValue", () => {
        it("detects uuids, long hex and cuids", () => {
            expect(looksLikeIdentifierValue("fdda6c2a-5310-4b0c-87cc-a13eb36e5167")).toBe(true);
            expect(looksLikeIdentifierValue("507f1f77bcf86cd799439011")).toBe(true);
            expect(looksLikeIdentifierValue("cjld2cjxh0000qzrmn831i7rn")).toBe(true);
        });

        it("leaves human text alone", () => {
            expect(looksLikeIdentifierValue("Priscila Alaniz")).toBe(false);
            expect(looksLikeIdentifierValue("Consultoría ambiental")).toBe(false);
            expect(looksLikeIdentifierValue("")).toBe(false);
            expect(looksLikeIdentifierValue(42)).toBe(false);
        });
    });
});
