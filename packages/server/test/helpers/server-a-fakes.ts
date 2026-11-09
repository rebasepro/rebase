/**
 * Typed fakes for the interfaces the server's tests stand in for most often:
 * `DataDriver` and `AuthRepository`.
 *
 * Each returns a *complete* object — every member the interface requires, plus
 * the optional ones the routes probe for — so a test no longer has to cast a
 * partial literal into the interface. A cast like that is what let fixtures
 * drift from the real shapes unnoticed; a builder that implements the
 * interface fails to compile the day the interface changes.
 *
 * Every method is a bare `jest.fn()` (it answers `undefined`) unless the caller
 * passes its own. Tests set answers with `mockResolvedValue` as before.
 */
import type { DataDriver } from "@rebasepro/types";
import type { AuthRepository, TokenRepository, UserRepository } from "../../src/auth/interfaces";

/** A method of `T`, mocked, whether `T` declares it optional or not. */
type MockedMethods<T> = {
    [K in keyof T]-?: NonNullable<T[K]> extends (...args: never[]) => unknown
        ? jest.MockedFunction<NonNullable<T[K]>>
        : never;
};

/** The `DataDriver` members `mockDataDriver` mocks. */
type MockedDriverKey =
    | "fetchCollection"
    | "fetchOne"
    | "save"
    | "delete"
    | "checkUniqueField"
    | "count"
    | "listenCollection"
    | "listenOne";

/** A `DataDriver` whose reads, writes and `count` are jest mocks. */
export type MockDataDriver = Omit<DataDriver, MockedDriverKey> & Pick<MockedMethods<DataDriver>, MockedDriverKey>;

/**
 * A `DataDriver` with every read and write a jest mock.
 *
 * `extra` adds or replaces the members it does not mock (`admin`, `batchWrite`,
 * `key` …); to change what a mocked one answers, call `mockResolvedValue` on it.
 */
export function mockDataDriver(extra: Omit<Partial<DataDriver>, MockedDriverKey> = {}): MockDataDriver {
    return {
        key: "postgres",
        initialised: true,
        fetchCollection: jest.fn(),
        fetchOne: jest.fn(),
        save: jest.fn(),
        delete: jest.fn(),
        checkUniqueField: jest.fn(),
        count: jest.fn(),
        listenCollection: jest.fn(),
        listenOne: jest.fn(),
        ...extra
    };
}

/**
 * A `DataDriver` built from plain functions, for a test that wants real
 * behaviour on a few members and does not care about the rest.
 *
 * The members it is not given throw, so a route reaching one the test did not
 * plan for fails loudly instead of answering `undefined`.
 */
export function fakeDataDriver(members: Partial<DataDriver> = {}): DataDriver {
    const unplanned = (name: string) => () => {
        throw new Error(`fakeDataDriver: ${name} was not expected in this test`);
    };
    return {
        fetchCollection: unplanned("fetchCollection"),
        fetchOne: unplanned("fetchOne"),
        save: unplanned("save"),
        delete: unplanned("delete"),
        checkUniqueField: unplanned("checkUniqueField"),
        ...members
    };
}

/** Every method of `AuthRepository`, optional ones included, as a jest mock. */
export type MockAuthRepository = MockedMethods<AuthRepository>;

/**
 * An `AuthRepository` whose every method — the optional ones too — is a jest
 * mock answering `undefined`, unless `overrides` supplies it.
 *
 * To model a repository *without* an optional method, spread it and set that
 * key to `undefined`: `{ ...repo, markRefreshTokenRotated: undefined }`.
 */
export function mockAuthRepository(overrides: Partial<MockAuthRepository> = {}): MockAuthRepository {
    return {
        createUser: jest.fn(),
        getUserById: jest.fn(),
        getUserByEmail: jest.fn(),
        getUserByIdentity: jest.fn(),
        getUserIdentities: jest.fn(),
        linkUserIdentity: jest.fn(),
        unlinkUserIdentity: jest.fn(),
        updateUser: jest.fn(),
        deleteUser: jest.fn(),
        listUsers: jest.fn(),
        listUsersPaginated: jest.fn(),
        firstUserIds: jest.fn(),
        listGuests: jest.fn(),
        deleteGuest: jest.fn(),
        updatePassword: jest.fn(),
        setEmailVerified: jest.fn(),
        setVerificationToken: jest.fn(),
        getUserByVerificationToken: jest.fn(),
        getUserRoleIds: jest.fn(),
        setUserRoles: jest.fn(),
        assignDefaultRole: jest.fn(),
        getUserWithRoles: jest.fn(),
        setUserDisabled: jest.fn(),
        setPendingEmailChange: jest.fn(),
        getPendingEmailChange: jest.fn(),
        findPendingEmailChange: jest.fn(),
        applyPendingEmailChange: jest.fn(),
        createRefreshToken: jest.fn(),
        markRefreshTokenRotated: jest.fn(),
        revokeRefreshTokenSession: jest.fn(),
        pruneRefreshTokens: jest.fn(),
        getTokensValidAfter: jest.fn(),
        setTokensValidAfter: jest.fn(),
        getAccountAccessState: jest.fn(),
        findRefreshTokenByHash: jest.fn(),
        deleteRefreshToken: jest.fn(),
        deleteAllRefreshTokensForUser: jest.fn(),
        listRefreshTokensForUser: jest.fn(),
        deleteRefreshTokenById: jest.fn(),
        createPasswordResetToken: jest.fn(),
        findValidPasswordResetToken: jest.fn(),
        markPasswordResetTokenUsed: jest.fn(),
        deleteAllPasswordResetTokensForUser: jest.fn(),
        deleteExpiredTokens: jest.fn(),
        createMagicLinkToken: jest.fn(),
        findValidMagicLinkToken: jest.fn(),
        markMagicLinkTokenUsed: jest.fn(),
        deleteAllMagicLinkTokensForUser: jest.fn(),
        ...mfaMethods(),
        ...overrides
    };
}

/** `MfaRepository`'s methods, kept apart so the list above stays readable. */
function mfaMethods(): Pick<MockAuthRepository, Exclude<keyof MockAuthRepository, NonMfaKey>> {
    return {
        createMfaFactor: jest.fn(),
        getMfaFactors: jest.fn(),
        getMfaFactorById: jest.fn(),
        verifyMfaFactor: jest.fn(),
        updateMfaFactorSecret: jest.fn(),
        deleteMfaFactor: jest.fn(),
        createMfaChallenge: jest.fn(),
        getMfaChallengeById: jest.fn(),
        verifyMfaChallenge: jest.fn(),
        createRecoveryCodes: jest.fn(),
        useRecoveryCode: jest.fn(),
        getUnusedRecoveryCodeCount: jest.fn(),
        deleteAllRecoveryCodes: jest.fn(),
        hasVerifiedMfaFactors: jest.fn(),
        claimMfaFactorCounter: jest.fn(),
        recordMfaChallengeAttempt: jest.fn()
    };
}

type NonMfaKey = keyof UserRepository | keyof TokenRepository;
