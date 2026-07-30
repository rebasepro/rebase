import {
    validatePasswordStrength,
    hashPassword,
    verifyPassword
} from "../src/auth/password";

describe("Password Utilities", () => {
    describe("validatePasswordStrength", () => {
        it("should accept a valid password", () => {
            const result = validatePasswordStrength("ValidPass123");
            expect(result.valid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it("should reject password shorter than 8 characters", () => {
            const result = validatePasswordStrength("Short1A");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Password must be at least 8 characters long");
        });

        it("should reject password without uppercase letter", () => {
            const result = validatePasswordStrength("lowercase123");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Password must contain at least one uppercase letter");
        });

        it("should reject password without lowercase letter", () => {
            const result = validatePasswordStrength("UPPERCASE123");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Password must contain at least one lowercase letter");
        });

        it("should reject password without number", () => {
            const result = validatePasswordStrength("NoNumbersHere");
            expect(result.valid).toBe(false);
            expect(result.errors).toContain("Password must contain at least one number");
        });

        it("should return multiple errors for multiple violations", () => {
            const result = validatePasswordStrength("short");
            expect(result.valid).toBe(false);
            expect(result.errors.length).toBeGreaterThan(1);
        });

        it("should accept password with special characters", () => {
            const result = validatePasswordStrength("Valid@Pass#123!");
            expect(result.valid).toBe(true);
        });

        it("should accept password at exactly 8 characters", () => {
            const result = validatePasswordStrength("Abcdefg1");
            expect(result.valid).toBe(true);
        });
    });

    describe("hashPassword", () => {
        it("should return a hash in salt:hash format", async () => {
            const hash = await hashPassword("TestPassword123");
            expect(hash).toContain(":");
            const [salt, hashValue] = hash.split(":");
            expect(salt).toBeTruthy();
            expect(hashValue).toBeTruthy();
        });

        it("should generate different hashes for the same password (due to random salt)", async () => {
            const hash1 = await hashPassword("SamePassword123");
            const hash2 = await hashPassword("SamePassword123");
            expect(hash1).not.toBe(hash2);
        });

        it("should generate a 32-byte salt (64 hex chars)", async () => {
            const hash = await hashPassword("TestPassword123");
            const [salt] = hash.split(":");
            expect(salt).toHaveLength(64);
        });

        it("should generate a 64-byte key (128 hex chars)", async () => {
            const hash = await hashPassword("TestPassword123");
            const [, hashValue] = hash.split(":");
            expect(hashValue).toHaveLength(128);
        });
    });

    describe("verifyPassword", () => {
        it("should verify a correct password", async () => {
            const password = "CorrectPassword123";
            const hash = await hashPassword(password);
            const isValid = await verifyPassword(password, hash);
            expect(isValid).toBe(true);
        });

        it("should reject an incorrect password", async () => {
            const hash = await hashPassword("CorrectPassword123");
            const isValid = await verifyPassword("WrongPassword123", hash);
            expect(isValid).toBe(false);
        });

        it("should return false for malformed hash (no colon)", async () => {
            const isValid = await verifyPassword("AnyPassword", "malformedhash");
            expect(isValid).toBe(false);
        });

        it("should return false for empty hash parts", async () => {
            const isValid = await verifyPassword("AnyPassword", ":");
            expect(isValid).toBe(false);
        });

        it("should be case-sensitive", async () => {
            const hash = await hashPassword("CaseSensitive123");
            const isValid = await verifyPassword("casesensitive123", hash);
            expect(isValid).toBe(false);
        });

        it("should handle empty password", async () => {
            const hash = await hashPassword("");
            const isValid = await verifyPassword("", hash);
            expect(isValid).toBe(true);
        });

        it("should handle unicode characters", async () => {
            const password = "Pässwörd123日本語";
            const hash = await hashPassword(password);
            const isValid = await verifyPassword(password, hash);
            expect(isValid).toBe(true);
        });

        it("should handle very long passwords", async () => {
            const password = "A".repeat(1000) + "bcdefg1";
            const hash = await hashPassword(password);
            const isValid = await verifyPassword(password, hash);
            expect(isValid).toBe(true);
        });
    });

    describe("timing-safe comparison", () => {
        /**
         * Verification should take the same time whether the password is right
         * or wrong, so that the response time does not leak the answer.
         *
         * Measured by interleaving the two cases and comparing **medians**, and
         * both of those matter. The original timed one batch of ten correct
         * verifications, then one batch of ten wrong ones, and compared the two
         * totals — so a single scheduler stall landing in either batch moved the
         * ratio by more than the threshold. It failed at 0.585 during a parallel
         * build for exactly that reason, having nothing to say about timing
         * safety when it did.
         *
         * Interleaving means a busy moment hits both samples rather than one,
         * and a median discards the outlier instead of averaging it in.
         */
        it("should take similar time for correct and incorrect passwords", async () => {
            const password = "TestPassword123";
            const hash = await hashPassword(password);

            const samples = 15;
            const correct: number[] = [];
            const incorrect: number[] = [];

            for (let i = 0; i < samples; i++) {
                // Alternate which case goes first, so a periodic stall cannot
                // settle onto one of them.
                const correctFirst = i % 2 === 0;
                for (const isCorrect of correctFirst ? [true, false] : [false, true]) {
                    const start = performance.now();
                    await verifyPassword(isCorrect ? password : "WrongPassword12", hash);
                    (isCorrect ? correct : incorrect).push(performance.now() - start);
                }
            }

            const median = (xs: number[]) => {
                const sorted = [...xs].sort((a, b) => a - b);
                const mid = sorted.length >> 1;
                return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
            };

            const correctMedian = median(correct);
            const incorrectMedian = median(incorrect);
            const ratio = Math.abs(correctMedian - incorrectMedian) / Math.max(correctMedian, incorrectMedian);

            expect(ratio).toBeLessThan(0.5);
        });
    });
});
