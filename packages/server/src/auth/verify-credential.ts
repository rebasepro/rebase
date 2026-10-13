/**
 * Verify a bearer credential outside the HTTP middlewares — for a custom
 * socket, a tunnel, anything an app authenticates from a frame or a header it
 * read itself.
 *
 * One answer for the two kinds of credential a person can hold: a session
 * token, and an API key (`rk_`). Both come back as who the caller acts as and
 * what it may do, so the endpoint checks a scope the same way either way.
 *
 * A backend answers for itself — `backend.verifyCredential(token)`, against its
 * own keys, store and access model. {@link verifyCredential} answers for the
 * process default.
 *
 * @module
 */

import { scopesForRoles } from "@rebasepro/types";
import { isApiKeyToken, resolveApiKey } from "./api-keys/api-key-middleware";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import { processAccessControl, type AccessControl } from "./access";
import { processJwtService, type JwtService } from "./jwt";

/** Who a verified credential acts as, and what it may do. */
export interface VerifiedCredential {
    uid: string;
    roles: string[];
    scopes: string[];
    /** `"api-key"` when an `rk_` key was presented, otherwise `"session"`. */
    kind: "session" | "api-key";
}

/** What a credential is checked against: one backend's keys, key store and access model. */
export interface CredentialAuthority {
    jwt: JwtService;
    access: AccessControl;
    apiKeyStore?: ApiKeyStore;
}

/** The process default's key store — the one {@link verifyCredential} checks `rk_` keys against. */
let processApiKeyStore: ApiKeyStore | undefined;

/** Install the key store the process default's {@link verifyCredential} checks `rk_` keys against. */
export function configureCredentialStore(store: ApiKeyStore | undefined): void {
    processApiKeyStore = store;
}

/** @internal The process default's key store, to snapshot or restore it. */
export function defaultCredentialStore(): ApiKeyStore | undefined {
    return processApiKeyStore;
}

/**
 * The identity and scopes behind a bearer credential, checked against one
 * backend, or null when it does not verify — expired, revoked, unknown, or a
 * key on a backend with no key store.
 */
export async function verifyCredentialAgainst(authority: CredentialAuthority, token: string): Promise<VerifiedCredential | null> {
    if (!token) return null;
    if (isApiKeyToken(token)) {
        if (!authority.apiKeyStore) return null;
        const resolved = await resolveApiKey(authority.apiKeyStore, token, authority.access);
        if (!("uid" in resolved)) return null;
        return { uid: resolved.uid, roles: resolved.roles, scopes: resolved.scopes, kind: "api-key" };
    }
    // A backend with no JWT of its own has no session to recognise: "nobody",
    // rather than a throw from a verifier that was never given a secret.
    if (!authority.jwt.isConfigured()) return null;
    const payload = await authority.jwt.verifyAccessToken(token);
    if (!payload?.uid) return null;
    const roles = payload.roles ?? [];
    return { uid: payload.uid, roles, scopes: scopesForRoles(roles, authority.access.model), kind: "session" };
}

/**
 * The identity and scopes behind a bearer credential, as the process default
 * answers — expired, revoked, unknown, or a key on a backend with no key store
 * all come back null. A backend built by `createRebaseBackend` answers for
 * itself: `backend.verifyCredential(token)`.
 */
export async function verifyCredential(token: string): Promise<VerifiedCredential | null> {
    return verifyCredentialAgainst({ jwt: processJwtService, access: processAccessControl, apiKeyStore: processApiKeyStore }, token);
}
