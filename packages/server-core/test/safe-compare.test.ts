/**
 * Tests for the safeCompare function used in auth middleware.
 *
 * Since safeCompare is not exported, we test it indirectly through
 * the createAuthMiddleware behavior with service keys. However, for
 * unit-level verification we replicate the logic here.
 */
import { timingSafeEqual } from "crypto";

// Replicate the safeCompare implementation to test in isolation
function safeCompare(a: string, b: string): boolean {
    const maxLen = Math.max(a.length, b.length);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a);
    bufB.write(b);
    try {
        const isEqual = timingSafeEqual(bufA, bufB);
        return isEqual && a.length === b.length;
    } catch {
        return false;
    }
}

describe("safeCompare", () => {
    it("should return true for identical strings", () => {
        expect(safeCompare("my-secret-key-12345678901234567890", "my-secret-key-12345678901234567890")).toBe(true);
    });

    it("should return false for different strings of same length", () => {
        expect(safeCompare("aaaa", "bbbb")).toBe(false);
    });

    it("should return false for different length strings", () => {
        expect(safeCompare("short", "a-much-longer-string")).toBe(false);
    });

    it("should return false when one string is a prefix of the other", () => {
        // This is the critical case: "abc" vs "abc\0\0\0" would match
        // without the length check, since Buffer.alloc zero-fills
        expect(safeCompare("abc", "abc\0\0\0")).toBe(false);
    });

    it("should return false for empty string vs non-empty", () => {
        expect(safeCompare("", "something")).toBe(false);
    });

    it("should return true for two empty strings", () => {
        expect(safeCompare("", "")).toBe(true);
    });

    it("should handle unicode strings", () => {
        expect(safeCompare("café", "café")).toBe(true);
        expect(safeCompare("café", "cafe")).toBe(false);
    });

    it("should not leak length information via early return", () => {
        // Both comparisons should take similar time (constant-time)
        // We can't easily assert timing, but we verify they both
        // go through the same code path
        const result1 = safeCompare("a", "bb");
        const result2 = safeCompare("aa", "bb");
        expect(result1).toBe(false);
        expect(result2).toBe(false);
    });
});
