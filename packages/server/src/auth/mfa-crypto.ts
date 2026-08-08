/**
 * Envelope encryption for TOTP secrets using AES-256-GCM.
 *
 * - Derives a 32-byte key via SHA-256 from `MFA_ENCRYPTION_KEY` or `JWT_SECRET`.
 * - Generates a random 12-byte IV per encryption call.
 * - Stamps the key that made the ciphertext, so the key can be changed without
 *   locking every enrolled user out — see "Rotating the key" below.
 *
 * ## Rotating the key
 *
 * A ciphertext used to be `iv:authTag:ciphertext` and recorded nothing about
 * which key produced it, while the key was re-derived from the environment on
 * every call. Setting `MFA_ENCRYPTION_KEY` on a deployment that had been
 * falling back to `JWT_SECRET` therefore made every stored factor undecryptable
 * — AES-GCM authenticates, so it did not return a wrong secret, it threw, and
 * every MFA sign-in failed until the variable was removed again.
 *
 * Now a ciphertext carries `v1.<keyId>`, where `keyId` is derived from the key
 * itself (no key names to keep in sync), and decryption runs against a list of
 * candidates: `MFA_ENCRYPTION_KEY`, then each comma-separated entry in
 * `MFA_ENCRYPTION_KEY_PREVIOUS`, then `JWT_SECRET`. To rotate:
 *
 * 1. **Deploy this code first.** It reads both formats. Doing it the other way
 *    round — setting the key before the readers understand the old ciphertexts
 *    — is the outage this exists to prevent.
 * 2. Move the old value into `MFA_ENCRYPTION_KEY_PREVIOUS` and set the new one
 *    as `MFA_ENCRYPTION_KEY`.
 * 3. Each factor is re-wrapped with the current key the next time its owner
 *    authenticates (`openTotpSecret` reports it via `rewrapped`).
 * 4. Once every enrolled user has signed in, drop `MFA_ENCRYPTION_KEY_PREVIOUS`.
 *    Any factor still on the old key then fails loudly, naming the key id,
 *    rather than being silently unreadable.
 *
 * Trial decryption across candidates is safe here: GCM's auth tag is a 128-bit
 * MAC, so a wrong key throws instead of yielding a plausible-looking secret.
 *
 * @module
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { logger } from "../utils/logger";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const AUTH_TAG_LENGTH = 16;

/** Ciphertext prefix marking the key-stamped format. */
const VERSION = "v1";

/** A key the process could decrypt with, and the id a ciphertext names it by. */
interface KeyCandidate {
    /** First 8 hex of `sha256(raw)` — derived, so no key registry to maintain. */
    id: string;
    key: Buffer;
    /** Where it came from, for error messages. */
    source: string;
}

/** Warn once, not once per sign-in. */
let warnedAboutFallback = false;

function toCandidate(raw: string, source: string): KeyCandidate {
    const digest = createHash("sha256").update(raw).digest();
    return { id: digest.toString("hex").slice(0, 8),
key: digest,
source };
}

/**
 * Every key this process can decrypt with, most-preferred first.
 *
 * The head of the list is the key new ciphertexts are written with; the rest
 * exist so that ciphertexts written before a rotation still open.
 */
function keyCandidates(): KeyCandidate[] {
    const candidates: KeyCandidate[] = [];
    const seen = new Set<string>();

    const add = (raw: string | undefined, source: string) => {
        const trimmed = raw?.trim();
        if (!trimmed || seen.has(trimmed)) return;
        seen.add(trimmed);
        candidates.push(toCandidate(trimmed, source));
    };

    add(process.env.MFA_ENCRYPTION_KEY, "MFA_ENCRYPTION_KEY");
    for (const previous of (process.env.MFA_ENCRYPTION_KEY_PREVIOUS ?? "").split(",")) {
        add(previous, "MFA_ENCRYPTION_KEY_PREVIOUS");
    }
    add(process.env.JWT_SECRET, "JWT_SECRET");

    if (candidates.length === 0) {
        throw new Error(
            "Cannot encrypt or decrypt TOTP secrets: none of MFA_ENCRYPTION_KEY, " +
                "MFA_ENCRYPTION_KEY_PREVIOUS or JWT_SECRET is configured."
        );
    }

    if (!process.env.MFA_ENCRYPTION_KEY && !warnedAboutFallback) {
        warnedAboutFallback = true;
        logger.warn(
            "[MFA-Crypto] MFA_ENCRYPTION_KEY is not set — falling back to JWT_SECRET. " +
                "Set a dedicated MFA_ENCRYPTION_KEY for production; see the rotation " +
                "steps in mfa-crypto.ts before you do it on a live deployment."
        );
    }

    return candidates;
}

