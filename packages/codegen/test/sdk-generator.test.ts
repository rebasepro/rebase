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
        it("leaves already PascalCase input alone", () => {
            expect(toPascalCase("TestEntities")).toBe("TestEntities");
            expect(toPascalCase("GitRepoUrl")).toBe("GitRepoUrl");
        });
        it("keeps capitals inside a chunk when joining chunks", () => {
            expect(toPascalCase("private_testEntities")).toBe("PrivateTestEntities");
        });
        it("folds SHOUTING_CASE down to one capital per word", () => {
            expect(toPascalCase("PRIVATE_NOTES")).toBe("PrivateNotes");
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
            // Nested fields carry their own `validation`; none of these declare it, so
            // each is optional and nullable rather than silently required.
            expect(ts).toContain("profile?: { age?: number | null; tagline?: string | null; } | null;");
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
        // The foreign key is emitted under its wire name — the Drizzle field
        // key, which is the JSON key the row arrives with. `author_id` is the
        // column behind it and is not a name the API ever answers to.
        expect(ts).toContain("authorId?: number | null;");
        expect(ts).not.toContain("author_id");
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
        expect(ts).toContain("authorId?: string | number | null;");
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
        // target is a string uuid and the relation is required
        expect(ts).toContain("authorId: string;");
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

        expect(ts).toContain("authorId?: string | number | null;");
        expect(ts).toContain("author?: Record<string, unknown>;");
    });

    it("a relation that shadows its own foreign key is typed as both", () => {
        // The read serves the scalar column, until `include` names the relation
        // — which nests the target under the same key and takes the column's
        // place. Typing it as only one of the two is how `job.companyId`
        // reached the query layer as an object.
        //
        // The clash is between the relation's *name* and the foreign key's
        // *wire* name, so it takes a relation named `companyId` to produce it.
        // A relation named `company_id` beside a `companyId` column no longer
        // collides at all — which is a second thing camel-casing the wire
        // bought, not a case this test stopped covering.
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
                    relationName: "companyId",
                    target: () => companiesCol,
                    localKey: "company_id"
                }
            ]
        } as unknown as CollectionConfig;

        const ts = generateTypedefs([jobsCol, companiesCol]);

        expect(ts).toContain("companyId?: string | Database[\"companies\"][\"Row\"] | null;");
    });
});

