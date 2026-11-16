import { describe, expect, it } from "@jest/globals";
import { createPublicKey, verify } from "node:crypto";
import { decryptAsBrowser, RFC } from "../../test/helpers/web-push-browser";
import {
    encryptPayload,
    fromBase64Url,
    generateVapidKeys,
    MAX_PAYLOAD_BYTES,
    toBase64Url,
    validateVapidKeys,
    vapidAuthorization
} from "./web-push-crypto";

describe("encryptPayload", () => {
    it("reproduces RFC 8291's worked example byte for byte", () => {
        const body = encryptPayload(fromBase64Url(RFC.plaintext), RFC.receiverPublic, RFC.auth, {
            salt: fromBase64Url(RFC.salt),
            senderPrivateKey: fromBase64Url(RFC.senderPrivate)
        });
        expect(body.equals(Buffer.concat([fromBase64Url(RFC.header), fromBase64Url(RFC.ciphertext)]))).toBe(true);
    });

    it("writes a message only the browser it was encrypted to can read, with a fresh key and salt each time", () => {
        const plaintext = Buffer.from(JSON.stringify({ title: "Te toca", body: "¡Juega!" }));
        const first = encryptPayload(plaintext, RFC.receiverPublic, RFC.auth);
        const second = encryptPayload(plaintext, RFC.receiverPublic, RFC.auth);
        expect(first.equals(second)).toBe(false);
        expect(decryptAsBrowser(first, fromBase64Url(RFC.receiverPrivate), fromBase64Url(RFC.auth)).equals(plaintext)).toBe(true);
        expect(() => decryptAsBrowser(first, fromBase64Url(RFC.receiverPrivate), Buffer.alloc(16))).toThrow();
    });

    it("refuses a payload that does not fit in one record", () => {
        expect(() => encryptPayload(Buffer.alloc(MAX_PAYLOAD_BYTES + 1), RFC.receiverPublic, RFC.auth)).toThrow(/at most 3993/);
        expect(() => encryptPayload(Buffer.alloc(MAX_PAYLOAD_BYTES), RFC.receiverPublic, RFC.auth)).not.toThrow();
    });
});

describe("VAPID", () => {
    it("generates pairs whose halves belong together", () => {
        const keys = generateVapidKeys();
        expect(fromBase64Url(keys.publicKey)).toHaveLength(65);
        expect(fromBase64Url(keys.privateKey)).toHaveLength(32);
        expect(validateVapidKeys(keys)).toBeNull();
        expect(validateVapidKeys({ publicKey: generateVapidKeys().publicKey, privateKey: keys.privateKey })).toMatch(/does not belong/);
        expect(validateVapidKeys({ publicKey: "abc", privateKey: keys.privateKey })).toMatch(/uncompressed P-256/);
    });

    it("signs an ES256 token for the push service's origin, verifiable with the public key", () => {
        const keys = generateVapidKeys();
        const now = new Date("2026-11-16T12:00:00Z");
        const header = vapidAuthorization("https://fcm.googleapis.com/fcm/send/abc", keys, "mailto:ops@example.com", now);
        const match = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(header);
        expect(match).not.toBeNull();
        const [, h, c, s, k] = match!;
        expect(k).toBe(keys.publicKey);
        expect(JSON.parse(fromBase64Url(h).toString())).toEqual({ typ: "JWT", alg: "ES256" });
        expect(JSON.parse(fromBase64Url(c).toString())).toEqual({
            aud: "https://fcm.googleapis.com",
            exp: Math.floor(now.getTime() / 1000) + 12 * 3600,
            sub: "mailto:ops@example.com"
        });
        const point = fromBase64Url(keys.publicKey);
        const publicKey = createPublicKey({
            key: { kty: "EC", crv: "P-256", x: toBase64Url(point.subarray(1, 33)), y: toBase64Url(point.subarray(33)) },
            format: "jwk"
        });
        expect(verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, fromBase64Url(s))).toBe(true);
    });
});