/** The key new ciphertexts are written with. */
function currentKey(): KeyCandidate {
    return keyCandidates()[0];
}

/**
 * Encrypt a plaintext TOTP secret.
 *
 * @param plaintext - The Base32 TOTP secret to encrypt.
 * @returns A string in the format `v1.<keyId>:iv_hex:authTag_hex:ciphertext_hex`.
 */
export function encryptTotpSecret(plaintext: string): string {
    const { id, key } = currentKey();
    const iv = randomBytes(IV_BYTES);

    const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
    const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return `${VERSION}.${id}:${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function openWith(candidate: KeyCandidate, ivHex: string, authTagHex: string, encryptedHex: string): string {
    const decipher = createDecipheriv(ALGORITHM, candidate.key, Buffer.from(ivHex, "hex"), {
        authTagLength: AUTH_TAG_LENGTH
    });
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    return Buffer.concat([decipher.update(Buffer.from(encryptedHex, "hex")), decipher.final()]).toString("utf8");
}

/** What a factor's stored secret opened to, and whether it should be re-stored. */
export interface OpenedTotpSecret {
    /** The Base32 TOTP secret. */
    secret: string;
    /**
     * Set when the secret opened with something other than the current key —
     * the same secret, re-encrypted under it. Persist this and the factor
     * stops depending on the old key. `null` when it is already current.
     */
    rewrapped: string | null;
}

/**
 * Decrypt a stored TOTP secret, reporting whether it wants re-wrapping.
 *
 * Accepts both the key-stamped format and the original unstamped
 * `iv:authTag:ciphertext`, which is tried against each candidate in turn.
 */
export function openTotpSecret(ciphertext: string): OpenedTotpSecret {
    const parts = ciphertext.split(":");
    const candidates = keyCandidates();
    const current = candidates[0];

    if (parts.length === 4) {
        const [stamp, ivHex, authTagHex, encryptedHex] = parts;
        const [version, keyId] = stamp.split(".");
        if (version !== VERSION || !keyId) {
            throw new Error(`Unsupported encrypted TOTP secret version "${stamp}"`);
        }

        const named = candidates.find(c => c.id === keyId);
        if (!named) {
            // Loud on purpose. An unknown key id means a key this deployment
            // once used is no longer configured — recoverable by restoring it
            // to MFA_ENCRYPTION_KEY_PREVIOUS, but only if someone is told.
            throw new Error(
                `No configured key matches this TOTP secret (key id "${keyId}"). ` +
                    "Restore the key that encrypted it via MFA_ENCRYPTION_KEY_PREVIOUS. " +
                    `Configured key ids: ${candidates.map(c => `${c.id} (${c.source})`).join(", ")}.`
            );
        }

        const secret = openWith(named, ivHex, authTagHex, encryptedHex);
        return { secret,
rewrapped: named.id === current.id ? null : encryptTotpSecret(secret) };
    }

    if (parts.length !== 3) {
        throw new Error(
            "Invalid encrypted TOTP secret format — expected v1.<keyId>:iv:authTag:ciphertext " +
                "or the legacy iv:authTag:ciphertext"
        );
    }

    // Unstamped, from before key ids existed: it was written with whatever the
    // environment resolved to at the time, which we can only discover by trying.
    const [ivHex, authTagHex, encryptedHex] = parts;
    for (const candidate of candidates) {
        try {
            const secret = openWith(candidate, ivHex, authTagHex, encryptedHex);
            // Always re-wrapped: even when the key is unchanged, stamping it
            // is what lets the next rotation identify this ciphertext.
            return { secret,
rewrapped: encryptTotpSecret(secret) };
        } catch {
            // Wrong key — GCM refused to authenticate. Try the next one.
        }
    }

    throw new Error(
        "Could not decrypt TOTP secret with any configured key. Tried: " +
            `${candidates.map(c => c.source).join(", ")}.`
    );
}

/**
 * Decrypt a previously encrypted TOTP secret.
 *
 * Prefer {@link openTotpSecret} on any path that can persist the result —
 * this wrapper discards the re-wrapped form, so a factor read through it stays
 * on whichever key it was written with.
 *
 * @param ciphertext - A stored TOTP secret, in either format.
 * @returns The original Base32 TOTP secret.
 */
export function decryptTotpSecret(ciphertext: string): string {
    return openTotpSecret(ciphertext).secret;
}
