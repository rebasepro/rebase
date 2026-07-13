import { CollectionConfig, PostgresCollectionConfig } from "@rebasepro/types";
import { generatePostgresDdl } from "../src/schema/generate-postgres-ddl-logic";

describe("generatePostgresDdl", () => {
    const cleanDdl = (ddl: string) => {
        return ddl
            .replace(/--.*$/gm, "") // Remove single-line SQL comments
            .replace(/\n{2,}/g, "\n") // Collapse multiple newlines
            .replace(/\s+/g, " ") // Collapse whitespace
            .trim();
    };

    it("should generate a simple table with basic types", async () => {
        const collections: CollectionConfig[] = [
            {
                slug: "products",
                table: "products",
                name: "Products",
                properties: {
                    name: { type: "string", validation: { required: true } },
                    price: { type: "number" },
                    available: { type: "boolean" }
                }
            }
        ];

        const result = await generatePostgresDdl(collections);
        const cleanResult = cleanDdl(result);

        expect(cleanResult).toContain("CREATE TABLE \"public\".\"products\" (");
        expect(cleanResult).toContain("\"id\" VARCHAR(255) PRIMARY KEY");
        expect(cleanResult).toContain("\"name\" VARCHAR(255) NOT NULL");
        expect(cleanResult).toContain("\"price\" NUMERIC");
        expect(cleanResult).toContain("\"available\" BOOLEAN");
        expect(cleanResult).toContain("ALTER TABLE \"public\".\"products\" ENABLE ROW LEVEL SECURITY");
    });

    it("should generate custom schemas", async () => {
        const collections: PostgresCollectionConfig[] = [
            {
                slug: "products",
                table: "products",
                name: "Products",
                schema: "inventory",
                properties: {
                    name: { type: "string" }
                }
            }
        ];

        const result = await generatePostgresDdl(collections);
        expect(result).toContain("CREATE SCHEMA IF NOT EXISTS \"inventory\";");
        expect(result).toContain("CREATE TABLE \"inventory\".\"products\"");
    });

    it("should generate enum types", async () => {
        const collections: CollectionConfig[] = [
            {
                slug: "orders",
                table: "orders",
                name: "Orders",
                properties: {
                    status: {
                        type: "string",
                        enum: ["pending", "shipped", "delivered"]
                    }
                }
            }
        ];

        const result = await generatePostgresDdl(collections);
        expect(result).toContain("CREATE TYPE \"public\".\"orders_status\" AS ENUM ('pending', 'shipped', 'delivered');");
        expect(result).toContain("\"status\" \"public\".\"orders_status\"");
    });

    it("should generate one-to-many relation foreign keys", async () => {
        const usersCollection: CollectionConfig = {
            slug: "users",
            table: "users",
            name: "Users",
            properties: {
                name: { type: "string" }
            }
        };
        const postsCollection: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                title: { type: "string" },
                author: { type: "relation", relationName: "author" }
            },
            relations: [
                {
                    relationName: "author",
                    target: () => usersCollection,
                    cardinality: "one",
                    localKey: "author_id",
                    onDelete: "set null"
                }
            ]
        };

        const result = await generatePostgresDdl([usersCollection, postsCollection]);
        const cleanResult = cleanDdl(result);

        expect(cleanResult).toContain("\"author_id\" VARCHAR(255)");
        expect(cleanResult).toContain("ALTER TABLE \"public\".\"posts\" ADD CONSTRAINT \"posts_author_id_fkey\" FOREIGN KEY (\"author_id\") REFERENCES \"public\".\"users\" (\"id\") ON DELETE SET NULL;");
    });

    it("should generate many-to-many junction tables", async () => {
        const postsCollection: CollectionConfig = {
            slug: "posts",
            table: "posts",
            name: "Posts",
            properties: {
                title: { type: "string" },
                tags: { type: "relation", relationName: "tags" }
            },
            relations: [
                {
                    relationName: "tags",
                    target: () => tagsCollection,
                    cardinality: "many",
                    direction: "owning",
                    through: {
                        table: "posts_to_tags",
                        sourceColumn: "post_id",
                        targetColumn: "tag_id"
                    }
                }
            ]
        };
        const tagsCollection: CollectionConfig = {
            slug: "tags",
            table: "tags",
            name: "Tags",
            properties: {
                name: { type: "string" }
            }
        };

        const result = await generatePostgresDdl([postsCollection, tagsCollection]);
        const cleanResult = cleanDdl(result);

        expect(cleanResult).toContain("CREATE TABLE \"public\".\"posts_to_tags\" (");
        expect(cleanResult).toContain("\"post_id\" VARCHAR(255) NOT NULL");
        expect(cleanResult).toContain("\"tag_id\" VARCHAR(255) NOT NULL");
        expect(cleanResult).toContain("ALTER TABLE \"public\".\"posts_to_tags\" ADD CONSTRAINT \"posts_to_tags_post_id_fkey\" FOREIGN KEY (\"post_id\") REFERENCES \"public\".\"posts\" (\"id\") ON DELETE CASCADE;");
        expect(cleanResult).toContain("ALTER TABLE \"public\".\"posts_to_tags\" ADD CONSTRAINT \"posts_to_tags_tag_id_fkey\" FOREIGN KEY (\"tag_id\") REFERENCES \"public\".\"tags\" (\"id\") ON DELETE CASCADE;");
        expect(cleanResult).toContain("PRIMARY KEY (\"post_id\", \"tag_id\")");
    });

    it("should generate column default values", async () => {
        const collections: CollectionConfig[] = [
            {
                slug: "users_uuid",
                table: "users_uuid",
                name: "Users UUID",
                properties: {
                    uuid_id: { type: "string", isId: "uuid" },
                    created: { type: "date", autoValue: "on_create" }
                }
            },
            {
                slug: "users_cuid",
                table: "users_cuid",
                name: "Users CUID",
                properties: {
                    cuid_id: { type: "string", isId: "cuid" }
                }
            }
        ];

        const result = await generatePostgresDdl(collections);
        const cleanResult = cleanDdl(result);

        expect(cleanResult).toContain("\"uuid_id\" UUID PRIMARY KEY DEFAULT gen_random_uuid()");
        expect(cleanResult).toContain("\"cuid_id\" VARCHAR(255) PRIMARY KEY DEFAULT cuid()");
        expect(cleanResult).toContain("\"created\" TIMESTAMP WITH TIME ZONE DEFAULT now()");
    });

    it("should generate RLS policies with ownerField and roles", async () => {
        const collections: PostgresCollectionConfig[] = [
            {
                slug: "posts",
                table: "posts",
                name: "Posts",
                properties: {
                    title: { type: "string" },
                    user_id: { type: "string" }
                },
                securityRules: [
                    {
                        operation: "select",
                        access: "public"
                    },
                    {
                        operation: "update",
                        ownerField: "user_id",
                        roles: ["admin", "editor"]
                    }
                ]
            }
        ];

        const result = await generatePostgresDdl(collections);
        const cleanResult = cleanDdl(result);

        expect(cleanResult).toContain("CREATE POLICY \"posts_select_");
        expect(cleanResult).toContain("USING (true)");
        expect(cleanResult).toContain("CREATE POLICY \"posts_update_");
        expect(cleanResult).toContain("USING (((user_id)::text = auth.uid()) AND (string_to_array(auth.roles(), ',') && ARRAY['admin','editor']))");
    });

    it("should generate advanced column types, constraints, and default values", async () => {
        const collections: CollectionConfig[] = [
            {
                slug: "items",
                table: "items",
                name: "Items",
                properties: {
                    price_int: { type: "number", validation: { integer: true } },
                    price_num: { type: "number" },
                    big_val: { type: "number", columnType: "bigint" },
                    raw_date: { type: "date", columnType: "date" },
                    raw_time: { type: "date", columnType: "time" },
                    raw_map: { type: "map", columnType: "json" },
                    raw_vector: { type: "vector", dimensions: 1536 },
                    raw_binary: { type: "binary" },
                    text_arr: { type: "array", of: { type: "string" } },
                    int_arr: { type: "array", of: { type: "number", validation: { integer: true } } },
                    bool_arr: { type: "array", of: { type: "boolean" } },
                    num_arr: { type: "array", of: { type: "number" } },
                    ref_val: { type: "reference", path: "other_collection" },
                    req_val: { type: "string", validation: { required: true } },
                    uniq_val: { type: "string", validation: { unique: true } }
                }
            },
            {
                slug: "other_collection",
                table: "other_collection",
                name: "Other Collection",
                properties: {
                    id: { type: "string", isId: "uuid" }
                }
            }
        ];

        const result = await generatePostgresDdl(collections);
        const cleanResult = cleanDdl(result);

        expect(cleanResult).toContain("\"price_int\" INTEGER");
        expect(cleanResult).toContain("\"price_num\" NUMERIC");
        expect(cleanResult).toContain("\"big_val\" BIGINT");
        expect(cleanResult).toContain("\"raw_date\" DATE");
        expect(cleanResult).toContain("\"raw_time\" TIME");
        expect(cleanResult).toContain("\"raw_map\" JSON");
        expect(cleanResult).toContain("\"raw_vector\" VECTOR(1536)");
        expect(cleanResult).toContain("\"raw_binary\" BYTEA");
        expect(cleanResult).toContain("\"text_arr\" TEXT[]");
        expect(cleanResult).toContain("\"int_arr\" INTEGER[]");
        expect(cleanResult).toContain("\"bool_arr\" BOOLEAN[]");
        expect(cleanResult).toContain("\"num_arr\" NUMERIC[]");
        expect(cleanResult).toContain("\"ref_val\" UUID");
        expect(cleanResult).toContain("ALTER TABLE \"public\".\"items\" ADD CONSTRAINT \"items_ref_val_fkey\" FOREIGN KEY (\"ref_val\") REFERENCES \"public\".\"other_collection\" (\"id\") ON DELETE SET NULL;");
        expect(cleanResult).toContain("\"req_val\" VARCHAR(255) NOT NULL");
        expect(cleanResult).toContain("\"uniq_val\" VARCHAR(255) UNIQUE");
    });

    it("should generate RLS policies with restrictive mode, multiple operations, and custom using/check clauses", async () => {
        const collections: PostgresCollectionConfig[] = [
            {
                slug: "documents",
                table: "documents",
                name: "Documents",
                properties: {
                    title: { type: "string" },
                    owner: { type: "string" }
                },
                securityRules: [
                    {
                        name: "restrict_access",
                        mode: "restrictive",
                        operations: ["select", "update"],
                        using: "owner = auth.uid()",
                        withCheck: "owner = auth.uid()",
                        pgRoles: ["authenticated"]
                    }
                ]
            }
        ];

        const result = await generatePostgresDdl(collections);
        const cleanResult = cleanDdl(result);

        expect(cleanResult).toContain("CREATE POLICY \"restrict_access_select\" ON \"public\".\"documents\" AS RESTRICTIVE FOR SELECT TO \"authenticated\" USING ((owner)::text = auth.uid())");
        expect(cleanResult).toContain("CREATE POLICY \"restrict_access_update\" ON \"public\".\"documents\" AS RESTRICTIVE FOR UPDATE TO \"authenticated\" USING ((owner)::text = auth.uid()) WITH CHECK ((owner)::text = auth.uid())");
    });
});
