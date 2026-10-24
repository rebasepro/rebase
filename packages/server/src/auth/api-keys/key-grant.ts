/**
 * What a new or changed key may hold, decided against whoever asked for it.
 *
 * One rule for every door that mints a credential: **nothing is minted with
 * more than its minter holds.** A key's scopes must be within the creator's
 * own; a service key's RLS roles must be roles the creator holds, unless the
 * creator is an admin; and `keys:*` never goes on a key at all.
 *
 * @module
 */

import {
    hasAdminRole,
    KEY_MANAGEMENT_SCOPES,
    knownScopes,
    parseScope,
    roleNameProblem,
    scopesBeyond,
    SCOPE_TARGETS,
    isBuiltInScope,
    validateScopes,
    type AccessModel,
    type ScopeTargetKind
} from "@rebasepro/types";
import { ApiError } from "../../api/errors";

/**
 * The targets this backend serves, for refusing a key narrowed to something
 * that does not exist — a typo there is a key that silently reaches nothing.
 * Each list is read when a key is minted, so it reflects what is loaded then.
 */
export interface KeyTargets {
    collections(): readonly string[];
    functions(): readonly string[];
    buckets(): readonly string[];
}

const TARGET_LISTS: Record<ScopeTargetKind, keyof KeyTargets> = {
    collection: "collections",
    bucket: "buckets",
    function: "functions"
};

/** Read a `scopes` body field: a non-empty array of strings, deduplicated. */
export function readScopesField(value: unknown): string[] {
    if (!Array.isArray(value) || value.length === 0 || value.some(entry => typeof entry !== "string")) {
        throw ApiError.badRequest(
            "scopes must be a non-empty array of scope strings, e.g. [\"data:read\", \"data:write:posts\"]",
            "INVALID_INPUT"
        );
    }
    return [...new Set(value.map(entry => entry.trim()))];
}

/**
 * Read a `roles` body field: an array of role names, trimmed, deduplicated,
 * without `service`. A key's roles reach RLS joined by `,` in `app.user_roles`,
 * so a name `roleNameProblem` refuses — `"editor,admin"` — is refused here too.
 */
export function readRolesField(value: unknown): string[] {
    if (!Array.isArray(value) || value.some(entry => typeof entry !== "string" || entry.trim() === "")) {
        throw ApiError.badRequest("roles must be an array of role names", "INVALID_INPUT");
    }
    const trimmed = value.map(entry => String(entry).trim());
    const problems = trimmed.flatMap(name => {
        const problem = roleNameProblem(name);
        return problem ? [`${JSON.stringify(name)} ${problem}`] : [];
    });
    if (problems.length > 0) {
        throw new ApiError(400, "INVALID_ROLE",
            `Not valid role names: ${problems.join("; ")}. A role name is a non-empty string without , { } " \\ or control characters.`,
            { problems });
    }
    // `service` is every service key's identity already; listing it adds nothing.
    return [...new Set(trimmed)].filter(role => role !== "service");
}

/**
 * Refuse scopes that are malformed, unknown, aimed at a target that does not
 * exist, for key management, or beyond what `minterScopes` covers.
 */
