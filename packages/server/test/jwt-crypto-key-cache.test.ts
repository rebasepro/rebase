/**
 * A string secret is imported once, not on every verify and sign.
 *
 * `jsonwebtoken` turns any key that is not a `KeyObject` into one on each call,
 * and for an HMAC secret it gets there by first trying the string as a PEM
 * public key (`createPublicKey`) and catching the throw. That failed parse was
 * about 15 of the 21 µs `verifyAccessToken` cost on every authenticated
 * request, and 12 of the 15 µs of each `jwt.sign` (one per download token).
 *
 * `jwt-crypto.ts` now does that same conversion once per secret value and
 * hands `jsonwebtoken` the `KeyObject`. Keyed by the secret itself, so a
 * rotated secret is a new key; only the key is remembered, never a result.
 */
import { createSecretKey, generateKeyPairSync, KeyObject } from "node:crypto";

jest.mock("jsonwebtoken", () => {
    const actual = jest.requireActual("jsonwebtoken");
    return {
        __esModule: true,
        default: { ...actual, verify: jest.fn(actual.verify), sign: jest.fn(actual.sign) }
    };
});

import jwt from "jsonwebtoken";
import { signJwt, verifyJwt } from "../src/auth/jwt-crypto";

const verify = jwt.verify as unknown as jest.Mock;
const sign = jwt.sign as unknown as jest.Mock;

const SECRET = "jwt-crypto-key-cache-secret-that-is-long-enough-0123456789";
const ROTATED = "jwt-crypto-key-cache-rotated-secret-long-enough-0123456789";

beforeEach(() => {
    verify.mockClear();
    sign.mockClear();
});

const keyPassedTo = (mock: jest.Mock, call: number): unknown => mock.mock.calls[call][1];

describe("an HMAC secret", () => {
    it("reaches jsonwebtoken as one KeyObject, reused across verifies and signs", async () => {
        const token = await signJwt({ sub: "u1" }, SECRET, { algorithm: "HS256", expiresIn: "5m" });
        await signJwt({ sub: "u2" }, SECRET, { algorithm: "HS256", expiresIn: "5m" });
        await verifyJwt(token, SECRET, { algorithms: ["HS256"] });
        await verifyJwt(token, SECRET, { algorithms: ["HS256"] });

        const signKey = keyPassedTo(sign, 0);
        const verifyKey = keyPassedTo(verify, 0);
        expect(signKey).toBeInstanceOf(KeyObject);
        expect(verifyKey).toBeInstanceOf(KeyObject);
        expect(keyPassedTo(sign, 1)).toBe(signKey);
        expect(keyPassedTo(verify, 1)).toBe(verifyKey);
        expect((verifyKey as KeyObject).equals(createSecretKey(Buffer.from(SECRET)))).toBe(true);
    });

    it("is a different key once the secret rotates, and the old tokens stop verifying", async () => {
        const old = await signJwt({ sub: "u1" }, SECRET, { algorithm: "HS256", expiresIn: "5m" });
        await verifyJwt(old, SECRET, { algorithms: ["HS256"] });

        await expect(verifyJwt(old, ROTATED, { algorithms: ["HS256"] })).rejects.toThrow("invalid signature");
        expect(keyPassedTo(verify, 1)).not.toBe(keyPassedTo(verify, 0));
        const fresh = await signJwt({ sub: "u1" }, ROTATED, { algorithm: "HS256", expiresIn: "5m" });
        expect(await verifyJwt(fresh, ROTATED, { algorithms: ["HS256"] })).toMatchObject({ sub: "u1" });
    });

    it("refuses an empty secret with jsonwebtoken's own errors, as before", async () => {
        await expect(signJwt({ sub: "u1" }, "", { algorithm: "HS256" })).rejects.toThrow("secretOrPrivateKey must have a value");
        const token = await signJwt({ sub: "u1" }, SECRET, { algorithm: "HS256" });
        await expect(verifyJwt(token, "", { algorithms: ["HS256"] })).rejects.toThrow("secret or public key must be provided");
    });
});

describe("a PEM string", () => {
    it("is still read as the asymmetric key it is", async () => {
        const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
        const privatePem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
        const publicPem = publicKey.export({ type: "spki", format: "pem" }).toString();

        const token = await signJwt({ sub: "u1" }, privatePem, { algorithm: "RS256" });

        expect(await verifyJwt(token, publicPem, { algorithms: ["RS256"] })).toMatchObject({ sub: "u1" });
        expect((keyPassedTo(verify, 0) as KeyObject).type).toBe("public");
        // An HMAC verify with the public key as "the secret" is refused, as jsonwebtoken refuses it.
        await expect(verifyJwt(token, publicPem, { algorithms: ["HS256"] })).rejects.toThrow();
    });
});
