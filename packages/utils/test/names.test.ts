import { generateForeignKeyName } from "../src/names";

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
