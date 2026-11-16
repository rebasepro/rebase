/**
 * The two pieces of cryptography Web Push needs, on `node:crypto` alone:
 *
 *  - **VAPID** (RFC 8292): a short-lived ES256 JWT that tells the push service
 *    which application server is sending, so a subscription made with this
 *    server's public key only accepts messages signed by its private key.
 *  - **Message encryption** (RFC 8291, `aes128gcm` from RFC 8188): the payload
 *    is encrypted to the browser's own key, so the push service carries it
 *    without being able to read it.
 *
 * Both are small and fully specified, and RFC 8291 Appendix A gives a complete
 * worked example, which `web-push-crypto.test.ts` reproduces byte for byte.
 */
import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";

/** A VAPID key pair, both halves base64url as `web-push generate-vapid-keys` prints them. */
export interface VapidKeys {
    /** The uncompressed P-256 point, 65 bytes. Browsers subscribe with it. */
    publicKey: string;
    /** The private scalar, 32 bytes. */
    privateKey: string;
}

/** The record size every message is written with: one record, the RFC's own value. */
const RECORD_SIZE = 4096;
/** salt (16) + rs (4) + idlen (1) + the sender's public key (65). */
const HEADER_LENGTH = 86;
/** The AES-GCM tag. */
const TAG_LENGTH = 16;
/**
 * The largest plaintext one record can carry: the record size less the header,
 * the tag and the one-byte delimiter. Push services refuse bodies over 4096
 * bytes, so this is also the practical limit.
 */
export const MAX_PAYLOAD_BYTES = RECORD_SIZE - HEADER_LENGTH - TAG_LENGTH - 1;

export function toBase64Url(bytes: Uint8Array): string {
    return Buffer.from(bytes).toString("base64url");
}

/** Decode base64url, tolerating standard base64 and `=` padding, as browsers and libraries vary. */
export function fromBase64Url(text: string): Buffer {
    return Buffer.from(text.replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_"), "base64url");
}

/** A new VAPID key pair. */
export function generateVapidKeys(): VapidKeys {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return {
        publicKey: toBase64Url(ecdh.getPublicKey()),
        privateKey: toBase64Url(leftPad(ecdh.getPrivateKey(), 32))
    };
}

/**
 * Whether a key pair is well formed and its halves belong together. Checked at
 * boot, because a mismatched pair is accepted by every push service at
 * subscribe time and refused at every send.
 */
export function validateVapidKeys(keys: VapidKeys): string | null {
    const publicKey = fromBase64Url(keys.publicKey);
    const privateKey = fromBase64Url(keys.privateKey);
    if (publicKey.length !== 65 || publicKey[0] !== 0x04) {
        return "the public key is not an uncompressed P-256 point (65 bytes, base64url)";
    }
    if (privateKey.length !== 32) return "the private key is not 32 bytes (base64url)";
    try {
        const ecdh = createECDH("prime256v1");
        ecdh.setPrivateKey(privateKey);
        if (!ecdh.getPublicKey().equals(publicKey)) return "the public key does not belong to the private key";
    } catch {
        return "the private key is not a valid P-256 key";
    }
    return null;
}

function leftPad(bytes: Buffer, length: number): Buffer {
    return bytes.length >= length ? bytes : Buffer.concat([Buffer.alloc(length - bytes.length), bytes]);
}

function signingKey(keys: VapidKeys): KeyObject {
    const publicKey = fromBase64Url(keys.publicKey);
    return createPrivateKey({
        key: {
            kty: "EC",
            crv: "P-256",
            d: toBase64Url(fromBase64Url(keys.privateKey)),
            x: toBase64Url(publicKey.subarray(1, 33)),
            y: toBase64Url(publicKey.subarray(33, 65))
        },
        format: "jwk"
    });
}

/**
 * The `Authorization` header for one push service: `vapid t=<jwt>, k=<key>`.
 *
 * `aud` is the push service's origin and `exp` is at most 24 hours ahead (the
 * RFC's ceiling); twelve leaves room for clock skew.
 */
export function vapidAuthorization(endpoint: string, keys: VapidKeys, subject: string, now: Date = new Date()): string {
    const header = toBase64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
    const claims = toBase64Url(Buffer.from(JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now.getTime() / 1000) + 12 * 60 * 60,
        sub: subject
    })));
    const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: signingKey(keys), dsaEncoding: "ieee-p1363" });
    return `vapid t=${header}.${claims}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

function hmac(key: Buffer, data: Buffer): Buffer {
    return createHmac("sha256", key).update(data).digest();
}

/** Fixed inputs, for reproducing the RFC's example. Never set in production. */
export interface EncryptionFixture {
    salt: Buffer;
    /** The sender's ephemeral private key. */
    senderPrivateKey: Buffer;
}

/**
 * Encrypt `plaintext` to one browser: the `aes128gcm` body, header included.
 *
 * Throws when the plaintext does not fit in one record — the caller's payload
 * is too big for Web Push and nothing can deliver it.
 */
export function encryptPayload(plaintext: Buffer, p256dh: string, auth: string, fixture?: EncryptionFixture): Buffer {
    if (plaintext.length > MAX_PAYLOAD_BYTES) {
        throw new Error(`push: the payload is ${plaintext.length} bytes; Web Push carries at most ${MAX_PAYLOAD_BYTES}.`);
    }
    const receiverPublicKey = fromBase64Url(p256dh);
    const authSecret = fromBase64Url(auth);

    const sender = createECDH("prime256v1");
    if (fixture) sender.setPrivateKey(fixture.senderPrivateKey);
    else sender.generateKeys();
    const senderPublicKey = sender.getPublicKey();
    const salt = fixture?.salt ?? randomBytes(16);

    const ecdhSecret = sender.computeSecret(receiverPublicKey);
    // HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
    const prkKey = hmac(authSecret, ecdhSecret);
    const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), receiverPublicKey, senderPublicKey]);
    const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
    // HKDF(salt, IKM, …) for the content key and the nonce
    const prk = hmac(salt, ikm);
    const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
    const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

    // One record, so it is the last one: the delimiter is 0x02 and no padding follows.
    const cipher = createCipheriv("aes-128-gcm", cek, nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);

    const header = Buffer.alloc(HEADER_LENGTH);
    salt.copy(header, 0);
    header.writeUInt32BE(RECORD_SIZE, 16);
    header.writeUInt8(senderPublicKey.length, 20);
    senderPublicKey.copy(header, 21);
    return Buffer.concat([header, ciphertext]);
}
