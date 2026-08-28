/**
 * The cryptography the request path needs, on primitives every runtime has.
 *
 * `node:crypto` is the obvious way to hash a string in a Node process and it is
 * the right one for anything that only ever runs during boot, a migration or a
 * CLI command. On the *request* path it is the difference between code that
 * could one day serve a request from somewhere other than a Node process and
 * code that could not — see `contracts/portable-core.txt` and the gate that
 * renders it.
 *
 * The trade is that WebCrypto's digest is **async** where `createHash` is
 * synchronous. That is the whole cost of this file, it is paid at the call
 * sites rather than here, and it is paid deliberately now: a sync-to-async
 * change ripples through every caller, and doing it while the callers are few
 * and the tests are green is enormously cheaper than doing it as one line item
 * inside a runtime port.
 *
 * Not everything moves. Signing and key parsing (`auth/jwt-keys.ts`) still need
 * `node:crypto`, because the portable replacement is a JWT library this package
 * does not depend on yet. Those stay recorded in the contract file rather than
 * hidden behind a wrapper that would imply they had moved.
 *
 * @module
 */

const encoder = new TextEncoder();

/**
 * SHA-256 of a string, lowercase hex — `createHash("sha256").digest("hex")`.
 *
 * Async because `crypto.subtle` is. Every current caller was already inside an
 * `async` function awaiting a database round trip, so the cost at the call site
 * is one keyword.
 */
export async function sha256Hex(input: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(input));
    return hex(new Uint8Array(digest));
}

/**
 * Constant-time string comparison, for secrets.
 *
 * Replaces `timingSafeEqual` over two padded Buffers. It stays synchronous —
 * WebCrypto is not involved, and there was never a reason for this one to be
 * async.
 *
 * The comparison is over UTF-8 **bytes**, never `String.length`: sizing a
 * buffer by code units truncates on any multi-byte character, so the trailing
 * bytes go unexamined and a guess matching everything but the final character
 * of a secret containing one non-ASCII character compares equal. That is the
 * exact failure this function exists to prevent, and it is why the encoding
 * happens first.
 *
 * The length difference is folded into the same accumulator as the content
 * rather than checked separately, so there is no second comparison to short-
 * circuit. What remains observable is the *longer* of the two lengths, which is
 * a property of the input the caller already sent.
 */
export function constantTimeEqual(a: string, b: string): boolean {
    const bytesA = encoder.encode(a);
    const bytesB = encoder.encode(b);

    let difference = bytesA.length ^ bytesB.length;
    const length = Math.max(bytesA.length, bytesB.length);
    for (let index = 0; index < length; index++) {
        difference |= (bytesA[index] ?? 0) ^ (bytesB[index] ?? 0);
    }

    return difference === 0;
}

/**
 * `bytes` cryptographically random bytes as lowercase hex —
 * `randomBytes(n).toString("hex")`.
 */
export function randomHex(bytes: number): string {
    return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

/**
 * A uniform integer in `[0, maxExclusive)` — `randomInt`, without `node:crypto`.
 *
 * Rejection sampling, not `% maxExclusive`: the modulo of a uniform 32-bit
 * draw is biased towards the low values whenever the range does not divide
 * 2^32, and these draws are one-time passcodes. The loop retries with
 * probability under 1/2 per iteration for any range, so it terminates.
 */
export function randomInt(maxExclusive: number): number {
    if (!Number.isInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 2 ** 32) {
        throw new RangeError(`randomInt needs an integer bound in (0, 2^32]; got ${maxExclusive}`);
    }

    const limit = Math.floor(2 ** 32 / maxExclusive) * maxExclusive;
    const draw = new Uint32Array(1);
    for (;;) {
        crypto.getRandomValues(draw);
        if (draw[0] < limit) return draw[0] % maxExclusive;
    }
}

function hex(bytes: Uint8Array): string {
    let out = "";
    for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
    return out;
}
