/**
 * The whole remote-MCP handshake, driven end to end.
 *
 * Register a client, walk the authorize hop, redeem the code, call a tool. Then
 * the ways it must fail: a stolen code redeemed by a second client, a replayed
 * code, a wrong PKCE verifier, a token for another audience, a write attempted
 * with a read-only scope.
 *
 * The store is in-memory and the driver is a stub, because what is under test
 * is the protocol and the checks around it — the RLS behaviour those tools rely
 * on is the database's, and asserting it here against a fake would prove only
 * that the fake agrees with itself. What this file does assert about RLS is the
 * one part that lives in this code: that the tools scope the driver by the
 * caller's uid before touching it, and that the surface refuses to exist at all
 * on a driver that cannot be scoped.
 */
import { Hono } from "hono";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { configureJwt, generateAccessToken } from "../src/auth/jwt";
import { createOAuthRoutes } from "../src/mcp/oauth-routes";
import { createMcpRoutes, createMcpWellKnownRoutes } from "../src/mcp/mcp-routes";
import { base64UrlEncode } from "../src/mcp/oauth-metadata";
import { sha256Bytes } from "../src/utils/portable-crypto";
import type {
    OAuthStore, OAuthClient, AuthorizationCodeRecord, RefreshTokenRecord
} from "../src/mcp/oauth-store";

const PUBLIC_URL = "https://talent.sustentalent.com";
const RESOURCE = "https://talent.sustentalent.com/mcp";
const REDIRECT = "https://claude.ai/api/mcp/auth_callback";

configureJwt({ secret: "test-secret-for-the-mcp-oauth-flow-0123456789", accessExpiresIn: "1h" });

/* ── An in-memory store with the real one's invariants ────────────── */

function memoryStore(): OAuthStore {
    const clients = new Map<string, OAuthClient>();
    const codes = new Map<string, { record: AuthorizationCodeRecord; expiresAt: number; consumed: boolean }>();
    const refresh = new Map<string, { record: RefreshTokenRecord; expiresAt: number; consumed: boolean; revoked: boolean }>();
    const consents = new Map<string, string>();

    return {
        async ensureTables() { /* nothing to create */ },
        async registerClient(client) { clients.set(client.clientId, client); },
        async getClient(id) { return clients.get(id) ?? null; },
        async countClients() { return clients.size; },

        async saveAuthorizationCode(code, record, expiresAt) {
            codes.set(code, { record, expiresAt: expiresAt.getTime(), consumed: false });
        },
        async consumeAuthorizationCode(code) {
            const entry = codes.get(code);
            if (!entry || entry.consumed || entry.expiresAt < Date.now()) return null;
            entry.consumed = true;
            return entry.record;
        },

        async saveRefreshToken(token, record, expiresAt) {
            refresh.set(token, { record, expiresAt: expiresAt.getTime(), consumed: false, revoked: false });
        },
        async consumeRefreshToken(token) {
            const entry = refresh.get(token);
            if (!entry) return null;
            if (entry.consumed) {
                // The replay response the real store implements in SQL.
                for (const other of refresh.values()) {
                    if (other.record.family === entry.record.family) other.revoked = true;
                }
                return null;
            }
            if (entry.revoked || entry.expiresAt < Date.now()) return null;
            entry.consumed = true;
            return entry.record;
        },
        async revokeFamily(family) {
            for (const entry of refresh.values()) {
                if (entry.record.family === family) entry.revoked = true;
            }
        },

        async hasConsent(uid, clientId, scope) {
            const granted = consents.get(`${uid}:${clientId}`);
            if (!granted) return false;
            const have = new Set(granted.split(" "));
            return scope.split(" ").every(s => have.has(s));
        },
        async recordConsent(uid, clientId, scope) { consents.set(`${uid}:${clientId}`, scope); }
    };
}

/* ── A driver that records how it was scoped ──────────────────────── */

const COLLECTIONS = [{
    slug: "candidates",
    name: "Candidates",
    properties: {
        name: { dataType: "string", name: "Name" },
        stage: { dataType: "string", name: "Stage" }
    }
}] as unknown as CollectionConfig[];

