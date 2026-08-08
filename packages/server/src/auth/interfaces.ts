import { z } from "zod";

/**
 * Authentication Abstraction Interfaces
 *
 * These interfaces define the contracts for authentication-related operations.
 * Implementations can use different databases (PostgreSQL, MongoDB, etc.) to
 * store user, role, and token data.
 */

/**
 * User data structure
 */
export interface UserData {
    id: string;
    email: string;
    passwordHash?: string | null;
    displayName?: string | null;
    photoUrl?: string | null;
    emailVerified: boolean;
    emailVerificationToken?: string | null;
    emailVerificationSentAt?: Date | null;
    isAnonymous?: boolean;
    metadata?: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Data for creating a new user
 */
export interface CreateUserData {
    email: string;
    passwordHash?: string;
    displayName?: string;
    photoUrl?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    metadata?: Record<string, unknown>;
}

/**
 * User Identity Data (OAuth accounts linked to user)
 */
export interface UserIdentityData {
    id: string;
    uid: string;
    provider: string;
    providerId: string;
    profileData?: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
}

/**
 * Standardized profile data returned by an OAuth provider verification payload
 */
export interface OAuthProviderProfile {
    providerId: string;
    email: string;
    displayName?: string | null;
    photoUrl?: string | null;
    /**
     * Whether the provider reported that it verified this email address.
     *
     * This is not a display field. It is the sole authorization input to
     * account linking: a `true` here lets the sign-in route attach the
     * incoming identity to a pre-existing account that shares the address.
     * Set it `true` **only** from a verification signal actually present in
     * the provider's response — pass that signal through
     * `providerVerifiedEmail()` rather than writing a literal, so a provider
     * that reports nothing comes back `false`.
     *
     * `false` is not a failure: the user signs in and, if they already have an
     * account, links through `POST /auth/link/<provider>`, which proves
     * ownership with a live session instead of an unverified address.
     */
    emailVerified?: boolean;
}

/**
 * Pluggable OAuth Provider integration strategy
 */
export interface OAuthProvider<T = unknown> {
    /** The identifier of the provider (e.g. "github", "google") */
    id: string;

    /** Zod schema validating the expected request payload (e.g. { code: string }) */
    schema: z.ZodSchema<T>;

