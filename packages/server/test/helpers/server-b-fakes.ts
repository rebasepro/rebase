import { createServer, type Server } from "node:http";
import { jest } from "@jest/globals";
import type {
    BackendBootstrapper,
    DataDriver,
    InitializedDriver,
    RealtimeProvider
} from "@rebasepro/types";
import type { AuthRepository } from "../../src/auth/interfaces";
import type { EmailService } from "../../src/email";

/**
 * Complete, typed fakes for the interfaces server tests stand in for.
 *
 * Each builder returns the whole interface, with defaults that answer "nothing
 * here" and overrides for what a test cares about, so a test never asserts a
 * half-built object into the type the code under test takes.
 */

/** A `DataDriver` that reads nothing and writes nowhere, unless told otherwise. */
export function fakeDataDriver(overrides: Partial<DataDriver> = {}): DataDriver {
    return {
        async fetchCollection() { return []; },
        async fetchOne() { return undefined; },
        async save() { return {}; },
        async delete() { /* nothing to delete */ },
        async checkUniqueField() { return true; },
        ...overrides
    };
}

/** A `RealtimeProvider` with no subscribers, unless told otherwise. */
export function fakeRealtimeProvider(overrides: Partial<RealtimeProvider> = {}): RealtimeProvider {
    return {
        subscribeToCollection() { /* no subscribers */ },
        subscribeToOne() { /* no subscribers */ },
        unsubscribe() { /* no subscribers */ },
        async notifyUpdate() { /* no subscribers */ },
        ...overrides
    };
}

/**
 * The default bootstrapper of a test boot: type `"fake"`, its driver
 * {@link fakeDataDriver} unless `init` names another.
 */
export function fakeBootstrapper(
    init: Partial<InitializedDriver> = {},
    overrides: Partial<BackendBootstrapper> = {}
): BackendBootstrapper {
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver: fakeDataDriver(), collections: [], internals: {}, ...init };
        },
        ...overrides
    };
}

/**
 * An HTTP server that never listens: what a boot that attaches no websocket
 * is handed as its `server`.
 */
export function idleServer(): Server {
    return createServer();
}

/** A function a fake did not expect to be called: it says which. */
function unstubbed(name: string): () => never {
    return () => {
        throw new Error(`${name} is not stubbed in this test`);
    };
}

/**
 * Every required method of `AuthRepository` as a `jest.fn` that throws until
 * the test gives it an answer — so a call the test did not plan for fails
 * loudly instead of resolving `undefined`.
 *
 * The optional methods are left out: their absence is a capability the code
 * under test branches on. A test that wants one passes it in `optional`, and
 * reads it back with the type it passed.
 */
