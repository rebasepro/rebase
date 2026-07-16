import { createHash } from "crypto";
import { sha1Hex } from "../src/sha1";

/** The reference the browser implementation has to agree with byte-for-byte. */
function nodeSha1(input: string): string {
    return createHash("sha1").update(input).digest("hex");
}

describe("sha1Hex", () => {
    it("matches the published SHA-1 test vectors", () => {
        expect(sha1Hex("")).toBe("da39a3ee5e6b4b0d3255bfef95601890afd80709");
        expect(sha1Hex("abc")).toBe("a9993e364706816aba3e25717850c26c9cd0d89d");
        expect(sha1Hex("The quick brown fox jumps over the lazy dog"))
            .toBe("2fd4e1c67a2d28fced849ee1bb76e7391b93eb12");
    });

    it("agrees with node:crypto across message-length boundaries", () => {
        // 55/56/57 and 63/64/65 straddle the padding and block boundaries,
        // where a hand-rolled implementation is most likely to be wrong.
        for (const length of [0, 1, 54, 55, 56, 57, 63, 64, 65, 119, 120, 128, 1000]) {
            const input = "a".repeat(length);
            expect(sha1Hex(input)).toBe(nodeSha1(input));
        }
    });

    it("agrees with node:crypto for multi-byte UTF-8 input", () => {
        for (const input of ["ünïcödé", "日本語のテキスト", "emoji 🎉🎊", "mixed ascii + ñ + 漢字"]) {
            expect(sha1Hex(input)).toBe(nodeSha1(input));
        }
    });

    it("agrees with node:crypto for the JSON payloads used to name policies", () => {
        const samples = [
            JSON.stringify({ a: undefined, m: "permissive", op: "select", u: "true" }),
            JSON.stringify({ op: "insert", rol: ["admin"], w: "auth.uid() IS NOT NULL" }),
            JSON.stringify({ ops: ["insert", "update", "delete"], rol: ["admin"], u: "x" })
        ];
        for (const sample of samples) {
            expect(sha1Hex(sample)).toBe(nodeSha1(sample));
        }
    });

    it("agrees with node:crypto on random inputs", () => {
        for (let i = 0; i < 200; i++) {
            const length = Math.floor(Math.random() * 200);
            let input = "";
            for (let j = 0; j < length; j++) {
                input += String.fromCharCode(Math.floor(Math.random() * 0x2fff));
            }
            expect(sha1Hex(input)).toBe(nodeSha1(input));
        }
    });
});
