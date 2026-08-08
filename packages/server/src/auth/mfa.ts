/**
 * TOTP (Time-based One-Time Password) implementation.
 *
 * Pure Node.js crypto implementation — no external dependencies required.
 * Implements RFC 6238 (TOTP) and RFC 4226 (HOTP).
 */

import { createHmac, randomBytes, createHash } from "crypto";

// ─── Base32 Encoding/Decoding ────────────────────────────────────────────────

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Encode a Buffer to Base32 string (RFC 4648)
 */
export function base32Encode(buffer: Buffer): string {
    let bits = 0;
    let value = 0;
    let output = "";

    for (let i = 0; i < buffer.length; i++) {
        value = (value << 8) | buffer[i];
        bits += 8;

        while (bits >= 5) {
            output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
            bits -= 5;
        }
    }

    if (bits > 0) {
        output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
    }

    return output;
}

/**
 * Decode a Base32 string to Buffer
 */
export function base32Decode(encoded: string): Buffer {
    const cleanInput = encoded.replace(/=+$/, "").toUpperCase();
    const bytes: number[] = [];
    let bits = 0;
    let value = 0;

    for (let i = 0; i < cleanInput.length; i++) {
        const index = BASE32_ALPHABET.indexOf(cleanInput[i]);
        if (index === -1) continue;

        value = (value << 5) | index;
        bits += 5;

        if (bits >= 8) {
            bytes.push((value >>> (bits - 8)) & 255);
            bits -= 8;
        }
    }

    return Buffer.from(bytes);
}

// ─── HOTP/TOTP ───────────────────────────────────────────────────────────────

/**
 * Generate an HOTP value per RFC 4226
 */
function generateHotp(secret: Buffer, counter: bigint): string {
    const hmac = createHmac("sha1", secret);
    const counterBuffer = Buffer.alloc(8);
    counterBuffer.writeBigInt64BE(counter);
    hmac.update(counterBuffer);
    const hash = hmac.digest();

    const offset = hash[hash.length - 1] & 0x0f;
    const code =
        (((hash[offset] & 0x7f) << 24) |
            (hash[offset + 1] << 16) |
            (hash[offset + 2] << 8) |
            hash[offset + 3]) %
        1000000;

    return code.toString().padStart(6, "0");
}

/**
 * Generate a TOTP value for the current time step
 */
export function generateTotp(secret: Buffer, timeStep = 30): string {
    const counter = BigInt(Math.floor(Date.now() / 1000 / timeStep));
    return generateHotp(secret, counter);
}

/**
 * Verify a TOTP token with a configurable time window
 *
 * @param secret - The shared secret as a Buffer
 * @param token - The 6-digit TOTP code to verify
 * @param window - Number of time steps to check on each side (default: 1)
 * @returns true if the token is valid within the window
 */
export function verifyTotp(secret: Buffer, token: string, window = 1): boolean {
    return verifyTotpCounter(secret, token, window) !== null;
}

/**
 * Verify a TOTP token and report *which* time step matched.
 *
 * RFC 6238 §5.2 requires that an accepted OTP not be accepted a second time,
 * and a boolean cannot express what was accepted: with `window = 1` the same
 * six digits stay valid for up to 90 seconds, so a code observed once — by a
 * phishing relay, over a shoulder, in a pasted support message — can be
 * presented again for the rest of that window. The caller records the returned
 * counter against the factor and refuses anything at or below it.
 *
 * @param secret - The shared secret as a Buffer
 * @param token - The 6-digit TOTP code to verify
 * @param window - Number of time steps to check on each side (default: 1)
 * @returns The matched time step, or `null` when no step in the window matches
 */
export function verifyTotpCounter(secret: Buffer, token: string, window = 1): number | null {
    const timeStep = 30;
    const counter = BigInt(Math.floor(Date.now() / 1000 / timeStep));
    for (let i = -window; i <= window; i++) {
        const step = counter + BigInt(i);
        if (generateHotp(secret, step) === token) {
            return Number(step);
        }
    }
    return null;
}

// ─── Secret Generation ───────────────────────────────────────────────────────

/**
 * Generate a new TOTP secret and return the setup information
 *
 * @param issuer - The issuer name (app name) for the QR code
 * @param accountName - The account identifier (usually email)
 * @returns Object with base32 secret and otpauth URI
 */
export function generateTotpSecret(issuer: string, accountName: string): {
    secret: string;
    uri: string;
} {
    // Generate a 20-byte random secret (160 bits, recommended by RFC 4226)
    const secretBuffer = randomBytes(20);
    const secret = base32Encode(secretBuffer);

    // Build otpauth:// URI for QR code generation
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccount = encodeURIComponent(accountName);
    const uri = `otpauth://totp/${encodedIssuer}:${encodedAccount}?secret=${secret}&issuer=${encodedIssuer}&algorithm=SHA1&digits=6&period=30`;

    return { secret,
uri };
}

// ─── Recovery Codes ──────────────────────────────────────────────────────────

/**
 * Generate a set of one-time recovery codes
 *
 * @param count - Number of recovery codes to generate (default: 10)
 * @returns Array of formatted recovery code strings (e.g. "A1B2C-D3E4F")
 */
export function generateRecoveryCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
        const raw = randomBytes(5).toString("hex").toUpperCase();
        const parts = raw.match(/.{1,5}/g);
        return parts ? parts.join("-") : raw;
    });
}

/**
 * Hash a recovery code for storage
 */
export function hashRecoveryCode(code: string): string {
    return createHash("sha256").update(code.replace(/-/g, "").toUpperCase()).digest("hex");
}