export function mockAuthRepository<O extends Partial<AuthRepository> = Record<never, never>>(
    optional?: O
): jest.Mocked<AuthRepository> & O {
    const repo: jest.Mocked<AuthRepository> = {
        createUser: jest.fn<AuthRepository["createUser"]>(unstubbed("createUser")),
        getUserById: jest.fn<AuthRepository["getUserById"]>(unstubbed("getUserById")),
        getUserByEmail: jest.fn<AuthRepository["getUserByEmail"]>(unstubbed("getUserByEmail")),
        getUserByIdentity: jest.fn<AuthRepository["getUserByIdentity"]>(unstubbed("getUserByIdentity")),
        getUserIdentities: jest.fn<AuthRepository["getUserIdentities"]>(unstubbed("getUserIdentities")),
        linkUserIdentity: jest.fn<AuthRepository["linkUserIdentity"]>(unstubbed("linkUserIdentity")),
        updateUser: jest.fn<AuthRepository["updateUser"]>(unstubbed("updateUser")),
        deleteUser: jest.fn<AuthRepository["deleteUser"]>(unstubbed("deleteUser")),
        listUsers: jest.fn<AuthRepository["listUsers"]>(unstubbed("listUsers")),
        listUsersPaginated: jest.fn<AuthRepository["listUsersPaginated"]>(unstubbed("listUsersPaginated")),
        updatePassword: jest.fn<AuthRepository["updatePassword"]>(unstubbed("updatePassword")),
        setEmailVerified: jest.fn<AuthRepository["setEmailVerified"]>(unstubbed("setEmailVerified")),
        setVerificationToken: jest.fn<AuthRepository["setVerificationToken"]>(unstubbed("setVerificationToken")),
        getUserByVerificationToken: jest.fn<AuthRepository["getUserByVerificationToken"]>(unstubbed("getUserByVerificationToken")),
        getUserRoleIds: jest.fn<AuthRepository["getUserRoleIds"]>(unstubbed("getUserRoleIds")),
        setUserRoles: jest.fn<AuthRepository["setUserRoles"]>(unstubbed("setUserRoles")),
        assignDefaultRole: jest.fn<AuthRepository["assignDefaultRole"]>(unstubbed("assignDefaultRole")),
        getUserWithRoles: jest.fn<AuthRepository["getUserWithRoles"]>(unstubbed("getUserWithRoles")),
        createRefreshToken: jest.fn<AuthRepository["createRefreshToken"]>(unstubbed("createRefreshToken")),
        findRefreshTokenByHash: jest.fn<AuthRepository["findRefreshTokenByHash"]>(unstubbed("findRefreshTokenByHash")),
        deleteRefreshToken: jest.fn<AuthRepository["deleteRefreshToken"]>(unstubbed("deleteRefreshToken")),
        deleteAllRefreshTokensForUser: jest.fn<AuthRepository["deleteAllRefreshTokensForUser"]>(unstubbed("deleteAllRefreshTokensForUser")),
        listRefreshTokensForUser: jest.fn<AuthRepository["listRefreshTokensForUser"]>(unstubbed("listRefreshTokensForUser")),
        deleteRefreshTokenById: jest.fn<AuthRepository["deleteRefreshTokenById"]>(unstubbed("deleteRefreshTokenById")),
        createPasswordResetToken: jest.fn<AuthRepository["createPasswordResetToken"]>(unstubbed("createPasswordResetToken")),
        findValidPasswordResetToken: jest.fn<AuthRepository["findValidPasswordResetToken"]>(unstubbed("findValidPasswordResetToken")),
        markPasswordResetTokenUsed: jest.fn<AuthRepository["markPasswordResetTokenUsed"]>(unstubbed("markPasswordResetTokenUsed")),
        deleteAllPasswordResetTokensForUser: jest.fn<AuthRepository["deleteAllPasswordResetTokensForUser"]>(unstubbed("deleteAllPasswordResetTokensForUser")),
        deleteExpiredTokens: jest.fn<AuthRepository["deleteExpiredTokens"]>(unstubbed("deleteExpiredTokens")),
        createMagicLinkToken: jest.fn<AuthRepository["createMagicLinkToken"]>(unstubbed("createMagicLinkToken")),
        findValidMagicLinkToken: jest.fn<AuthRepository["findValidMagicLinkToken"]>(unstubbed("findValidMagicLinkToken")),
        markMagicLinkTokenUsed: jest.fn<AuthRepository["markMagicLinkTokenUsed"]>(unstubbed("markMagicLinkTokenUsed")),
        createMfaFactor: jest.fn<AuthRepository["createMfaFactor"]>(unstubbed("createMfaFactor")),
        getMfaFactors: jest.fn<AuthRepository["getMfaFactors"]>(unstubbed("getMfaFactors")),
        getMfaFactorById: jest.fn<AuthRepository["getMfaFactorById"]>(unstubbed("getMfaFactorById")),
        verifyMfaFactor: jest.fn<AuthRepository["verifyMfaFactor"]>(unstubbed("verifyMfaFactor")),
        deleteMfaFactor: jest.fn<AuthRepository["deleteMfaFactor"]>(unstubbed("deleteMfaFactor")),
        createMfaChallenge: jest.fn<AuthRepository["createMfaChallenge"]>(unstubbed("createMfaChallenge")),
        getMfaChallengeById: jest.fn<AuthRepository["getMfaChallengeById"]>(unstubbed("getMfaChallengeById")),
        verifyMfaChallenge: jest.fn<AuthRepository["verifyMfaChallenge"]>(unstubbed("verifyMfaChallenge")),
        createRecoveryCodes: jest.fn<AuthRepository["createRecoveryCodes"]>(unstubbed("createRecoveryCodes")),
        useRecoveryCode: jest.fn<AuthRepository["useRecoveryCode"]>(unstubbed("useRecoveryCode")),
        getUnusedRecoveryCodeCount: jest.fn<AuthRepository["getUnusedRecoveryCodeCount"]>(unstubbed("getUnusedRecoveryCodeCount")),
        deleteAllRecoveryCodes: jest.fn<AuthRepository["deleteAllRecoveryCodes"]>(unstubbed("deleteAllRecoveryCodes")),
        hasVerifiedMfaFactors: jest.fn<AuthRepository["hasVerifiedMfaFactors"]>(unstubbed("hasVerifiedMfaFactors"))
    };
    return Object.assign(repo, optional);
}

/** An `EmailService` that is configured and accepts every message. */
export function mockEmailService(): jest.Mocked<EmailService> {
    return {
        send: jest.fn<EmailService["send"]>(async () => ({})),
        isConfigured: jest.fn<EmailService["isConfigured"]>(() => true)
    };
}
