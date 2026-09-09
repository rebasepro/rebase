/**
 * The OAuth 2.1 authorization server that issues tokens for `/mcp`.
 *
 * Three endpoints and a decision handler:
 *
 *   POST /register            RFC 7591 dynamic client registration
 *   GET  /authorize           the user-facing consent hop
 *   POST /authorize/decision  what the consent page posts back
 *   POST /token               code and refresh grants
 *
 * The one shape worth explaining up front is `/authorize/decision`. This server
 * already has a login endpoint, a password policy, rate limits and whatever MFA
 * the deployment configured, and duplicating any of that here would mean a
 * second credential path with its own bugs. So the consent page never sees a
 * password: it posts to the EXISTING `${basePath}/auth/login`, gets an ordinary
 * session token back, and hands that to `/authorize/decision` as proof of who
 * is consenting. This file authenticates a person exactly once, with the same
 * function `/api/data` uses, and otherwise deals only in grants.
 *
 * The authorization request itself is carried across that hop as a signed,
 * 10-minute token rather than as form fields. Without that, `/authorize/
 * decision` would mint a code for whatever `client_id` and `redirect_uri` its
 * caller typed — an open code-minting endpoint that skips every check
 * `/authorize` performs.
 */
import { Hono } from "hono";
import type { Context } from "hono";
import type { HonoEnv } from "../api/types.js";
import { logger } from "../utils/logger.js";
import { createRateLimiter } from "../auth/rate-limiter.js";
import { randomHex, constantTimeEqual, sha256Hex } from "../utils/portable-crypto.js";
import {
    verifyAccessToken,
    generateMcpAccessToken,
    signPurposeToken,
    verifyPurposeToken
} from "../auth/jwt.js";
import type { OAuthStore } from "./oauth-store.js";
import { AUTHORIZATION_CODE_TTL_MS } from "./oauth-store.js";
import {
    canonicalResourceUri,
    issuerFor,
    narrowScope,
    redirectUriAllowed,
    resourceMatches,
    verifyPkce,
    MCP_SCOPES
} from "./oauth-metadata.js";
import { renderConsentPage } from "./consent-page.js";

/** How long an issued MCP access token lives. */
const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;

/** How long a refresh token lives. Rotated on every use. */
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** How long the signed authorization request survives the login hop. */
const AUTHORIZE_REQUEST_TTL_SECONDS = 600;

/**
 * A ceiling on open dynamic registration.
 *
 * RFC 7591 registration has to be open for the MCP flow to work at all — the
 * client is a piece of software the operator has never heard of, and there is
 * nobody to hand a client ID to in advance. Open means anyone can POST, so the
 * table is a free write for the internet. The cap turns "unbounded rows" into
 * "a bounded, boring amount of junk", which is the difference between a nuisance
 * and a disk-exhaustion vector.
 */
const MAX_REGISTERED_CLIENTS = 5_000;

export interface OAuthRoutesConfig {
    store: OAuthStore;
    /** The externally reachable origin of this deployment. */
    publicUrl: string;
    /** Where `/mcp` is mounted, e.g. `/mcp`. */
    mcpPath: string;
    /** Where the auth routes live, e.g. `/api/auth` — the consent page posts there. */
    authBasePath: string;
    /** Whether open registration is permitted. */
    allowDynamicRegistration: boolean;
}

interface AuthorizeRequestClaims {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    codeChallengeMethod: string;
    scope: string;
    resource: string;
    state?: string;
}