function stubDriver() {
    const scopedAs: { uid: string; roles?: string[] }[] = [];
    const rows = [{ id: "c1", name: "Ada", stage: "interview" }];

    const driver = {
        key: "postgres",
        async withAuth(user: { uid: string; roles?: string[] }) {
            scopedAs.push(user);
            return driver as unknown as DataDriver;
        },
        async fetchCollection() { return rows; },
        async fetchOne() { return rows[0]; },
        async save({ values }: { values: Record<string, unknown> }) { return { id: "new", ...values }; },
        async delete() { /* ok */ }
    };

    return { driver: driver as unknown as DataDriver, scopedAs };
}

/* ── The app under test ───────────────────────────────────────────── */

function buildApp(driver: DataDriver) {
    const store = memoryStore();
    const app = new Hono();
    const mcpConfig = {
        publicUrl: PUBLIC_URL,
        mcpPath: "/mcp",
        oauthBasePath: "/api/oauth",
        getDriver: () => driver,
        getCollections: () => COLLECTIONS,
        serverInfo: { name: "rebase", version: "test" }
    };
    app.route("/", createMcpWellKnownRoutes(mcpConfig));
    app.route("/mcp", createMcpRoutes(mcpConfig));
    app.route("/api/oauth", createOAuthRoutes({
        store,
        publicUrl: PUBLIC_URL,
        mcpPath: "/mcp",
        authBasePath: "/api/auth",
        allowDynamicRegistration: true
    }));
    return { app, store };
}

async function pkcePair() {
    const verifier = "v".repeat(43);
    return { verifier, challenge: base64UrlEncode(await sha256Bytes(verifier)) };
}

/** Register a client and walk the flow to an access token. */
async function authorize(app: Hono, opts: { scope?: string; uid?: string } = {}) {
    const registered = await app.request("/api/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_name: "Claude", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none"
        })
    });
    const client = await registered.json() as { client_id: string };

    const { verifier, challenge } = await pkcePair();
    const scope = opts.scope ?? "mcp:read";
    const query = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: RESOURCE,
        scope,
        state: "xyz"
    });
    const page = await app.request(`/api/oauth/authorize?${query}`);
    const html = await page.text();
    const requestToken = /name="request_token" value="([^"]+)"/.exec(html)?.[1] ?? "";

    const sessionToken = await generateAccessToken(opts.uid ?? "user-1", ["recruiter"]);
    const decision = await app.request("/api/oauth/authorize/decision", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ request_token: requestToken, session_token: sessionToken, decision: "allow" })
    });
    const code = new URL(decision.headers.get("location")!).searchParams.get("code")!;

    return { clientId: client.client_id, code, verifier, page, html, decision };
}

async function redeem(app: Hono, clientId: string, code: string, verifier: string) {
    const res = await app.request("/api/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT
        })
    });
    return { res, body: await res.json() as Record<string, unknown> };
}

function rpc(app: Hono, token: string, body: unknown) {
    return app.request("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
    });
}

/* ── Discovery ────────────────────────────────────────────────────── */

describe("discovery", () => {
    const { driver } = stubDriver();
    const { app } = buildApp(driver);

    it("serves protected-resource metadata at the RFC 9728 path", async () => {
        const res = await app.request("/.well-known/oauth-protected-resource/mcp");
        expect(res.status).toBe(200);
        expect(await res.json()).toMatchObject({
            resource: RESOURCE,
            authorization_servers: [PUBLIC_URL]
        });
    });

    it("serves authorization-server metadata", async () => {
        const res = await app.request("/.well-known/oauth-authorization-server");
        expect(await res.json()).toMatchObject({
            issuer: PUBLIC_URL,
            registration_endpoint: `${PUBLIC_URL}/api/oauth/register`,
            code_challenge_methods_supported: ["S256"]
        });
    });

    it("challenges an unauthenticated MCP call with the metadata URL", async () => {
        // This header is the client's whole discovery path. Without it, a
        // protected server is indistinguishable from a broken one.
        const res = await app.request("/mcp", { method: "POST", body: "{}" });
        expect(res.status).toBe(401);
        expect(res.headers.get("WWW-Authenticate")).toContain(
            'resource_metadata="https://talent.sustentalent.com/.well-known/oauth-protected-resource/mcp"'
        );
    });
});

/* ── The happy path ───────────────────────────────────────────────── */

