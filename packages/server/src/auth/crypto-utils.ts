/**
 * Cryptographic utility functions for auth.
 *
 * @module
 */

import { timingSafeEqual } from "crypto";

/**
 * Constant-time string comparison to prevent timing attacks.
 *
 * Used for comparing service keys, tokens, and other secrets where
 * timing side-channels could leak information about the expected value.
 *
 * @param a - First string to compare.
 * @param b - Second string to compare.
 * @returns `true` if the strings are identical, `false` otherwise.
 */
export function safeCompare(a: string, b: string): boolean {
    const maxLen = Math.max(a.length, b.length);
    const bufA = Buffer.alloc(maxLen);
    const bufB = Buffer.alloc(maxLen);
    bufA.write(a);
    bufB.write(b);
    try {
        const isEqual = timingSafeEqual(bufA, bufB);
        return isEqual && a.length === b.length;
    } catch {
        return false;
    }
}
