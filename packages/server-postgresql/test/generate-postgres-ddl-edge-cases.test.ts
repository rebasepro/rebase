import { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import { generatePostgresDdl, generatePostgresPoliciesDdl } from "../src/schema/generate-postgres-ddl-logic";

describe("generatePostgresDdl edge cases", () => {
    const cleanDdl = (ddl: string) => {
        return ddl
            .replace(/--.*$/gm, "") // Remove single-line SQL comments
            .replace(/\n{2,}/g, "\n") // Collapse multiple newlines
            .replace(/\s+/g, " ") // Collapse whitespace
            .trim();
    };

    // ── 1. Empty collections array ────────────────────────────────────
    describe("empty collections array", () => {
        it("should produce valid DDL with only the header comment", async () => {
            const result = await generatePostgresDdl([]);
            expect(result).toContain("auto-generated");
            // No CREATE TABLE or ALTER TABLE statements
            expect(result).not.toContain("CREATE TABLE");
            expect(result).not.toContain("ALTER TABLE");
            expect(result).not.toContain("CREATE TYPE");
        });

        it("should produce valid DDL regardless of includePolicies option", async () => {
            const withPolicies = await generatePostgresDdl([], { includePolicies: true });
            const withoutPolicies = await generatePostgresDdl([], { includePolicies: false });
            expect(withPolicies).not.toContain("CREATE TABLE");
            expect(withoutPolicies).not.toContain("CREATE TABLE");
        });
    });

    // ── 2. Enum values with single quotes ─────────────────────────────
    describe("enum values with single quotes", () => {
        it("should embed single quotes in enum values without escaping (documents current behavior)", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "phrases",
                    table: "phrases",
                    name: "Phrases",
                    properties: {
                        mood: {
                            type: "string",
                            enum: ["it's", "won't"]
                        }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            // Current behavior: single quotes inside values are NOT escaped,
            // producing invalid SQL. Document this as a known limitation.
            expect(result).toContain("CREATE TYPE");
            expect(result).toContain("phrases_mood");
            // The raw output will contain the unescaped quotes
            expect(result).toContain("it's");
            expect(result).toContain("won't");
        });
    });

    // ── 3. Table name with special characters ─────────────────────────
    describe("table name with special characters", () => {
        it("should quote table names containing hyphens", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "my-items",
                    table: "my-items",
                    name: "My Items",
                    properties: {
                        name: { type: "string" }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);
            // Table name should be quoted, preserving hyphens
            expect(cleanResult).toContain("CREATE TABLE \"public\".\"my-items\" (");
            expect(cleanResult).toContain("ALTER TABLE \"public\".\"my-items\" ENABLE ROW LEVEL SECURITY");
        });

        it("should quote table names containing spaces", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "my items",
                    table: "my items",
                    name: "My Items",
                    properties: {
                        name: { type: "string" }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            expect(result).toContain("\"my items\"");
        });
    });

    // ── 4. Column with reserved SQL keyword names ─────────────────────
    describe("columns with reserved SQL keyword names", () => {
        it("should quote column names that are reserved SQL keywords", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "records",
                    table: "records",
                    name: "Records",
                    properties: {
                        order: { type: "number" },
                        select: { type: "string" },
                        table: { type: "string" },
                        user: { type: "string" }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);

            // All column names should be double-quoted, which protects them
            // from being interpreted as SQL keywords
            expect(cleanResult).toContain("\"order\" NUMERIC");
            expect(cleanResult).toContain("\"select\" VARCHAR(255)");
            expect(cleanResult).toContain("\"table\" VARCHAR(255)");
            expect(cleanResult).toContain("\"user\" VARCHAR(255)");
        });

        it("should also generate implicit id column when properties use reserved keywords", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "records",
                    table: "records",
                    name: "Records",
                    properties: {
                        order: { type: "number" },
                        group: { type: "string" }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);
            // Implicit id should still be present
            expect(cleanResult).toContain("\"id\" VARCHAR(255) PRIMARY KEY");
        });
    });

    // ── 5. Number with isId: 'increment' ──────────────────────────────
    describe("number with isId increment", () => {
        it("should generate GENERATED BY DEFAULT AS IDENTITY for numeric auto-increment id", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "counters",
                    table: "counters",
                    name: "Counters",
                    properties: {
                        id: { type: "number", isId: "increment" },
                        label: { type: "string" }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("\"id\" INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY");
            // Ensure no implicit VARCHAR id is added
            expect(cleanResult).not.toContain("VARCHAR(255) PRIMARY KEY");
        });

        it("should not add duplicate id column when isId increment is used", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "items",
                    table: "items",
                    name: "Items",
                    properties: {
                        id: { type: "number", isId: "increment" },
                        name: { type: "string" }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            // Count occurrences of PRIMARY KEY — should be exactly 1
            const pkCount = (result.match(/PRIMARY KEY/g) ?? []).length;
            expect(pkCount).toBe(1);
        });
    });

    // ── 6. Collection with only relation properties ───────────────────
    describe("collection with only relation properties", () => {
        it("should add implicit id column when collection has only relation properties", async () => {
            const usersCollection: CollectionConfig = {
                slug: "users",
                table: "users",
                name: "Users",
                properties: {
                    name: { type: "string" }
                }
            };
            const profileCollection: CollectionConfig = {
                slug: "profiles",
                table: "profiles",
                name: "Profiles",
                properties: {
                    owner: { type: "relation", relationName: "owner" }
                },
                relations: [
                    {
                        relationName: "owner",
                        target: () => usersCollection,
                        cardinality: "one",
                        localKey: "owner_id",
                        onDelete: "cascade"
                    }
                ]
            };

            const result = await generatePostgresDdl([usersCollection, profileCollection]);
            const cleanResult = cleanDdl(result);

            // Implicit id should be added since no explicit PK exists
            expect(cleanResult).toContain("\"id\" VARCHAR(255) PRIMARY KEY");
            // FK column should also be present
            expect(cleanResult).toContain("\"owner_id\" VARCHAR(255)");
        });

        it("should add implicit id even when collection has zero non-relation properties", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "empty_ish",
                    table: "empty_ish",
                    name: "Empty-ish",
                    properties: {}
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);

            // Even with no properties, implicit id is added
            expect(cleanResult).toContain("CREATE TABLE \"public\".\"empty_ish\" (");
            expect(cleanResult).toContain("\"id\" VARCHAR(255) PRIMARY KEY");
        });
    });

    // ── 7. generatePostgresPoliciesDdl standalone ─────────────────────
    describe("generatePostgresPoliciesDdl", () => {
        it("should generate RLS enable statement for each collection", () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "posts",
                    table: "posts",
                    name: "Posts",
                    properties: {
                        title: { type: "string" }
                    }
                },
                {
                    slug: "comments",
                    table: "comments",
                    name: "Comments",
                    properties: {
                        body: { type: "string" }
                    }
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);

            expect(result).toContain("ALTER TABLE \"public\".\"posts\" ENABLE ROW LEVEL SECURITY");
            expect(result).toContain("ALTER TABLE \"public\".\"comments\" ENABLE ROW LEVEL SECURITY");
        });

        it("should generate policies for collections with security rules", () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "posts",
                    table: "posts",
                    name: "Posts",
                    properties: {
                        title: { type: "string" },
                        author_id: { type: "string" }
                    },
                    securityRules: [
                        {
                            operation: "select",
                            access: "public"
                        },
                        {
                            operation: "delete",
                            ownerField: "author_id"
                        }
                    ]
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("CREATE POLICY");
            expect(cleanResult).toContain("USING (true)");
            expect(cleanResult).toContain("FOR SELECT");
            expect(cleanResult).toContain("FOR DELETE");
            expect(cleanResult).toContain("(author_id)::text = auth.uid()");
        });

        it("should generate only the default server-or-admin read policy for collections without security rules", () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "items",
                    table: "items",
                    name: "Items",
                    properties: {
                        name: { type: "string" }
                    }
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);

            expect(result).toContain("ALTER TABLE");
            expect(result).toContain("ENABLE ROW LEVEL SECURITY");
            // Reads run under the restricted reader role (RLS default-denies),
            // so the framework injects a baseline read for server/admin.
            expect(result).toContain("CREATE POLICY \"items_default_admin_read\"");
            expect((result.match(/CREATE POLICY/g) ?? []).length).toBe(1);
        });

        it("should return only the header comment for an empty collections array", () => {
            const result = generatePostgresPoliciesDdl([]);
            expect(result).toContain("RLS policies");
            expect(result).not.toContain("ALTER TABLE");
            expect(result).not.toContain("CREATE POLICY");
        });

        it("should use custom schema in policy DDL", () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "docs",
                    table: "docs",
                    name: "Docs",
                    schema: "app",
                    properties: {
                        title: { type: "string" }
                    },
                    securityRules: [
                        {
                            operation: "select",
                            access: "public"
                        }
                    ]
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);

            expect(result).toContain("ALTER TABLE \"app\".\"docs\" ENABLE ROW LEVEL SECURITY");
            expect(result).toContain("ON \"app\".\"docs\"");
        });

        it("should handle multiple operations in a single rule", () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "entries",
                    table: "entries",
                    name: "Entries",
                    properties: {
                        data: { type: "string" }
                    },
                    securityRules: [
                        {
                            name: "public_read_write",
                            operations: ["select", "insert"],
                            access: "public"
                        }
                    ]
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("CREATE POLICY \"public_read_write_select\"");
            expect(cleanResult).toContain("CREATE POLICY \"public_read_write_insert\"");
        });

        it("should generate restrictive policies with pgRoles", () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "secrets",
                    table: "secrets",
                    name: "Secrets",
                    properties: {
                        value: { type: "string" }
                    },
                    securityRules: [
                        {
                            name: "admin_only",
                            operation: "select",
                            mode: "restrictive",
                            using: "true",
                            pgRoles: ["admin_role"]
                        }
                    ]
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("AS RESTRICTIVE");
            expect(cleanResult).toContain("TO \"admin_role\"");
        });

        it("should fall back to USING (false) when no clause can be built for select", () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "locked",
                    table: "locked",
                    name: "Locked",
                    properties: {
                        data: { type: "string" }
                    },
                    securityRules: [
                        {
                            operation: "select"
                            // No access, ownerField, or using — should produce USING (false)
                        }
                    ]
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("USING (false)");
        });

        it("should generate WITH CHECK (false) for insert without any clause", () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "locked",
                    table: "locked",
                    name: "Locked",
                    properties: {
                        data: { type: "string" }
                    },
                    securityRules: [
                        {
                            operation: "insert"
                            // No clause — should produce WITH CHECK (false)
                        }
                    ]
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("WITH CHECK (false)");
            // The INSERT policy itself must not carry a USING clause (the
            // injected default read policy legitimately does).
            const insertPolicy = cleanResult.split("CREATE POLICY").find(p => p.includes("FOR INSERT"));
            expect(insertPolicy).toBeDefined();
            expect(insertPolicy).not.toContain("USING");
        });

        it("should generate both USING and WITH CHECK for update", () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "items",
                    table: "items",
                    name: "Items",
                    properties: {
                        owner_id: { type: "string" }
                    },
                    securityRules: [
                        {
                            operation: "update",
                            ownerField: "owner_id"
                        }
                    ]
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("FOR UPDATE");
            expect(cleanResult).toContain("USING ((owner_id)::text = auth.uid())");
            expect(cleanResult).toContain("WITH CHECK ((owner_id)::text = auth.uid())");
        });

        it("should include DROP POLICY IF EXISTS before CREATE POLICY", () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "items",
                    table: "items",
                    name: "Items",
                    properties: {
                        data: { type: "string" }
                    },
                    securityRules: [
                        {
                            operation: "select",
                            access: "public"
                        }
                    ]
                }
            ];

            const result = generatePostgresPoliciesDdl(collections);

            expect(result).toContain("DROP POLICY IF EXISTS");
            // DROP should appear before CREATE
            const dropIdx = result.indexOf("DROP POLICY IF EXISTS");
            const createIdx = result.indexOf("CREATE POLICY");
            expect(dropIdx).toBeLessThan(createIdx);
        });
    });

    // ── 8. Multiple collections referencing the same enum ─────────────
    describe("multiple collections referencing same enum type", () => {
        it("should create separate enum types per collection (enum names are scoped to table)", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "orders",
                    table: "orders",
                    name: "Orders",
                    properties: {
                        status: {
                            type: "string",
                            enum: ["pending", "active", "closed"]
                        }
                    }
                },
                {
                    slug: "invoices",
                    table: "invoices",
                    name: "Invoices",
                    properties: {
                        status: {
                            type: "string",
                            enum: ["pending", "active", "closed"]
                        }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);

            // Each collection gets its own scoped enum type
            expect(result).toContain("\"orders_status\"");
            expect(result).toContain("\"invoices_status\"");
            // Both should appear exactly once
            const ordersEnumCount = (result.match(/CREATE TYPE.*orders_status/g) ?? []).length;
            const invoicesEnumCount = (result.match(/CREATE TYPE.*invoices_status/g) ?? []).length;
            expect(ordersEnumCount).toBe(1);
            expect(invoicesEnumCount).toBe(1);
        });

        it("should not create duplicate enum when same collection has same-named enum", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "products",
                    table: "products",
                    name: "Products",
                    properties: {
                        category: {
                            type: "string",
                            enum: ["electronics", "clothing"]
                        },
                        size: {
                            type: "string",
                            enum: ["S", "M", "L"]
                        }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);

            // Two different enums should be created
            expect(result).toContain("\"products_category\"");
            expect(result).toContain("\"products_size\"");
            const categoryCount = (result.match(/CREATE TYPE.*products_category/g) ?? []).length;
            const sizeCount = (result.match(/CREATE TYPE.*products_size/g) ?? []).length;
            expect(categoryCount).toBe(1);
            expect(sizeCount).toBe(1);
        });
    });

    // ── 9. Binary type ────────────────────────────────────────────────
    describe("binary type", () => {
        it("should generate BYTEA column for binary type", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "files",
                    table: "files",
                    name: "Files",
                    properties: {
                        data: { type: "binary" },
                        checksum: { type: "binary" }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("\"data\" BYTEA");
            expect(cleanResult).toContain("\"checksum\" BYTEA");
        });

        it("should support required binary columns", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "blobs",
                    table: "blobs",
                    name: "Blobs",
                    properties: {
                        content: { type: "binary", validation: { required: true } }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("\"content\" BYTEA NOT NULL");
        });
    });

    // ── 10. Vector type ───────────────────────────────────────────────
    describe("vector type", () => {
        it("should generate VECTOR(N) column with specified dimensions", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "embeddings",
                    table: "embeddings",
                    name: "Embeddings",
                    properties: {
                        embedding: { type: "vector", dimensions: 1536 }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("\"embedding\" VECTOR(1536)");
        });

        it("should support different dimension values", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "vectors",
                    table: "vectors",
                    name: "Vectors",
                    properties: {
                        small_vec: { type: "vector", dimensions: 3 },
                        medium_vec: { type: "vector", dimensions: 384 },
                        large_vec: { type: "vector", dimensions: 4096 }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("\"small_vec\" VECTOR(3)");
            expect(cleanResult).toContain("\"medium_vec\" VECTOR(384)");
            expect(cleanResult).toContain("\"large_vec\" VECTOR(4096)");
        });

        it("should support required vector columns", async () => {
            const collections: CollectionConfig[] = [
                {
                    slug: "required_vecs",
                    table: "required_vecs",
                    name: "Required Vecs",
                    properties: {
                        vec: { type: "vector", dimensions: 768, validation: { required: true } }
                    }
                }
            ];

            const result = await generatePostgresDdl(collections);
            const cleanResult = cleanDdl(result);

            expect(cleanResult).toContain("\"vec\" VECTOR(768) NOT NULL");
        });
    });

    // ── Bonus: includePolicies: false ─────────────────────────────────
    describe("includePolicies option", () => {
        it("should not include RLS or policies when includePolicies is false", async () => {
            const collections: PostgresCollectionConfig[] = [
                {
                    slug: "items",
                    table: "items",
                    name: "Items",
                    properties: {
                        name: { type: "string" }
                    },
                    securityRules: [
                        {
                            operation: "select",
                            access: "public"
                        }
                    ]
                }
            ];

            const result = await generatePostgresDdl(collections, { includePolicies: false });

            expect(result).toContain("CREATE TABLE");
            expect(result).not.toContain("ENABLE ROW LEVEL SECURITY");
            expect(result).not.toContain("CREATE POLICY");
        });
    });
});
