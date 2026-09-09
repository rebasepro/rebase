/**
 * The discovery documents and the small pure rules the OAuth surface is built
 * from: canonical URIs, PKCE, scopes, redirect-URI matching.
 *
 * Everything here is a function of its arguments. That is deliberate — these
 * are the parts a specification pins down exactly, and the parts where being
 * approximately right is indistinguishable from being wrong until a client
 * refuses to connect. Keeping them free of Hono, of the database and of the
 * server's config means the tests can state the spec's rules directly.
 *
 * References, because every rule below traces to one:
 *   RFC 9728  OAuth 2.0 Protected Resource Metadata
 *   RFC 8414  OAuth 2.0 Authorization Server Metadata
 *   RFC 7591  Dynamic Client Registration
 *   RFC 8707  Resource Indicators
 *   RFC 7636  PKCE
 *   OAuth 2.1 draft-ietf-oauth-v2-1
 */
import { sha256Bytes } from "../utils/portable-crypto.js";

/**
 * What a token may do at `/mcp`.
 *
 * Two, and no more. RFC 9728 asks `scopes_supported` to be the minimal set that
 * makes the resource usable, and the MCP specification's scope-minimization
 * guidance points the same way: a client that only needs to read should be able
 * to ask for exactly that, and a consent screen listing eleven fine-grained
 * permissions is one nobody reads.
 *
 * They are not a substitute for RLS. A `mcp:read` token still reads through the
 * user's own policies — the scope decides whether the tool exists for this
 * session, the database decides which rows come back.
 */
export const MCP_SCOPES = ["mcp:read", "mcp:write"] as const;
export type McpScope = (typeof MCP_SCOPES)[number];

/** The scope a client gets when it asks for nothing in particular. */
export const DEFAULT_MCP_SCOPE = "mcp:read";

/**
 * The canonical resource identifier for this server's MCP endpoint.
 *
 * RFC 8707 §2 and the MCP specification agree on the shape: an absolute URI,
 * lowercase scheme and host, no fragment, and — where the spec expresses a
 * preference — no trailing slash. Clients send this back as the `resource`
 * parameter and the token's audience is bound to it, so a value that disagrees
 * with what the client computed rejects every token. It is worth being fussy.
 */
export function canonicalResourceUri(publicUrl: string, mcpPath = "/mcp"): string {
    const url = new URL(publicUrl);
    url.hash = "";
    url.search = "";
    url.protocol = url.protocol.toLowerCase();
    url.hostname = url.hostname.toLowerCase();
    const base = url.origin;
    const path = mcpPath.startsWith("/") ? mcpPath : `/${mcpPath}`;
    return path === "/" ? base : `${base}${path.replace(/\/+$/, "")}`;
}

/** The issuer identifier: the origin, with no path. */
export function issuerFor(publicUrl: string): string {
    const url = new URL(publicUrl);
    return url.origin;
}

/**
 * Where the protected-resource metadata for a given resource lives.
 *
 * RFC 9728 §3.1 inserts `.well-known/oauth-protected-resource` **between** the
 * host and the resource's own path — `https://h/mcp` is described at
 * `https://h/.well-known/oauth-protected-resource/mcp`, not at
 * `…/mcp/.well-known/…`. Getting this backwards is a 404 the client reports as
 * "no authorization server", which points at everything except the path.
 */
export function protectedResourceMetadataPath(mcpPath = "/mcp"): string {
    const path = mcpPath.startsWith("/") ? mcpPath : `/${mcpPath}`;
    return path === "/"
        ? "/.well-known/oauth-protected-resource"
        : `/.well-known/oauth-protected-resource${path.replace(/\/+$/, "")}`;
}

export interface ProtectedResourceMetadata {
    resource: string;
    authorization_servers: string[];
    scopes_supported: string[];
    bearer_methods_supported: string[];
    resource_documentation?: string;
}