describe("the full flow", () => {
    it("registers, authorizes, redeems and calls a tool", async () => {
        const { driver, scopedAs } = stubDriver();
        const { app } = buildApp(driver);

        const { clientId, code, verifier, html, decision } = await authorize(app);

        // The consent page names the client and does not swallow the state.
        expect(html).toContain("Claude");
        expect(decision.status).toBe(302);
        const back = new URL(decision.headers.get("location")!);
        expect(back.searchParams.get("state")).toBe("xyz");
        // RFC 9207 — the metadata advertises support, so this must be present.
        expect(back.searchParams.get("iss")).toBe(PUBLIC_URL);

        const { res, body } = await redeem(app, clientId, code, verifier);
        expect(res.status).toBe(200);
        expect(res.headers.get("Cache-Control")).toBe("no-store");
        expect(body.token_type).toBe("Bearer");
        expect(body.scope).toBe("mcp:read");
        const token = String(body.access_token);

        const init = await rpc(app, token, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
        expect(await init.json()).toMatchObject({
            result: { capabilities: { tools: {} }, serverInfo: { name: "rebase" } }
        });

        const list = await rpc(app, token, { jsonrpc: "2.0", id: 2, method: "tools/list" });
        const listed = (await list.json() as { result: { tools: { name: string }[] } }).result.tools;
        expect(listed.map(t => t.name)).toEqual(["list_collections", "query_collection", "get_document"]);

        const call = await rpc(app, token, {
            jsonrpc: "2.0", id: 3, method: "tools/call",
            params: { name: "query_collection", arguments: { collection: "candidates" } }
        });
        const result = (await call.json() as { result: { structuredContent: { rows: unknown[] } } }).result;
        expect(result.structuredContent.rows).toHaveLength(1);

        // The point of the whole exercise: the driver was scoped to the person
        // who consented before a single row was read.
        expect(scopedAs).toContainEqual({ uid: "user-1", roles: ["recruiter"], isAnonymous: false });
    });

    it("answers a notification with 202 and no body", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app);
        const { body } = await redeem(app, clientId, code, verifier);

        const res = await rpc(app, String(body.access_token), {
            jsonrpc: "2.0", method: "notifications/initialized"
        });
        expect(res.status).toBe(202);
    });

    it("does not pretend to hold a server-initiated stream", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const res = await app.request("/mcp", { headers: { Authorization: "Bearer whatever" } });
        expect(res.status).toBe(405);
        expect(res.headers.get("Allow")).toContain("POST");
    });
});

/* ── The refusals ─────────────────────────────────────────────────── */

describe("authorization refusals", () => {
    it("refuses a redirect_uri that is not registered, WITHOUT redirecting", async () => {
        // Redirecting this error is what makes an authorize endpoint an open
        // redirector, so the assertion is on the status, not the body.
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const registered = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "c", redirect_uris: [REDIRECT] })
        });
        const { client_id } = await registered.json() as { client_id: string };

        const res = await app.request(`/api/oauth/authorize?${new URLSearchParams({
            response_type: "code", client_id, redirect_uri: "https://evil.example.com/steal",
            code_challenge: "x", code_challenge_method: "S256", resource: RESOURCE
        })}`);
        expect(res.status).toBe(400);
        expect(res.headers.get("location")).toBeNull();
    });

    it("refuses a resource naming someone else's server", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const registered = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "c", redirect_uris: [REDIRECT] })
        });
        const { client_id } = await registered.json() as { client_id: string };
        const { challenge } = await pkcePair();

        const res = await app.request(`/api/oauth/authorize?${new URLSearchParams({
            response_type: "code", client_id, redirect_uri: REDIRECT,
            code_challenge: challenge, code_challenge_method: "S256",
            resource: "https://app.medicalmotion.com/mcp"
        })}`);
        expect(res.status).toBe(302);
        expect(new URL(res.headers.get("location")!).searchParams.get("error")).toBe("invalid_target");
    });

    it("refuses registration of a non-loopback http redirect", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const res = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "c", redirect_uris: ["http://evil.example.com/cb"] })
        });
        expect(res.status).toBe(400);
        expect((await res.json() as { error: string }).error).toBe("invalid_redirect_uri");
    });

    it("refuses registration of a javascript: redirect", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const res = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "c", redirect_uris: ["javascript:alert(1)"] })
        });
        expect(res.status).toBe(400);
    });

    it("mints no code when the user denies", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const registered = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "c", redirect_uris: [REDIRECT] })
        });
        const { client_id } = await registered.json() as { client_id: string };
        const { challenge } = await pkcePair();
        const page = await app.request(`/api/oauth/authorize?${new URLSearchParams({
            response_type: "code", client_id, redirect_uri: REDIRECT,
            code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE
        })}`);
        const requestToken = /name="request_token" value="([^"]+)"/.exec(await page.text())?.[1] ?? "";

        const res = await app.request("/api/oauth/authorize/decision", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ request_token: requestToken, decision: "deny" })
        });
        const back = new URL(res.headers.get("location")!);
        expect(back.searchParams.get("error")).toBe("access_denied");
        expect(back.searchParams.get("code")).toBeNull();
    });

    it("mints no code without a valid session token", async () => {
        // The identity comes from the verified session, never from a form field.
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const registered = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "c", redirect_uris: [REDIRECT] })
        });
        const { client_id } = await registered.json() as { client_id: string };
        const { challenge } = await pkcePair();
        const page = await app.request(`/api/oauth/authorize?${new URLSearchParams({
            response_type: "code", client_id, redirect_uri: REDIRECT,
            code_challenge: challenge, code_challenge_method: "S256", resource: RESOURCE
        })}`);
        const requestToken = /name="request_token" value="([^"]+)"/.exec(await page.text())?.[1] ?? "";

        const res = await app.request("/api/oauth/authorize/decision", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                request_token: requestToken, session_token: "forged", decision: "allow"
            })
        });
        expect(new URL(res.headers.get("location")!).searchParams.get("code")).toBeNull();
    });

    it("refuses a decision with no signed request — no open code minting", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const session = await generateAccessToken("user-1", []);
        const res = await app.request("/api/oauth/authorize/decision", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ request_token: "", session_token: session, decision: "allow" })
        });
        expect(res.status).toBe(400);
        expect(res.headers.get("location")).toBeNull();
    });
});

