/**
 * The rig every MCP test drives: an in-memory store, a driver that records how
 * it was scoped, and helpers that walk the OAuth flow.
 *
 * Extracted from `mcp-oauth-flow.test.ts` once a second suite needed it. The
 * in-memory store is a real implementation of `OAuthStore`, not a stub with
 * `jest.fn()` on every method — it enforces the same invariants the SQL one
 * does (single-use codes, refresh rotation, replay killing the family), because
 * a suite driven against a fake that always says yes proves only that the calls
 * were made.
 *
 * It is listed in `tsconfig.tests.json`, which is what keeps it honest: when
 * `OAuthStore` gained `listGrants` and `revokeGrant` this fake went on
 * satisfying an interface it no longer implemented, and 26 tests kept passing
 * against a shape production does not have.
 */
import { Hono } from "hono";
import type { CollectionConfig, DataDriver } from "@rebasepro/types";
import { generateAccessToken } from "../../src/auth/jwt";
import { createOAuthRoutes } from "../../src/mcp/oauth-routes";
import { createMcpRoutes, createMcpWellKnownRoutes } from "../../src/mcp/mcp-routes";
import { base64UrlEncode } from "../../src/mcp/oauth-metadata";
import { sha256Bytes } from "../../src/utils/portable-crypto";
import type {
    OAuthStore, OAuthClient, AuthorizationCodeRecord, RefreshTokenRecord
} from "../../src/mcp/oauth-store";

export const PUBLIC_URL = "https://talent.sustentalent.com";
export const RESOURCE = "https://talent.sustentalent.com/mcp";
export const REDIRECT = "https://claude.ai/api/mcp/auth_callback";
export const JWT_SECRET = "test-secret-for-the-mcp-oauth-flow-0123456789";

export function memoryStore(): OAuthStore {
    const clients = new Map<string, OAuthClient>();
    const codes = new Map<string, { record: AuthorizationCodeRecord; expiresAt: number; consumed: boolean }>();
    const refresh = new Map<string, { record: RefreshTokenRecord; expiresAt: number; consumed: boolean; revoked: boolean }>();
    const consents = new Map<string, { scope: string; grantedAt: string }>();

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

        async revokeTokenForClient(token, clientId) {
            const entry = refresh.get(token);
            // No side effect when it is not this client's token — the whole
            // point of the method.
            if (!entry || entry.record.clientId !== clientId) return false;
            let revoked = false;
            for (const other of refresh.values()) {
                if (other.record.family === entry.record.family && !other.revoked) {
                    other.revoked = true;
                    revoked = true;
                }
            }
            return revoked;
        },

        async recordConsent(uid, clientId, scope) {
            consents.set(`${uid}:${clientId}`, { scope, grantedAt: new Date().toISOString() });
        },

        async listGrants(uid) {
            const out = [];
            for (const [key, consent] of consents) {
                if (!key.startsWith(`${uid}:`)) continue;
                const clientId = key.slice(uid.length + 1);
                let activeTokens = 0;
                for (const entry of refresh.values()) {
                    if (entry.record.uid === uid && entry.record.clientId === clientId
                        && !entry.revoked && !entry.consumed && entry.expiresAt > Date.now()) {
                        activeTokens++;
                    }
                }
                out.push({
                    clientId,
                    clientName: clients.get(clientId)?.clientName ?? "(unknown application)",
                    scope: consent.scope,
                    grantedAt: consent.grantedAt,
                    activeTokens
                });
            }
            return out;
        },

        async revokeGrant(uid, clientId) {
            let touched = false;
            for (const entry of refresh.values()) {
                if (entry.record.uid === uid && entry.record.clientId === clientId && !entry.revoked) {
                    entry.revoked = true;
                    touched = true;
                }
            }
            if (consents.delete(`${uid}:${clientId}`)) touched = true;
            return touched;
        }
    };
}

export const COLLECTIONS = [{
    slug: "candidates",
    name: "Candidates",
    properties: {
        name: { dataType: "string", name: "Name" },
        stage: { dataType: "string", name: "Stage" }
    }
}] as unknown as CollectionConfig[];

/** A driver that records every identity it was scoped to. */
export function stubDriver() {
    const scopedAs: { uid: string; roles?: string[]; isAnonymous?: boolean }[] = [];
    const calls: { method: string; args: unknown }[] = [];
    const rows = [{ id: "c1", name: "Ada", stage: "interview" }];

    const driver = {
        key: "postgres",
        async withAuth(user: { uid: string; roles?: string[]; isAnonymous?: boolean }) {
            scopedAs.push(user);
            return driver as unknown as DataDriver;
        },
        async fetchCollection(args: unknown) { calls.push({ method: "fetchCollection", args }); return rows; },
        async fetchOne(args: unknown) { calls.push({ method: "fetchOne", args }); return rows[0]; },
        async save(args: { values: Record<string, unknown> }) {
            calls.push({ method: "save", args });
            return { id: "new", ...args.values };
        },
        async delete(args: unknown) { calls.push({ method: "delete", args }); }
    };

    return { driver: driver as unknown as DataDriver, scopedAs, calls, rows };
}