describe("generateSDK configurations", () => {
    it("does not generate README.md if includeReadme is false", () => {
        const files = generateSDK([authorsCollection], { includeReadme: false });
        expect(files.map(f => f.path)).toEqual(["database.types.ts"]);
    });

    it("generates the README by default", () => {
        // Only the opt-out branch was covered, so `includeReadme` defaulting to
        // off — or the README disappearing entirely — went unnoticed.
        for (const options of [undefined, {}, { includeReadme: true }]) {
            const files = generateSDK([authorsCollection], options);
            expect(files.map(f => f.path)).toEqual(["database.types.ts", "README.md"]);
            const readme = files.find(f => f.path === "README.md")!;
            expect(readme.content).toContain("createRebaseClient");
            expect(readme.content).toContain("@rebasepro/client");
        }
    });

    it("always emits the typedefs, and they reflect the collections passed in", () => {
        const files = generateSDK([authorsCollection]);
        const types = files.find(f => f.path === "database.types.ts")!;
        expect(types.content).toContain("export interface Database");
        expect(types.content).toContain("authors:");
    });

    /**
     * The README is the first thing a developer reads after generating, and it
     * taught the naming rule from before 0.14: that a field keeps its *column*
     * name, so `created_at` is `row.created_at`. It has not been true since —
     * a declared property is its key in the collection, and a foreign key
     * derived from a relation arrives camelCased (`author_id` → `authorId`).
     *
     * A reader who believed it wrote `row.created_at` and `{ author_id: 5 }`,
     * both of which are compile errors against the types generated in the same
     * directory. Two snake_case examples were the whole of the damage, so the
     * check is that neither spelling comes back.
     */
    it("teaches the wire names, not the column names", () => {
        const readme = generateSDK([authorsCollection])
            .find(f => f.path === "README.md")!.content;

        // The old paragraph's own two examples, banned outright.
        expect(readme).not.toContain("created_at");
        expect(readme).not.toContain("author_id");

        // And the rule behind them, so a different snake_case field cannot
        // reintroduce the same advice under another name.
        expect(readme).not.toMatch(/\brow\.[a-z0-9]+_/);
        expect(readme).not.toMatch(/\{\s*[a-z0-9]+_[a-z0-9_]*:/);

        // What replaced it.
        expect(readme).toContain("row.authorId");
        expect(readme).toContain("row.createdAt");
    });
});

/**
 * `Row` describes what a read serves; `Insert` and `Update` describe what a
 * write accepts. They were near-identical, and all three were wrong in the same
 * direction: everything optional, nothing nullable, the primary key writable
 * and the documented relation-write shape missing.
 */
describe("Row, Insert and Update describe different things", () => {
    /**
     * The body of one of the three blocks, so an assertion cannot match the
     * wrong one. Scoped to a collection as well as a block: the generator emits
     * collections in slug order, so `posts` is not the first one in the file
     * however the fixtures are passed in.
     */
    function block(ts: string, name: "Row" | "Insert" | "Update", slug = "posts"): string {
        const collection = ts.indexOf(`  ${slug}: {`);
        expect(collection).toBeGreaterThan(-1);
        const start = ts.indexOf(`    ${name}: {`, collection);
        expect(start).toBeGreaterThan(-1);
        return ts.slice(start, ts.indexOf("    };", start));
    }

    const authorsCol = {
        slug: "authors",
        properties: { id: { type: "number", isId: "increment" } }
    } as unknown as CollectionConfig;

    const postsCol = {
        slug: "posts",
        properties: {
            id: { type: "string", isId: "uuid" },
            title: { type: "string", validation: { required: true } },
            subtitle: { type: "string" },
            secret: { type: "string", excludeFromApi: true },
            author: { type: "relation", relation: { kind: "belongsTo", target: () => authorsCol } }
        }
    } as unknown as CollectionConfig;

    it("marks the primary key required on Row, whatever its validation says", () => {
        // Introspection sets `isId` and never sets `validation.required`, so
        // `row.id` was `string | undefined` for every baas project.
        expect(block(generateTypedefs([postsCol, authorsCol]), "Row")).toContain("id: string;");
    });

    it("types an optional column as nullable, not merely absent", () => {
        // The column is on every row a read returns; what varies is whether the
        // value is null. `subtitle?: string` said the key might not be there.
        expect(block(generateTypedefs([postsCol, authorsCol]), "Row"))
            .toContain("subtitle?: string | null;");
    });

    it("leaves excludeFromApi columns out of every type", () => {
        // One rule, both directions — see the dedicated suite below.
        const ts = generateTypedefs([postsCol, authorsCol]);
        for (const name of ["Row", "Insert", "Update"] as const) {
            expect(block(ts, name)).not.toContain("secret");
        }
    });

    it("does not let Update reassign the primary key", () => {
        const update = block(generateTypedefs([postsCol, authorsCol]), "Update");
        expect(update).not.toMatch(/^\s+id\??:/m);
        expect(update).toContain("title?: string;");
        // The foreign key is still writable — it is a column, not the row's own key.
        expect(update).toContain("authorId?: number;");
    });

    it("accepts both write shapes for a belongsTo relation", () => {
        // The server takes either: `{ author: 5 }`, which the write transformer
        // maps onto the foreign-key column, or `{ authorId: 5 }`, which passes
        // through. Only the second was generated, so the documented form was a
        // type error.
        const insert = block(generateTypedefs([postsCol, authorsCol]), "Insert");
        expect(insert).toContain("authorId?: number;");
        expect(insert).toContain("author?: number;");
    });

    it("offers the relation write key the server actually accepts", () => {
        // The write transformer looks the payload key up in `properties` and
        // only treats it as a relation if what it finds there is one. So the
        // accepted key is the property key — a relation whose `relationName`
        // differs is not reachable under that name, and offering it would have
        // written to a column that does not exist.
        const renamed = {
            slug: "posts",
            properties: {
                id: { type: "string", isId: "uuid" },
                author: {
                    type: "relation",
                    relation: {
                        kind: "belongsTo",
                        relationName: "author_rel",
                        target: () => authorsCol,
                        localKey: "author_id"
                    }
                }
            }
        } as unknown as CollectionConfig;

        const insert = block(generateTypedefs([renamed, authorsCol]), "Insert");
        expect(insert).toContain("author?: number;");
        expect(insert).toContain("authorId?: number;");
        expect(insert).not.toContain("author_rel");
    });

    it("types a foreign key from the target's primary key on writes too", () => {
        // Insert hardcoded `string | number`, so a string typechecked against a
        // numeric-keyed target while Row knew better.
        expect(block(generateTypedefs([postsCol, authorsCol]), "Insert"))
            .not.toContain("string | number");
    });
});

/**
 * `excludeFromApi` means one thing: the API surface does not mention the
 * property, in either direction. `Insert` used to keep such columns writable —
 * "stripped from responses, not from writes" — which left the generated types
 * as the one place a secret was still named, and offered it to a client as
 * something to send.
 *
 * The assertions below are over the *rule*, derived from the fixture, not over
 * a list of names. Pinning `passwordHash` and `emailVerificationToken` is how
 * this kept coming back: every sibling generator was fixed for those two names
 * and stayed wrong for the rule.
 */
describe("excludeFromApi keeps a property off every generated type", () => {
    const owners = {
        slug: "owners",
        properties: {
            id: {
                name: "ID",
                type: "string",
                isId: "uuid"
            }
        }
    } as unknown as CollectionConfig;

    /** Excluded properties, one per shape the generator emits differently. */
    const excludedProperties = {
        credential: {
            name: "Credential",
            type: "string",
            excludeFromApi: true
        },
        attempts: {
            name: "Attempts",
            type: "number",
            validation: { required: true },
            excludeFromApi: true
        },
        lockedOut: {
            name: "Locked out",
            type: "boolean",
            excludeFromApi: true
        },
        rotatedAt: {
            name: "Rotated at",
            type: "date",
            excludeFromApi: true
        },
        recoveryCodes: {
            name: "Recovery codes",
            type: "array",
            of: { name: "Code", type: "string" },
            excludeFromApi: true
        },
        internalNotes: {
            name: "Internal notes",
            type: "map",
            properties: { note: { name: "Note", type: "string" } },
            excludeFromApi: true
        },
        // Declared under one name, stored under another. The server strips a
        // row by both, so a generated type may name neither — and the relation
        // below claims exactly this column as its foreign key.
        legacyOwner: {
            name: "Legacy owner",
            type: "string",
            columnName: "owner_id",
            excludeFromApi: true
        },
        // A relation can be excluded too; the included target is stripped by
        // the property key, like any other column.
        auditor: {
            name: "Auditor",
            type: "relation",
            relation: { kind: "belongsTo", target: () => owners, localKey: "auditor_id" },
            excludeFromApi: true
        }
    } as const;

    const vault = {
        slug: "vault",
        properties: {
            id: {
                name: "ID",
                type: "string",
                isId: "uuid"
            },
            label: {
                name: "Label",
                type: "string",
                validation: { required: true }
            },
            owner: {
                name: "Owner",
                type: "relation",
                relation: { kind: "belongsTo", target: () => owners, localKey: "owner_id" }
            },
            ...excludedProperties
        }
    } as unknown as CollectionConfig;

    /** Every name a property was declared or stored under. */
    const forbidden = Object.entries(excludedProperties).flatMap(([key, prop]) => {
        const columnName = (prop as { columnName?: string }).columnName;
        return columnName ? [key, columnName] : [key];
    });

    /** The keys one emitted block declares, ignoring the types they carry. */
    function emittedKeys(body: string): string[] {
        return [...body.matchAll(/^ {6}"?([^"?:]+)"?\??:/gm)].map(m => m[1]);
    }

    // Anchored on the collection, not on the first `Row: {` in the file: the
    // generator sorts by slug, so which collection comes first is not the order
    // the fixtures were passed in.
    function block(ts: string, name: "Row" | "Insert" | "Update", slug = "vault"): string[] {
        const collection = ts.indexOf(`  ${slug}: {`);
        expect(collection).toBeGreaterThan(-1);
        const start = ts.indexOf(`    ${name}: {`, collection);
        expect(start).toBeGreaterThan(-1);
        return emittedKeys(ts.slice(start, ts.indexOf("    };", start)));
    }

    const generated = generateTypedefs([vault, owners]);

    it.each(["Row", "Insert", "Update"] as const)("%s names none of them", name => {
        const keys = block(generated, name);
        // Guards against passing because nothing was generated at all.
        expect(keys).toContain("label");
        for (const forbiddenKey of forbidden) {
            expect(keys).not.toContain(forbiddenKey);
        }
    });

    it("keeps the unmarked siblings, including the relation and its foreign key", () => {
        // `owner_id` is the excluded `legacyOwner`'s column, so the relation
        // that stores its key there loses the scalar — but the relation itself
        // is not excluded and is still readable and writable by name.
        expect(block(generated, "Row")).toContain("owner");
        expect(block(generated, "Insert")).toContain("owner");
        expect(block(generated, "Update")).toContain("owner");
    });

    it("keeps a foreign key whose own column is not excluded", () => {
        // The excluded `auditor` relation stores its key in the `auditor_id`
        // column, which nothing marked, and serves it as `auditorId`. The
        // server serves it, so the type says so: excluding a relation is not
        // a claim about a different column.
        expect(block(generated, "Row")).toContain("auditorId");
    });
});

describe("generateTypedefs is independent of collection order", () => {
    // `rebase generate-sdk` sorts by slug before generating, and both
    // `generate-sdk && git diff --exit-code` and `rebase doctor` compare the
    // generator's output against the file it wrote. While the sort lived only
    // in the command, a project whose filename order differed from its slug
    // order had its SDK reported permanently out of date, and re-running the
    // printed fix rewrote the file in the order it was already in.
    const articles = {
        slug: "articles",
        properties: { title: { type: "string" } }
    } as unknown as CollectionConfig;
    const authors = {
        slug: "authors",
        properties: { name: { type: "string" } }
    } as unknown as CollectionConfig;

    it("emits byte-identical output for a shuffled input", () => {
        expect(generateTypedefs([authors, articles])).toEqual(generateTypedefs([articles, authors]));
    });

    it("does not reorder the array it was given", () => {
        const input = [authors, articles];
        generateTypedefs(input);
        expect(input.map(c => c.slug)).toEqual(["authors", "articles"]);
    });
});
