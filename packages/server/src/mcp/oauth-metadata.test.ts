/**
 * The specification, as assertions.
 *
 * These are the rules a client library enforces on our behalf and then reports
 * as an unhelpful "could not connect": a metadata path off by one segment, a
 * `plain` PKCE challenge quietly accepted, a redirect URI matched by prefix. So
 * each test below names the document and section it comes from, and several
 * assert a REFUSAL rather than a success — the refusals are the security
 * properties, and they are the ones a well-meaning refactor removes.
 */
import {
    canonicalResourceUri,
    issuerFor,
    protectedResourceMetadataPath,
    protectedResourceMetadata,
    authorizationServerMetadata,
    verifyPkce,
    base64UrlEncode,
    redirectUriAllowed,
    narrowScope,
    scopeAllows,
    bearerChallenge,
    insufficientScopeChallenge,
    resourceMatches,
    MCP_SCOPES
} from "./oauth-metadata.js";
import { sha256Bytes } from "../utils/portable-crypto.js";

const HOST = "https://talent.sustentalent.com";

/* ── Canonical URIs (RFC 8707 §2) ─────────────────────────────────── */

describe("canonicalResourceUri", () => {
    it("is the origin plus the MCP path, with no trailing slash", () => {
        expect(canonicalResourceUri(HOST)).toBe("https://talent.sustentalent.com/mcp");
        expect(canonicalResourceUri(`${HOST}/`)).toBe("https://talent.sustentalent.com/mcp");
    });

    it("drops a fragment and a query, which the RFC forbids in a resource id", () => {
        expect(canonicalResourceUri(`${HOST}/?a=1#frag`)).toBe("https://talent.sustentalent.com/mcp");
    });

    it("lowercases scheme and host, so two spellings of one server agree", () => {
        expect(canonicalResourceUri("HTTPS://Talent.SustenTalent.com")).toBe("https://talent.sustentalent.com/mcp");
    });

    it("keeps a non-default port, because it identifies a different server", () => {
        expect(canonicalResourceUri("https://localhost:8443")).toBe("https://localhost:8443/mcp");
    });

    it("ignores the path of the public URL — the resource path is ours to set", () => {
        expect(canonicalResourceUri(`${HOST}/anything`)).toBe("https://talent.sustentalent.com/mcp");
    });
});

describe("issuerFor", () => {
    it("is the bare origin", () => {
        expect(issuerFor(`${HOST}/api/whatever`)).toBe("https://talent.sustentalent.com");
    });
});

/* ── Metadata documents ───────────────────────────────────────────── */

describe("protectedResourceMetadataPath (RFC 9728 §3.1)", () => {
    it("inserts the well-known segment BETWEEN host and resource path", () => {
        // The mistake this exists to prevent is `/mcp/.well-known/...`, which
        // 404s and is reported by clients as "no authorization server".
        expect(protectedResourceMetadataPath("/mcp")).toBe("/.well-known/oauth-protected-resource/mcp");
    });

    it("has no suffix for a resource at the root", () => {
        expect(protectedResourceMetadataPath("/")).toBe("/.well-known/oauth-protected-resource");
    });
});

describe("protectedResourceMetadata", () => {
    const doc = protectedResourceMetadata(HOST);

    it("points at itself and at the authorization server", () => {
        expect(doc.resource).toBe("https://talent.sustentalent.com/mcp");
        expect(doc.authorization_servers).toEqual(["https://talent.sustentalent.com"]);
    });

    it("advertises only the header method — a token in a query string is forbidden", () => {
        expect(doc.bearer_methods_supported).toEqual(["header"]);
    });

    it("does not advertise offline_access", () => {
        // The MCP specification: a protected resource SHOULD NOT list it,
        // because a refresh token is not something this resource requires.
        expect(doc.scopes_supported).not.toContain("offline_access");
        expect(doc.scopes_supported).toEqual([...MCP_SCOPES]);
    });
});