export function protectedResourceMetadata(
    publicUrl: string,
    mcpPath = "/mcp"
): ProtectedResourceMetadata {
    return {
        resource: canonicalResourceUri(publicUrl, mcpPath),
        authorization_servers: [issuerFor(publicUrl)],
        // `offline_access` is deliberately absent. The MCP specification says a
        // protected resource SHOULD NOT advertise it, because a refresh token
        // is a property of the client's session with the authorization server
        // and not something this resource requires to answer a request.
        scopes_supported: [...MCP_SCOPES],
        bearer_methods_supported: ["header"],
        resource_documentation: "https://rebase.pro/docs/ai/mcp"
    };
}

export interface AuthorizationServerMetadata {
    issuer: string;
    authorization_endpoint: string;
    token_endpoint: string;
    registration_endpoint: string;
    scopes_supported: string[];
    response_types_supported: string[];
    grant_types_supported: string[];
    code_challenge_methods_supported: string[];
    token_endpoint_auth_methods_supported: string[];
    authorization_response_iss_parameter_supported: boolean;
    service_documentation?: string;
}

export function authorizationServerMetadata(
    publicUrl: string,
    oauthBasePath: string
): AuthorizationServerMetadata {
    const issuer = issuerFor(publicUrl);
    const base = `${issuer}${oauthBasePath}`;
    return {
        issuer,
        authorization_endpoint: `${base}/authorize`,
        token_endpoint: `${base}/token`,
        registration_endpoint: `${base}/register`,
        scopes_supported: [...MCP_SCOPES],
        response_types_supported: ["code"],
        // No implicit, no password, no client_credentials. OAuth 2.1 removes the
        // first two outright; the third would mint a token with no user behind
        // it, and every row this server returns is filtered by who is asking.
        // A token with no `uid` has nothing for RLS to evaluate.
        grant_types_supported: ["authorization_code", "refresh_token"],
        // S256 only. RFC 7636 also defines `plain`, and OAuth 2.1 forbids it for
        // anything that can compute a SHA-256 — which is every client that can
        // speak HTTPS.
        code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: ["client_secret_post", "client_secret_basic", "none"],
        // RFC 9207. We do emit `iss` on both success and error redirects, so we
        // say so — a client that sees `true` here and no `iss` MUST reject the
        // response, which makes this claim load-bearing rather than decorative.
        authorization_response_iss_parameter_supported: true,
        service_documentation: "https://rebase.pro/docs/ai/mcp"
    };
}

/**
 * Verify a PKCE code verifier against the challenge recorded at authorize time.
 *
 * RFC 7636 §4.6: BASE64URL(SHA256(ASCII(verifier))) === challenge, with the
 * base64url unpadded. Only S256 is accepted — `plain` compares the verifier to
 * itself, which protects against nothing once the code has leaked, and OAuth
 * 2.1 removes it.
 */
export async function verifyPkce(
    verifier: string,
    challenge: string,
    method: string
): Promise<boolean> {
    if (method !== "S256") return false;
    // RFC 7636 §4.1 — 43 to 128 characters from the unreserved set. A verifier
    // shorter than that has too little entropy for the exercise to mean
    // anything, and a client sending one is misconfigured rather than unlucky.
    if (!/^[A-Za-z0-9\-._~]{43,128}$/.test(verifier)) return false;
    const digest = await sha256Bytes(verifier);
    return base64UrlEncode(digest) === challenge;
}

