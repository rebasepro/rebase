import { describe, expect, it, beforeEach } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import jwt from "jsonwebtoken";
import { Hono } from "hono";
import {
    configureJwt,
    generateAccessToken,
    verifyAccessToken,
    getJwks,
    hasAsymmetricSigningKey,
    createJwksRoutes
} from "../src/auth";
import { normalizePemFromEnv, resolveSigningKeys } from "../src/auth/jwt-keys";

/**
 * Access tokens signed with a key only this server holds, verifiable by anyone
 * holding only the public half.
 *
 * The shared secret it supplements cannot do that: handing a gateway or an edge
 * worker the means to *check* a session also hands it the means to *mint* one,
 * and rotating the secret signs every user out at once — which is why, in
 * practice, it is never rotated.
 *
 * Two properties carry the feature, and each has a way of appearing to work
 * while being wrong:
 *
 *  - **rotation is not an outage.** A token signed by the previous key keeps
 *    verifying until it expires. A verifier keyed only on the active key passes
 *    every test written the same minute the key was configured, and signs
 *    everybody out the first time a key changes.
 *  - **the token does not choose its own key.** The classic bypass is to take
 *    the public key from the JWKS we publish, HMAC a payload with it, and set
 *    `alg: HS256` so the verifier checks it against that same public key.
 *
 * A note on what the algorithm-confusion tests below actually prove.
 * `jsonwebtoken@9` refuses on its own — *"secretOrPublicKey must be a symmetric
 * key when using HS256"* — whether the key is passed as a `KeyObject` or as a
 * PEM string, and whether or not `algorithms` is pinned. Both mutations were
 * tried, and the suite stayed green through them. So those cases pin an
 * **outcome** the library currently guarantees rather than a decision this file
 * makes: they are worth keeping as the thing that fails if the library is
 * swapped, downgraded, or replaced by hand-rolled verification, and they are
 * not evidence that the pinning in `verifyAccessToken` is load-bearing. The
 * pinning stays because it costs nothing and does not depend on a library's
 * internal guard remaining in place.
 *
 * The case that *is* load-bearing is the last one: a token carrying a known
 * `kid` but signed with the symmetric secret. Nothing in the library rejects
 * it — only the decision to resolve the key by `kid` first and never fall back
 * does. That mutation does fail the suite.
 */

const SECRET = "test-secret-at-least-32-characters-long-xx";

function ecKey() {
    return generateKeyPairSync("ec", {
        namedCurve: "P-256",
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
    });
}

function rsaKey() {
    return generateKeyPairSync("rsa", {
        modulusLength: 2048,
        privateKeyEncoding: { type: "pkcs8", format: "pem" },
        publicKeyEncoding: { type: "spki", format: "pem" }
    });
}

const KEY_A = ecKey();
const KEY_B = ecKey();
const RSA = rsaKey();

describe("access tokens signed asymmetrically", () => {
    beforeEach(() => {
        configureJwt({
            secret: SECRET,
            signingKeys: [{ kid: "key-a", privateKey: KEY_A.privateKey }]
        });
    });

    it("round-trips a token through the public key", async () => {
        const token = await generateAccessToken("user-1", ["admin"]);
        const payload = await verifyAccessToken(token);

        expect(payload?.uid).toBe("user-1");
        expect(payload?.roles).toEqual(["admin"]);
    });

    it("names the signing key in the header, so a verifier knows which to fetch", async () => {
        const header = jwt.decode(await generateAccessToken("user-1", []), { complete: true })?.header;

        expect(header?.kid).toBe("key-a");
        expect(header?.alg).toBe("ES256");
    });

    it("signs RSA keys as RS256 without being told to", async () => {
        configureJwt({ secret: SECRET, signingKeys: [{ kid: "rsa", privateKey: RSA.privateKey }] });
        const header = jwt.decode(await generateAccessToken("user-1", []), { complete: true })?.header;

        expect(header?.alg).toBe("RS256");
        expect((await verifyAccessToken(await generateAccessToken("user-1", [])))?.uid).toBe("user-1");
    });

    it("stays HS256 when no keys are configured, and says so", async () => {
        configureJwt({ secret: SECRET });
        const header = jwt.decode(await generateAccessToken("user-1", []), { complete: true })?.header;

        expect(header?.alg).toBe("HS256");
        expect(header?.kid).toBeUndefined();
        expect(hasAsymmetricSigningKey()).toBe(false);
    });
});