export function assertScopesGrantable(
    requested: readonly string[],
    minterScopes: readonly string[],
    model: AccessModel,
    targets?: KeyTargets
): void {
    // `keys:*` are scopes, and no key may hold one, so the list a refusal
    // offers leaves them out: offering them sent the next attempt to
    // KEY_MANAGEMENT_SCOPE.
    const keyManagement: ReadonlySet<string> = new Set(KEY_MANAGEMENT_SCOPES);
    const problems = validateScopes(requested, model);
    if (problems.length > 0) {
        const grantable = knownScopes(model).filter(scope => !keyManagement.has(scope));
        throw new ApiError(400, "INVALID_SCOPES",
            `Not valid scopes: ${problems.map(p => `"${p.scope}" (${p.reason})`).join(", ")}. ` +
            `Valid scopes are ${grantable.join(", ")}; data, storage and function scopes take a ` +
            "target after a second colon, e.g. \"data:read:posts\".",
            { problems, validScopes: grantable });
    }

    const management = requested.filter(entry => keyManagement.has(parseScope(entry)?.scope ?? ""));
    if (management.length > 0) {
        throw new ApiError(400, "KEY_MANAGEMENT_SCOPE",
            `${management.join(", ")} cannot go on a key: a key that manages keys could mint its own successor. ` +
            "Manage keys as a person, or with the service key.",
            { scopes: management });
    }

    if (targets) {
        const unknown: string[] = [];
        for (const entry of requested) {
            const parsed = parseScope(entry);
            if (!parsed?.target || !isBuiltInScope(parsed.scope)) continue;
            const kind = SCOPE_TARGETS[parsed.scope];
            if (!kind) continue;
            if (!targets[TARGET_LISTS[kind]]().includes(parsed.target)) unknown.push(entry);
        }
        if (unknown.length > 0) {
            throw new ApiError(400, "UNKNOWN_SCOPE_TARGET",
                `These scopes name something this backend does not serve: ${unknown.join(", ")}. ` +
                "A target is a collection slug, a storage source id or a function name.",
                {
                    scopes: unknown,
                    collections: targets.collections(),
                    buckets: targets.buckets(),
                    functions: targets.functions()
                });
        }
    }

    const beyond = scopesBeyond(requested, minterScopes);
    if (beyond.length > 0) {
        throw new ApiError(403, "SCOPE_EXCEEDS_CREATOR",
            `A key cannot hold more than the account creating it, and you do not hold ${beyond.join(", ")}.`,
            { scopes: beyond });
    }
}

/**
 * Refuse RLS roles the minter does not hold. An admin may give any role — they
 * already read every row — and anyone else only their own.
 */
export function assertRolesGrantable(requested: readonly string[], minterRoles: readonly string[]): void {
    if (hasAdminRole(minterRoles)) return;
    const beyond = requested.filter(role => !minterRoles.includes(role));
    if (beyond.length > 0) {
        throw new ApiError(403, "ROLE_EXCEEDS_CREATOR",
            `A key cannot run as a role the account creating it does not hold: ${beyond.join(", ")}.`,
            { roles: beyond });
    }
}

/**
 * Refuse changing or revoking a key that holds more than the caller — a role
 * they do not hold, or a scope beyond theirs. An admin manages any key.
 *
 * The same ceiling as minting, applied to the key as it already is: a
 * `keys:write` role could otherwise widen an admin-role key it could never
 * have minted to every data scope, or revoke the key an admin's integration
 * runs on. `assertMayManageAccount` is the same rule for accounts.
 */
export function assertMayManageKey(
    existing: { roles: readonly string[]; scopes: readonly string[] },
    managerRoles: readonly string[],
    managerScopes: readonly string[]
): void {
    if (hasAdminRole(managerRoles)) return;
    const roles = existing.roles.filter(role => !managerRoles.includes(role));
    const scopes = scopesBeyond(existing.scopes, managerScopes);
    if (roles.length > 0 || scopes.length > 0) {
        throw new ApiError(403, "KEY_OUTRANKS_CALLER",
            `This key holds ${[...roles.map(role => `the role ${role}`), ...scopes].join(", ")}, which you do not, ` +
            "so you cannot change or revoke it.",
            { roles, scopes });
    }
}

/** Read an optional `expires_at`: absent, null, or a future ISO-8601 instant. */
export function readExpiresAt(value: unknown, requireFuture: boolean): string | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    const parsed = typeof value === "string" ? new Date(value) : new Date(NaN);
    if (isNaN(parsed.getTime())) {
        throw ApiError.badRequest("expires_at must be a valid ISO-8601 date", "INVALID_INPUT");
    }
    if (requireFuture && parsed <= new Date()) {
        throw ApiError.badRequest("expires_at must be in the future", "INVALID_INPUT");
    }
    return parsed.toISOString();
}

/** Read an optional `rate_limit`: absent, null, or a positive integer. */
export function readRateLimit(value: unknown): number | null | undefined {
    if (value === undefined) return undefined;
    if (value === null) return null;
    if (typeof value !== "number" || value < 1 || !Number.isInteger(value)) {
        throw ApiError.badRequest("rate_limit must be a positive integer or null", "INVALID_INPUT");
    }
    return value;
}

/** Read a key name: a non-empty string, trimmed. */
export function readName(value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw ApiError.badRequest("Name is required", "INVALID_INPUT");
    }
    return value.trim();
}
