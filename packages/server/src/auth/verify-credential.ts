/**
 * Verify a bearer credential outside the HTTP middlewares — for a custom
 * socket, a tunnel, anything an app authenticates from a frame or a header it
 * read itself.
 *
 * One answer for the two kinds of credential a person can hold: a session
 * token, and an API key (`rk_`). Both come back as who the caller acts as and
 * what it may do, so the endpoint checks a scope the same way either way.
 *
 * @module
 */

import { scopesForRoles } from "@rebasepro/types";
import { extractUserFromToken } from "./middleware";
import { isApiKeyToken, resolveApiKey } from "./api-keys/api-key-middleware";
import type { ApiKeyStore } from "./api-keys/api-key-store";
import { getAccessModel } from "./access";

/** Who a verified credential acts as, and what it may do. */
export interface VerifiedCredential {
    uid: string;
    roles: string[];
    scopes: string[];
    /** `"api-key"` when an `rk_` key was presented, otherwise `"session"`. */
    kind: "session" | "api-key";
}

let apiKeyStore: ApiKeyStore | undefined;

/** Install the key store `verifyCredential` checks `rk_` keys against. Called once at boot. */
export function configureCredentialStore(store: ApiKeyStore | undefined): void {
    apiKeyStore = store;
}

/**
 * The identity and scopes behind a bearer credential, or null when it does
 * not verify — expired, revoked, unknown, or a key on a backend with no key
 * store.
 */
export async function verifyCredential(token: string): Promise<VerifiedCredential | null> {
    if (!token) return null;
    if (isApiKeyToken(token)) {
        if (!apiKeyStore) return null;
        const resolved = await resolveApiKey(apiKeyStore, token);
        if (!("uid" in resolved)) return null;
        return { uid: resolved.uid, roles: resolved.roles, scopes: resolved.scopes, kind: "api-key" };
    }
    const payload = await extractUserFromToken(token);
    if (!payload?.uid) return null;
    const roles = payload.roles ?? [];
    return { uid: payload.uid, roles, scopes: scopesForRoles(roles, getAccessModel()), kind: "session" };
}
