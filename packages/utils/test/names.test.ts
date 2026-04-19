import { generateForeignKeyName } from "../src/names";

describe("generateForeignKeyName", () => {
    it("singularizes a plural name and appends _id", () => {
        expect(generateForeignKeyName("users")).toBe("user_id");
        expect(generateForeignKeyName("posts")).toBe("post_id");
        expect(generateForeignKeyName("comments")).toBe("comment_id");
    });

    it("converts PascalCase to snake_case before singularizing", () => {
        expect(generateForeignKeyName("Product")).toBe("product_id");
        expect(generateForeignKeyName("UserProfile")).toBe("user_profile_id");
    });

    it("converts camelCase to snake_case before singularizing", () => {
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

    it("handles single character names", () => {
        // 's' itself becomes '' after singularization
        expect(generateForeignKeyName("s")).toBe("_id");
    });

    it("handles kebab-case input", () => {
        expect(generateForeignKeyName("user-profiles")).toBe("user_profile_id");
    });

    it("handles names ending in 'ss' (e.g. 'address')", () => {
        // "address" -> "addres_id" — this is a known limitation of the naive heuristic
        const result = generateForeignKeyName("address");
        expect(result).toBe("addres_id");
    });

    it("handles uppercase acronyms (splits per letter)", () => {
        // The snake_case conversion splits every uppercase letter individually
        const result = generateForeignKeyName("URLs");
        expect(result).toBe("ur_l_id");
    });

});
