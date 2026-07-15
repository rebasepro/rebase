/**
 * Envelope encryption for TOTP secrets using AES-256-GCM.
 *
 * - Derives a 32-byte key via SHA-256 from `MFA_ENCRYPTION_KEY` or `JWT_SECRET`.
 * - Generates a random 12-byte IV per encryption call.
 * - Returns ciphertexts in the format `iv_hex:authTag_hex:ciphertext_hex`.
 *
 * @module
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { logger } from "../utils/logger";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_LENGTH = 16;

/**
 * Resolve the raw key string from environment variables.
 *
 * Prefers `MFA_ENCRYPTION_KEY`; falls back to `JWT_SECRET` with a warning.
 * Throws if neither is set.
 */
function resolveKeyString(): string {
    const explicit = process.env.MFA_ENCRYPTION_KEY;
    if (explicit) {
        return explicit;
    }

    const fallback = process.env.JWT_SECRET;
    if (fallback) {
        logger.warn(
            "[MFA-Crypto] MFA_ENCRYPTION_KEY is not set — falling back to JWT_SECRET. " +
                "Set a dedicated MFA_ENCRYPTION_KEY for production."
        );
        return fallback;
    }

    throw new Error(
        "Cannot encrypt TOTP secret: neither MFA_ENCRYPTION_KEY nor JWT_SECRET is configured."
    );
}

/**
 * Derive a deterministic 32-byte AES-256 key from the raw secret string.
 */
function deriveKey(raw: string): Buffer {
    return createHash("sha256").update(raw).digest();
}

/**
 * Encrypt a plaintext TOTP secret.
 *
 * @param plaintext - The Base32 TOTP secret to encrypt.
 * @returns A string in the format `iv_hex:authTag_hex:ciphertext_hex`.
 */
export function encryptTotpSecret(plaintext: string): string {
    const key = deriveKey(resolveKeyString());
    const iv = randomBytes(IV_BYTES);

    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt a previously encrypted TOTP secret.
 *
 * @param ciphertext - A string in the format `iv_hex:authTag_hex:ciphertext_hex`.
 * @returns The original Base32 TOTP secret.
 */
export function decryptTotpSecret(ciphertext: string): string {
    const parts = ciphertext.split(":");
    if (parts.length !== 3) {
        throw new Error("Invalid encrypted TOTP secret format — expected iv:authTag:ciphertext");
    }

    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = deriveKey(resolveKeyString());
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const encrypted = Buffer.from(encryptedHex, "hex");

    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
}