    /**
     * Verify external tokens/codes and return a standardized user profile.
     *
     * NOTE: Declared as method syntax (not arrow property) intentionally.
     * This makes `OAuthProvider` bivariant in `T`, which is correct because
     * each provider is self-contained — `schema` validates the request body
     * and `verify` consumes the same `T`. Bivariance lets heterogeneous
     * providers (`OAuthProvider<SpecificPayload>`) coexist in a single
     * `OAuthProvider<unknown>[]` array without resorting to `any`.
     */
    verify(payload: T): Promise<OAuthProviderProfile | null>;
}

/**
 * Role data structure
 */
export interface RoleData {
    id: string;
    name: string;
    isAdmin: boolean;
    defaultPermissions: {
        read?: boolean;
        create?: boolean;
        edit?: boolean;
        delete?: boolean;
    } | null;
    collectionPermissions: Record<string, {
        read?: boolean;
        create?: boolean;
        edit?: boolean;
        delete?: boolean;
    }> | null;
}

/**
 * Data for creating a new role
 */
export interface CreateRoleData {
    id: string;
    name: string;
    isAdmin?: boolean;
    defaultPermissions?: RoleData["defaultPermissions"];
    collectionPermissions?: RoleData["collectionPermissions"];
}

/**
 * Refresh token info
 */
export interface RefreshTokenInfo {
    id: string;
    uid: string;
    tokenHash: string;
    expiresAt: Date;
    createdAt: Date;
    userAgent?: string | null;
    ipAddress?: string | null;
    /**
     * The sign-in this token descends from. Every token minted by rotating
     * this one carries the same id.
     *
     * Optional because a custom {@link TokenRepository} written against an
     * older release does not supply it; the refresh endpoint then treats the
     * token as a session of one, which costs reuse tolerance but still works.
     */
    sessionId?: string;
    /**
     * Set when this token was superseded by a rotation. Being superseded is
     * not an error — a client whose response was lost still holds it — so it
     * stays usable to mint a sibling for a short window after this instant.
     */
    rotatedAt?: Date | null;
    /** Hard kill (logout, remote session revoke). Never usable again. */
    revoked?: boolean;
    /** When the sign-in happened; carried across rotations, unlike createdAt. */
    sessionStartedAt?: Date;
    /**
     * The assurance level this session was established at. See
     * {@link RefreshTokenSession.aal} — refresh reads it from here and mints
     * the replacement access token at the same level.
     *
     * Absent on rows written before this column existed, and on repositories
     * that do not store it; both read as `aal1`, the restrictive value.
     */
    aal?: "aal1" | "aal2";
}

/**
 * Identity of the sign-in a refresh token belongs to, threaded through
 * rotation so descendants stay grouped.
 */
export interface RefreshTokenSession {
    id: string;
    startedAt: Date;
    /**
     * How this session was established: `aal2` only where a second factor was
     * actually presented.
     *
     * Persisted because refresh has nothing else to go on. Deriving it at
     * refresh time from "does this user have a factor?" would promote every
     * pre-existing password-only session of a user who later enrolled — the
     * assurance level is a property of the *sign-in*, not of the account.
     */
    aal?: "aal1" | "aal2";
}

/**
 * Password reset token info
 */
export interface PasswordResetTokenInfo {
    uid: string;
    expiresAt: Date;
}

/**
 * Magic link token info
 */
export interface MagicLinkTokenInfo {
    uid: string;
    expiresAt: Date;
}

// =============================================================================
// AUTH REPOSITORY INTERFACES
// =============================================================================

/**
 * Options for paginated user listing
 */
export interface ListUsersOptions {
    /** Max results per page (default 25) */
    limit?: number;
    /** Number of results to skip (default 0) */
    offset?: number;
    /** Search term — matches against email and displayName (case-insensitive) */
    search?: string;
    /** Field to sort by (default "createdAt") */
    orderBy?: string;
    /** Sort direction (default "desc") */
    orderDir?: "asc" | "desc";
    /** Filter by role ID */
    roleId?: string;
}

/**
 * Result of a paginated user listing
 */
export interface PaginatedUsersResult {
    users: UserData[];
    /** Total number of users matching the filters (ignoring limit/offset) */
    total: number;
    limit: number;
    offset: number;
}

/**
 * Abstract user repository interface.
 * Handles all user-related database operations.
 */
export interface UserRepository {
    /**
     * Create a new user
     */
    createUser(data: CreateUserData): Promise<UserData>;

    /**
     * Get a user by ID
     */
    getUserById(id: string): Promise<UserData | null>;

    /**
     * Get a user by email
     */
    getUserByEmail(email: string): Promise<UserData | null>;

    /**
     * Get a user by an OAuth identity
     */
    getUserByIdentity(provider: string, providerId: string): Promise<UserData | null>;

    /**
     * Get all identities linked to a user
     */
    getUserIdentities(uid: string): Promise<UserIdentityData[]>;

    /**
     * Link a new OAuth identity to a user
     */
    linkUserIdentity(uid: string, provider: string, providerId: string, profileData?: Record<string, unknown>): Promise<void>;

    /**
     * Update a user
     */
    updateUser(id: string, data: Partial<Omit<CreateUserData, "id">>): Promise<UserData | null>;

    /**
     * Delete a user
     */
    deleteUser(id: string): Promise<void>;

    /**
     * List all users (unbounded — use listUsersPaginated for large datasets)
     */
    listUsers(): Promise<UserData[]>;

    /**
     * List users with server-side pagination, search, and sorting.
     */
    listUsersPaginated(options?: ListUsersOptions): Promise<PaginatedUsersResult>;

    /**
     * Update user's password hash
     */
    updatePassword(id: string, passwordHash: string): Promise<void>;

    /**
     * Set email verification status
     */
    setEmailVerified(id: string, verified: boolean): Promise<void>;

    /**
     * Set email verification token
     */
    setVerificationToken(id: string, token: string | null): Promise<void>;

    /**
     * Find user by email verification token
     */
    getUserByVerificationToken(token: string): Promise<UserData | null>;

    /**
     * Get roles for a user
     */
    getUserRoles(uid: string): Promise<RoleData[]>;

    /**
     * Get role IDs for a user
     */
    getUserRoleIds(uid: string): Promise<string[]>;

    /**
     * Set roles for a user (replaces existing roles)
     */
    setUserRoles(uid: string, roleIds: string[]): Promise<void>;

