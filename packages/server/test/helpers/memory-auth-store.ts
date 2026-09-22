import { randomUUID } from "node:crypto";
import type {
    AuthRepository,
    MfaChallengeInfo,
    MfaFactor,
    RefreshTokenInfo,
    RoleData,
    UserData,
    UserIdentityData
} from "../../src/auth/interfaces";

/**
 * An auth store that keeps state, for tests that follow one account through
 * several doors.
 *
 * A jest mock answers what the previous line told it to, so it cannot say
 * whether the password an attacker set still logs in after the owner proved
 * the address, or whether the refresh token a door handed out is the one the
 * next request presents. This store can: each door writes to it, and the next
 * door reads what was written.
 *
 * It covers what the auth routes touch, not all of `AuthRepository`.
 */
export interface MemoryAuthStoreOptions {
    /**
     * Whether the store can detach an OAuth identity. `false` is a repository
     * without `unlinkUserIdentity`, which is what the MongoDB driver is today.
     */
    unlinkIdentities?: boolean;
}

interface StoredSingleUseToken {
    uid: string;
    expiresAt: Date;
    used: boolean;
}

interface StoredFactor extends MfaFactor {
    secretEncrypted: string;
}

export class MemoryAuthStore {
    readonly users = new Map<string, UserData>();
    readonly roles = new Map<string, string[]>();
    identities: UserIdentityData[] = [];
    refreshTokens: RefreshTokenInfo[] = [];
    readonly magicLinkTokens = new Map<string, StoredSingleUseToken>();
    readonly resetTokens = new Map<string, StoredSingleUseToken>();
    readonly validAfter = new Map<string, Date>();
    factors: StoredFactor[] = [];
    readonly challenges = new Map<string, MfaChallengeInfo>();

    constructor(private readonly options: MemoryAuthStoreOptions = {}) {}

    private snapshot(user: UserData): UserData {
        return { ...user };
    }

    private roleData(uid: string): RoleData[] {
        return (this.roles.get(uid) ?? []).map(id => ({
            id,
            name: id,
            isAdmin: id === "admin",
            defaultPermissions: null,
            collectionPermissions: null
        }));
    }

    private findUserByEmail(email: string): UserData | undefined {
        const wanted = email.trim().toLowerCase();
        return [...this.users.values()].find(u => u.email === wanted);
    }

    /** The providers linked to a user, sorted, for a one-line assertion. */
    providersOf(uid: string): string[] {
        return this.identities.filter(i => i.uid === uid).map(i => i.provider).sort();
    }