export function createOAuthRoutes(config: OAuthRoutesConfig): Hono<HonoEnv> {
    const router = new Hono<HonoEnv>();
    const { store, publicUrl, mcpPath } = config;
    const issuer = issuerFor(publicUrl);
    const canonicalResource = canonicalResourceUri(publicUrl, mcpPath);

    // The limiters are created PER ROUTER, not at module scope.
    //
    // In production that is the same thing: one process mounts this router once,
    // so one bucket. It matters everywhere else — a module-level limiter shares
    // its counter across every instance in the process, so a test suite that
    // builds twenty apps exhausts the registration limit on the fourth and the
    // rest fail for a reason that has nothing to do with what they assert. A
    // limiter whose scope is wider than the thing it protects is a limiter that
    // will eventually refuse something nobody meant it to.
    /**
     * Registration is an unauthenticated write, so it gets the tightest limit here.
     *
     * The cap above bounds the *total* damage; this bounds the rate at which one
     * source can approach it. Without both, a single host can fill five thousand
     * rows in a few seconds and every legitimate client that arrives afterwards is
     * refused — the cap turns into the denial of service rather than the defence
     * against one. Ten registrations in fifteen minutes is generous for the real
     * pattern, which is a person connecting an application once.
     */
    const registrationLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        limit: 10,
        message: "Too many client registrations from this address. Try again later."
    });

    /**
     * The token endpoint, which is where a stolen code or refresh token gets spent.
     *
     * Looser than registration because a busy deployment legitimately refreshes
     * often — one token per client per hour, times however many clients a user has
     * connected, times however many users share an egress IP. 120 in fifteen
     * minutes leaves that comfortable while making an offline guessing loop against
     * a code or a client secret pointless: both are 256 bits, so the limit is
     * belt-and-braces rather than the actual protection.
     */
    const tokenLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        limit: 120,
        message: "Too many token requests, please try again later."
    });

    /**
     * The authorize endpoint and its decision hop.
     *
     * Rendering a consent page is cheap, but the decision hop verifies a session
     * token on every call, and an unauthenticated caller can drive it. Shared
     * between the two because they are two halves of one flow and a limit that
     * only covers the cheap half is decorative.
     */
    const authorizeLimiter = createRateLimiter({
        windowMs: 15 * 60 * 1000,
        limit: 60,
        message: "Too many authorization requests, please try again later."
    });

    /* ── Dynamic client registration (RFC 7591) ───────────────────── */

    router.post("/register", registrationLimiter, async (c) => {
        if (!config.allowDynamicRegistration) {
            // 403 rather than 404: the endpoint exists and is advertised in the
            // metadata, it is this deployment that has switched it off. A 404
            // would send the client hunting for a different path.
            return c.json({
                error: "access_denied",
                error_description: "Dynamic client registration is disabled on this deployment."
            }, 403);
        }

        let body: Record<string, unknown>;
        try {
            body = await c.req.json();
        } catch {
            return c.json({ error: "invalid_client_metadata", error_description: "Body must be JSON." }, 400);
        }

        const redirectUris = Array.isArray(body.redirect_uris) ? body.redirect_uris.map(String) : [];
        if (redirectUris.length === 0) {
            return c.json({
                error: "invalid_redirect_uri",
                error_description: "At least one redirect_uri is required."
            }, 400);
        }

        // Every redirect URI is checked at REGISTRATION, not only at authorize
        // time. A client that registers `javascript:` or a bare fragment has
        // made a mistake we can name now, and refusing here means the stored
        // row can never be the source of an open redirect later.
        for (const uri of redirectUris) {
            const problem = redirectUriProblem(uri);
            if (problem) {
                return c.json({ error: "invalid_redirect_uri", error_description: `${uri}: ${problem}` }, 400);
            }
        }

        if (await store.countClients() >= MAX_REGISTERED_CLIENTS) {
            logger.error("[oauth] Registration refused: client cap reached", { cap: MAX_REGISTERED_CLIENTS });
            return c.json({
                error: "invalid_client_metadata",
                error_description: "This deployment has reached its registered-client limit."
            }, 400);
        }

        const requestedAuthMethod = typeof body.token_endpoint_auth_method === "string"
            ? body.token_endpoint_auth_method
            : "client_secret_post";
        const isPublic = requestedAuthMethod === "none";

        const clientId = `mcp_${randomHex(16)}`;
        // A public client gets no secret at all rather than an unused one. PKCE
        // is what protects it, and a secret shipped inside a distributable
        // client is a secret in the hands of everyone who has the client.
        const clientSecret = isPublic ? null : randomHex(32);

        const grantTypes = Array.isArray(body.grant_types) && body.grant_types.length
            ? body.grant_types.map(String).filter(g => g === "authorization_code" || g === "refresh_token")
            : ["authorization_code", "refresh_token"];
        if (!grantTypes.includes("authorization_code")) {
            return c.json({
                error: "invalid_client_metadata",
                error_description: "Only authorization_code (with optional refresh_token) is supported."
            }, 400);
        }

        const scope = narrowScope(typeof body.scope === "string" ? body.scope : undefined);

        await store.registerClient({
            clientId,
            clientSecretHash: clientSecret ? await sha256Hex(clientSecret) : null,
            clientName: typeof body.client_name === "string" && body.client_name.trim()
                ? body.client_name.slice(0, 200)
                : "Unnamed MCP client",
            redirectUris,
            grantTypes,
            scope,
            tokenEndpointAuthMethod: isPublic ? "none" : "client_secret_post"
        });

        logger.info("[oauth] Registered MCP client", { clientId, redirectUris });

        return c.json({
            client_id: clientId,
            // Returned exactly once, here. Nothing stores it in the clear, so
            // this response is the client's only chance to keep it.
            ...(clientSecret ? { client_secret: clientSecret } : {}),
            client_id_issued_at: Math.floor(Date.now() / 1000),
            // 0 means "does not expire", per RFC 7591 §3.2.1.
            ...(clientSecret ? { client_secret_expires_at: 0 } : {}),
            redirect_uris: redirectUris,
            grant_types: grantTypes,
            response_types: ["code"],
            token_endpoint_auth_method: isPublic ? "none" : "client_secret_post",
            scope
        }, 201);
    });

    /* ── Authorization endpoint ───────────────────────────────────── */

    router.get("/authorize", authorizeLimiter, async (c) => {
        const q = c.req.query();

        const clientId = q.client_id;
        if (!clientId) return authorizeInputError(c, "invalid_request", "client_id is required.");

        const client = await store.getClient(clientId);
        if (!client) return authorizeInputError(c, "invalid_client", "Unknown client_id.");

        const redirectUri = q.redirect_uri;
        if (!redirectUri) return authorizeInputError(c, "invalid_request", "redirect_uri is required.");

        // Everything above this line renders an error PAGE; everything below it
        // redirects the error to the client. The split is OAuth 2.1 §4.1.2.1 and
        // it is a security rule, not a style: a bad `client_id` or a
        // `redirect_uri` that does not match a registration must NOT be
        // redirected to, or the endpoint becomes the open redirector the
        // registration check exists to prevent.
        if (!redirectUriAllowed(redirectUri, client.redirectUris)) {
            return authorizeInputError(c, "invalid_request",
                "redirect_uri does not match a registered redirect URI for this client.");
        }

        const state = q.state;
        const fail = (error: string, description: string) =>
            c.redirect(errorRedirect(redirectUri, error, description, state, issuer), 302);

        if (q.response_type !== "code") {
            return fail("unsupported_response_type", "Only the authorization code flow is supported.");
        }

        // PKCE is mandatory. OAuth 2.1 requires it for every client, and this
        // server has no flow that works without it — there is no fallback to
        // fall back to.
        const codeChallenge = q.code_challenge;
        if (!codeChallenge) {
            return fail("invalid_request", "code_challenge is required (PKCE).");
        }
        const codeChallengeMethod = q.code_challenge_method ?? "plain";
        if (codeChallengeMethod !== "S256") {
            return fail("invalid_request", "code_challenge_method must be S256.");
        }

        // RFC 8707. The MCP specification makes this MUST for clients, so a
        // missing `resource` is a client that will mis-handle the token later;
        // defaulting it would paper over that. A resource naming someone else's
        // server is refused outright — that is the audience boundary.
        const resource = q.resource;
        if (!resource) {
            return fail("invalid_request", "resource is required (RFC 8707).");
        }
        if (!resourceMatches(resource, canonicalResource)) {
            return fail("invalid_target", `resource must identify ${canonicalResource}.`);
        }

        const scope = narrowScope(q.scope);

        const requestToken = await signPurposeToken(
            "mcp-authorize-request",
            {
                clientId,
                redirectUri,
                codeChallenge,
                codeChallengeMethod,
                scope,
                resource: canonicalResource,
                ...(state ? { state } : {})
            },
            AUTHORIZE_REQUEST_TTL_SECONDS
        );

        return c.html(renderConsentPage({
            clientName: client.clientName,
            scope,
            scopeDescriptions: describeScopes(scope),
            requestToken,
            loginUrl: `${config.authBasePath}/login`,
            decisionUrl: `${c.req.path}/decision`,
            resource: canonicalResource
        }));
    });

    /**
     * What the consent page posts once the person has signed in and pressed
     * Allow. Mints the authorization code and sends it home.
     */
    router.post("/authorize/decision", authorizeLimiter, async (c) => {
        const form = await c.req.parseBody();
        const requestToken = String(form.request_token ?? "");
        const sessionToken = String(form.session_token ?? "");
        const approved = String(form.decision ?? "") === "allow";

        const request = await verifyPurposeToken<AuthorizeRequestClaims>("mcp-authorize-request", requestToken);
        if (!request) {
            // The signed request is the only thing that makes this endpoint
            // safe. Without a valid one there is nothing to redirect to that we
            // are willing to trust, so this is a page and not a redirect.
            return c.html(
                "<h1>This authorization request has expired</h1><p>Start again from the application that sent you here.</p>",
                400
            );
        }

        if (!approved) {
            return c.redirect(
                errorRedirect(request.redirectUri, "access_denied", "The user declined.", request.state, issuer),
                302
            );
        }

        // Who is consenting is decided HERE, by the same verifier `/api/data`
        // uses, and never by a form field naming a user.
        const session = await verifyAccessToken(sessionToken);
        if (!session) {
            return c.redirect(
                errorRedirect(request.redirectUri, "access_denied", "Not signed in.", request.state, issuer),
                302
            );
        }

        const code = randomHex(32);
        await store.saveAuthorizationCode(code, {
            clientId: request.clientId,
            uid: session.uid,
            roles: session.roles ?? [],
            redirectUri: request.redirectUri,
            codeChallenge: request.codeChallenge,
            codeChallengeMethod: request.codeChallengeMethod,
            scope: request.scope,
            resource: request.resource
        }, new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS));

        await store.recordConsent(session.uid, request.clientId, request.scope);

        const target = new URL(request.redirectUri);
        target.searchParams.set("code", code);
        if (request.state) target.searchParams.set("state", request.state);
        // RFC 9207. The metadata advertises support, which obliges us to emit it
        // on every authorization response — a client that sees the advertisement
        // and no `iss` MUST reject the response.
        target.searchParams.set("iss", issuer);

        logger.info("[oauth] Authorization code issued", {
            clientId: request.clientId,
            uid: session.uid,
            scope: request.scope
        });

        return c.redirect(target.toString(), 302);
    });

    /* ── Token endpoint ───────────────────────────────────────────── */

    router.post("/token", tokenLimiter, async (c) => {
        const form = await c.req.parseBody();
        const grantType = String(form.grant_type ?? "");

        const clientId = String(form.client_id ?? "") || basicAuthClientId(c.req.header("authorization"));
        if (!clientId) {
            return c.json({ error: "invalid_client", error_description: "client_id is required." }, 401);
        }

        const client = await store.getClient(clientId);
        if (!client) {
            return c.json({ error: "invalid_client", error_description: "Unknown client." }, 401);
        }

        // A confidential client must prove it is itself. A public one registered
        // with `none` has no secret to prove anything with, which is exactly why
        // PKCE is mandatory above.
        if (client.clientSecretHash) {
            const presented = String(form.client_secret ?? "") || basicAuthSecret(c.req.header("authorization"));
            if (!presented || !constantTimeEqual(await sha256Hex(presented), client.clientSecretHash)) {
                return c.json({ error: "invalid_client", error_description: "Client authentication failed." }, 401);
            }
        }

        if (grantType === "authorization_code") {
            return handleAuthorizationCodeGrant(c, form, client);
        }
        if (grantType === "refresh_token") {
            return handleRefreshGrant(c, form, client);
        }
        return c.json({
            error: "unsupported_grant_type",
            error_description: "Supported grants: authorization_code, refresh_token."
        }, 400);
    });

    async function handleAuthorizationCodeGrant(
        c: Context<HonoEnv>,
        form: Record<string, unknown>,
        client: { clientId: string }
    ) {
        const code = String(form.code ?? "");
        if (!code) return c.json({ error: "invalid_request", error_description: "code is required." }, 400);

        // Redemption and invalidation are the same statement in the store, so a
        // code raced by two exchanges is granted at most once.
        const record = await store.consumeAuthorizationCode(code);
        if (!record) {
            return c.json({ error: "invalid_grant", error_description: "Code is invalid, expired or already used." }, 400);
        }

        // The code was minted for ONE client. Without this, a second registered
        // client — trivial to obtain, registration is open — could redeem a code
        // intercepted from the first.
        if (record.clientId !== client.clientId) {
            logger.error("[oauth] Code redeemed by the wrong client", {
                mintedFor: record.clientId, presentedBy: client.clientId
            });
            return c.json({ error: "invalid_grant", error_description: "Code was not issued to this client." }, 400);
        }

        // RFC 6749 §4.1.3: the redirect_uri must be identical to the one in the
        // authorization request.
        const redirectUri = String(form.redirect_uri ?? "");
        if (redirectUri !== record.redirectUri) {
            return c.json({ error: "invalid_grant", error_description: "redirect_uri does not match the authorization request." }, 400);
        }

        const verifier = String(form.code_verifier ?? "");
        if (!await verifyPkce(verifier, record.codeChallenge, record.codeChallengeMethod)) {
            return c.json({ error: "invalid_grant", error_description: "PKCE verification failed." }, 400);
        }

        // A `resource` sent at token time must agree with the one the code was
        // minted for. RFC 8707 allows narrowing here; allowing a *change* would
        // let a client swap the audience after consent was given.
        const requestedResource = form.resource ? String(form.resource) : record.resource;
        if (!resourceMatches(requestedResource, record.resource)) {
            return c.json({ error: "invalid_target", error_description: "resource does not match the authorization request." }, 400);
        }

        return issueTokens(c, {
            clientId: record.clientId,
            uid: record.uid,
            roles: record.roles,
            scope: record.scope,
            resource: record.resource,
            family: randomHex(16)
        });
    }

    async function handleRefreshGrant(
        c: Context<HonoEnv>,
        form: Record<string, unknown>,
        client: { clientId: string }
    ) {
        const presented = String(form.refresh_token ?? "");
        if (!presented) {
            return c.json({ error: "invalid_request", error_description: "refresh_token is required." }, 400);
        }

        // The store handles replay detection: a token used twice revokes its
        // whole family, and this call returns null for the second use.
        const record = await store.consumeRefreshToken(presented);
        if (!record) {
            return c.json({ error: "invalid_grant", error_description: "Refresh token is invalid, expired or revoked." }, 400);
        }
        if (record.clientId !== client.clientId) {
            await store.revokeFamily(record.family);
            return c.json({ error: "invalid_grant", error_description: "Refresh token was not issued to this client." }, 400);
        }

        // A refresh may narrow the scope but never widen it (RFC 6749 §6). The
        // intersection is taken rather than refusing, so a client repeating its
        // original request keeps working.
        const held = new Set(record.scope.split(" ").filter(Boolean));
        let scope = record.scope;
        if (form.scope) {
            const asked = narrowScope(String(form.scope)).split(" ").filter(Boolean);
            const granted = asked.filter(s => held.has(s));
            // An empty intersection must NOT fall back to the held scope. The
            // first version of this line ended `|| record.scope`, which meant a
            // client holding `mcp:write` and asking for `mcp:read` was handed
            // `mcp:write` — a refresh that WIDENS the grant, which is precisely
            // what RFC 6749 §6 forbids. Asking for nothing you hold is a bad
            // request, not a request for everything.
            if (granted.length === 0) {
                return c.json({
                    error: "invalid_scope",
                    error_description: "The requested scope is not a subset of the scope originally granted."
                }, 400);
            }
            scope = granted.join(" ");
        }

        // The roles are the ones recorded when consent was given, carried on the
        // refresh record. Minting with an empty list instead would not be a
        // smaller grant — it is a different identity to the database, and every
        // role-based policy would start returning nothing the moment a client
        // first refreshed. The cost of carrying them is that a role change does
        // not reach an existing grant until the refresh token expires or the
        // user revokes the client; see `RefreshTokenRecord.roles`.
        return issueTokens(c, {
            clientId: record.clientId,
            uid: record.uid,
            roles: record.roles,
            scope,
            resource: record.resource,
            family: record.family
        });
    }

    async function issueTokens(
        c: Context<HonoEnv>,
        grant: { clientId: string; uid: string; roles: string[]; scope: string; resource: string; family: string }
    ) {
        const accessToken = await generateMcpAccessToken({
            uid: grant.uid,
            roles: grant.roles,
            scope: grant.scope,
            clientId: grant.clientId,
            aud: grant.resource,
            iss: issuer
        }, ACCESS_TOKEN_TTL_SECONDS);

        const refreshToken = randomHex(32);
        await store.saveRefreshToken(refreshToken, {
            clientId: grant.clientId,
            uid: grant.uid,
            roles: grant.roles,
            scope: grant.scope,
            resource: grant.resource,
            family: grant.family
        }, new Date(Date.now() + REFRESH_TOKEN_TTL_MS));

        // `no-store` is RFC 6749 §5.1 and it is not boilerplate: this body is a
        // bearer credential, and a proxy that caches it hands it to the next
        // caller.
        c.header("Cache-Control", "no-store");
        c.header("Pragma", "no-cache");

        return c.json({
            access_token: accessToken,
            token_type: "Bearer",
            expires_in: ACCESS_TOKEN_TTL_SECONDS,
            refresh_token: refreshToken,
            scope: grant.scope
        });
    }

    /* ── Connected applications, for the person who connected them ── */

    /**
     * Who is asking, from an ORDINARY session token.
     *
     * Deliberately not an MCP token. These endpoints are how a person governs
     * the applications they have authorized, and letting one of those
     * applications present its own token here would let it enumerate the
     * others — or revoke them. A grant to read your data is not a grant to
     * manage your grants.
     */
    async function sessionUser(c: Context<HonoEnv>): Promise<{ uid: string } | null> {
        const header = c.req.header("authorization") ?? "";
        if (!header.toLowerCase().startsWith("bearer ")) return null;
        // `verifyAccessToken` refuses any purpose-scoped token, so an MCP access
        // token fails here by construction rather than by a check that could be
        // forgotten.
        const session = await verifyAccessToken(header.slice(7).trim());
        return session ? { uid: session.uid } : null;
    }

    router.get("/grants", async (c) => {
        const user = await sessionUser(c);
        if (!user) {
            return c.json({ error: "unauthorized", error_description: "Sign in to see connected applications." }, 401);
        }
        return c.json({ grants: await store.listGrants(user.uid) });
    });

    router.delete("/grants/:clientId", async (c) => {
        const user = await sessionUser(c);
        if (!user) {
            return c.json({ error: "unauthorized", error_description: "Sign in to disconnect an application." }, 401);
        }

        // Scoped to the caller's own uid in the STORE query, not filtered here.
        // A revoke that took a uid from anywhere but the verified session would
        // let one user disconnect another's applications.
        const revoked = await store.revokeGrant(user.uid, c.req.param("clientId"));
        if (!revoked) {
            return c.json({ error: "not_found", error_description: "You have not connected that application." }, 404);
        }

        return c.json({
            revoked: true,
            // Said plainly rather than implied. Access tokens are self-contained
            // JWTs checked without a database round trip — that is what makes
            // `/mcp` cheap — so an already-issued one keeps working until it
            // expires. Claiming an instant cut-off would be the same class of
            // promise as the consent screen's vanished revocation line.
            note: "Refresh tokens are revoked immediately. An access token already issued keeps working until it expires, at most one hour."
        });
    });

    /**
     * RFC 7009 token revocation, for a client retiring its own credential.
     *
     * Separate from `/grants` above and answering a different question: this is
     * a client saying "I am done with this token", where that one is a person
     * saying "I am done with this application". A client cannot revoke another
     * client's token — the family it names has to belong to it — and the
     * response is 200 either way, which RFC 7009 §2.2 requires: an error would
     * turn this endpoint into an oracle for which tokens exist.
     */
    router.post("/revoke", tokenLimiter, async (c) => {
        const form = await c.req.parseBody();
        const clientId = String(form.client_id ?? "") || basicAuthClientId(c.req.header("authorization"));
        const token = String(form.token ?? "");

        if (clientId && token) {
            const client = await store.getClient(clientId);
            if (client) {
                if (client.clientSecretHash) {
                    const presented = String(form.client_secret ?? "") || basicAuthSecret(c.req.header("authorization"));
                    if (!presented || !constantTimeEqual(await sha256Hex(presented), client.clientSecretHash)) {
                        return c.json({ error: "invalid_client" }, 401);
                    }
                }
                // Reads before it writes, and writes only on a match — see
                // `revokeTokenForClient`. Consuming first would let anyone who
                // learned a token string destroy the grant it belongs to.
                await store.revokeTokenForClient(token, clientId);
            }
        }

        // 200 regardless — including for a token that was never valid.
        return c.body(null, 200);
    });

    return router;
}