    /**
     * Assign a specific role to a new user
     */
    assignDefaultRole(uid: string, roleId: string): Promise<void>;

    /**
     * Get user with their roles
     */
    getUserWithRoles(uid: string): Promise<{ user: UserData; roles: RoleData[] } | null>;
}

/**
 * Abstract role repository interface.
 * Handles all role-related database operations.
 */
export interface RoleRepository {
    /**
     * Get a role by ID
     */
    getRoleById(id: string): Promise<RoleData | null>;

    /**
     * List all roles
     */
    listRoles(): Promise<RoleData[]>;

    /**
     * Create a new role
     */
    createRole(data: CreateRoleData): Promise<RoleData>;

    /**
     * Update a role
     */
    updateRole(id: string, data: Partial<Omit<RoleData, "id">>): Promise<RoleData | null>;

    /**
     * Delete a role
     */
    deleteRole(id: string): Promise<void>;
}

/**
 * Abstract token repository interface.
 * Handles refresh tokens and password reset tokens.
 */
export interface TokenRepository {
    // Refresh tokens

    /**
     * Create a new refresh token.
     *
     * `session` groups this token with the sign-in it descends from. It is
     * optional so that repositories written against an older release keep
     * satisfying this interface; implementations that ignore it degrade to one
     * session per token.
     */
    createRefreshToken(uid: string, tokenHash: string, expiresAt: Date, userAgent?: string, ipAddress?: string, session?: RefreshTokenSession): Promise<void>;

    /**
     * Mark a token as superseded by a rotation, WITHOUT making it unusable.
     *
     * The distinction from deletion is the entire point: a client that never
     * received the rotated response still holds this token, and must be able
     * to present it and be recognised. Implementations that omit this method
     * fall back to {@link TokenRepository.deleteRefreshToken}, which restores
     * the old, lossy behaviour.
     */
    markRefreshTokenRotated?(tokenHash: string): Promise<void>;

    /**
     * Hard-kill every token of one sign-in (logout, remote session revoke).
     * Unlike rotation this is final — no grace, no replay.
     */
    revokeRefreshTokenSession?(sessionId: string): Promise<void>;

    /**
     * Drop tokens of a session that were superseded before `supersededBefore`,
     * plus anything already expired. Keeps rotation from growing a row per
     * refresh forever; called opportunistically, never load-bearing.
     */
    pruneRefreshTokens?(uid: string, sessionId: string, supersededBefore: Date): Promise<void>;

    /**
     * The instant before which every session of this user is void, or null if
     * none is set. See `users.tokens_valid_after`.
     */
    getTokensValidAfter?(uid: string): Promise<Date | null>;

    /**
     * Void every session that began before `at`. Set alongside deleting the
     * user's tokens so a rotation racing the delete cannot survive it.
     */
    setTokensValidAfter?(uid: string, at: Date): Promise<void>;

    /**
     * Find a refresh token by hash
     */
    findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenInfo | null>;

    /**
     * Delete a refresh token by hash
     */
    deleteRefreshToken(tokenHash: string): Promise<void>;

    /**
     * Delete all refresh tokens for a user
     */
    deleteAllRefreshTokensForUser(uid: string): Promise<void>;

    /**
     * List all refresh tokens for a user
     */
    listRefreshTokensForUser(uid: string): Promise<RefreshTokenInfo[]>;

    /**
     * Delete a specific refresh token by its primary key ID
     */
    deleteRefreshTokenById(id: string, uid: string): Promise<void>;

    // Password reset tokens

    /**
     * Create a password reset token
     */
    createPasswordResetToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void>;

    /**
     * Find a valid (not expired, not used) password reset token by hash
     */
    findValidPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenInfo | null>;

    /**
     * Mark a password reset token as used
     */
    markPasswordResetTokenUsed(tokenHash: string): Promise<void>;

    /**
     * Delete all password reset tokens for a user
     */
    deleteAllPasswordResetTokensForUser(uid: string): Promise<void>;

    /**
     * Clean up expired tokens
     */
    deleteExpiredTokens(): Promise<void>;

    // Magic link tokens

    /**
     * Create a magic link token
     */
    createMagicLinkToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void>;

    /**
     * Find a valid (not expired, not used) magic link token by hash
     */
    findValidMagicLinkToken(tokenHash: string): Promise<MagicLinkTokenInfo | null>;

