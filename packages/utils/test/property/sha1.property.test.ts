/**
 * `sha1Hex` against `node:crypto`, for arbitrary input.
 *
 * The example suite pins the published vectors and the lengths that straddle
 * SHA-1's padding and block boundaries — the places a hand-rolled digest is
 * most likely to be wrong. What it cannot pin is the *encoder*: the digest is
 * of UTF-8 bytes, and the interesting disagreements are about which bytes a
 * given JavaScript string produces.
 *
 * That matters more here than a portable-digest exercise usually would, because
 * the two implementations run in different places on purpose. The DDL generator
 * hashes a rule on the server; the Studio hashes the same rule in the browser to
 * decide whether a policy is one it generated. If they ever disagree about a
 * string, the Studio offers to import the framework's own policies back into
 * the codebase they came from.
 */

import { createHash } from "crypto";
import fc from "fast-check";
import { sha1Hex } from "../../src/sha1";

const RUNS = Number(process.env.FC_RUNS ?? 3000);

const nodeSha1 = (input: string): string => createHash("sha1").update(input).digest("hex");

describe("sha1Hex vs node:crypto", () => {

    it("agrees on arbitrary unicode strings", () => {
        fc.assert(fc.property(fc.string({ maxLength: 300, unit: "grapheme" }), input => {
            expect(sha1Hex(input)).toBe(nodeSha1(input));
        }), { numRuns: RUNS });
    });

    it("agrees on arbitrary binary-ish strings", () => {
        fc.assert(fc.property(fc.string({ maxLength: 300, unit: "binary" }), input => {
            expect(sha1Hex(input)).toBe(nodeSha1(input));
        }), { numRuns: RUNS });
    });

    /**
     * Every length from 0 to 200, which covers each block boundary and each
     * padding case exhaustively rather than at the handful of lengths a fixture
     * lists. Cheap enough that sampling them would be the odd choice.
     */
    it("agrees at every message length through three blocks", () => {
        for (let n = 0; n <= 200; n++) {
            const input = "a".repeat(n);
            expect({ n, digest: sha1Hex(input) }).toEqual({ n, digest: nodeSha1(input) });
        }
    });

    /**
     * The encoder's hard case: a lone surrogate is a valid JavaScript string
     * but not valid UTF-16, so it has no legal UTF-8 encoding. Node substitutes
     * U+FFFD; a hand-rolled encoder that reads `charCodeAt` and branches on
     * ranges usually emits the surrogate's code point directly, and the two
     * digests part ways.
     *
     * Reachable, if unlikely: a rule's `using:` string comes from a project's
     * source file, and a truncated emoji is the ordinary way a lone surrogate
     * appears in real text.
     */
    it("agrees on lone surrogates", () => {
        const loneSurrogate = fc.oneof(
            fc.integer({ min: 0xd800, max: 0xdbff }), // high, unpaired
            fc.integer({ min: 0xdc00, max: 0xdfff })  // low, unpaired
        ).map(code => String.fromCharCode(code));

        fc.assert(fc.property(
            fc.array(fc.oneof(loneSurrogate, fc.stringMatching(/^[a-z]{0,3}$/)), { maxLength: 8 }),
            parts => {
                const input = parts.join("");
                expect(sha1Hex(input)).toBe(nodeSha1(input));
            }
        ), { numRuns: RUNS });
    });

    it("agrees on the exact strings the policy hasher feeds it", () => {
        // `getPolicyNameHash` hashes `JSON.stringify` of a rule, so the real
        // input alphabet is JSON: quotes, braces, backslashes, nulls.
        const jsonish = fc.json({ maxDepth: 3 });
        fc.assert(fc.property(jsonish, input => {
            expect(sha1Hex(input)).toBe(nodeSha1(input));
        }), { numRuns: RUNS });
    });

    it("is deterministic and fixed-width", () => {
        fc.assert(fc.property(fc.string({ maxLength: 200 }), input => {
            const once = sha1Hex(input);
            expect(once).toMatch(/^[0-9a-f]{40}$/);
            expect(sha1Hex(input)).toBe(once);
        }), { numRuns: RUNS });
    });
});
