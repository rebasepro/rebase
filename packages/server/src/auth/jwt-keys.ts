import { createPublicKey, createPrivateKey, type KeyObject } from "crypto";

/**
 * Asymmetric signing keys for access tokens, and the JWKS built from them.
 *
 * The symmetric secret this replaces is not going away — it still signs every
 * purpose-scoped token (download, MFA-pending, password reset), which are read
 * only by the server that minted them and are better off short. What a shared
 * secret cannot do is let *anybody else* verify a session:
 *
 *  - a gateway, an edge worker, or a second service that wants to check a token
 *    has to be handed the key that mints them, so every verifier becomes a
 *    forger;
 *  - and rotating it invalidates every token in circulation at once, which is
 *    why in practice it never gets rotated at all.
 *
 * A private key signs, the matching public key verifies, and the public half is
 * published at `/.well-known/jwks.json` for anyone to fetch. Rotation stops
 * being an outage: mint with the new key, keep the old one in the list until
 * the last token signed by it has expired, then drop it.
 *
 * **The key is chosen by `kid`, and the algorithm comes from the key — never
 * from the token.** A verifier that reads `alg` out of the header it is
 * checking will accept an `HS256` token whose "secret" is the RSA public key it
 * published, which is a complete authentication bypass and the best-known way
 * to get this wrong. {@link resolveVerificationKey} therefore returns the
 * algorithm alongside the key, and the caller pins it.
 */

/** The algorithms a signing key may use. Both are widely supported by verifiers. */
export type JwtSigningAlgorithm = "RS256" | "ES256";

/**
 * One asymmetric key pair, as an operator configures it.
 *
 * Only the private key is supplied: the public half is derived from it, so a
 * mismatched pair — a configuration error that produces tokens nobody can
 * verify, and which no amount of local testing catches because the signer never
 * consults the public key — cannot be expressed.
 */
export interface JwtSigningKeyConfig {
    /**
     * Names this key in the token header and in the JWKS. Any stable string;
     * something that identifies *when* it was minted (`"2026-08"`) is the usual
     * choice, because the question you ask of a `kid` later is always "is this
     * the old one?".
     */
    kid: string;
    /** PEM-encoded PKCS#8 or SEC1 private key. */
    privateKey: string;
    /**
     * Defaults to the algorithm implied by the key type — RSA keys sign RS256,
     * EC keys sign ES256. Worth setting only to be explicit.
     */
    algorithm?: JwtSigningAlgorithm;
}

/** A configured key, parsed and ready to sign or verify with. */
export interface ResolvedJwtKey {
    kid: string;
    algorithm: JwtSigningAlgorithm;
    privateKey: KeyObject;
    publicKey: KeyObject;
}

/** A JSON Web Key, as served by the JWKS endpoint. Public parameters only. */
export type PublicJwk = Record<string, unknown> & {
    kid: string;
    alg: JwtSigningAlgorithm;
    use: "sig";
};

/**
 * The algorithm a key type implies.
 *
 * Rejecting anything else here rather than defaulting is deliberate: an Ed25519
 * key configured by someone expecting it to work would otherwise be signed with
 * `RS256` in the header and fail verification everywhere, at runtime, on tokens
 * already handed to users.
 */
function algorithmForKey(key: KeyObject, kid: string): JwtSigningAlgorithm {
    switch (key.asymmetricKeyType) {
        case "rsa":
        case "rsa-pss":
            return "RS256";
        case "ec":
            return "ES256";
        default:
            throw new Error(
                `JWT signing key "${kid}" is a ${key.asymmetricKeyType ?? "non-asymmetric"} key. ` +
                "Supported: RSA (RS256) and EC P-256 (ES256). Generate one with: " +
                "openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem"
            );
    }
}

/**
 * An EC key of the wrong curve is the other way a key parses cleanly and then
 * fails to verify: `ES256` means P-256 specifically, and a P-384 key signs a
 * token whose header says P-256's algorithm.
 */
