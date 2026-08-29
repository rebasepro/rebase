/**
 * Cryptographic utility functions for auth.
 *
 * @module
 */

import { constantTimeEqual } from "../utils/portable-crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Used for comparing service keys, tokens, and other secrets where
 * timing side-channels could leak information about the expected value.
 *
 * The implementation lives in `utils/portable-crypto.ts`, which does this over
 * UTF-8 bytes without `node:crypto` — this function is on the request path, and
 * the byte-level reasoning it depends on is documented there.
 *
 * @param a - First string to compare.
 * @param b - Second string to compare.
 * @returns `true` if the strings are identical, `false` otherwise.
 */
export function safeCompare(a: string, b: string): boolean {
    return constantTimeEqual(a, b);
}
