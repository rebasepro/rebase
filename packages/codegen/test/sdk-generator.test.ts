import { describe, it, expect } from "@jest/globals";
import { toPascalCase, toCamelCase, toSafeIdentifier, indent } from "../src/utils";
import { generateTypedefs } from "../src/generate-types";
import { generateSDK } from "../src/index";
import { CollectionConfig } from "@rebasepro/types";

// ─── Test Fixtures ─────────────────────────────────────────────────

const authorsCollection = {
    name: "Authors",
    singularName: "Author",
    slug: "authors",
    table: "authors",
    properties: {
        id: { name: "ID",
type: "number",
isId: "increment",
validation: { required: true } },
        name: { name: "Name",
type: "string",
validation: { required: true } },
        email: { name: "Email",
type: "string" }
    }
} as unknown as CollectionConfig;

describe("Utils", () => {
    describe("toPascalCase", () => {
        it("converts snake_case to PascalCase", () => {
            expect(toPascalCase("private_notes")).toBe("PrivateNotes");
        });
        it("handles already PascalCase input", () => {
            expect(toPascalCase("TestEntities")).toBe("Testentities"); // Note: toPascalCase implementation lowercases follow-up chars per word split
        });
        it("handles kebab-case", () => {
            expect(toPascalCase("private-notes")).toBe("PrivateNotes");
        });
        it("handles space separated strings", () => {
            expect(toPascalCase("private notes")).toBe("PrivateNotes");
        });
        it("handles multiple delimiters and empty chunks", () => {
            expect(toPascalCase("private--notes__here")).toBe("PrivateNotesHere");
        });
    });

    describe("toCamelCase", () => {
        it("converts snake_case to camelCase", () => {
            expect(toCamelCase("private_notes")).toBe("privateNotes");
        });
        it("converts kebab-case to camelCase", () => {
            expect(toCamelCase("private-notes")).toBe("privateNotes");
        });
        it("preserves already camelCase and PascalCase when no separators are present", () => {
            expect(toCamelCase("customDomain")).toBe("customDomain");
            expect(toCamelCase("GitRepoUrl")).toBe("gitRepoUrl");
        });
    });

    describe("toSafeIdentifier", () => {
        it("converts slugs to camelCase", () => {
            expect(toSafeIdentifier("private-notes")).toBe("privateNotes");
        });
        it("strips invalid JS identifier characters and camel cases", () => {
            expect(toSafeIdentifier("my-special-slug!")).toBe("mySpecialSlug");
            expect(toSafeIdentifier("some@name#here")).toBe("someNameHere");
        });
    });

    describe("indent", () => {
        it("indents multi-line string by given space count", () => {
            const block = "line1\nline2\nline3";
            const expected = "  line1\n  line2\n  line3";
            expect(indent(block, 2)).toBe(expected);
        });
        it("does not indent empty/whitespace lines", () => {
            const block = "line1\n\n  \nline2";
            const expected = "  line1\n\n  \n  line2";
            expect(indent(block, 2)).toBe(expected);
        });
    });
});

