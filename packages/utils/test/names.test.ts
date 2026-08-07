import { generateForeignKeyName, toPostgresIdentifier } from "../src/names";

describe("generateForeignKeyName", () => {
    it("singularizes a plural name and appends _id", () => {
        expect(generateForeignKeyName("users")).toBe("user_id");
        expect(generateForeignKeyName("posts")).toBe("post_id");
        expect(generateForeignKeyName("comments")).toBe("comment_id");
    });

    it("converts PascalCase to snake_case", () => {
        expect(generateForeignKeyName("Product")).toBe("product_id");
        expect(generateForeignKeyName("UserProfile")).toBe("user_profile_id");
    });

    it("converts camelCase to snake_case", () => {
        expect(generateForeignKeyName("userProfiles")).toBe("user_profile_id");
        expect(generateForeignKeyName("blogPosts")).toBe("blog_post_id");
    });

    it("handles already singular names (no trailing s)", () => {
        expect(generateForeignKeyName("author")).toBe("author_id");
        expect(generateForeignKeyName("child")).toBe("child_id");
    });

    it("handles already snake_case with trailing s", () => {
        expect(generateForeignKeyName("user_profiles")).toBe("user_profile_id");
        expect(generateForeignKeyName("blog_posts")).toBe("blog_post_id");
    });

    it("handles kebab-case input", () => {
        expect(generateForeignKeyName("user-profiles")).toBe("user_profile_id");
    });

    // The cases below are the ones a trailing-"s" strip got wrong. They are the
    // reason this uses `singular()` rather than `slice(0, -1)`.

    it("uses real English singularization, not a trailing-s strip", () => {
        expect(generateForeignKeyName("categories")).toBe("category_id");
        expect(generateForeignKeyName("addresses")).toBe("address_id");
        expect(generateForeignKeyName("boxes")).toBe("box_id");
        expect(generateForeignKeyName("classes")).toBe("class_id");
        expect(generateForeignKeyName("analyses")).toBe("analysis_id");
    });

    it("handles irregular plurals", () => {
        expect(generateForeignKeyName("children")).toBe("child_id");
        expect(generateForeignKeyName("people")).toBe("person_id");
    });

    it("leaves uncountable nouns alone", () => {
        expect(generateForeignKeyName("news")).toBe("news_id");
        expect(generateForeignKeyName("series")).toBe("series_id");
    });

    it("does not strip the 's' from a word ending in a double 's'", () => {
        // A double "s" is never a plural marker, so "address" must not become "addres".
        expect(generateForeignKeyName("address")).toBe("address_id");
        expect(generateForeignKeyName("business")).toBe("business_id");
        expect(generateForeignKeyName("BlogAddress")).toBe("blog_address_id");
    });

    it("keeps acronyms intact", () => {
        // snake-casing first would split every capital: "URLs" -> "ur_ls" -> "ur_l_id".
        expect(generateForeignKeyName("URLs")).toBe("url_id");
        expect(generateForeignKeyName("APIKeys")).toBe("api_key_id");
    });

    it("never produces a name that is only the suffix", () => {
        // "s" singularizes to the empty string; "_id" is not a usable column name.
        expect(generateForeignKeyName("s")).toBe("s_id");
    });
});

describe("toPostgresIdentifier", () => {
    /*
     * This derives identifiers the database is then looked up by, so its output
     * is frozen: a name that changes shape stops matching the object already
     * created under the old one. It had no test at all — it was rewritten off
     * `Buffer` (a Node global, in a package browser-facing code imports, which
     * stopped `packages/codegen` compiling) and nothing would have noticed a
     * behaviour change.
     */
    it("leaves anything within the 63-byte bound untouched", () => {
        expect(toPostgresIdentifier("users")).toBe("users");
        expect(toPostgresIdentifier("a".repeat(63))).toBe("a".repeat(63));
        expect(toPostgresIdentifier("")).toBe("");
    });

    it("truncates at 63 BYTES, not 63 characters", () => {
        // The bound is NAMEDATALEN-1, and NAMEDATALEN counts bytes. 32 two-byte
        // characters are 64 bytes, so one has to go — a character-based slice
        // would have kept all 32.
        const wide = "é".repeat(32);
        expect(wide.length).toBe(32);
        expect(new TextEncoder().encode(wide).byteLength).toBe(64);
        expect(toPostgresIdentifier(wide)).toBe("é".repeat(31));
    });

    // Long enough to exceed 63 bytes at every character width. 40 ASCII
    // characters are only 40 bytes — under the bound, returned untouched — so
    // the widths cannot share a repeat count chosen for the widest one.
    const OVERLONG = 64;

    it("never cuts a character in half", () => {
        // 63 bytes lands mid-sequence for every width > 1. The result must be
        // whole characters, with no U+FFFD left behind.
        for (const ch of ["\u00e9", "\u4e2d", "\u{1f600}"]) {
            const out = toPostgresIdentifier(ch.repeat(OVERLONG));
            expect(out).not.toContain("\uFFFD");
            expect(new TextEncoder().encode(out).byteLength).toBeLessThanOrEqual(63);
            // Whole characters, and a genuine prefix of the input.
            expect([...out].every(c => c === ch)).toBe(true);
            expect(ch.repeat(OVERLONG).startsWith(out)).toBe(true);
        }
    });

    it("fills the bound as fully as the encoding allows", () => {
        // Truncating to whole characters may leave a byte or two spare, but not
        // a whole character's worth — that would be dropping more than Postgres.
        for (const ch of ["a", "\u00e9", "\u4e2d", "\u{1f600}"]) {
            const width = new TextEncoder().encode(ch).byteLength;
            const out = toPostgresIdentifier(ch.repeat(OVERLONG));
            const bytes = new TextEncoder().encode(out).byteLength;
            expect(bytes).toBeLessThanOrEqual(63);
            expect(bytes).toBeGreaterThan(63 - width);
        }
    });
});