describe("rotation", () => {
    it("keeps verifying tokens signed by the previous key", async () => {
        configureJwt({ secret: SECRET, signingKeys: [{ kid: "key-a", privateKey: KEY_A.privateKey }] });
        const beforeRotation = await generateAccessToken("user-1", ["admin"]);

        // The new key goes in front and becomes active; the old one stays in
        // the list exactly as long as tokens it signed can still be presented.
        configureJwt({
            secret: SECRET,
            signingKeys: [
                { kid: "key-b", privateKey: KEY_B.privateKey },
                { kid: "key-a", privateKey: KEY_A.privateKey }
            ]
        });

        expect((await verifyAccessToken(beforeRotation))?.uid).toBe("user-1");
        expect(jwt.decode(await generateAccessToken("user-2", []), { complete: true })?.header.kid).toBe("key-b");
    });

    it("stops accepting a key once it is dropped from the list", async () => {
        configureJwt({ secret: SECRET, signingKeys: [{ kid: "key-a", privateKey: KEY_A.privateKey }] });
        const oldToken = await generateAccessToken("user-1", []);

        configureJwt({ secret: SECRET, signingKeys: [{ kid: "key-b", privateKey: KEY_B.privateKey }] });

        expect(await verifyAccessToken(oldToken)).toBeNull();
    });

    it("honours activeKid rather than list order", async () => {
        configureJwt({
            secret: SECRET,
            activeKid: "key-b",
            signingKeys: [
                { kid: "key-a", privateKey: KEY_A.privateKey },
                { kid: "key-b", privateKey: KEY_B.privateKey }
            ]
        });

        expect(jwt.decode(await generateAccessToken("u", []), { complete: true })?.header.kid).toBe("key-b");
    });

    it("refuses to boot when activeKid names no configured key", () => {
        expect(() => configureJwt({
            secret: SECRET,
            activeKid: "typo",
            signingKeys: [{ kid: "key-a", privateKey: KEY_A.privateKey }]
        })).toThrow(/not among the configured signing keys/);
    });

    it("still verifies HS256 tokens minted before any key existed", async () => {
        configureJwt({ secret: SECRET });
        const legacy = await generateAccessToken("user-1", ["admin"]);

        configureJwt({ secret: SECRET, signingKeys: [{ kid: "key-a", privateKey: KEY_A.privateKey }] });

        // Otherwise turning the feature on is a mass sign-out.
        expect((await verifyAccessToken(legacy))?.uid).toBe("user-1");
    });
});

describe("the algorithm is the key's, never the token's", () => {
    beforeEach(() => {
        configureJwt({ secret: SECRET, signingKeys: [{ kid: "key-a", privateKey: KEY_A.privateKey }] });
    });

    it("rejects an HS256 token forged with the published public key as the secret", async () => {
        // Exactly what an attacker can do with nothing but /.well-known/jwks.json
        // and the public key it serves.
        const forged = jwt.sign(
            { uid: "attacker", roles: ["admin"] },
            KEY_A.publicKey,
            { algorithm: "HS256", keyid: "key-a" }
        );

        expect(await verifyAccessToken(forged)).toBeNull();
    });

    it("rejects an unsigned `alg: none` token", async () => {
        const unsigned = jwt.sign({ uid: "attacker", roles: ["admin"] }, "", { algorithm: "none" });

        expect(await verifyAccessToken(unsigned)).toBeNull();
    });

    it("rejects a token signed by a key we do not hold, even under a known kid", async () => {
        const wrongKey = jwt.sign({ uid: "attacker" }, KEY_B.privateKey, { algorithm: "ES256", keyid: "key-a" });

        expect(await verifyAccessToken(wrongKey)).toBeNull();
    });

    it("rejects an ES256 token whose kid we have never seen", async () => {
        const unknown = jwt.sign({ uid: "attacker" }, KEY_B.privateKey, { algorithm: "ES256", keyid: "nope" });

        expect(await verifyAccessToken(unknown)).toBeNull();
    });

    it("will not let the shared secret mint a session once a key names itself", async () => {
        // The one case the library does not cover for us, and the reason
        // `verifyAccessToken` resolves the key by `kid` *first* and never falls
        // back to the secret when it finds one.
        //
        // The secret is not the equal of a signing key: it also signs download
        // tokens, which are handed out in URLs, logged by proxies, and pasted
        // into tickets. A verifier that tried HS256 first — or that tried it
        // after the asymmetric attempt failed — would make every one of those
        // an admin session for anyone who could reach the secret, on a backend
        // whose operator believes they have moved to asymmetric keys.
        const downgraded = jwt.sign(
            { uid: "attacker", roles: ["admin"] },
            SECRET,
            { algorithm: "HS256", keyid: "key-a" }
        );

        expect(await verifyAccessToken(downgraded)).toBeNull();
    });
});