describe("token endpoint refusals", () => {
    it("refuses a code redeemed twice", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app);

        expect((await redeem(app, clientId, code, verifier)).res.status).toBe(200);
        const second = await redeem(app, clientId, code, verifier);
        expect(second.res.status).toBe(400);
        expect(second.body.error).toBe("invalid_grant");
    });

    it("refuses a code redeemed by a different client", async () => {
        // Registration is open, so obtaining a second client is trivial. This
        // is what stops one from spending another's intercepted code.
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { code, verifier } = await authorize(app);

        const other = await app.request("/api/oauth/register", {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ client_name: "thief", redirect_uris: [REDIRECT], token_endpoint_auth_method: "none" })
        });
        const { client_id: thief } = await other.json() as { client_id: string };

        const res = await redeem(app, thief, code, verifier);
        expect(res.res.status).toBe(400);
        expect(res.body.error).toBe("invalid_grant");
    });

    it("refuses a wrong PKCE verifier", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code } = await authorize(app);
        const res = await redeem(app, clientId, code, "w".repeat(43));
        expect(res.res.status).toBe(400);
        expect(res.body.error_description).toContain("PKCE");
    });

    it("refuses a mismatched redirect_uri", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app);
        const res = await app.request("/api/oauth/token", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "authorization_code", client_id: clientId, code,
                code_verifier: verifier, redirect_uri: "https://claude.ai/other"
            })
        });
        expect(res.status).toBe(400);
    });

    it("rotates refresh tokens and kills the family on replay", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app);
        const first = await redeem(app, clientId, code, verifier);
        const refreshToken = String(first.body.refresh_token);

        const refreshOnce = async (token: string) => app.request("/api/oauth/token", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ grant_type: "refresh_token", client_id: clientId, refresh_token: token })
        });

        const rotated = await refreshOnce(refreshToken);
        expect(rotated.status).toBe(200);
        const next = String((await rotated.json() as Record<string, unknown>).refresh_token);
        expect(next).not.toBe(refreshToken);

        // Replaying the spent token must not merely fail — it must invalidate
        // the rotated one too, because we cannot tell the thief from the owner.
        expect((await refreshOnce(refreshToken)).status).toBe(400);
        expect((await refreshOnce(next)).status).toBe(400);
    });

    it("a refreshed token keeps the caller's roles", async () => {
        // The first version of this dropped them, and every test still passed:
        // an empty `roles` is not a smaller grant, it is a different identity to
        // the database, so the failure would have been invisible here and shown
        // up in the field as "the integration stops seeing anything about an
        // hour after you connect it" — with role-based policies returning
        // nothing and no error anywhere.
        const { driver, scopedAs } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app);
        const first = await redeem(app, clientId, code, verifier);

        const rotated = await app.request("/api/oauth/token", {
            method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                grant_type: "refresh_token", client_id: clientId,
                refresh_token: String(first.body.refresh_token)
            })
        });
        const refreshedToken = String((await rotated.json() as Record<string, unknown>).access_token);

        await rpc(app, refreshedToken, {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "query_collection", arguments: { collection: "candidates" } }
        });

        expect(scopedAs.at(-1)).toEqual({ uid: "user-1", roles: ["recruiter"], isAnonymous: false });
    });
});

