import { getTableIncludesFromCollections } from "../src/cli-helpers";

describe("Unmapped tables safety with Atlas", () => {
    it("should produce include filters only for managed tables and M2M junction tables", async () => {
        const mockCollections = [
            {
                slug: "users",
                table: "users",
                properties: { name: { type: "string" } }
            },
            {
                slug: "posts",
                table: "posts",
                properties: {
                    title: { type: "string" }
                },
                relations: [
                    {
                        kind: "manyToMany",
                        relationName: "tags",
                        target: () => ({ table: "tags", slug: "tags" }),
                        through: {
                            table: "posts_to_tags",
                            sourceColumn: "post_id",
                            targetColumn: "tag_id"
                        }
                    }
                ]
            }
        ];

        const includes = await getTableIncludesFromCollections(mockCollections);

        // Verify only managed tables and their junctions are included
        expect(includes).toContain("public.users");
        expect(includes).toContain("public.posts");
        expect(includes).toContain("public.posts_to_tags");

        // Verify unmapped tables are NOT included, ensuring they are ignored by Atlas --include filters
        const unmappedTables = [
            "public.legacy_orders",
            "public.external_analytics",
            "public.stripe_webhooks",
            "public.audit_log"
        ];
        for (const unmapped of unmappedTables) {
            expect(includes).not.toContain(unmapped);
        }
    });

    it("should support custom schemas in table include paths", async () => {
        const mockCollections = [
            {
                slug: "orders",
                table: "orders",
                schema: "sales",
                properties: { id: { type: "string" } }
            }
        ];

        const includes = await getTableIncludesFromCollections(mockCollections);
        expect(includes).toContain("sales.orders");
        expect(includes).not.toContain("public.orders");
    });
});
