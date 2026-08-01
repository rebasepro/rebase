import { hashString } from "../src/hash";

describe("hash utils", () => {
    describe("hashString", () => {
        it("should return 0 for empty string", () => {
            expect(hashString("")).toBe(0);
        });

        it("should hash a string consistently", () => {
            const str = "hello world";
            const hash1 = hashString(str);
            const hash2 = hashString(str);
            expect(hash1).toBe(hash2);
            expect(typeof hash1).toBe("number");
        });

        it("should generate different hashes for different strings", () => {
            expect(hashString("apple")).not.toBe(hashString("apples"));
        });

        it("should absolutize inputs whose 32-bit accumulator goes negative", () => {
            // "rebase" is one of them: without Math.abs it hashes to -934952060.
            // The old sample happened to be positive already, so the assertion
            // held with Math.abs deleted.
            expect(hashString("rebase")).toBe(934952060);
        });

        it("should return a non-negative 32-bit integer for every input", () => {
            const samples = [
                "", "a", "rebase", "collection/users", "hello world",
                "some long string that might cause negative bitwise overflow",
                "éèê", "x".repeat(1000)
            ];
            for (const sample of samples) {
                const hash = hashString(sample);
                expect(Number.isInteger(hash)).toBe(true);
                expect(hash).toBeGreaterThanOrEqual(0);
                expect(hash).toBeLessThanOrEqual(2 ** 31);
            }
        });
    });
});