/**
 * A driver with NO `withAuth` — a Mongo-shaped one.
 *
 * The MCP surface must refuse to mount on this rather than run every call as
 * the database owner.
 */
export function unscopableDriver(): DataDriver {
    return {
        key: "mongodb",
        async fetchCollection() { return []; },
        async fetchOne() { return undefined; },
        async save() { return {}; },
        async delete() { /* ok */ }
    } as unknown as DataDriver;
}

export interface HarnessOptions {
    allowDynamicRegistration?: boolean;
    driver?: DataDriver;
    collections?: CollectionConfig[];
}

export function buildApp(options: HarnessOptions = {}) {
    const store = memoryStore();
    const driver = options.driver ?? stubDriver().driver;
    const app = new Hono();
    const mcpConfig = {
        publicUrl: PUBLIC_URL,
        mcpPath: "/mcp",
        oauthBasePath: "/api/oauth",
        getDriver: () => driver,
        getCollections: () => options.collections ?? COLLECTIONS,
        serverInfo: { name: "rebase", version: "test" }
    };
    app.route("/", createMcpWellKnownRoutes(mcpConfig));
    app.route("/mcp", createMcpRoutes(mcpConfig));
    app.route("/api/oauth", createOAuthRoutes({
        store,
        publicUrl: PUBLIC_URL,
        mcpPath: "/mcp",
        authBasePath: "/api/auth",
        allowDynamicRegistration: options.allowDynamicRegistration ?? true
    }));
    return { app, store };
}

export async function pkcePair(verifier = "v".repeat(43)) {
    return { verifier, challenge: base64UrlEncode(await sha256Bytes(verifier)) };
}

export async function registerClient(app: Hono, body: Record<string, unknown> = {}) {
    const res = await app.request("/api/oauth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            client_name: "Claude",
            redirect_uris: [REDIRECT],
            token_endpoint_auth_method: "none",
            ...body
        })
    });
    return { res, body: await res.json() as Record<string, unknown> };
}

/** Register a client and walk the flow as far as an authorization code. */
export async function authorize(
    app: Hono,
    opts: { scope?: string; uid?: string; roles?: string[]; clientId?: string; verifier?: string } = {}
) {
    let clientId = opts.clientId;
    if (!clientId) {
        clientId = String((await registerClient(app)).body.client_id);
    }

    const { verifier, challenge } = await pkcePair(opts.verifier);
    const query = new URLSearchParams({
        response_type: "code",
        client_id: clientId,
        redirect_uri: REDIRECT,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: RESOURCE,
        scope: opts.scope ?? "mcp:read",
        state: "xyz"
    });
    const page = await app.request(`/api/oauth/authorize?${query}`);
    const html = await page.text();
    const requestToken = /name="request_token" value="([^"]+)"/.exec(html)?.[1] ?? "";

    const sessionToken = await generateAccessToken(opts.uid ?? "user-1", opts.roles ?? ["recruiter"]);
    const decision = await app.request("/api/oauth/authorize/decision", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ request_token: requestToken, session_token: sessionToken, decision: "allow" })
    });
    const location = decision.headers.get("location");
    const code = location ? new URL(location).searchParams.get("code") ?? "" : "";

    return { clientId, code, verifier, page, html, decision, sessionToken, requestToken };
}

export async function redeem(app: Hono, clientId: string, code: string, verifier: string, extra: Record<string, string> = {}) {
    const res = await app.request("/api/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "authorization_code",
            client_id: clientId, code, code_verifier: verifier, redirect_uri: REDIRECT,
            ...extra
        })
    });
    return { res, body: await res.json() as Record<string, unknown> };
}

export function refreshWith(app: Hono, clientId: string, refreshToken: string, extra: Record<string, string> = {}) {
    return app.request("/api/oauth/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            grant_type: "refresh_token", client_id: clientId, refresh_token: refreshToken, ...extra
        })
    });
}

export function rpc(app: Hono, token: string, body: unknown) {
    return app.request("/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body)
    });
}

/** The full walk: register, authorize, redeem. Returns the access token. */
export async function connectedClient(app: Hono, opts: Parameters<typeof authorize>[1] = {}) {
    const { clientId, code, verifier } = await authorize(app, opts);
    const { body } = await redeem(app, clientId, code, verifier);
    return {
        clientId,
        accessToken: String(body.access_token),
        refreshToken: String(body.refresh_token),
        scope: String(body.scope)
    };
}