    repo(): AuthRepository {
        const repo: Partial<AuthRepository> = {
            // ── users ──
            createUser: async (data) => {
                const email = data.email.trim().toLowerCase();
                if (this.findUserByEmail(email)) {
                    throw new Error(`duplicate email ${email}`);
                }
                const now = new Date();
                const user: UserData = {
                    id: randomUUID(),
                    email,
                    passwordHash: data.passwordHash ?? null,
                    displayName: data.displayName ?? null,
                    photoUrl: data.photoUrl ?? null,
                    emailVerified: data.emailVerified ?? false,
                    isAnonymous: data.isAnonymous ?? false,
                    metadata: data.metadata ?? {},
                    createdAt: now,
                    updatedAt: now
                };
                this.users.set(user.id, user);
                return this.snapshot(user);
            },
            getUserById: async (id) => {
                const user = this.users.get(id);
                return user ? this.snapshot(user) : null;
            },
            getUserByEmail: async (email) => {
                const user = this.findUserByEmail(email);
                return user ? this.snapshot(user) : null;
            },
            getUserByIdentity: async (provider, providerId) => {
                const identity = this.identities.find(i => i.provider === provider && i.providerId === providerId);
                const user = identity ? this.users.get(identity.uid) : undefined;
                return user ? this.snapshot(user) : null;
            },
            getUserIdentities: async (uid) => this.identities.filter(i => i.uid === uid).map(i => ({ ...i })),
            linkUserIdentity: async (uid, provider, providerId, profileData) => {
                if (this.identities.some(i => i.provider === provider && i.providerId === providerId)) return;
                const now = new Date();
                this.identities.push({ id: randomUUID(), uid, provider, providerId, profileData: profileData ?? null, createdAt: now, updatedAt: now });
            },
            updateUser: async (id, data) => {
                const user = this.users.get(id);
                if (!user) return null;
                if (data.email !== undefined) user.email = data.email.trim().toLowerCase();
                if (data.passwordHash !== undefined) user.passwordHash = data.passwordHash;
                if (data.displayName !== undefined) user.displayName = data.displayName;
                if (data.photoUrl !== undefined) user.photoUrl = data.photoUrl;
                if (data.emailVerified !== undefined) user.emailVerified = data.emailVerified;
                if (data.isAnonymous !== undefined) user.isAnonymous = data.isAnonymous;
                if (data.metadata !== undefined) user.metadata = data.metadata;
                user.updatedAt = new Date();
                return this.snapshot(user);
            },
            deleteUser: async (id) => {
                this.users.delete(id);
                this.identities = this.identities.filter(i => i.uid !== id);
            },
            listUsers: async () => [...this.users.values()].map(u => this.snapshot(u)),
            listUsersPaginated: async (options) => {
                const all = [...this.users.values()];
                const limit = options?.limit ?? 25;
                const offset = options?.offset ?? 0;
                return { users: all.slice(offset, offset + limit).map(u => this.snapshot(u)), total: all.length, limit, offset };
            },
            updatePassword: async (id, passwordHash) => {
                const user = this.users.get(id);
                if (user) user.passwordHash = passwordHash;
            },
            setEmailVerified: async (id, verified) => {
                const user = this.users.get(id);
                if (user) user.emailVerified = verified;
            },
            setVerificationToken: async () => undefined,
            getUserByVerificationToken: async () => null,
            getUserRoles: async (uid) => this.roleData(uid),
            getUserRoleIds: async (uid) => [...(this.roles.get(uid) ?? [])],
            setUserRoles: async (uid, roleIds) => {
                this.roles.set(uid, [...roleIds]);
            },
            assignDefaultRole: async (uid, roleId) => {
                const current = this.roles.get(uid) ?? [];
                if (!current.includes(roleId)) this.roles.set(uid, [...current, roleId]);
            },
            getUserWithRoles: async (uid) => {
                const user = this.users.get(uid);
                return user ? { user: this.snapshot(user), roles: this.roleData(uid) } : null;
            },

            // ── refresh tokens and the revocation mark ──
            createRefreshToken: async (uid, tokenHash, expiresAt, userAgent, ipAddress, session) => {
                const id = randomUUID();
                this.refreshTokens.push({
                    id, uid, tokenHash, expiresAt, userAgent, ipAddress,
                    createdAt: new Date(),
                    sessionId: session?.id ?? id,
                    sessionStartedAt: session?.startedAt ?? new Date(),
                    aal: session?.aal,
                    rotatedAt: null,
                    revoked: false
                });
            },
            markRefreshTokenRotated: async (tokenHash) => {
                const row = this.refreshTokens.find(r => r.tokenHash === tokenHash);
                if (row) row.rotatedAt = new Date();
            },
            revokeRefreshTokenSession: async (sessionId) => {
                for (const row of this.refreshTokens) {
                    if (row.sessionId === sessionId) row.revoked = true;
                }
            },
            pruneRefreshTokens: async () => undefined,
            getTokensValidAfter: async (uid) => this.validAfter.get(uid) ?? null,
            setTokensValidAfter: async (uid, at) => {
                this.validAfter.set(uid, at);
            },
            findRefreshTokenByHash: async (tokenHash) => {
                const row = this.refreshTokens.find(r => r.tokenHash === tokenHash);
                return row ? { ...row } : null;
            },
            deleteRefreshToken: async (tokenHash) => {
                this.refreshTokens = this.refreshTokens.filter(r => r.tokenHash !== tokenHash);
            },
            deleteAllRefreshTokensForUser: async (uid) => {
                this.refreshTokens = this.refreshTokens.filter(r => r.uid !== uid);
            },
            listRefreshTokensForUser: async (uid) => this.refreshTokens.filter(r => r.uid === uid).map(r => ({ ...r })),
            deleteRefreshTokenById: async (id, uid) => {
                this.refreshTokens = this.refreshTokens.filter(r => !(r.id === id && r.uid === uid));
            },

            // ── single-use tokens ──
            createPasswordResetToken: async (uid, tokenHash, expiresAt) => {
                this.resetTokens.set(tokenHash, { uid, expiresAt, used: false });
            },
            findValidPasswordResetToken: async (tokenHash) => {
                const token = this.resetTokens.get(tokenHash);
                return token && !token.used && token.expiresAt > new Date() ? { uid: token.uid, expiresAt: token.expiresAt } : null;
            },
            markPasswordResetTokenUsed: async (tokenHash) => {
                const token = this.resetTokens.get(tokenHash);
                if (token) token.used = true;
            },
            deleteAllPasswordResetTokensForUser: async (uid) => {
                for (const [hash, token] of this.resetTokens) {
                    if (token.uid === uid) this.resetTokens.delete(hash);
                }
            },
            deleteExpiredTokens: async () => undefined,
            createMagicLinkToken: async (uid, tokenHash, expiresAt) => {
                this.magicLinkTokens.set(tokenHash, { uid, expiresAt, used: false });
            },
            findValidMagicLinkToken: async (tokenHash) => {
                const token = this.magicLinkTokens.get(tokenHash);
                return token && !token.used && token.expiresAt > new Date() ? { uid: token.uid, expiresAt: token.expiresAt } : null;
            },
            markMagicLinkTokenUsed: async (tokenHash) => {
                const token = this.magicLinkTokens.get(tokenHash);
                if (token) token.used = true;
            },

            // ── MFA ──
            createMfaFactor: async (uid, factorType, secretEncrypted, friendlyName) => {
                const now = new Date();
                const factor: StoredFactor = { id: randomUUID(), uid, factorType, secretEncrypted, friendlyName, verified: false, lastUsedCounter: null, createdAt: now, updatedAt: now };
                this.factors.push(factor);
                return { ...factor };
            },
            getMfaFactors: async (uid) => this.factors.filter(f => f.uid === uid).map(f => ({ ...f })),
            getMfaFactorById: async (factorId) => {
                const factor = this.factors.find(f => f.id === factorId);
                return factor ? { ...factor } : null;
            },
            verifyMfaFactor: async (factorId) => {
                const factor = this.factors.find(f => f.id === factorId);
                if (factor) factor.verified = true;
            },
            deleteMfaFactor: async (factorId, uid) => {
                this.factors = this.factors.filter(f => !(f.id === factorId && f.uid === uid));
            },
            hasVerifiedMfaFactors: async (uid) => this.factors.some(f => f.uid === uid && f.verified),
            claimMfaFactorCounter: async (factorId, counter) => {
                const factor = this.factors.find(f => f.id === factorId);
                if (!factor) return false;
                if (factor.lastUsedCounter !== null && factor.lastUsedCounter !== undefined && factor.lastUsedCounter >= counter) return false;
                factor.lastUsedCounter = counter;
                return true;
            },
            createMfaChallenge: async (factorId, ipAddress) => {
                const challenge: MfaChallengeInfo = { id: randomUUID(), factorId, createdAt: new Date(), ipAddress, attempts: 0 };
                this.challenges.set(challenge.id, challenge);
                return { ...challenge };
            },
            getMfaChallengeById: async (challengeId) => {
                const challenge = this.challenges.get(challengeId);
                return challenge && !challenge.verifiedAt ? { ...challenge } : null;
            },
            verifyMfaChallenge: async (challengeId) => {
                const challenge = this.challenges.get(challengeId);
                if (challenge) challenge.verifiedAt = new Date();
            },
            recordMfaChallengeAttempt: async (challengeId) => {
                const challenge = this.challenges.get(challengeId);
                if (!challenge) return 0;
                challenge.attempts = (challenge.attempts ?? 0) + 1;
                return challenge.attempts;
            },
            createRecoveryCodes: async () => undefined,
            useRecoveryCode: async () => false,
            getUnusedRecoveryCodeCount: async () => 0,
            deleteAllRecoveryCodes: async () => undefined
        };
        return repo as AuthRepository;
    }
}
