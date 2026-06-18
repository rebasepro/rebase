import {
    computePropertyPriority, sortPropertiesOrder,
    PropertyOrderingContext, PropertyOrderEntry
} from "../src/schema/introspect-db-logic";

// ── Helpers ───────────────────────────────────────────────────────────

function mkCtx(overrides: Partial<PropertyOrderingContext> = {}): PropertyOrderingContext {
    return {
        propType: "string",
        isPk: false,
        isEnum: false,
        isStorage: false,
        pgDataType: "character varying",
        originalIndex: 0,
        ...overrides
    };
}

function mkEntry(key: string, overrides: Partial<PropertyOrderingContext> = {}): PropertyOrderEntry {
    return { key,
ctx: mkCtx(overrides) };
}

// ═══════════════════════════════════════════════════════════════════════
// computePropertyPriority() — tier assignment
// ═══════════════════════════════════════════════════════════════════════
describe("computePropertyPriority", () => {
    describe("Tier 0: Identity / Primary keys", () => {
        it("ranks 'id' PK as tier 0 (score 0)", () => {
            const score = computePropertyPriority("id", mkCtx({ isPk: true }));
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThan(10);
        });

        it("ranks any PK column in tier 0", () => {
            const score = computePropertyPriority("uuid", mkCtx({ isPk: true }));
            expect(score).toBeGreaterThanOrEqual(0);
            expect(score).toBeLessThan(10);
        });

        it("ranks unknown PK name with fallback score 5", () => {
            const score = computePropertyPriority("pk_col", mkCtx({ isPk: true }));
            expect(score).toBeGreaterThanOrEqual(5);
            expect(score).toBeLessThan(10);
        });
    });

    describe("Tier 1: Title / Name fields", () => {
        it.each(["name", "title", "label", "display_name", "headline", "subject", "heading"])(
            "ranks '%s' in tier 1 (10-19)",
            (col) => {
                const score = computePropertyPriority(col, mkCtx());
                expect(score).toBeGreaterThanOrEqual(10);
                expect(score).toBeLessThan(20);
            }
        );

        it("ranks 'product_name' as partial match in tier 1b (17-19)", () => {
            const score = computePropertyPriority("product_name", mkCtx());
            expect(score).toBeGreaterThanOrEqual(17);
            expect(score).toBeLessThan(20);
        });

        it("ranks 'page_title' as partial match in tier 1b", () => {
            const score = computePropertyPriority("page_title", mkCtx());
            expect(score).toBeGreaterThanOrEqual(17);
            expect(score).toBeLessThan(20);
        });
    });

    describe("Tier 2: Human identity fields", () => {
        it.each(["first_name", "last_name", "full_name", "username", "email", "phone", "phone_number"])(
            "ranks '%s' in tier 2 (20-29)",
            (col) => {
                const score = computePropertyPriority(col, mkCtx());
                expect(score).toBeGreaterThanOrEqual(20);
                expect(score).toBeLessThan(30);
            }
        );

        it("ranks first_name before last_name", () => {
            const first = computePropertyPriority("first_name", mkCtx());
            const last = computePropertyPriority("last_name", mkCtx());
            expect(first).toBeLessThan(last);
        });
    });

    describe("Tier 3: Core descriptors", () => {
        it.each(["slug", "code", "sku", "type", "status", "role", "category"])(
            "ranks '%s' in tier 3 (30-39)",
            (col) => {
                const score = computePropertyPriority(col, mkCtx());
                expect(score).toBeGreaterThanOrEqual(30);
                expect(score).toBeLessThan(40);
            }
        );
    });

    describe("Tier 4: Short text, enums, booleans", () => {
        it("ranks enum fields in tier 4", () => {
            const score = computePropertyPriority("payment_method", mkCtx({ isEnum: true }));
            expect(score).toBeGreaterThanOrEqual(40);
            expect(score).toBeLessThan(50);
        });

        it("ranks boolean fields in tier 4", () => {
            const score = computePropertyPriority("active", mkCtx({ propType: "boolean" }));
            expect(score).toBeGreaterThanOrEqual(40);
            expect(score).toBeLessThan(50);
        });

        it("ranks short string (varchar) in tier 4", () => {
            const score = computePropertyPriority("color", mkCtx({ propType: "string",
pgDataType: "character varying" }));
            expect(score).toBeGreaterThanOrEqual(40);
            expect(score).toBeLessThan(50);
        });
    });

    describe("Tier 5: Numbers & user-facing dates", () => {
        it("ranks number fields in tier 5", () => {
            const score = computePropertyPriority("price", mkCtx({ propType: "number" }));
            expect(score).toBeGreaterThanOrEqual(50);
            expect(score).toBeLessThan(60);
        });

        it("ranks non-system date fields in tier 5", () => {
            const score = computePropertyPriority("published_at", mkCtx({ propType: "date" }));
            expect(score).toBeGreaterThanOrEqual(50);
            expect(score).toBeLessThan(60);
        });
    });

    describe("Tier 6: Relations", () => {
        it("ranks relation fields in tier 6", () => {
            const score = computePropertyPriority("author", mkCtx({ propType: "relation" }));
            expect(score).toBeGreaterThanOrEqual(60);
            expect(score).toBeLessThan(70);
        });
    });

    describe("Tier 7: Long text fields", () => {
        it.each(["description", "summary", "excerpt", "bio", "about"])(
            "ranks '%s' in tier 7 (70-79)",
            (col) => {
                const score = computePropertyPriority(col, mkCtx());
                expect(score).toBeGreaterThanOrEqual(70);
                expect(score).toBeLessThan(80);
            }
        );
    });

    describe("Tier 8: Rich content fields", () => {
        it.each(["content", "body", "html"])(
            "ranks '%s' in tier 8 (80-89)",
            (col) => {
                const score = computePropertyPriority(col, mkCtx());
                expect(score).toBeGreaterThanOrEqual(80);
                expect(score).toBeLessThan(90);
            }
        );
    });

    describe("Tier 9: Media / storage fields", () => {
        it("ranks storage fields in tier 9", () => {
            const score = computePropertyPriority("profile_image", mkCtx({ isStorage: true }));
            expect(score).toBeGreaterThanOrEqual(90);
            expect(score).toBeLessThan(100);
        });

        it.each(["avatar", "photo_url", "logo", "cover_image", "thumbnail"])(
            "ranks '%s' (media pattern) in tier 9",
            (col) => {
                const score = computePropertyPriority(col, mkCtx());
                expect(score).toBeGreaterThanOrEqual(90);
                expect(score).toBeLessThan(100);
            }
        );

        it("ranks URL-suffix fields in tier 9", () => {
            const score = computePropertyPriority("website_url", mkCtx());
            expect(score).toBeGreaterThanOrEqual(90);
            expect(score).toBeLessThan(100);
        });
    });

    describe("Tier 10: JSON / Map types", () => {
        it("ranks map types in tier 10", () => {
            const score = computePropertyPriority("metadata", mkCtx({ propType: "map" }));
            expect(score).toBeGreaterThanOrEqual(100);
            expect(score).toBeLessThan(110);
        });

        it("ranks unknown map field names slightly higher", () => {
            const known = computePropertyPriority("metadata", mkCtx({ propType: "map" }));
            const unknown = computePropertyPriority("weird_json", mkCtx({ propType: "map" }));
            expect(unknown).toBeGreaterThan(known);
        });
    });

    describe("Tier 11: Array types", () => {
        it("ranks array types in tier 11", () => {
            const score = computePropertyPriority("tags", mkCtx({ propType: "array" }));
            expect(score).toBeGreaterThanOrEqual(110);
            expect(score).toBeLessThan(120);
        });
    });

    describe("Tier 12: System timestamps", () => {
        it.each(["created_at", "updated_at", "deleted_at", "archived_at"])(
            "ranks '%s' in tier 12 (120-129)",
            (col) => {
                const score = computePropertyPriority(col, mkCtx({ propType: "date" }));
                expect(score).toBeGreaterThanOrEqual(120);
                expect(score).toBeLessThan(130);
            }
        );

        it("ranks created_at before updated_at", () => {
            const created = computePropertyPriority("created_at", mkCtx({ propType: "date" }));
            const updated = computePropertyPriority("updated_at", mkCtx({ propType: "date" }));
            expect(created).toBeLessThan(updated);
        });

        it("ranks updated_at before deleted_at", () => {
            const updated = computePropertyPriority("updated_at", mkCtx({ propType: "date" }));
            const deleted = computePropertyPriority("deleted_at", mkCtx({ propType: "date" }));
            expect(updated).toBeLessThan(deleted);
        });
    });

    describe("tiebreaking with originalIndex", () => {
        it("preserves original column order within the same tier", () => {
            const a = computePropertyPriority("color", mkCtx({ originalIndex: 0 }));
            const b = computePropertyPriority("size", mkCtx({ originalIndex: 1 }));
            expect(a).toBeLessThan(b);
        });

        it("tiebreaker is fractional (doesn't cross tier boundaries)", () => {
            const lastInTier = computePropertyPriority("color", mkCtx({ originalIndex: 9999 }));
            // Should still be in tier 4 (42.x) not tier 5 (50+)
            expect(lastInTier).toBeLessThan(50);
        });
    });
});

