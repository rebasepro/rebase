import {
    base32Encode,
    base32Decode,
    generateTotp,
    verifyTotp,
    verifyTotpCounter,
    generateTotpSecret,
    generateRecoveryCodes,
    hashRecoveryCode
} from "../src/auth/mfa";

describe("base32Encode / base32Decode", () => {
    it("round-trips a known buffer", () => {
        const original = Buffer.from("Hello, World!");
        const encoded = base32Encode(original);
        const decoded = base32Decode(encoded);
        expect(decoded.toString()).toBe("Hello, World!");
    });

    it("encodes known test vectors (RFC 4648)", () => {
        // RFC 4648 test vectors
        expect(base32Encode(Buffer.from(""))).toBe("");
        expect(base32Encode(Buffer.from("f"))).toBe("MY");
        expect(base32Encode(Buffer.from("fo"))).toBe("MZXQ");
        expect(base32Encode(Buffer.from("foo"))).toBe("MZXW6");
        expect(base32Encode(Buffer.from("foob"))).toBe("MZXW6YQ");
        expect(base32Encode(Buffer.from("fooba"))).toBe("MZXW6YTB");
        expect(base32Encode(Buffer.from("foobar"))).toBe("MZXW6YTBOI");
    });

    it("decodes base32 with trailing padding characters", () => {
        const decoded = base32Decode("MZXW6===");
        expect(decoded.toString()).toBe("foo");
    });

    it("is case-insensitive when decoding", () => {
        const upper = base32Decode("MZXW6YTBOI");
        const lower = base32Decode("mzxw6ytboi");
        expect(upper.equals(lower)).toBe(true);
    });

    it("handles single byte", () => {
        const buf = Buffer.from([0xff]);
        const encoded = base32Encode(buf);
        const decoded = base32Decode(encoded);
        expect(decoded[0]).toBe(0xff);
    });

    it("round-trips random 20-byte secret", () => {
        const original = Buffer.from("abcdefghij1234567890");
        const encoded = base32Encode(original);
        const decoded = base32Decode(encoded);
        expect(decoded.toString()).toBe(original.toString());
    });
});

describe("generateTotp", () => {
    it("returns a 6-digit string", () => {
        const secret = Buffer.from("12345678901234567890");
        const code = generateTotp(secret);
        expect(code).toMatch(/^\d{6}$/);
    });

    it("returns consistent results for the same time step", () => {
        const secret = Buffer.from("test-secret-1234567");
        const code1 = generateTotp(secret);
        const code2 = generateTotp(secret);
        expect(code1).toBe(code2);
    });

    it("pads short codes with leading zeros", () => {
        // A TOTP is the HOTP value modulo 10^6, so about one step in a hundred
        // lands below 100000 — and the authenticator app still shows six digits.
        // `length === 6` could not tell padding apart from any other code, so this
        // pins a step whose value is genuinely short: counter 36 (t = 1_080_000ms)
        // hashes to 3784 for the RFC 4226 test secret, and must render as 003784.
        jest.useFakeTimers().setSystemTime(1_080_000);
        try {
            const secret = Buffer.from("12345678901234567890");
            expect(generateTotp(secret)).toBe("003784");
        } finally {
            jest.useRealTimers();
        }
    });
});

describe("verifyTotp", () => {
    it("verifies a freshly generated token", () => {
        const secret = Buffer.from("12345678901234567890");
        const token = generateTotp(secret);
        expect(verifyTotp(secret, token)).toBe(true);
    });

    it("rejects an incorrect token", () => {
        const secret = Buffer.from("12345678901234567890");
        expect(verifyTotp(secret, "000000")).toBe(false);
    });

    it("rejects token from different secret", () => {
        const secret1 = Buffer.from("secret-one-12345678");
        const secret2 = Buffer.from("secret-two-12345678");
        const token = generateTotp(secret1);
        expect(verifyTotp(secret2, token)).toBe(false);
    });

    it("uses window parameter to check adjacent time steps", () => {
        // The window exists for the user whose phone clock drifts, or who types
        // the code as the step rolls over. Verifying only the *current* step
        // proves nothing about it: an implementation that ignored `window`
        // entirely would pass. So the token under test comes from a neighbouring
        // step, and the same token must be accepted with a window and refused
        // without one.
        const secret = Buffer.from("12345678901234567890");
        const now = 1_700_000_000_000; // floor(t/30) differs from t + 30s
        jest.useFakeTimers().setSystemTime(now);
        try {
            const current = generateTotp(secret);

            jest.setSystemTime(now + 30_000);
            const nextStep = generateTotp(secret);
            jest.setSystemTime(now - 30_000);
            const previousStep = generateTotp(secret);

            jest.setSystemTime(now);
            // If these collided the assertions below would be vacuous.
            expect(new Set([current, nextStep, previousStep]).size).toBe(3);

            expect(verifyTotp(secret, current, 0)).toBe(true);
            expect(verifyTotp(secret, nextStep, 0)).toBe(false);
            expect(verifyTotp(secret, previousStep, 0)).toBe(false);

            expect(verifyTotp(secret, nextStep, 1)).toBe(true);
            expect(verifyTotp(secret, previousStep, 1)).toBe(true);

            // …and the window is a bound, not a suggestion: two steps out is
            // outside a window of 1.
            jest.setSystemTime(now + 60_000);
            const twoStepsOut = generateTotp(secret);
            jest.setSystemTime(now);
            expect(verifyTotp(secret, twoStepsOut, 1)).toBe(false);
            expect(verifyTotp(secret, twoStepsOut, 2)).toBe(true);
        } finally {
            jest.useRealTimers();
        }
    });
});

