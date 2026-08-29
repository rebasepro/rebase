/**
 * The WebCrypto primitives the request path runs on.
 *
 * These replaced `node:crypto` calls that were already correct, which is the
 * dangerous kind of change: nothing downstream fails loudly if a hash is
 * subtly different or a "random" integer is biased, because both still return
 * a plausible value. So each one is checked against the thing it replaced —
 * `node:crypto` is imported here, in a test, where nobody cares which runtime
 * it needs.
 *
 * `randomInt` gets the most attention because it is the one whose failure is
 * invisible. It mints one-time passcodes (`generateOtpCode`), and a modulo of
 * a uniform draw is biased towards the low end of the range whenever the range
 * does not divide 2^32 — an entirely working OTP generator that quietly hands
 * out some codes more often than others.
 */

import { createHash, randomInt as nodeRandomInt, timingSafeEqual } from "node:crypto";
import { sha256Hex, constantTimeEqual, randomHex, randomInt } from "../src/utils/portable-crypto";

describe("sha256Hex", () => {
    it("is createHash('sha256').digest('hex')", async () => {
        for (const input of ["", "a", "the quick brown fox", "héllo wörld", "🔐", "x".repeat(10_000)]) {
            expect(await sha256Hex(input)).toBe(createHash("sha256").update(input).digest("hex"));
        }
    });

    it("hashes the UTF-8 bytes, not the code units", async () => {
        // The distinction that matters for anything keyed by a hash of user
        // input: two strings that differ only beyond the BMP must not collide.
        expect(await sha256Hex("é")).not.toBe(await sha256Hex("e"));
        expect((await sha256Hex("🔐")).length).toBe(64);
    });
});

describe("constantTimeEqual", () => {
    it("agrees with timingSafeEqual over equal-length inputs", () => {
        const pairs: Array<[string, string]> = [
            ["", ""], ["a", "a"], ["a", "b"], ["secret", "secret"], ["secret", "secreT"],
            ["ünïcödé", "ünïcödé"], ["ünïcödé", "ünïcöde"]
        ];
        for (const [a, b] of pairs) {
            const bytesA = Buffer.from(a, "utf8");
            const bytesB = Buffer.from(b, "utf8");
            const expected = bytesA.length === bytesB.length && timingSafeEqual(bytesA, bytesB);
            expect([a, b, constantTimeEqual(a, b)]).toEqual([a, b, expected]);
        }
    });

    it("is false for different lengths, including a prefix", () => {
        expect(constantTimeEqual("abc", "abcdef")).toBe(false);
        expect(constantTimeEqual("abcdef", "abc")).toBe(false);
        expect(constantTimeEqual("abc", "abc\0\0\0")).toBe(false);
    });

    it("compares whole multi-byte characters", () => {
        // Sizing a buffer by `String.length` truncates on any multi-byte
        // character, leaving the trailing bytes unexamined — a guess matching
        // everything but the final character then compares equal. These two
        // differ only in the last character, and one of them is 2 bytes.
        expect(constantTimeEqual("passwörd", "passwörc")).toBe(false);
        expect(constantTimeEqual("wörd", "word")).toBe(false);
    });
});

describe("randomHex", () => {
    it("returns 2n lowercase hex characters", () => {
        for (const n of [1, 8, 40]) {
            const hex = randomHex(n);
            expect(hex).toMatch(new RegExp(`^[0-9a-f]{${n * 2}}$`));
        }
    });

    it("does not repeat", () => {
        const seen = new Set(Array.from({ length: 200 }, () => randomHex(16)));
        expect(seen.size).toBe(200);
    });
});

describe("randomInt", () => {
    it("stays inside the range", () => {
        for (const bound of [1, 2, 6, 10, 1000, 10 ** 6]) {
            for (let i = 0; i < 200; i++) {
                const value = randomInt(bound);
                expect(value).toBeGreaterThanOrEqual(0);
                expect(value).toBeLessThan(bound);
                expect(Number.isInteger(value)).toBe(true);
            }
        }
    });

    it("refuses a bound it cannot draw uniformly", () => {
        for (const bound of [0, -1, 1.5, NaN, 2 ** 32 + 1]) {
            expect(() => randomInt(bound)).toThrow(RangeError);
        }
        // `node:crypto` agrees on all of those except the last: it draws wider
        // than 32 bits and accepts a bound up to 2^48. This one deliberately
        // does not, because a single `Uint32Array` draw is all any caller here
        // needs and a wider one that is subtly wrong is worse than a refusal.
        for (const bound of [0, -1, 1.5, NaN]) {
            expect(() => nodeRandomInt(bound)).toThrow();
        }
        expect(() => nodeRandomInt(2 ** 32 + 1)).not.toThrow();
    });

    it("is not biased towards the low end", () => {
        // The bound is chosen so a modulo implementation FAILS this, which a
        // small one would not: `% 3` over a 32-bit draw is biased by about one
        // part in 2^32, so a test at bound 3 would pass against exactly the
        // implementation this one exists to rule out.
        //
        // At 3 · 2^30 the leftover is 2^30 wide, so under `%` every value below
        // 2^30 gets a second chance and lands there half the time instead of a
        // third. Rejection sampling keeps it at a third; 60k draws put the
        // standard error near 0.2 points, and the two hypotheses are 16 points
        // apart.
        const bound = 3 * 2 ** 30;
        let low = 0;
        for (let i = 0; i < 60_000; i++) {
            if (randomInt(bound) < 2 ** 30) low += 1;
        }
        expect(Math.abs(low / 60_000 - 1 / 3)).toBeLessThan(0.02);
    });

    it("covers both ends of a small range", () => {
        const seen = new Set(Array.from({ length: 500 }, () => randomInt(2)));
        expect([...seen].sort()).toEqual([0, 1]);
    });
});
