/**
 * Minimal SHA-1 implementation that runs in both Node and the browser.
 *
 * This exists because generated Postgres policy names embed a SHA-1 digest of
 * the security rule. The DDL generator runs on the server (where `node:crypto`
 * is available) but the Studio has to derive the same names in the browser to
 * tell a policy it generated apart from one it did not. `node:crypto` cannot be
 * bundled for the browser, so the shared derivation needs a portable digest.
 *
 * SHA-1 is used purely to name things deterministically — never for security.
 * The output is byte-identical to `createHash("sha1").update(str).digest("hex")`,
 * which `sha1.test.ts` pins against `node:crypto` directly.
 */

/** Rotate a 32-bit word left by `n` bits. */
function rotl(value: number, n: number): number {
    return (value << n) | (value >>> (32 - n));
}

/**
 * SHA-1 digest of a string, hex-encoded.
 *
 * The input is encoded as UTF-8, matching Node's default handling of strings
 * passed to `hash.update(str)`.
 */
export function sha1Hex(input: string): string {
    const bytes: number[] = Array.from(new TextEncoder().encode(input));
    const bitLength = bytes.length * 8;

    // Padding: 0x80, then zeroes up to 56 bytes mod 64, then the length as a
    // 64-bit big-endian integer.
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);

    const hi = Math.floor(bitLength / 0x100000000);
    const lo = bitLength >>> 0;
    bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
    bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);

    let h0 = 0x67452301;
    let h1 = 0xefcdab89;
    let h2 = 0x98badcfe;
    let h3 = 0x10325476;
    let h4 = 0xc3d2e1f0;

    const w = new Array<number>(80);

    for (let offset = 0; offset < bytes.length; offset += 64) {
        for (let i = 0; i < 16; i++) {
            const j = offset + i * 4;
            w[i] = ((bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3]) | 0;
        }
        for (let i = 16; i < 80; i++) {
            w[i] = rotl(w[i - 3] ^ w[i - 8] ^ w[i - 14] ^ w[i - 16], 1);
        }

        let a = h0;
        let b = h1;
        let c = h2;
        let d = h3;
        let e = h4;

        for (let i = 0; i < 80; i++) {
            let f: number;
            let k: number;
            if (i < 20) {
                f = (b & c) | (~b & d);
                k = 0x5a827999;
            } else if (i < 40) {
                f = b ^ c ^ d;
                k = 0x6ed9eba1;
            } else if (i < 60) {
                f = (b & c) | (b & d) | (c & d);
                k = 0x8f1bbcdc;
            } else {
                f = b ^ c ^ d;
                k = 0xca62c1d6;
            }

            const temp = (rotl(a, 5) + f + e + k + w[i]) | 0;
            e = d;
            d = c;
            c = rotl(b, 30);
            b = a;
            a = temp;
        }

        h0 = (h0 + a) | 0;
        h1 = (h1 + b) | 0;
        h2 = (h2 + c) | 0;
        h3 = (h3 + d) | 0;
        h4 = (h4 + e) | 0;
    }

    return [h0, h1, h2, h3, h4]
        .map(word => (word >>> 0).toString(16).padStart(8, "0"))
        .join("");
}