function assertCurveMatches(publicKey: KeyObject, kid: string): void {
    const jwk = publicKey.export({ format: "jwk" }) as { crv?: string };
    if (jwk.crv && jwk.crv !== "P-256") {
        throw new Error(
            `JWT signing key "${kid}" uses curve ${jwk.crv}, but ES256 requires P-256. ` +
            "Generate one with: openssl genpkey -algorithm EC -pkeyopt ec_paramgen_curve:P-256 -out jwt-key.pem"
        );
    }
}

/**
 * Parse the configured keys, deriving each public half from its private key.
 *
 * Throws on anything malformed. This runs at boot, from `configureJwt`, so a
 * key that cannot sign takes the process down at start rather than at the first
 * login — the same bargain every other credential in this file makes.
 */
export function resolveSigningKeys(configs: JwtSigningKeyConfig[]): ResolvedJwtKey[] {
    const seen = new Set<string>();

    return configs.map((config) => {
        if (!config.kid) {
            throw new Error("Every JWT signing key needs a `kid`; it is what the JWKS and the token header agree on.");
        }
        if (seen.has(config.kid)) {
            throw new Error(
                `Duplicate JWT signing key id "${config.kid}". A \`kid\` selects exactly one key at ` +
                "verification time, so two keys sharing one is a token that verifies or does not depending on order."
            );
        }
        seen.add(config.kid);

        let privateKey: KeyObject;
        try {
            privateKey = createPrivateKey(config.privateKey);
        } catch (error) {
            throw new Error(
                `JWT signing key "${config.kid}" is not a readable PEM private key: ` +
                `${error instanceof Error ? error.message : String(error)}`
            );
        }

        const publicKey = createPublicKey(privateKey);
        const derived = algorithmForKey(privateKey, config.kid);
        const algorithm = config.algorithm ?? derived;

        if (algorithm !== derived) {
            throw new Error(
                `JWT signing key "${config.kid}" is declared as ${algorithm} but is a ` +
                `${privateKey.asymmetricKeyType} key, which signs ${derived}.`
            );
        }
        if (algorithm === "ES256") assertCurveMatches(publicKey, config.kid);

        return { kid: config.kid, algorithm, privateKey, publicKey };
    });
}

/**
 * The key a token names, or `null` if it names none we hold.
 *
 * The returned algorithm is the *key's*, and the caller must verify with that
 * one alone. See the module docblock for what happens otherwise.
 */
export function resolveVerificationKey(keys: ResolvedJwtKey[], kid: string | undefined): ResolvedJwtKey | null {
    if (!kid) return null;
    return keys.find((key) => key.kid === kid) ?? null;
}

/**
 * A PEM as an environment variable can actually carry it.
 *
 * A PEM is multi-line and environment variables are not, so every deployment
 * tool solves it differently: `.env` files and most secret managers escape the
 * newlines to `\n`, Kubernetes and Docker secrets pass the bytes through
 * intact, and CI systems that mangle both are usually fed base64. All three
 * arrive here, and guessing wrong produces "not a readable PEM private key" at
 * boot with a key the operator can see is perfectly valid.
 *
 * Detection is on content, not on a flag: a PEM says so on its first line, and
 * anything that does not is tried as base64.
 */
export function normalizePemFromEnv(value: string): string {
    const trimmed = value.trim();
    if (trimmed.includes("-----BEGIN")) {
        // Literal backslash-n, not a newline — what an escaped .env value holds.
        return trimmed.replace(/\\n/g, "\n");
    }
    return Buffer.from(trimmed, "base64").toString("utf8");
}

/**
 * The public halves, in JWKS form.
 *
 * Node exports a JWK containing only public parameters for a public
 * `KeyObject` — no `d`, no primes — so the private material cannot leak
 * through this path even if a private key were passed by mistake. The keys are
 * derived from `publicKey` regardless, and this is asserted in the tests,
 * because "cannot" is worth checking on the one endpoint whose entire job is to
 * be world-readable.
 */
export function toJwks(keys: ResolvedJwtKey[]): { keys: PublicJwk[] } {
    return {
        keys: keys.map((key) => ({
            ...(key.publicKey.export({ format: "jwk" }) as Record<string, unknown>),
            kid: key.kid,
            alg: key.algorithm,
            use: "sig" as const
        }))
    };
}
