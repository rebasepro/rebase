/**
 * Tests for `safeCompare`, the constant-time comparison guarding the service
 * key, API keys and the metrics token. A wrong answer here is an authentication
 * bypass, not a cosmetic bug.
 *
 * This file used to define its own copy of the implementation and test that.
 * A test of a copy passes no matter what the real function does — which is
 * precisely how the multi-byte truncation below survived. It imports the real
 * one now.
 */
import { safeCompare } from "../src/auth/crypto-utils";

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
        // Buffer.alloc zero-fills, so without a length check "abc" would match
        // "abc\0\0\0".
        expect(safeCompare("abc", "abc\0\0\0")).toBe(false);
        expect(safeCompare("abc", "abcdef")).toBe(false);
        expect(safeCompare("abcdef", "abc")).toBe(false);
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

    it("compares the whole of a multi-byte secret", () => {
        // Sizing the comparison buffer by character count while writing UTF-8
        // truncated the tail: every character past the byte budget went
        // unexamined, so a guess differing only in the final character compared
        // equal. One non-ASCII character in a secret was enough.
        const real = `é${"a".repeat(30)}X`;
        const guess = `é${"a".repeat(30)}Q`;

        expect(guess.length).toBe(real.length);
        expect(safeCompare(guess, real)).toBe(false);
        expect(safeCompare(real, real)).toBe(true);
    });

    it("handles characters outside the basic multilingual plane", () => {
        expect(safeCompare("🔑secret", "🔑secret")).toBe(true);
        expect(safeCompare("🔑secret", "🔑secreT")).toBe(false);
    });

    it("should not leak length information via early return", () => {
        // Both comparisons go through the same code path; the length check is
        // folded in after the constant-time compare rather than short-circuiting.
        expect(safeCompare("a", "bb")).toBe(false);
        expect(safeCompare("aa", "bb")).toBe(false);
    });
});