describe("propertyToTypeScriptType mapping", () => {
    it("maps basic types correctly", () => {
        const col = {
            slug: "types_collection",
            properties: {
                bool: { type: "boolean" },
                dt: { type: "date" },
                geo: { type: "geopoint" },
                ref: { type: "reference" },
                vec: { type: "vector" },
                bin: { type: "binary" },
                unknown: { type: "something-weird" }
            }
        } as unknown as CollectionConfig;

        const ts = generateTypedefs([col]);
        expect(ts).toContain("bool?: boolean;");
        expect(ts).toContain("dt?: string;");
        expect(ts).toContain("geo?: { latitude: number; longitude: number; };");
        expect(ts).toContain("ref?: string | number;");
        expect(ts).toContain("vec?: number[];");
        expect(ts).toContain("bin?: string;");
        expect(ts).toContain("unknown?: unknown;");
    });

    describe("string enum mapping", () => {
        it("maps string array enum", () => {
            const col = {
                slug: "posts",
                properties: {
                    status: {
                        type: "string",
                        enum: ["draft", "published"]
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain('status?: "draft" | "published";');
        });

        it("maps string array of objects enum", () => {
            const col = {
                slug: "posts",
                properties: {
                    status: {
                        type: "string",
                        enum: [
                            { id: "draft",
label: "Draft" },
                            { id: "published",
label: "Published" }
                        ]
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain('status?: "draft" | "published";');
        });

        it("maps string record enum using keys", () => {
            const col = {
                slug: "posts",
                properties: {
                    status: {
                        type: "string",
                        enum: {
                            draft: "Draft",
                            published: "Published"
                        }
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain('status?: "draft" | "published";');
        });
    });

    describe("number enum mapping", () => {
        it("maps number array enum", () => {
            const col = {
                slug: "posts",
                properties: {
                    level: {
                        type: "number",
                        enum: [1, 2, 3]
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("level?: 1 | 2 | 3;");
        });

        it("maps number array of objects enum", () => {
            const col = {
                slug: "posts",
                properties: {
                    level: {
                        type: "number",
                        enum: [
                            { id: 10,
label: "Low" },
                            { id: 20,
label: "High" }
                        ]
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("level?: 10 | 20;");
        });

        it("maps number record enum using keys", () => {
            const col = {
                slug: "posts",
                properties: {
                    level: {
                        type: "number",
                        enum: {
                            1: "Low",
                            2: "High"
                        }
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("level?: 1 | 2;");
        });
    });

    describe("map property mapping", () => {
        it("maps nested properties recursively", () => {
            const col = {
                slug: "users",
                properties: {
                    profile: {
                        type: "map",
                        properties: {
                            age: { type: "number" },
                            tagline: { type: "string" }
                        }
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("profile?: { age: number; tagline: string; };");
        });

        it("falls back to Record<string, any> if properties is absent", () => {
            const col = {
                slug: "users",
                properties: {
                    metadata: {
                        type: "map"
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("metadata?: Record<string, unknown>;");
        });
    });

    describe("array property mapping", () => {
        it("maps typed array using the 'of' property", () => {
            const col = {
                slug: "articles",
                properties: {
                    tags: {
                        type: "array",
                        of: { type: "string" }
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("tags?: Array<string>;");
        });

        it("falls back to Array<any> if 'of' property is absent", () => {
            const col = {
                slug: "articles",
                properties: {
                    generic: {
                        type: "array"
                    }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("generic?: Array<unknown>;");
        });
    });
});

describe("generateTypedefs schemas configurations", () => {
    describe("Insert type requirements", () => {
        it("makes properties optional in Insert if validation required is false", () => {
            const col = {
                slug: "books",
                properties: {
                    title: { type: "string" }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("Insert: {");
            expect(ts).toContain("title?: string;");
        });

        it("makes properties required in Insert if validation required is true", () => {
            const col = {
                slug: "books",
                properties: {
                    title: { type: "string",
validation: { required: true } }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("Insert: {");
            expect(ts).toContain("title: string;");
        });

        it("makes isId: 'increment' key optional in Insert even if validation required is true", () => {
            const col = {
                slug: "books",
                properties: {
                    id: { type: "number",
isId: "increment",
validation: { required: true } }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("Insert: {");
            expect(ts).toContain("id?: number;");
        });

        it("makes isId: 'uuid' key optional in Insert even if validation required is true", () => {
            const col = {
                slug: "books",
                properties: {
                    id: { type: "string",
isId: "uuid",
validation: { required: true } }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("Insert: {");
            expect(ts).toContain("id?: string;");
        });

        it("keeps isId: 'manual' key required in Insert if validation required is true", () => {
            const col = {
                slug: "books",
                properties: {
                    id: { type: "string",
isId: "manual",
validation: { required: true } }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("Insert: {");
            expect(ts).toContain("id: string;");
        });

        it("keeps isId: true key required in Insert if validation required is true", () => {
            const col = {
                slug: "books",
                properties: {
                    id: { type: "string",
isId: true,
validation: { required: true } }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("Insert: {");
            expect(ts).toContain("id: string;");
        });
    });

    describe("Update type optionality", () => {
        it("makes all direct fields optional in Update", () => {
            const col = {
                slug: "books",
                properties: {
                    id: { type: "number",
isId: "increment",
validation: { required: true } },
                    title: { type: "string",
validation: { required: true } }
                }
            } as unknown as CollectionConfig;

            const ts = generateTypedefs([col]);
            expect(ts).toContain("Update: {");
            expect(ts).toContain("id?: number;");
            expect(ts).toContain("title?: string;");
        });
    });
});

describe("Collection relations and FK resolutions", () => {
    it("handles target primary key type resolution for FK columns", () => {
        const authorsCol = {
            slug: "authors",
            driver: "postgres",
            properties: {
                id: { type: "number",
isId: "increment" }
            }
        } as unknown as CollectionConfig;

        const postsCol = {
            slug: "posts",
            driver: "postgres",
            properties: {
                id: { type: "number",
isId: "increment" },
                author: {
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        target: () => authorsCol,
                        localKey: "author_id",
                    }
                }
            }
        } as unknown as CollectionConfig;

        const ts = generateTypedefs([postsCol, authorsCol]);

        // Row should have authorId as number since authors PK (id) is number
        expect(ts).toContain("posts: {");
        expect(ts).toContain("Row: {");
        expect(ts).toContain("authorId?: number;");
    });

    it("defaults to string | number when target primary key cannot be resolved", () => {
        const postsCol = {
            slug: "posts",
            driver: "postgres",
            properties: {
                id: { type: "number",
isId: "increment" },
                author: {
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        // A real collection whose *primary key* cannot be determined — which is
                        // what this test is about. A target with no slug at all is now a
                        // configuration error rather than a silent degradation.
                        target: () => ({ slug: "no_properties", name: "no-properties" }),
                        localKey: "author_id",
                    }
                }
            }
        } as unknown as CollectionConfig;

        const ts = generateTypedefs([postsCol]);

        expect(ts).toContain("posts: {");
        expect(ts).toContain("Row: {");
        expect(ts).toContain("authorId?: string | number;");
    });

    it("supports relation validation constraints making FK required", () => {
        const authorsCol = {
            slug: "authors",
            driver: "postgres",
            properties: {
                id: { type: "string",
isId: "uuid" }
            }
        } as unknown as CollectionConfig;

        const postsCol = {
            slug: "posts",
            driver: "postgres",
            properties: {
                id: { type: "number",
isId: "increment" },
                author: {
                    type: "relation",
                    relationName: "author_rel",
                    collectionPath: "authors"
                }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "author_rel",
                    target: () => authorsCol,
                    localKey: "author_id",
                    validation: { required: true }
                }
            ]
        } as unknown as CollectionConfig;

        const ts = generateTypedefs([postsCol, authorsCol]);

        expect(ts).toContain("posts: {");
        expect(ts).toContain("Row: {");
        expect(ts).toContain("authorId: string;"); // target is string uuid, validation required is true
    });

    it("types a relation as the target's own row, inlined — the shape a read serves", () => {
        const tagsCol = {
            slug: "tags",
            driver: "postgres",
            properties: {
                id: { type: "number",
isId: "increment" }
            }
        } as unknown as CollectionConfig;

        const postsCol = {
            slug: "posts",
            driver: "postgres",
            properties: {
                id: { type: "number",
isId: "increment" },
                tags: {
                    type: "relation",
                    relation: {
                        kind: "manyToMany",
                        target: () => tagsCol,
                    }
                }
            }
        } as unknown as CollectionConfig;

        const ts = generateTypedefs([postsCol, tagsCol]);

        // `include: ["tags"]` inlines each tag's own columns. The
        // `{ __type: "relation" }` envelope this used to emit is the admin's
        // view-model and never reaches a `find()`.
        expect(ts).toContain("tags?: Array<Database[\"tags\"][\"Row\"]>;");
        expect(ts).not.toContain("__type: \"relation\"");
    });

    it("falls back to an open record when the target is not in this generation run", () => {
        const postsCol = {
            slug: "posts",
            driver: "postgres",
            properties: {
                id: { type: "number",
isId: "increment" },
                author: {
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        target: () => ({ slug: "authors", name: "authors" }),
                        localKey: "author_id"
                    }
                }
            }
        } as unknown as CollectionConfig;

        const ts = generateTypedefs([postsCol]);

        expect(ts).toContain("authorId?: string | number;");
        expect(ts).toContain("author?: Record<string, unknown>;");
    });

    it("a relation that shadows its own foreign key is typed as both", () => {
        // The read serves the scalar column, until `include` names the relation
        // — which nests the target under the same key and takes the column's
        // place. Typing it as only one of the two is how `job.company_id`
        // reached the query layer as an object.
        const companiesCol = {
            slug: "companies",
            driver: "postgres",
            properties: {
                id: { type: "string",
isId: "uuid" }
            }
        } as unknown as CollectionConfig;

        const jobsCol = {
            slug: "jobs",
            driver: "postgres",
            properties: {
                id: { type: "string",
isId: "uuid" }
            },
            relations: [
                {
                    kind: "belongsTo",
                    relationName: "company_id",
                    target: () => companiesCol,
                    localKey: "company_id"
                }
            ]
        } as unknown as CollectionConfig;

        const ts = generateTypedefs([jobsCol, companiesCol]);

        expect(ts).toContain("companyId?: string | Database[\"companies\"][\"Row\"];");
    });
});

describe("generateSDK configurations", () => {
    it("does not generate README.md if includeReadme is false", () => {
        const files = generateSDK([authorsCollection], { includeReadme: false });
        expect(files.length).toBe(1);
        expect(files[0].path).toBe("database.types.ts");
    });
});
