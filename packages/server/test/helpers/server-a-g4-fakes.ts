/**
 * Complete stand-ins for `AuthRepository` and `ApiKeyStore` built from the few
 * methods a test means to answer.
 *
 * Unlike `mockAuthRepository` (server-a-fakes.ts), the optional methods stay
 * *absent* here: code that probes for one (`repo.getAccountAccessState?.()`)
 * sees a repository without it, as it did when these were partial literals cast
 * into the interface. Every required method a test does not supply rejects, so
 * a route reaching one the test did not plan for fails loudly.
 */
import type { AuthRepository } from "../../src/auth/interfaces";
import type { ApiKeyStore } from "../../src/auth/api-keys/api-key-store";

function unplanned(owner: string, name: string) {
    return async (): Promise<never> => {
        throw new Error(`${owner}.${name} was not expected in this test`);
    };
}

/** An `AuthRepository` answering with `members`; the rest of its required methods reject. */
export function authRepositoryWith(members: Partial<AuthRepository>): AuthRepository {
    const no = (name: string) => unplanned("AuthRepository", name);
    return {
        createUser: no("createUser"),
        getUserById: no("getUserById"),
        getUserByEmail: no("getUserByEmail"),
        getUserByIdentity: no("getUserByIdentity"),
        getUserIdentities: no("getUserIdentities"),
        linkUserIdentity: no("linkUserIdentity"),
        updateUser: no("updateUser"),
        deleteUser: no("deleteUser"),
        listUsers: no("listUsers"),
        listUsersPaginated: no("listUsersPaginated"),
        updatePassword: no("updatePassword"),
        setEmailVerified: no("setEmailVerified"),
        setVerificationToken: no("setVerificationToken"),
        getUserByVerificationToken: no("getUserByVerificationToken"),
        getUserRoleIds: no("getUserRoleIds"),
        setUserRoles: no("setUserRoles"),
        assignDefaultRole: no("assignDefaultRole"),
        getUserWithRoles: no("getUserWithRoles"),
        createRefreshToken: no("createRefreshToken"),
        findRefreshTokenByHash: no("findRefreshTokenByHash"),
        deleteRefreshToken: no("deleteRefreshToken"),
        deleteAllRefreshTokensForUser: no("deleteAllRefreshTokensForUser"),
        listRefreshTokensForUser: no("listRefreshTokensForUser"),
        deleteRefreshTokenById: no("deleteRefreshTokenById"),
        createPasswordResetToken: no("createPasswordResetToken"),
        findValidPasswordResetToken: no("findValidPasswordResetToken"),
        markPasswordResetTokenUsed: no("markPasswordResetTokenUsed"),
        deleteAllPasswordResetTokensForUser: no("deleteAllPasswordResetTokensForUser"),
        deleteExpiredTokens: no("deleteExpiredTokens"),
        createMagicLinkToken: no("createMagicLinkToken"),
        findValidMagicLinkToken: no("findValidMagicLinkToken"),
        markMagicLinkTokenUsed: no("markMagicLinkTokenUsed"),
        createMfaFactor: no("createMfaFactor"),
        getMfaFactors: no("getMfaFactors"),
        getMfaFactorById: no("getMfaFactorById"),
        verifyMfaFactor: no("verifyMfaFactor"),
        deleteMfaFactor: no("deleteMfaFactor"),
        createMfaChallenge: no("createMfaChallenge"),
        getMfaChallengeById: no("getMfaChallengeById"),
        verifyMfaChallenge: no("verifyMfaChallenge"),
        createRecoveryCodes: no("createRecoveryCodes"),
        useRecoveryCode: no("useRecoveryCode"),
        getUnusedRecoveryCodeCount: no("getUnusedRecoveryCodeCount"),
        deleteAllRecoveryCodes: no("deleteAllRecoveryCodes"),
        hasVerifiedMfaFactors: no("hasVerifiedMfaFactors"),
        ...members
    };
}

/** An `ApiKeyStore` answering with `members`; the rest reject. */
export function apiKeyStoreWith(members: Partial<ApiKeyStore>): ApiKeyStore {
    const no = (name: string) => unplanned("ApiKeyStore", name);
    return {
        ensureTable: no("ensureTable"),
        createApiKey: no("createApiKey"),
        findByKeyHash: no("findByKeyHash"),
        listApiKeys: no("listApiKeys"),
        getApiKeyById: no("getApiKeyById"),
        updateApiKey: no("updateApiKey"),
        revokeApiKey: no("revokeApiKey"),
        updateLastUsed: no("updateLastUsed"),
        ...members
    };
}