/* ── helpers ──────────────────────────────────────────────────────── */

/**
 * Why a redirect URI cannot be registered, or null if it can.
 *
 * Refusing at registration is cheaper than refusing at authorize time, and it
 * means a stored row is never itself the hazard.
 */
export function redirectUriProblem(uri: string): string | null {
    let url: URL;
    try {
        url = new URL(uri);
    } catch {
        return "not an absolute URI";
    }
    if (url.hash) return "must not contain a fragment";
    // `javascript:`, `data:` and friends turn a redirect into script execution
    // in whatever context follows it.
    if (url.protocol === "https:") return null;
    if (url.protocol === "http:") {
        // Plaintext is permitted only for the loopback address a native client
        // has to use (RFC 8252 §7.3). Anywhere else it puts the authorization
        // code on the wire in the clear.
        return (url.hostname === "127.0.0.1" || url.hostname === "[::1]" || url.hostname === "::1")
            ? null
            : "http is only allowed for loopback redirects";
    }
    // A private-use scheme (`com.example.app:/cb`) is how a mobile client
    // receives a redirect, and RFC 8252 §7.1 endorses it. It must be a reverse
    // domain name, which excludes `javascript:` and `data:`.
    if (/^[a-z][a-z0-9+.-]*:$/.test(url.protocol) && url.protocol.includes(".")) return null;
    return `scheme ${url.protocol} is not allowed`;
}