describe("the JWKS", () => {
    beforeEach(() => {
        configureJwt({
            secret: SECRET,
            signingKeys: [
                { kid: "key-a", privateKey: KEY_A.privateKey },
                { kid: "rsa", privateKey: RSA.privateKey }
            ]
        });
    });

    it("publishes one entry per configured key", () => {
        expect(getJwks().keys.map(k => k.kid).sort()).toEqual(["key-a", "rsa"]);
    });

    it("carries no private material", () => {
        // `d` is the EC/RSA private exponent; `p`/`q` are the RSA primes. The
        // endpoint is world-readable, so this is asserted rather than reasoned
        // about.
        for (const key of getJwks().keys) {
            expect(key.d).toBeUndefined();
            expect(key.p).toBeUndefined();
            expect(key.q).toBeUndefined();
        }
        expect(JSON.stringify(getJwks())).not.toContain("PRIVATE");
    });

    it("marks each key for signature use, with its algorithm", () => {
        const ec = getJwks().keys.find(k => k.kid === "key-a");

        expect(ec).toMatchObject({ use: "sig", alg: "ES256", kty: "EC", crv: "P-256" });
    });

    it("is served, unauthenticated, at /.well-known/jwks.json", async () => {
        const app = new Hono();
        app.route("/.well-known", createJwksRoutes());

        const res = await app.request("/.well-known/jwks.json");

        expect(res.status).toBe(200);
        expect(((await res.json()) as { keys: unknown[] }).keys).toHaveLength(2);
    });

    it("answers an empty key set rather than a 404 when none are configured", async () => {
        // A 404 is indistinguishable from a wrong URL; an empty list is a fact.
        configureJwt({ secret: SECRET });
        const app = new Hono();
        app.route("/.well-known", createJwksRoutes());

        const res = await app.request("/.well-known/jwks.json");

        expect(res.status).toBe(200);
        expect((await res.json() as { keys: unknown[] }).keys).toEqual([]);
    });
});

describe("key configuration is checked at boot", () => {
    it("rejects a PEM that will not parse", () => {
        expect(() => configureJwt({ secret: SECRET, signingKeys: [{ kid: "k", privateKey: "not a pem" }] }))
            .toThrow(/not a readable PEM private key/);
    });

    it("rejects two keys sharing a kid", () => {
        expect(() => configureJwt({
            secret: SECRET,
            signingKeys: [
                { kid: "same", privateKey: KEY_A.privateKey },
                { kid: "same", privateKey: KEY_B.privateKey }
            ]
        })).toThrow(/Duplicate JWT signing key id/);
    });

    it("rejects an algorithm the key cannot actually sign", () => {
        expect(() => resolveSigningKeys([{ kid: "k", privateKey: KEY_A.privateKey, algorithm: "RS256" }]))
            .toThrow(/is declared as RS256 but is a ec key/);
    });

    it("rejects an EC curve that is not P-256", () => {
        const p384 = generateKeyPairSync("ec", {
            namedCurve: "P-384",
            privateKeyEncoding: { type: "pkcs8", format: "pem" },
            publicKeyEncoding: { type: "spki", format: "pem" }
        });

        // Parses fine, signs fine, and fails verification everywhere — the
        // header would claim ES256 for a curve that is not P-256.
        expect(() => resolveSigningKeys([{ kid: "k", privateKey: p384.privateKey }]))
            .toThrow(/curve P-384, but ES256 requires P-256/);
    });

    it("leaves the previous configuration standing when a new one is bad", async () => {
        configureJwt({ secret: SECRET, signingKeys: [{ kid: "key-a", privateKey: KEY_A.privateKey }] });
        const token = await generateAccessToken("user-1", []);

        expect(() => configureJwt({ secret: SECRET, signingKeys: [{ kid: "bad", privateKey: "nope" }] })).toThrow();

        expect((await verifyAccessToken(token))?.uid).toBe("user-1");
    });
});

describe("a PEM as an environment variable carries it", () => {
    it("accepts a PEM with real newlines", () => {
        expect(normalizePemFromEnv(KEY_A.privateKey)).toContain("-----BEGIN");
    });

    it("accepts a PEM whose newlines were escaped, as .env files carry them", () => {
        const escaped = KEY_A.privateKey.replace(/\n/g, "\\n");

        expect(resolveSigningKeys([{ kid: "k", privateKey: normalizePemFromEnv(escaped) }])).toHaveLength(1);
    });

    it("accepts base64 of the whole PEM", () => {
        const b64 = Buffer.from(KEY_A.privateKey, "utf8").toString("base64");

        expect(resolveSigningKeys([{ kid: "k", privateKey: normalizePemFromEnv(b64) }])).toHaveLength(1);
    });
});