describe("verifyTotpCounter", () => {
    it("reports which step matched, not merely that one did", () => {
        // Replay protection is built on this number: the caller records it
        // against the factor and refuses anything at or below it. An
        // implementation that always answered with the *current* step would
        // still verify every code correctly, and would silently mark a code
        // from the previous step as having spent the current one — so the
        // identity of the step is asserted, not just its presence.
        const secret = Buffer.from("12345678901234567890");
        const now = 1_700_000_000_000;
        jest.useFakeTimers().setSystemTime(now);
        try {
            const step = Math.floor(now / 1000 / 30);
            const current = generateTotp(secret);

            jest.setSystemTime(now - 30_000);
            const previous = generateTotp(secret);
            jest.setSystemTime(now);

            expect(verifyTotpCounter(secret, current)).toBe(step);
            expect(verifyTotpCounter(secret, previous)).toBe(step - 1);
            expect(verifyTotpCounter(secret, "000000")).toBeNull();
        } finally {
            jest.useRealTimers();
        }
    });
});

describe("generateTotpSecret", () => {
    it("returns a base32 secret and otpauth URI", () => {
        const result = generateTotpSecret("MyApp", "user@example.com");
        expect(result.secret).toBeTruthy();
        expect(result.uri).toBeTruthy();
    });

    it("generates a valid otpauth URI format", () => {
        const result = generateTotpSecret("MyApp", "user@example.com");
        expect(result.uri).toMatch(/^otpauth:\/\/totp\//);
        expect(result.uri).toContain("secret=");
        expect(result.uri).toContain("issuer=MyApp");
        expect(result.uri).toContain("algorithm=SHA1");
        expect(result.uri).toContain("digits=6");
        expect(result.uri).toContain("period=30");
    });

    it("encodes special characters in issuer and account", () => {
        const result = generateTotpSecret("My App & Co.", "user+test@example.com");
        expect(result.uri).toContain(encodeURIComponent("My App & Co."));
        expect(result.uri).toContain(encodeURIComponent("user+test@example.com"));
    });

    it("generates unique secrets on each call", () => {
        const result1 = generateTotpSecret("App", "user@test.com");
        const result2 = generateTotpSecret("App", "user@test.com");
        expect(result1.secret).not.toBe(result2.secret);
    });

    it("secret can be decoded back to a 20-byte buffer", () => {
        const result = generateTotpSecret("App", "user@test.com");
        const decoded = base32Decode(result.secret);
        expect(decoded.length).toBe(20);
    });
});

describe("generateRecoveryCodes", () => {
    it("generates 10 codes by default", () => {
        const codes = generateRecoveryCodes();
        expect(codes).toHaveLength(10);
    });

    it("generates the specified number of codes", () => {
        const codes = generateRecoveryCodes(5);
        expect(codes).toHaveLength(5);
    });

    it("generates codes in XXXXX-XXXXX format", () => {
        const codes = generateRecoveryCodes();
        for (const code of codes) {
            expect(code).toMatch(/^[A-F0-9]{5}-[A-F0-9]{5}$/);
        }
    });

    it("generates unique codes", () => {
        const codes = generateRecoveryCodes(20);
        const unique = new Set(codes);
        expect(unique.size).toBe(codes.length);
    });
});

describe("hashRecoveryCode", () => {
    it("returns a hex string", () => {
        const hash = hashRecoveryCode("ABC12-DEF34");
        expect(hash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("is deterministic", () => {
        const hash1 = hashRecoveryCode("ABC12-DEF34");
        const hash2 = hashRecoveryCode("ABC12-DEF34");
        expect(hash1).toBe(hash2);
    });

    it("strips dashes before hashing", () => {
        const withDashes = hashRecoveryCode("ABC12-DEF34");
        const withoutDashes = hashRecoveryCode("ABC12DEF34");
        expect(withDashes).toBe(withoutDashes);
    });

    it("normalizes to uppercase before hashing", () => {
        const upper = hashRecoveryCode("ABC12-DEF34");
        const lower = hashRecoveryCode("abc12-def34");
        expect(upper).toBe(lower);
    });

    it("different codes produce different hashes", () => {
        const hash1 = hashRecoveryCode("ABC12-DEF34");
        const hash2 = hashRecoveryCode("XYZ98-UVW76");
        expect(hash1).not.toBe(hash2);
    });
});