/** Build the error redirect an authorization failure sends to the client. */
function errorRedirect(
    redirectUri: string,
    error: string,
    description: string,
    state: string | undefined,
    issuer: string
): string {
    const url = new URL(redirectUri);
    url.searchParams.set("error", error);
    url.searchParams.set("error_description", description);
    if (state) url.searchParams.set("state", state);
    // RFC 9207 §2: the `iss` goes on error responses too. A client that only
    // validated it on success would accept a forged failure from anywhere.
    url.searchParams.set("iss", issuer);
    return url.toString();
}

/** An error we must NOT redirect: render it instead. */
function authorizeInputError(
    c: Context<HonoEnv>,
    error: string,
    description: string
): Response {
    return c.html(
        `<!doctype html><meta charset="utf-8"><title>Authorization error</title>` +
        `<h1>${escapeHtml(error)}</h1><p>${escapeHtml(description)}</p>` +
        `<p>This request was not redirected back to the application, because the details it sent could not be trusted.</p>`,
        400
    );
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Human-readable consent lines, one per granted scope. */
export function describeScopes(scope: string): { scope: string; description: string }[] {
    const text: Record<string, string> = {
        "mcp:read": "Read data you already have access to",
        "mcp:write": "Create, change and delete data you already have access to"
    };
    return scope
        .split(" ")
        .filter(s => (MCP_SCOPES as readonly string[]).includes(s))
        .map(s => ({ scope: s, description: text[s] }));
}

function decodeBasic(header: string | undefined): { id: string; secret: string } | null {
    if (!header?.startsWith("Basic ")) return null;
    try {
        const decoded = atob(header.slice(6));
        const at = decoded.indexOf(":");
        if (at < 0) return null;
        // RFC 6749 §2.3.1 form-encodes both halves before base64.
        return {
            id: decodeURIComponent(decoded.slice(0, at)),
            secret: decodeURIComponent(decoded.slice(at + 1))
        };
    } catch {
        return null;
    }
}

function basicAuthClientId(header: string | undefined): string {
    return decodeBasic(header)?.id ?? "";
}

function basicAuthSecret(header: string | undefined): string {
    return decodeBasic(header)?.secret ?? "";
}