describe("authorizationServerMetadata (RFC 8414)", () => {
    const doc = authorizationServerMetadata(HOST, "/api/oauth");

    it("names endpoints under the OAuth base path", () => {
        expect(doc.authorization_endpoint).toBe("https://talent.sustentalent.com/api/oauth/authorize");
        expect(doc.token_endpoint).toBe("https://talent.sustentalent.com/api/oauth/token");
        expect(doc.registration_endpoint).toBe("https://talent.sustentalent.com/api/oauth/register");
    });

    it("offers S256 and NOT plain", () => {
        expect(doc.code_challenge_methods_supported).toEqual(["S256"]);
    });

    it("offers no grant that mints a token with no user behind it", () => {
        // client_credentials would produce a token with no `uid`, and every row
        // this server returns is filtered by who is asking.
        expect(doc.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
        expect(doc.grant_types_supported).not.toContain("client_credentials");
        expect(doc.grant_types_supported).not.toContain("password");
        expect(doc.response_types_supported).not.toContain("token");
    });

    it("claims iss support, which makes emitting it mandatory (RFC 9207)", () => {
        expect(doc.authorization_response_iss_parameter_supported).toBe(true);
    });
});

/* ── PKCE (RFC 7636) ──────────────────────────────────────────────── */

describe("verifyPkce", () => {
    const verifier = "a".repeat(43);

    async function challengeFor(v: string): Promise<string> {
        return base64UrlEncode(await sha256Bytes(v));
    }

    it("accepts the S256 challenge derived from the verifier", async () => {
        expect(await verifyPkce(verifier, await challengeFor(verifier), "S256")).toBe(true);
    });

    it("rejects a verifier that does not derive the challenge", async () => {
        expect(await verifyPkce("b".repeat(43), await challengeFor(verifier), "S256")).toBe(false);
    });

    it("refuses `plain` even when the values match", async () => {
        // OAuth 2.1 removes `plain`: it proves nothing once the code has leaked,
        // because the leaked request carries the verifier too.
        expect(await verifyPkce(verifier, verifier, "plain")).toBe(false);
    });

    it("refuses a verifier shorter than 43 characters", async () => {
        const short = "a".repeat(42);
        expect(await verifyPkce(short, await challengeFor(short), "S256")).toBe(false);
    });

    it("refuses a verifier longer than 128 characters", async () => {
        const long = "a".repeat(129);
        expect(await verifyPkce(long, await challengeFor(long), "S256")).toBe(false);
    });

    it("refuses characters outside the unreserved set", async () => {
        const bad = `${"a".repeat(42)}/`;
        expect(await verifyPkce(bad, await challengeFor(bad), "S256")).toBe(false);
    });

    it("produces unpadded base64url", async () => {
        const encoded = await challengeFor(verifier);
        expect(encoded).not.toContain("=");
        expect(encoded).not.toContain("+");
        expect(encoded).not.toContain("/");
    });
});

/* ── Redirect URIs (OAuth 2.1 §4.1.2.1, RFC 8252 §7.3) ────────────── */

describe("redirectUriAllowed", () => {
    const registered = ["https://claude.ai/api/mcp/auth_callback"];

    it("accepts an exact match", () => {
        expect(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback", registered)).toBe(true);
    });

    it("refuses a different path on a registered origin", () => {
        // The open-redirect shape: an attacker who controls any path on the
        // origin controls where the authorization code lands.
        expect(redirectUriAllowed("https://claude.ai/evil", registered)).toBe(false);
    });

    it("refuses an appended query or fragment", () => {
        expect(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback?next=x", registered)).toBe(false);
        expect(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback#x", registered)).toBe(false);
    });

    it("refuses a prefix extension of a registered URI", () => {
        expect(redirectUriAllowed("https://claude.ai/api/mcp/auth_callback_evil", registered)).toBe(false);
    });

    it("refuses another origin entirely", () => {
        expect(redirectUriAllowed("https://claude.ai.evil.com/api/mcp/auth_callback", registered)).toBe(false);
    });

    it("ignores the port for a loopback redirect (RFC 8252 §7.3)", () => {
        const native = ["http://127.0.0.1:1234/callback"];
        expect(redirectUriAllowed("http://127.0.0.1:59123/callback", native)).toBe(true);
        expect(redirectUriAllowed("http://127.0.0.1:59123/other", native)).toBe(false);
    });

    it("does NOT extend the loopback exemption to localhost", () => {
        // RFC 8252 §8.3: `localhost` resolves through a name service an attacker
        // may influence, so the literal address is the one that gets the pass.
        const named = ["http://localhost:1234/callback"];
        expect(redirectUriAllowed("http://localhost:59123/callback", named)).toBe(false);
    });

    it("does not extend the port exemption to https", () => {
        const secure = ["https://127.0.0.1:1234/callback"];
        expect(redirectUriAllowed("https://127.0.0.1:59123/callback", secure)).toBe(false);
    });

    it("refuses a value that is not a URI at all", () => {
        expect(redirectUriAllowed("not a uri", registered)).toBe(false);
    });
});

/* ── Scopes ───────────────────────────────────────────────────────── */

describe("narrowScope", () => {
    it("defaults to read when nothing is asked for", () => {
        expect(narrowScope(undefined)).toBe("mcp:read");
        expect(narrowScope("")).toBe("mcp:read");
    });

    it("keeps the scopes this server issues", () => {
        expect(narrowScope("mcp:read mcp:write")).toBe("mcp:read mcp:write");
    });

    it("drops scopes it does not issue rather than refusing the request", () => {
        expect(narrowScope("openid profile mcp:read")).toBe("mcp:read");
    });

    it("cannot be tricked into granting write by an unknown scope", () => {
        expect(narrowScope("mcp:admin mcp:*")).toBe("mcp:read");
    });

    it("de-duplicates", () => {
        expect(narrowScope("mcp:read mcp:read")).toBe("mcp:read");
    });
});

describe("scopeAllows", () => {
    it("is exact — read does not imply write", () => {
        expect(scopeAllows("mcp:read", "mcp:read")).toBe(true);
        expect(scopeAllows("mcp:read", "mcp:write")).toBe(false);
        expect(scopeAllows("mcp:read mcp:write", "mcp:write")).toBe(true);
    });
});

/* ── Challenges (RFC 6750 §3) ─────────────────────────────────────── */

describe("bearerChallenge", () => {
    it("points at the protected-resource metadata", () => {
        expect(bearerChallenge(HOST, "/mcp")).toBe(
            'Bearer resource_metadata="https://talent.sustentalent.com/.well-known/oauth-protected-resource/mcp"'
        );
    });

    it("carries a scope hint when one is given", () => {
        expect(bearerChallenge(HOST, "/mcp", "mcp:read")).toContain('scope="mcp:read"');
    });
});

describe("insufficientScopeChallenge", () => {
    const header = insufficientScopeChallenge(HOST, "/mcp", "mcp:write", 'needs "write"');

    it("names the error and the scope that would satisfy the call", () => {
        expect(header).toContain('error="insufficient_scope"');
        expect(header).toContain('scope="mcp:write"');
        expect(header).toContain("resource_metadata=");
    });

    it("does not let a description break out of its quoted string", () => {
        expect(header).toContain(`error_description="needs 'write'"`);
        expect(header.match(/"/g)?.length ?? 0).toBe(8);
    });
});

/* ── Resource indicators (RFC 8707) ───────────────────────────────── */

describe("resourceMatches", () => {
    const canonical = "https://talent.sustentalent.com/mcp";

    it("accepts the canonical URI", () => {
        expect(resourceMatches(canonical, canonical)).toBe(true);
    });

    it("accepts a more specific path beneath it", () => {
        expect(resourceMatches(`${canonical}/sub`, canonical)).toBe(true);
    });

    it("tolerates a trailing slash", () => {
        expect(resourceMatches(`${canonical}/`, canonical)).toBe(true);
    });

    it("refuses a sibling path that merely shares a prefix", () => {
        expect(resourceMatches("https://talent.sustentalent.com/mcpx", canonical)).toBe(false);
    });

    it("refuses another origin — this is the audience boundary", () => {
        // A token minted for someone else's server must never be usable here,
        // and the check that ultimately prevents it starts at authorize time.
        expect(resourceMatches("https://evil.example.com/mcp", canonical)).toBe(false);
        expect(resourceMatches("http://talent.sustentalent.com/mcp", canonical)).toBe(false);
    });

    it("refuses a fragment, which RFC 8707 forbids", () => {
        expect(resourceMatches(`${canonical}#x`, canonical)).toBe(false);
    });

    it("refuses a non-URI", () => {
        expect(resourceMatches("talent.sustentalent.com", canonical)).toBe(false);
    });
});
