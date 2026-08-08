import { createCipheriv, createHash, randomBytes } from "crypto";
import { encryptTotpSecret, openTotpSecret, decryptTotpSecret } from "../src/auth/mfa-crypto";

/**
 * Changing `MFA_ENCRYPTION_KEY` used to lock every enrolled user out.
 *
 * The key was re-derived from the environment on every call and the ciphertext
 * recorded nothing about which key produced it, so pointing the variable at a
 * new value made every stored factor undecryptable. AES-GCM authenticates, so
 * the failure was not a wrong secret — it was a throw on every MFA sign-in,
 * with no way back except restoring the old value.
 *
 * These tests are the rotation, run end to end: encrypt under one key,
 * reconfigure the environment the way a real rotation does, and require that
 * the factor still opens and comes back re-wrapped under the new key.
 */

const SECRET = "JBSWY3DPEHPK3PXP";

/** A ciphertext in the pre-key-id format, written with `raw`. */
function legacyCiphertext(plaintext: string, raw: string): string {
    const key = createHash("sha256").update(raw).digest();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}

const ENV_KEYS = ["MFA_ENCRYPTION_KEY", "MFA_ENCRYPTION_KEY_PREVIOUS", "JWT_SECRET"] as const;

describe("MFA secret encryption across a key rotation", () => {
    let saved: Record<string, string | undefined>;

    beforeEach(() => {
        saved = Object.fromEntries(ENV_KEYS.map(k => [k, process.env[k]]));
        for (const k of ENV_KEYS) delete process.env[k];
    });

    afterEach(() => {
        for (const k of ENV_KEYS) {
            if (saved[k] === undefined) delete process.env[k];
            else process.env[k] = saved[k];
        }
    });

    it("round-trips under the current key and stamps the key id", () => {
        process.env.MFA_ENCRYPTION_KEY = "key-alpha";

        const ciphertext = encryptTotpSecret(SECRET);
        expect(ciphertext).toMatch(/^v1\.[0-9a-f]{8}:/);

        const opened = openTotpSecret(ciphertext);
        expect(opened.secret).toBe(SECRET);
        // Already current — nothing to re-store.
        expect(opened.rewrapped).toBeNull();
    });

    /**
     * The outage this whole change exists to prevent: a deployment that has
     * been falling back to JWT_SECRET, then sets a dedicated key for the first
     * time. Every factor on disk predates the new key.
     */
    it("opens a JWT_SECRET-era secret after MFA_ENCRYPTION_KEY is set for the first time", () => {
        process.env.JWT_SECRET = "the-jwt-secret";
        const stored = legacyCiphertext(SECRET, "the-jwt-secret");

        // The rotation: a dedicated key appears; JWT_SECRET stays configured
        // because the rest of the system still needs it.
        process.env.MFA_ENCRYPTION_KEY = "brand-new-mfa-key";

        const opened = openTotpSecret(stored);
        expect(opened.secret).toBe(SECRET);

        // ...and it comes back re-wrapped under the new key, so the factor
        // stops depending on JWT_SECRET once this is persisted.
        expect(opened.rewrapped).not.toBeNull();
        process.env.JWT_SECRET = "something-else-entirely";
        expect(decryptTotpSecret(opened.rewrapped as string)).toBe(SECRET);
    });

    it("completes a rotation from one dedicated key to another", () => {
        process.env.MFA_ENCRYPTION_KEY = "key-alpha";
        const stored = encryptTotpSecret(SECRET);

        // Step 2 of the documented sequence: old key demoted, new key current.
        process.env.MFA_ENCRYPTION_KEY = "key-beta";
        process.env.MFA_ENCRYPTION_KEY_PREVIOUS = "key-alpha";

        const opened = openTotpSecret(stored);
        expect(opened.secret).toBe(SECRET);
        expect(opened.rewrapped).not.toBeNull();

        // Step 4: once re-wrapped, the old key can be dropped entirely.
        delete process.env.MFA_ENCRYPTION_KEY_PREVIOUS;
        expect(decryptTotpSecret(opened.rewrapped as string)).toBe(SECRET);
    });

    it("reads a legacy ciphertext whose key is still current, and stamps it", () => {
        process.env.MFA_ENCRYPTION_KEY = "key-alpha";
        const stored = legacyCiphertext(SECRET, "key-alpha");

        const opened = openTotpSecret(stored);
        expect(opened.secret).toBe(SECRET);
        // Same key, but the ciphertext is unstamped — re-wrapping is what lets
        // the NEXT rotation identify it rather than trial-decrypting again.
        expect(opened.rewrapped).toMatch(/^v1\.[0-9a-f]{8}:/);
    });

    it("accepts several previous keys, so two rotations can overlap", () => {
        process.env.MFA_ENCRYPTION_KEY = "key-alpha";
        const oldest = encryptTotpSecret(SECRET);

        process.env.MFA_ENCRYPTION_KEY = "key-gamma";
        process.env.MFA_ENCRYPTION_KEY_PREVIOUS = "key-beta, key-alpha";

        expect(openTotpSecret(oldest).secret).toBe(SECRET);
    });

    /**
     * Loud, not silent. An unknown key id means a key this deployment once used
     * is no longer configured; the fix is to restore it, and nobody restores
     * what they were not told about.
     */
    it("names the missing key id when no configured key matches", () => {
        process.env.MFA_ENCRYPTION_KEY = "key-alpha";
        const stored = encryptTotpSecret(SECRET);
        const keyId = stored.split(":")[0].split(".")[1];

        process.env.MFA_ENCRYPTION_KEY = "key-beta";

        expect(() => openTotpSecret(stored)).toThrow(new RegExp(`key id "${keyId}"`));
        expect(() => openTotpSecret(stored)).toThrow(/MFA_ENCRYPTION_KEY_PREVIOUS/);
    });

    it("refuses a legacy ciphertext no configured key opens", () => {
        process.env.MFA_ENCRYPTION_KEY = "key-alpha";
        const stored = legacyCiphertext(SECRET, "a-key-nobody-configured");

        expect(() => openTotpSecret(stored)).toThrow(/any configured key/);
    });

    it("refuses to operate with no key configured at all", () => {
        expect(() => encryptTotpSecret(SECRET)).toThrow(/MFA_ENCRYPTION_KEY/);
    });

    it("rejects a malformed ciphertext", () => {
        process.env.MFA_ENCRYPTION_KEY = "key-alpha";
        expect(() => openTotpSecret("not-a-ciphertext")).toThrow(/Invalid encrypted TOTP secret format/);
        expect(() => openTotpSecret("v9.abcd1234:aa:bb:cc")).toThrow(/Unsupported encrypted TOTP secret version/);
    });

    it("does not put the plaintext secret in an error message", () => {
        process.env.MFA_ENCRYPTION_KEY = "key-alpha";
        const stored = legacyCiphertext(SECRET, "a-key-nobody-configured");

        try {
            openTotpSecret(stored);
            throw new Error("expected openTotpSecret to throw");
        } catch (e) {
            expect((e as Error).message).not.toContain(SECRET);
        }
    });
});