/** Unpadded base64url, as every one of these RFCs means it. */
export function base64UrlEncode(bytes: Uint8Array): string {
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Is `candidate` one of the client's registered redirect URIs?
 *
 * Exact string comparison, which is what OAuth 2.1 §4.1.2.1 requires and what
 * closes open redirection. No prefix matching, no ignoring the query, no
 * "same origin is close enough" — every one of those has been the published
 * root cause of a token-stealing redirect, because an attacker who controls any
 * path or parameter on a permitted origin controls where the code lands.
 *
 * The one concession is loopback: RFC 8252 §7.3 requires the port to be ignored
 * for `http://127.0.0.1` and `http://[::1]`, because a native client binds an
 * ephemeral port it cannot know at registration time. `localhost` is
 * deliberately NOT included — RFC 8252 §8.3 recommends against it, since it
 * resolves through a name service an attacker may influence.
 */
export function redirectUriAllowed(candidate: string, registered: string[]): boolean {
    if (registered.includes(candidate)) return true;

    let url: URL;
    try {
        url = new URL(candidate);
    } catch {
        return false;
    }
    if (url.protocol !== "http:") return false;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "[::1]" && url.hostname !== "::1") return false;

    return registered.some(entry => {
        let known: URL;
        try {
            known = new URL(entry);
        } catch {
            return false;
        }
        return known.protocol === url.protocol
            && known.hostname === url.hostname
            && known.pathname === url.pathname
            && known.search === url.search;
    });
}

/**
 * Narrow a requested scope to what this server issues.
 *
 * An unknown scope is dropped rather than refused. RFC 6749 §3.3 allows either,
 * and dropping is what keeps a client that asks for `openid profile email` out
 * of habit from failing to connect at all — it gets the MCP scopes it is
 * entitled to and none of the ones it invented.
 */
export function narrowScope(requested: string | undefined | null): string {
    if (!requested) return DEFAULT_MCP_SCOPE;
    const granted = requested
        .split(/\s+/)
        .filter(Boolean)
        .filter((s): s is McpScope => (MCP_SCOPES as readonly string[]).includes(s));
    return granted.length ? [...new Set(granted)].join(" ") : DEFAULT_MCP_SCOPE;
}

/** Does a granted scope string carry this permission? */
export function scopeAllows(scope: string, needed: McpScope): boolean {
    return scope.split(/\s+/).filter(Boolean).includes(needed);
}

/**
 * The `WWW-Authenticate` value for an unauthenticated request.
 *
 * RFC 6750 §3 plus the MCP specification's requirement that the challenge point
 * at the protected-resource metadata: a client with no token discovers the
 * entire authorization server from this one header, so an omitted
 * `resource_metadata` is what makes a server look like it has no auth at all.
 */
export function bearerChallenge(publicUrl: string, mcpPath: string, scope?: string): string {
    const metadataUrl = `${issuerFor(publicUrl)}${protectedResourceMetadataPath(mcpPath)}`;
    const parts = [`Bearer resource_metadata="${metadataUrl}"`];
    if (scope) parts.push(`scope="${scope}"`);
    return parts.join(", ");
}

/** The 403 challenge for a token that is valid but too narrow. */
export function insufficientScopeChallenge(
    publicUrl: string,
    mcpPath: string,
    needed: string,
    description: string
): string {
    const metadataUrl = `${issuerFor(publicUrl)}${protectedResourceMetadataPath(mcpPath)}`;
    return [
        `Bearer error="insufficient_scope"`,
        `scope="${needed}"`,
        `resource_metadata="${metadataUrl}"`,
        `error_description="${description.replace(/"/g, "'")}"`
    ].join(", ");
}

/**
 * Does the `resource` a client asked for name this server?
 *
 * RFC 8707 lets a client send a resource more specific than the one the server
 * advertises, so this compares on origin plus path prefix rather than equality
 * — `https://h/mcp` accepts `https://h/mcp` and rejects `https://h/mcpx` and
 * anything on another origin. Rejecting is the point: a token minted for
 * another audience must never be usable here, and the check that stops that
 * starts at the authorize request.
 */
export function resourceMatches(requested: string, canonical: string): boolean {
    let asked: URL;
    try {
        asked = new URL(requested);
    } catch {
        return false;
    }
    if (asked.hash) return false;
    const mine = new URL(canonical);
    if (asked.origin.toLowerCase() !== mine.origin.toLowerCase()) return false;

    const askedPath = asked.pathname.replace(/\/+$/, "");
    const minePath = mine.pathname.replace(/\/+$/, "");
    return askedPath === minePath || askedPath.startsWith(`${minePath}/`);
}