// ═══════════════════════════════════════════════════════════════════════
// sortPropertiesOrder() — full sorting integration
// ═══════════════════════════════════════════════════════════════════════
describe("sortPropertiesOrder", () => {
    it("places 'id' before 'name' before generic fields", () => {
        const entries: PropertyOrderEntry[] = [
            mkEntry("created_at", { propType: "date",
originalIndex: 3 }),
            mkEntry("name", { originalIndex: 1 }),
            mkEntry("id", { isPk: true,
originalIndex: 0 }),
            mkEntry("status", { originalIndex: 2 })
        ];
        const result = sortPropertiesOrder(entries);
        expect(result).toEqual(["id", "name", "status", "created_at"]);
    });

    it("sorts a realistic user table correctly", () => {
        const entries: PropertyOrderEntry[] = [
            mkEntry("id", { isPk: true,
propType: "string",
pgDataType: "uuid",
originalIndex: 0 }),
            mkEntry("created_at", { propType: "date",
originalIndex: 1 }),
            mkEntry("updated_at", { propType: "date",
originalIndex: 2 }),
            mkEntry("email", { originalIndex: 3 }),
            mkEntry("first_name", { originalIndex: 4 }),
            mkEntry("last_name", { originalIndex: 5 }),
            mkEntry("avatar", { isStorage: true,
originalIndex: 6 }),
            mkEntry("role", { isEnum: true,
originalIndex: 7 }),
            mkEntry("active", { propType: "boolean",
originalIndex: 8 }),
            mkEntry("bio", { pgDataType: "text",
originalIndex: 9 }),
            mkEntry("metadata", { propType: "map",
pgDataType: "jsonb",
originalIndex: 10 })
        ];
        const result = sortPropertiesOrder(entries);
        expect(result).toEqual([
            "id", // tier 0: PK
            "first_name", // tier 2: human identity
            "last_name", // tier 2: human identity
            "email", // tier 2: human identity
            "role", // tier 4: enum
            "active", // tier 4: boolean
            "bio", // tier 7: long text
            "avatar", // tier 9: storage
            "metadata", // tier 10: map
            "created_at", // tier 12: system timestamp
            "updated_at" // tier 12: system timestamp
        ]);
    });

    it("sorts a realistic product table correctly", () => {
        const entries: PropertyOrderEntry[] = [
            mkEntry("id", { isPk: true,
propType: "number",
pgDataType: "integer",
originalIndex: 0 }),
            mkEntry("created_at", { propType: "date",
originalIndex: 1 }),
            mkEntry("sku", { originalIndex: 2 }),
            mkEntry("name", { originalIndex: 3 }),
            mkEntry("description", { pgDataType: "text",
originalIndex: 4 }),
            mkEntry("price", { propType: "number",
originalIndex: 5 }),
            mkEntry("category", { propType: "relation",
originalIndex: 6 }),
            mkEntry("cover_image", { isStorage: true,
originalIndex: 7 }),
            mkEntry("active", { propType: "boolean",
originalIndex: 8 })
        ];
        const result = sortPropertiesOrder(entries);
        expect(result).toEqual([
            "id", // tier 0: PK
            "name", // tier 1: title/name
            "sku", // tier 3: descriptor
            "category", // tier 3: descriptor (name match overrides relation tier)
            "active", // tier 4: boolean
            "price", // tier 5: number
            "description", // tier 7: long text
            "cover_image", // tier 9: storage
            "created_at" // tier 12: system timestamp
        ]);
    });

    it("sorts a blog post table correctly", () => {
        const entries: PropertyOrderEntry[] = [
            mkEntry("id", { isPk: true,
propType: "string",
pgDataType: "uuid",
originalIndex: 0 }),
            mkEntry("updated_at", { propType: "date",
originalIndex: 1 }),
            mkEntry("created_at", { propType: "date",
originalIndex: 2 }),
            mkEntry("content", { pgDataType: "text",
originalIndex: 3 }),
            mkEntry("title", { originalIndex: 4 }),
            mkEntry("slug", { originalIndex: 5 }),
            mkEntry("status", { isEnum: true,
originalIndex: 6 }),
            mkEntry("author", { propType: "relation",
originalIndex: 7 }),
            mkEntry("published_at", { propType: "date",
originalIndex: 8 }),
            mkEntry("cover_image", { isStorage: true,
originalIndex: 9 }),
            mkEntry("excerpt", { pgDataType: "text",
originalIndex: 10 })
        ];
        const result = sortPropertiesOrder(entries);
        expect(result).toEqual([
            "id", // tier 0: PK
            "title", // tier 1: title
            "slug", // tier 3: descriptor
            "status", // tier 4: enum
            "published_at", // tier 5: user-facing date
            "author", // tier 6: relation
            "excerpt", // tier 7: long text
            "content", // tier 8: rich content
            "cover_image", // tier 9: storage
            "created_at", // tier 12: system timestamp
            "updated_at" // tier 12: system timestamp
        ]);
    });

    it("preserves original order for properties in the same tier", () => {
        const entries: PropertyOrderEntry[] = [
            mkEntry("color", { propType: "string",
pgDataType: "character varying",
originalIndex: 0 }),
            mkEntry("size", { propType: "string",
pgDataType: "character varying",
originalIndex: 1 }),
            mkEntry("weight", { propType: "string",
pgDataType: "character varying",
originalIndex: 2 })
        ];
        const result = sortPropertiesOrder(entries);
        // All three are tier 4 (short strings), should preserve original order
        expect(result).toEqual(["color", "size", "weight"]);
    });

    it("handles tables with only system columns", () => {
        const entries: PropertyOrderEntry[] = [
            mkEntry("id", { isPk: true,
originalIndex: 0 }),
            mkEntry("created_at", { propType: "date",
originalIndex: 1 }),
            mkEntry("updated_at", { propType: "date",
originalIndex: 2 })
        ];
        const result = sortPropertiesOrder(entries);
        expect(result).toEqual(["id", "created_at", "updated_at"]);
    });

    it("handles partial name matches (product_name, page_title)", () => {
        const entries: PropertyOrderEntry[] = [
            mkEntry("id", { isPk: true,
originalIndex: 0 }),
            mkEntry("product_name", { originalIndex: 1 }),
            mkEntry("category", { originalIndex: 2 }),
            mkEntry("price", { propType: "number",
originalIndex: 3 })
        ];
        const result = sortPropertiesOrder(entries);
        // product_name should come after id but before category and price
        expect(result[0]).toBe("id");
        expect(result[1]).toBe("product_name");
    });

    it("handles mixed URL and media fields", () => {
        const entries: PropertyOrderEntry[] = [
            mkEntry("name", { originalIndex: 0 }),
            mkEntry("website_url", { originalIndex: 1 }),
            mkEntry("avatar", { isStorage: true,
originalIndex: 2 }),
            mkEntry("thumbnail", { originalIndex: 3 })
        ];
        const result = sortPropertiesOrder(entries);
        expect(result[0]).toBe("name");
        // All media/url fields should cluster together after name
        expect(result.indexOf("website_url")).toBeGreaterThan(result.indexOf("name"));
        expect(result.indexOf("avatar")).toBeGreaterThan(result.indexOf("name"));
        expect(result.indexOf("thumbnail")).toBeGreaterThan(result.indexOf("name"));
    });
});
