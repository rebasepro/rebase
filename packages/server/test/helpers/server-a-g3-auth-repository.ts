/**
 * An `AuthRepository` that implements only what a test gives it.
 *
 * Every method the interface requires and the test did not supply rejects,
 * naming itself, so a door reaching one the test did not plan for fails loudly.
 * Optional methods the test did not supply are *absent* — not stubbed — because
 * the auth code branches on whether a repository has them
 * (`getTokensValidAfter`, `getAccountAccessState`, `markRefreshTokenRotated` …),
 * and a stub would send it down a path a partial fixture never took.
 *
 * Use `mockAuthRepository` from `server-a-fakes.ts` instead when the test wants
 * every method present as a jest mock.
 */
import type { AuthRepository, UserData } from "../../src/auth/interfaces";

/**
 * A stored account, for a fixture's `getUserWithRoles` / `getUserById`.
 *
 * Those two are required by the interface, and the access-token check probes
 * for `getUserWithRoles` before it falls back to `getUserRoleIds` — so a
 * fixture that only means "this user holds these roles" has to answer it.
 */
export function storedUser(id: string, overrides: Partial<UserData> = {}): UserData {
    return {
        id,
        email: `${id}@example.test`,
        emailVerified: true,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        ...overrides
    };
}

export function partialAuthRepository(members: Partial<AuthRepository> = {}): AuthRepository {
    const unplanned = (name: string) => async (): Promise<never> => {
        throw new Error(`partialAuthRepository: ${name} was not expected in this test`);
    };
    return {
        // UserRepository
        createUser: unplanned("createUser"),
        getUserById: unplanned("getUserById"),
        getUserByEmail: unplanned("getUserByEmail"),
        getUserByIdentity: unplanned("getUserByIdentity"),
        getUserIdentities: unplanned("getUserIdentities"),
        linkUserIdentity: unplanned("linkUserIdentity"),
        updateUser: unplanned("updateUser"),
        deleteUser: unplanned("deleteUser"),
        listUsers: unplanned("listUsers"),
        listUsersPaginated: unplanned("listUsersPaginated"),
        updatePassword: unplanned("updatePassword"),
        setEmailVerified: unplanned("setEmailVerified"),
        setVerificationToken: unplanned("setVerificationToken"),
        getUserByVerificationToken: unplanned("getUserByVerificationToken"),
        getUserRoleIds: unplanned("getUserRoleIds"),
        setUserRoles: unplanned("setUserRoles"),
        assignDefaultRole: unplanned("assignDefaultRole"),
        getUserWithRoles: unplanned("getUserWithRoles"),
        // TokenRepository
        createRefreshToken: unplanned("createRefreshToken"),
        findRefreshTokenByHash: unplanned("findRefreshTokenByHash"),
        deleteRefreshToken: unplanned("deleteRefreshToken"),
        deleteAllRefreshTokensForUser: unplanned("deleteAllRefreshTokensForUser"),
        listRefreshTokensForUser: unplanned("listRefreshTokensForUser"),
        deleteRefreshTokenById: unplanned("deleteRefreshTokenById"),
        createPasswordResetToken: unplanned("createPasswordResetToken"),
        findValidPasswordResetToken: unplanned("findValidPasswordResetToken"),
        markPasswordResetTokenUsed: unplanned("markPasswordResetTokenUsed"),
        deleteAllPasswordResetTokensForUser: unplanned("deleteAllPasswordResetTokensForUser"),
        deleteExpiredTokens: unplanned("deleteExpiredTokens"),
        createMagicLinkToken: unplanned("createMagicLinkToken"),
        findValidMagicLinkToken: unplanned("findValidMagicLinkToken"),
        markMagicLinkTokenUsed: unplanned("markMagicLinkTokenUsed"),
        // MfaRepository
        createMfaFactor: unplanned("createMfaFactor"),
        getMfaFactors: unplanned("getMfaFactors"),
        getMfaFactorById: unplanned("getMfaFactorById"),
        verifyMfaFactor: unplanned("verifyMfaFactor"),
        deleteMfaFactor: unplanned("deleteMfaFactor"),
        createMfaChallenge: unplanned("createMfaChallenge"),
        getMfaChallengeById: unplanned("getMfaChallengeById"),
        verifyMfaChallenge: unplanned("verifyMfaChallenge"),
        createRecoveryCodes: unplanned("createRecoveryCodes"),
        useRecoveryCode: unplanned("useRecoveryCode"),
        getUnusedRecoveryCodeCount: unplanned("getUnusedRecoveryCodeCount"),
        deleteAllRecoveryCodes: unplanned("deleteAllRecoveryCodes"),
        hasVerifiedMfaFactors: unplanned("hasVerifiedMfaFactors"),
        ...members
    };
}
