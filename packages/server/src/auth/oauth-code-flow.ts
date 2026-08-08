import { z } from "zod";

/**
 * The authorization-code request shape every OAuth provider accepts, and the
 * two derivations of it that were previously copy-pasted twelve times.
 *
 * Twelve providers declared their own `z.object({ code, redirectUri })` and
 * each decided independently whether to accept a PKCE verifier (one did) and
 * how to read a verification signal off the provider's profile response (five
 * skipped the question and hardcoded `true`). One predicate, twelve
 * implementations — so the controls below live here and every provider calls
 * them, which is what makes it impossible for a thirteenth provider to ship
 * without them.
 */

/** The request body every authorization-code provider consumes. */
export interface OAuthCodeFlowPayload {
    /** Authorization code returned to the client by the provider. */
    code: string;
    /**
     * Redirect URI the code was issued against. Echoed to the token endpoint,
     * which is what binds the code to the client that started the flow — and
     * why the route allowlists it before `verify` ever runs
     * (see `isRedirectUriAllowed`).
     */
    redirectUri: string;
    /**
     * PKCE verifier, when the client started the flow with a
     * `code_challenge`. Forwarded to the token endpoint verbatim.
     */
    codeVerifier?: string;
}

/**
 * Build the request schema for an authorization-code provider.
 *
 * `pkce` defaults to `"optional"`: the client decides whether it sent a
 * `code_challenge`, and providers that do not implement PKCE simply never see
 * a verifier because their clients never generate one. `"required"` is for
 * providers that mandate PKCE (Twitter/X).
 */
export function oauthCodeFlowSchema(opts: { pkce?: "required" | "optional" } = {}) {
    const verifier = opts.pkce === "required"
        ? z.string().min(1, "PKCE code verifier is required")
        : z.string().min(1).optional();

    return z.object({
        code: z.string().min(1, "Auth code is required"),
        redirectUri: z.string().url("Valid redirect URI is required"),
        codeVerifier: verifier
    });
}

/**
 * The `code_verifier` token-endpoint parameter, or nothing.
 *
 * Returned as a spreadable object so a provider adds PKCE with one `...` in
 * its existing body literal, rather than branching.
 */
export function pkceTokenParams(codeVerifier?: string): Record<string, string> {
    return codeVerifier ? { code_verifier: codeVerifier } : {};
}

/**
 * Normalise a provider's email-verification signal into the boolean that
 * `OAuthProviderProfile.emailVerified` promises.
 *
 * The whole point is the default: anything that is not an affirmative
 * verification signal — `undefined`, `null`, a missing field, an empty string,
 * `false` — becomes `false`. A provider that reports nothing therefore cannot
 * accidentally assert that it verified the address, which is exactly the
 * mistake five providers had made.
 *
 * Accepts the string forms because OIDC issuers are inconsistent about whether
 * `email_verified` is a JSON boolean or a string.
 */
export function providerVerifiedEmail(signal: unknown): boolean {
    if (signal === true) return true;
    if (typeof signal === "string") {
        const normalized = signal.trim().toLowerCase();
        return normalized === "true" || normalized === "1";
    }
    return false;
}
