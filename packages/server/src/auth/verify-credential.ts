/**
 * Verify a bearer credential outside the HTTP middlewares — for a custom
 * socket, a tunnel, anything an app authenticates from a frame or a header it
 * read itself.
 *
 * One answer for every credential the backend's routes accept: a session
 * token, an API key (`rk_`) and the service key. Each comes back as who the
 * caller acts as and what it may do, so the endpoint checks a scope the same
 * way whichever was presented — and comes back null exactly when the routes
 * would refuse it.
 *
 * A backend answers for itself — `backend.verifyCredential(token)`, against its
 * own keys, store and access model. {@link verifyCredential} answers for the
 * process default.
 *
 * @module
 */

import { scopesForRoles, type AuthAdapter, type AuthenticatedUser } from "@rebasepro/types";
import { isApiKeyToken, resolveApiKey } from "./api-keys/api-key-middleware";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import { processAccessControl, type AccessControl } from "./access";
import { processJwtService, type JwtService } from "./jwt";
import { userFromToken } from "./middleware";
import { SERVICE_IDENTITY } from "./rls-scope";

/** Who a verified credential acts as, and what it may do. */
export interface VerifiedCredential {
    uid: string;
    roles: string[];
    scopes: string[];
    /**
     * `"api-key"` when an `rk_` key was presented, `"service-key"` for the
     * backend's service key, otherwise `"session"`.
     */
    kind: "session" | "api-key" | "service-key";
}

/** What a credential is checked against: one backend's keys, key store, access model and auth. */
export interface CredentialAuthority {
    jwt: JwtService;
    access: AccessControl;
    apiKeyStore?: ApiKeyStore;
    /**
     * How the backend judges a session: its auth adapter, which every door it
     * serves asks. When there is none — a backend with no `auth` — a session
     * is its signature alone, as it is on that backend's routes, which have no
     * account store to ask either.
     */
    authAdapter?: AuthAdapter;
}

/** The process default's key store and auth — what {@link verifyCredential} checks against. */
let processCredentials: Pick<CredentialAuthority, "apiKeyStore" | "authAdapter"> = {};

/**
 * Install what the process default's {@link verifyCredential} checks against:
 * the key store `rk_` keys are found in, and the auth adapter that judges a
 * session.
 */
export function configureCredentials(credentials: Pick<CredentialAuthority, "apiKeyStore" | "authAdapter">): void {
    processCredentials = { apiKeyStore: credentials.apiKeyStore, authAdapter: credentials.authAdapter };
}

/**
 * A session token as an auth adapter judges it: its `verifyToken`, or — for an
 * adapter that verifies requests only — a request carrying nothing but the
 * token as a bearer, which is what the realtime socket asks too.
 */
async function adapterVerdict(adapter: AuthAdapter, token: string): Promise<AuthenticatedUser | null> {
    if (adapter.verifyToken) return adapter.verifyToken(token);
    return adapter.verifyRequest(new Request("http://localhost/", { headers: { Authorization: `Bearer ${token}` } }));
}

/**
 * The identity and scopes behind a bearer credential, checked against one
 * backend — the verdict its routes reach on the same string. Null when they
 * would refuse it: it does not verify, it is expired, its session was
 * revoked, its account is gone or disabled, or it is a key on a backend with
 * no key store. A session's roles are the account's now, read the way the
 * routes read them, not the ones the token claims.
 *
 * Throws when the backend cannot answer — its database is unreachable — with
 * the error its routes answer then (`503 DATABASE_UNAVAILABLE`).
 */
export async function verifyCredentialAgainst(authority: CredentialAuthority, token: string): Promise<VerifiedCredential | null> {
    if (!token) return null;
    // The order the routes take: a key where there is a store to find it in,
    // then the backend's auth. An `rk_` string on a backend with no store is
    // judged as a session, and verifies as nothing.
    if (authority.apiKeyStore && isApiKeyToken(token)) {
        const resolved = await resolveApiKey(authority.apiKeyStore, token, authority.access);
        if (!("uid" in resolved)) return null;
        return { uid: resolved.uid, roles: resolved.roles, scopes: resolved.scopes, kind: "api-key" };
    }
    if (authority.authAdapter) {
        const user = await adapterVerdict(authority.authAdapter, token);
        if (!user) return null;
        return {
            uid: user.uid,
            roles: user.roles,
            scopes: user.scopes ?? scopesForRoles(user.roles, authority.access.model),
            // The built-in adapter verifies the service key as the service
            // identity, which is how every door recognises that credential.
            kind: user.uid === SERVICE_IDENTITY.uid ? "service-key" : "session"
        };
    }
    // A backend with no auth of its own has no account to ask about, and no
    // JWT may mean no session to recognise: "nobody", rather than a throw from
    // a verifier that was never given a secret.
    const payload = await userFromToken(authority.jwt, token);
    if (!payload?.uid) return null;
    const roles = payload.roles ?? [];
    return { uid: payload.uid, roles, scopes: scopesForRoles(roles, authority.access.model), kind: "session" };
}

/**
 * The identity and scopes behind a bearer credential, as the process default
 * answers — the backend `initializeRebaseBackend` or `setDefaultBackend`
 * installed. Null when its routes would refuse it: expired, revoked, an
 * account that is gone or disabled, or a key on a backend with no key store.
 * A backend built by `createRebaseBackend` answers for itself:
 * `backend.verifyCredential(token)`.
 */
export async function verifyCredential(token: string): Promise<VerifiedCredential | null> {
    return verifyCredentialAgainst({ jwt: processJwtService, access: processAccessControl, ...processCredentials }, token);
}