    /**
     * Mark a magic link token as used
     */
    markMagicLinkTokenUsed(tokenHash: string): Promise<void>;
}

// =============================================================================
// MFA INTERFACES
// =============================================================================

/**
 * MFA factor data structure
 */
export interface MfaFactor {
    id: string;
    uid: string;
    factorType: "totp";
    friendlyName?: string;
    verified: boolean;
    createdAt: Date;
    updatedAt: Date;
    /**
     * The highest TOTP time step ever accepted for this factor. A code whose
     * step is at or below it has already been spent — see
     * {@link MfaRepository.claimMfaFactorCounter}.
     */
    lastUsedCounter?: number | null;
}

/**
 * MFA challenge information
 */
export interface MfaChallengeInfo {
    id: string;
    factorId: string;
    createdAt: Date;
    verifiedAt?: Date;
    ipAddress?: string;
    /** Failed verifications recorded against this challenge so far. */
    attempts?: number;
}

/**
 * Recovery code data structure
 */
export interface RecoveryCode {
    id: string;
    uid: string;
    usedAt?: Date;
}

/**
 * Abstract MFA repository interface.
 * Handles all MFA-related database operations.
 */
export interface MfaRepository {
    /**
     * Create a new MFA factor for a user
     */
    createMfaFactor(uid: string, factorType: "totp", secretEncrypted: string, friendlyName?: string): Promise<MfaFactor>;

    /**
     * Get all MFA factors for a user
     */
    getMfaFactors(uid: string): Promise<MfaFactor[]>;

    /**
     * Get a specific MFA factor by ID
     */
    getMfaFactorById(factorId: string): Promise<(MfaFactor & { secretEncrypted: string }) | null>;

    /**
     * Mark an MFA factor as verified
     */
    verifyMfaFactor(factorId: string): Promise<void>;

    /**
     * Delete an MFA factor
     */
    deleteMfaFactor(factorId: string, uid: string): Promise<void>;

    /**
     * Create an MFA challenge
     */
    createMfaChallenge(factorId: string, ipAddress?: string): Promise<MfaChallengeInfo>;

    /**
     * Get an MFA challenge by ID
     */
    getMfaChallengeById(challengeId: string): Promise<MfaChallengeInfo | null>;

    /**
     * Mark an MFA challenge as verified
     */
    verifyMfaChallenge(challengeId: string): Promise<void>;

    /**
     * Create recovery codes for a user
     */
    createRecoveryCodes(uid: string, codeHashes: string[]): Promise<void>;

    /**
     * Use a recovery code (mark as used)
     */
    useRecoveryCode(uid: string, codeHash: string): Promise<boolean>;

    /**
     * Get unused recovery code count for a user
     */
    getUnusedRecoveryCodeCount(uid: string): Promise<number>;

    /**
     * Delete all recovery codes for a user
     */
    deleteAllRecoveryCodes(uid: string): Promise<void>;

    /**
     * Check if a user has any verified MFA factors
     */
    hasVerifiedMfaFactors(uid: string): Promise<boolean>;

    /**
     * Claim a TOTP time step for a factor: succeed once, then never again for
     * that step or any earlier one.
     *
     * One statement, claim-and-act — `UPDATE … WHERE last_used_counter IS NULL
     * OR last_used_counter < $counter RETURNING id`. A read-then-write would
     * let two requests carrying the same code both pass the check before either
     * wrote, which is precisely the replay this exists to stop.
     *
     * Optional so a repository written against an older release still compiles;
     * where it is absent, an accepted code stays replayable for the rest of its
     * window and the route says so in the log.
     *
     * @returns true when the step was claimed by this call, false when it had
     *          already been spent.
     */
    claimMfaFactorCounter?(factorId: string, counter: number): Promise<boolean>;

    /**
     * Record a failed verification against a challenge and return the new
     * total. Atomic (`UPDATE … SET attempts = attempts + 1 RETURNING attempts`)
     * so concurrent guesses cannot share one increment.
     *
     * Optional; where it is absent the route falls back to the rate limiters
     * alone.
     */
    recordMfaChallengeAttempt?(challengeId: string): Promise<number>;
}

/**
 * Combined auth repository interface for convenience
 */
export interface AuthRepository extends UserRepository, RoleRepository, TokenRepository, MfaRepository { }
