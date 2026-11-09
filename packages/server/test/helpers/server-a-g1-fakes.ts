/**
 * Complete, typed stand-ins for `AuthRepository`, `ApiKeyStore` and an API
 * key, for tests that care about one or two members and used to cast a partial
 * literal into the interface.
 *
 * The members a test does not supply throw when called, so a code path the
 * test did not plan for fails loudly. Optional members are left out unless
 * given: code that probes for them (`if (repo.getTokensValidAfter)`) sees what
 * it saw before.
 */
import type { ApiKeyMasked } from "@rebasepro/types";
import type { AuthRepository, UserData } from "../../src/auth/interfaces";
import type { ApiKeyStore } from "../../src/auth/api-keys/api-key-store";

function unplanned(owner: string, name: string): () => never {
    return () => {
        throw new Error(`${owner}.${name} was not expected in this test`);
    };
}

/** A user row: an active, verified account unless `overrides` says otherwise. */
export function fakeUser(overrides: Partial<UserData> = {}): UserData {
    return {
        id: "user-1",
        email: "user-1@test.com",
        emailVerified: true,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
        ...overrides
    };
}

/**
 * An `AuthRepository` made of `members`; every other required method throws.
 *
 * One member is derived rather than left to throw: given `getUserRoleIds` and
 * no `getUserWithRoles`, the account read answers a live account holding those
 * same roles. The access-token judge calls `getUserWithRoles` whenever it is a
 * function — on every real repository, always — so a fake whose account read
 * threw would refuse every token for a reason no real store has, and one
 * without it would test a path production never takes.
 */
export function fakeAuthRepository(members: Partial<AuthRepository> = {}): AuthRepository {
    const u = (name: string) => unplanned("AuthRepository", name);
    const roleIds = members.getUserRoleIds;
    const accountFromRoles: Partial<AuthRepository> = roleIds && !members.getUserWithRoles
        ? { getUserWithRoles: async (uid: string) => ({ user: fakeUser({ id: uid }), roles: await roleIds(uid) }) }
        : {};
    return {
        createUser: u("createUser"),
        getUserById: u("getUserById"),
        getUserByEmail: u("getUserByEmail"),
        getUserByIdentity: u("getUserByIdentity"),
        getUserIdentities: u("getUserIdentities"),
        linkUserIdentity: u("linkUserIdentity"),
        updateUser: u("updateUser"),
        deleteUser: u("deleteUser"),
        listUsers: u("listUsers"),
        listUsersPaginated: u("listUsersPaginated"),
        updatePassword: u("updatePassword"),
        setEmailVerified: u("setEmailVerified"),
        setVerificationToken: u("setVerificationToken"),
        getUserByVerificationToken: u("getUserByVerificationToken"),
        getUserRoleIds: u("getUserRoleIds"),
        setUserRoles: u("setUserRoles"),
        assignDefaultRole: u("assignDefaultRole"),
        getUserWithRoles: u("getUserWithRoles"),
        createRefreshToken: u("createRefreshToken"),
        findRefreshTokenByHash: u("findRefreshTokenByHash"),
        deleteRefreshToken: u("deleteRefreshToken"),
        deleteAllRefreshTokensForUser: u("deleteAllRefreshTokensForUser"),
        listRefreshTokensForUser: u("listRefreshTokensForUser"),
        deleteRefreshTokenById: u("deleteRefreshTokenById"),
        createPasswordResetToken: u("createPasswordResetToken"),
        findValidPasswordResetToken: u("findValidPasswordResetToken"),
        markPasswordResetTokenUsed: u("markPasswordResetTokenUsed"),
        deleteAllPasswordResetTokensForUser: u("deleteAllPasswordResetTokensForUser"),
        deleteExpiredTokens: u("deleteExpiredTokens"),
        createMagicLinkToken: u("createMagicLinkToken"),
        findValidMagicLinkToken: u("findValidMagicLinkToken"),
        markMagicLinkTokenUsed: u("markMagicLinkTokenUsed"),
        createMfaFactor: u("createMfaFactor"),
        getMfaFactors: u("getMfaFactors"),
        getMfaFactorById: u("getMfaFactorById"),
        verifyMfaFactor: u("verifyMfaFactor"),
        deleteMfaFactor: u("deleteMfaFactor"),
        createMfaChallenge: u("createMfaChallenge"),
        getMfaChallengeById: u("getMfaChallengeById"),
        verifyMfaChallenge: u("verifyMfaChallenge"),
        createRecoveryCodes: u("createRecoveryCodes"),
        useRecoveryCode: u("useRecoveryCode"),
        getUnusedRecoveryCodeCount: u("getUnusedRecoveryCodeCount"),
        deleteAllRecoveryCodes: u("deleteAllRecoveryCodes"),
        hasVerifiedMfaFactors: u("hasVerifiedMfaFactors"),
        ...accountFromRoles,
        ...members
    };
}

/** An `ApiKeyStore` made of `members`; every other method throws. */
export function fakeApiKeyStore(members: Partial<ApiKeyStore> = {}): ApiKeyStore {
    const u = (name: string) => unplanned("ApiKeyStore", name);
    return {
        ensureTable: u("ensureTable"),
        createApiKey: u("createApiKey"),
        findByKeyHash: u("findByKeyHash"),
        listApiKeys: u("listApiKeys"),
        getApiKeyById: u("getApiKeyById"),
        updateApiKey: u("updateApiKey"),
        revokeApiKey: u("revokeApiKey"),
        updateLastUsed: u("updateLastUsed"),
        ...members
    };
}

/** The key a request authenticated with, as the middleware sets it on `c.get("apiKey")`. */
export function maskedApiKey(overrides: Partial<ApiKeyMasked> = {}): ApiKeyMasked {
    return {
        id: "key-1",
        name: "test key",
        kind: "service",
        key_prefix: "rk_test_key",
        scopes: [],
        roles: [],
        owner_uid: null,
        rate_limit: null,
        created_by: "tester",
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
        last_used_at: null,
        expires_at: null,
        revoked_at: null,
        ...overrides
    };
}