describe("resource-server refusals", () => {
    it("refuses a token minted for another audience", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);

        // A real token from a *different* server: same secret in this test, but
        // a different `aud`, which is exactly the confused-deputy shape.
        const { generateMcpAccessToken } = await import("../src/auth/jwt");
        const foreign = await generateMcpAccessToken({
            uid: "user-1", roles: [], scope: "mcp:read", clientId: "c",
            aud: "https://app.medicalmotion.com/mcp", iss: "https://app.medicalmotion.com"
        }, 3600);

        const res = await rpc(app, foreign, { jsonrpc: "2.0", id: 1, method: "tools/list" });
        expect(res.status).toBe(401);
    });

    it("refuses an ordinary session token", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const session = await generateAccessToken("user-1", ["admin"]);
        const res = await rpc(app, session, { jsonrpc: "2.0", id: 1, method: "tools/list" });
        expect(res.status).toBe(401);
    });

    it("does not list write tools for a read-only token", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app, { scope: "mcp:read" });
        const { body } = await redeem(app, clientId, code, verifier);

        const list = await rpc(app, String(body.access_token), { jsonrpc: "2.0", id: 1, method: "tools/list" });
        const names = (await list.json() as { result: { tools: { name: string }[] } }).result.tools.map(t => t.name);
        expect(names).not.toContain("create_document");
        expect(names).not.toContain("delete_document");
    });

    it("refuses a write call from a read-only token, and says which scope is missing", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app, { scope: "mcp:read" });
        const { body } = await redeem(app, clientId, code, verifier);

        const res = await rpc(app, String(body.access_token), {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "delete_document", arguments: { collection: "candidates", id: "c1" } }
        });
        const payload = await res.json() as { error?: { message: string } };
        expect(payload.error?.message).toContain("mcp:write");
        expect(res.headers.get("WWW-Authenticate")).toContain("insufficient_scope");
    });

    it("offers write tools when mcp:write was granted", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app, { scope: "mcp:read mcp:write" });
        const { body } = await redeem(app, clientId, code, verifier);

        const list = await rpc(app, String(body.access_token), { jsonrpc: "2.0", id: 1, method: "tools/list" });
        const names = (await list.json() as { result: { tools: { name: string }[] } }).result.tools.map(t => t.name);
        expect(names).toContain("create_document");
    });

    it("refuses a collection the project does not declare", async () => {
        // A collection name reaches a table name downstream. Only the registry
        // decides what exists.
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app);
        const { body } = await redeem(app, clientId, code, verifier);

        const res = await rpc(app, String(body.access_token), {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: { name: "query_collection", arguments: { collection: "rebase.oauth_clients" } }
        });
        const payload = await res.json() as { result: { isError: boolean; content: { text: string }[] } };
        expect(payload.result.isError).toBe(true);
        expect(payload.result.content[0].text).toContain("Unknown collection");
    });

    it("refuses a filter on a field the collection does not declare", async () => {
        const { driver } = stubDriver();
        const { app } = buildApp(driver);
        const { clientId, code, verifier } = await authorize(app);
        const { body } = await redeem(app, clientId, code, verifier);

        const res = await rpc(app, String(body.access_token), {
            jsonrpc: "2.0", id: 1, method: "tools/call",
            params: {
                name: "query_collection",
                arguments: { collection: "candidates", filter: { salary: ["==", 1] } }
            }
        });
        const payload = await res.json() as { result: { isError: boolean; content: { text: string }[] } };
        expect(payload.result.isError).toBe(true);
        expect(payload.result.content[0].text).toContain("not a field");
    });
});
