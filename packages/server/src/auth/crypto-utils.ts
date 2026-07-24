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
    // Encode first, then size the padding by BYTE length.
    //
    // Allocating by `String.length` and writing into it truncates at the buffer
    // boundary, so any multi-byte character shortens the region actually
    // compared and the trailing bytes are never examined. With a secret
    // containing one non-ASCII character, a guess matching everything but the
    // final character compares equal — the exact failure this function exists to
    // prevent.
    const bytesA = Buffer.from(a, "utf8");
    const bytesB = Buffer.from(b, "utf8");

    const length = Math.max(bytesA.length, bytesB.length);
    const paddedA = Buffer.alloc(length);
    const paddedB = Buffer.alloc(length);
    bytesA.copy(paddedA);
    bytesB.copy(paddedB);

    try {
        // The length check is folded in after the constant-time compare so an
        // early return cannot itself leak the length.
        return timingSafeEqual(paddedA, paddedB) && bytesA.length === bytesB.length;
    } catch {
        return false;
    }
}
