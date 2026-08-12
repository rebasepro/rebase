import { Db, ObjectId } from "mongodb";
import { normalizeEmail } from "@rebasepro/common";

/** Loose document type that allows string _id values (Rebase convention). */
export interface MongoDoc { _id?: string; [key: string]: any; }
import {
    UserRepository,
    RoleRepository,
    TokenRepository,
    AuthRepository,
    UserData,
    CreateUserData,
    RoleData,
    CreateRoleData,
    RefreshTokenInfo,
    RefreshTokenSession,
    PasswordResetTokenInfo,
    MagicLinkTokenInfo,
    UserIdentityData,
    ListUsersOptions,
    PaginatedUsersResult,
    MfaFactor,
    MfaChallengeInfo,
    ApiError
} from "@rebasepro/server";

export type Role = RoleData;

function escapeRegExp(str: string): string {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function toUser(doc: any): UserData {
    return {
        id: doc._id || doc.id,
        email: doc.email,
        passwordHash: doc.passwordHash ?? null,
        displayName: doc.displayName ?? null,
        photoUrl: doc.photoUrl ?? null,
        emailVerified: doc.emailVerified ?? false,
        emailVerificationToken: doc.emailVerificationToken ?? null,
        emailVerificationSentAt: doc.emailVerificationSentAt ? new Date(doc.emailVerificationSentAt) : null,
        createdAt: new Date(doc.createdAt),
        updatedAt: new Date(doc.updatedAt)
    };
}

export class MongoUserService implements UserRepository {
    constructor(private db: Db) {}

    private get collection() {
        return this.db.collection<MongoDoc>("rebase_users");
    }

    private get identitiesCollection() {
        return this.db.collection<MongoDoc>("rebase_user_identities");
    }

    private get userRolesCollection() {
        return this.db.collection<MongoDoc>("rebase_user_roles");
    }

    private get rolesCollection() {
        return this.db.collection<MongoDoc>("rebase_roles");
    }

    async createUser(data: CreateUserData): Promise<UserData> {
        const id = new ObjectId().toString();
        const now = new Date();
        const doc = {
            _id: id,
            id,
            email: normalizeEmail(data.email),
            passwordHash: data.passwordHash ?? null,
            displayName: data.displayName ?? null,
            photoUrl: data.photoUrl ?? null,
            emailVerified: data.emailVerified ?? false,
            createdAt: now,
            updatedAt: now
        };
        try {
            await this.collection.insertOne(doc);
        } catch (error) {
            // 11000 is Mongo's duplicate key, and the unique index on `email`
            // in `ensure-collections.ts` is what raises it. Same answer as
            // Postgres gives for its 23505, and the same answer the route
            // gives when its pre-check sees the row — see
            // `UserRepository.createUser`.
            if ((error as { code?: number })?.code === 11000) {
                throw ApiError.conflict("Email already registered", "EMAIL_EXISTS");
            }
            throw error;
        }
        return toUser(doc);
    }

    async getUserById(id: string): Promise<UserData | null> {
        const doc = await this.collection.findOne({ id });
        return doc ? toUser(doc) : null;
    }

    async getUserByEmail(email: string): Promise<UserData | null> {
        const doc = await this.collection.findOne({ email: normalizeEmail(email) });
        return doc ? toUser(doc) : null;
    }

    async getUserByIdentity(provider: string, providerId: string): Promise<UserData | null> {
        const identity = await this.identitiesCollection.findOne({ provider,
providerId });
        if (!identity) return null;
        return this.getUserById(identity.uid);
    }

    async getUserIdentities(uid: string): Promise<UserIdentityData[]> {
        const docs = await this.identitiesCollection.find({ uid }).toArray();
        return docs.map(doc => ({
            id: doc.id,
            uid: doc.uid,
            provider: doc.provider,
            providerId: doc.providerId,
            profileData: doc.profileData ?? null,
            createdAt: new Date(doc.createdAt),
            updatedAt: new Date(doc.updatedAt)
        }));
    }

    async linkUserIdentity(uid: string, provider: string, providerId: string, profileData?: Record<string, unknown>): Promise<void> {
        const now = new Date();
        await this.identitiesCollection.updateOne(
            { provider,
providerId },
            {
                $setOnInsert: {
                    _id: new ObjectId().toString(),
                    id: new ObjectId().toString(),
                    uid,
                    provider,
                    providerId,
                    createdAt: now
                },
                $set: {
                    profileData: profileData ?? null,
                    updatedAt: now
                }
            },
            { upsert: true }
        );
    }

    async updateUser(id: string, data: Partial<Omit<CreateUserData, "id">>): Promise<UserData | null> {
        const updateData: Record<string, unknown> = { ...data,
updatedAt: new Date() };
        if (typeof updateData.email === "string") updateData.email = normalizeEmail(updateData.email);

        await this.collection.updateOne({ id }, { $set: updateData });
        return this.getUserById(id);
    }

    async deleteUser(id: string): Promise<void> {
        await this.collection.deleteOne({ id });
        await this.identitiesCollection.deleteMany({ uid: id });
        await this.userRolesCollection.deleteMany({ uid: id });
    }

    async listUsers(): Promise<UserData[]> {
        const docs = await this.collection.find().toArray();
        return docs.map(toUser);
    }

    async listUsersPaginated(options?: ListUsersOptions): Promise<PaginatedUsersResult> {
        const limit = options?.limit ?? 25;
        const offset = options?.offset ?? 0;
        const search = options?.search?.trim() || "";
        const orderBy = options?.orderBy || "createdAt";
        const orderDir = options?.orderDir || "desc";
        const roleId = options?.roleId;

        const query: Record<string, unknown> = {};

        if (search) {
            const escapedSearch = escapeRegExp(search);
            query.$or = [
                { email: { $regex: escapedSearch,
$options: "i" } },
                { displayName: { $regex: escapedSearch,
$options: "i" } }
            ];
        }

        if (roleId) {
            const userRoles = await this.userRolesCollection.find({ roleId }).toArray();
            const userIds = userRoles.map(ur => ur.uid);
            query.id = { $in: userIds };
        }

        const sort: Record<string, 1 | -1> = {};
        sort[orderBy] = orderDir === "asc" ? 1 : -1;

        const total = await this.collection.countDocuments(query);
        const docs = await this.collection.find(query).sort(sort).skip(offset).limit(limit).toArray();

        return {
            users: docs.map(toUser),
            total,
            limit,
            offset
        };
    }

    async updatePassword(id: string, passwordHash: string): Promise<void> {
        await this.collection.updateOne(
            { id },
            { $set: { passwordHash,
updatedAt: new Date() } }
        );
    }

    async setEmailVerified(id: string, verified: boolean): Promise<void> {
        await this.collection.updateOne(
            { id },
            { $set: { emailVerified: verified,
emailVerificationToken: null,
updatedAt: new Date() } }
        );
    }

    async setVerificationToken(id: string, token: string | null): Promise<void> {
        await this.collection.updateOne(
            { id },
            { $set: { emailVerificationToken: token,
emailVerificationSentAt: token ? new Date() : null,
updatedAt: new Date() } }
        );
    }

    async getUserByVerificationToken(token: string): Promise<UserData | null> {
        const doc = await this.collection.findOne({ emailVerificationToken: token });
        return doc ? toUser(doc) : null;
    }

    async getUserRoles(uid: string): Promise<RoleData[]> {
        const userRoles = await this.userRolesCollection.find({ uid }).toArray();
        const roleIds = userRoles.map(ur => ur.roleId);
        if (roleIds.length === 0) return [];

        const roles = await this.rolesCollection.find({ id: { $in: roleIds } }).toArray();
        return roles.map(r => ({
            id: r.id,
            name: r.name,
            isAdmin: r.isAdmin ?? false,
            defaultPermissions: r.defaultPermissions ?? null,
            collectionPermissions: r.collectionPermissions ?? null
        }));
    }

    async getUserRoleIds(uid: string): Promise<string[]> {
        const userRoles = await this.userRolesCollection.find({ uid }).toArray();
        return userRoles.map(ur => ur.roleId);
    }

    async setUserRoles(uid: string, roleIds: string[]): Promise<void> {
        await this.userRolesCollection.deleteMany({ uid });
            if (roleIds.length > 0) {
            const docs = roleIds.map(roleId => ({
                _id: new ObjectId().toString(),
                uid,
                roleId
            }));
            await this.userRolesCollection.insertMany(docs);
        }
    }

    async assignDefaultRole(uid: string, roleId: string): Promise<void> {
        await this.userRolesCollection.updateOne(
            { uid,
roleId },
            { $setOnInsert: { _id: new ObjectId().toString(),
uid,
roleId } },
            { upsert: true }
        );
    }

    async getUserWithRoles(uid: string): Promise<{ user: UserData; roles: RoleData[] } | null> {
        const user = await this.getUserById(uid);
        if (!user) return null;
        const roles = await this.getUserRoles(uid);
        return { user,
roles };
    }
}

export class MongoRoleService implements RoleRepository {
    constructor(private db: Db) {}

    private get collection() {
        return this.db.collection<MongoDoc>("rebase_roles");
    }

    async getRoleById(id: string): Promise<RoleData | null> {
        const doc = await this.collection.findOne({ id });
        if (!doc) return null;
        return {
            id: doc.id,
            name: doc.name,
            isAdmin: doc.isAdmin ?? false,
            defaultPermissions: doc.defaultPermissions ?? null,
            collectionPermissions: doc.collectionPermissions ?? null
        };
    }

    async listRoles(): Promise<RoleData[]> {
        const docs = await this.collection.find().sort({ name: 1 }).toArray();
        return docs.map(doc => ({
            id: doc.id,
            name: doc.name,
            isAdmin: doc.isAdmin ?? false,
            defaultPermissions: doc.defaultPermissions ?? null,
            collectionPermissions: doc.collectionPermissions ?? null
        }));
    }

    async createRole(data: CreateRoleData): Promise<RoleData> {
        const doc = {
            _id: data.id,
            id: data.id,
            name: data.name,
            isAdmin: data.isAdmin ?? false,
            defaultPermissions: data.defaultPermissions ?? null,
            collectionPermissions: data.collectionPermissions ?? null
        };
        await this.collection.insertOne(doc);
        return { ...doc } as RoleData;
    }

    async updateRole(id: string, data: Partial<Omit<RoleData, "id">>): Promise<RoleData | null> {
        await this.collection.updateOne({ id }, { $set: data });
        return this.getRoleById(id);
    }

    async deleteRole(id: string): Promise<void> {
        await this.collection.deleteOne({ id });
        await this.db.collection("rebase_user_roles").deleteMany({ roleId: id });
    }
}

export class MongoRefreshTokenService {
    constructor(private db: Db) {}

    private get collection() {
        return this.db.collection<MongoDoc>("rebase_refresh_tokens");
    }

    private toInfo(doc: MongoDoc): RefreshTokenInfo {
        return {
            id: doc.id,
            uid: doc.uid,
            tokenHash: doc.tokenHash,
            expiresAt: new Date(doc.expiresAt),
            createdAt: new Date(doc.createdAt),
            userAgent: doc.userAgent,
            ipAddress: doc.ipAddress,
            sessionId: doc.sessionId,
            rotatedAt: doc.rotatedAt ? new Date(doc.rotatedAt) : null,
            revoked: Boolean(doc.revoked),
            sessionStartedAt: new Date(doc.sessionStartedAt || doc.createdAt)
        };
    }

    async createToken(
        uid: string,
        tokenHash: string,
        expiresAt: Date,
        userAgent?: string,
        ipAddress?: string,
        session?: RefreshTokenSession
    ): Promise<void> {
        const safeUserAgent = userAgent || "";
        const safeIpAddress = ipAddress || "";

        // No deleteMany first. Tokens of one sign-in accumulate under a shared
        // sessionId and are pruned once nobody can still be holding them —
        // evicting by (uid, userAgent, ipAddress) is what used to sign out a
        // second browser profile behind the same address.
        const now = new Date();
        await this.collection.insertOne({
            _id: new ObjectId().toString(),
            id: new ObjectId().toString(),
            uid,
            tokenHash,
            expiresAt,
            createdAt: now,
            userAgent: safeUserAgent,
            ipAddress: safeIpAddress,
            sessionId: session?.id ?? new ObjectId().toString(),
            sessionStartedAt: session?.startedAt ?? now,
            rotatedAt: null,
            revoked: false
        });
    }

    async findByHash(tokenHash: string): Promise<RefreshTokenInfo | null> {
        const doc = await this.collection.findOne({ tokenHash });
        return doc ? this.toInfo(doc) : null;
    }

    /** Superseded, not gone — see the Postgres service for why that matters. */
    async markRotated(tokenHash: string): Promise<void> {
        await this.collection.updateOne({ tokenHash }, { $set: { rotatedAt: new Date() } });
    }

    async revokeSession(sessionId: string): Promise<void> {
        await this.collection.updateMany(
            { sessionId },
            { $set: { revoked: true, rotatedAt: new Date() } }
        );
    }

    async prune(uid: string, sessionId: string, supersededBefore: Date): Promise<void> {
        await this.collection.deleteMany({
            uid,
            $or: [
                { expiresAt: { $lt: new Date() } },
                { sessionId, rotatedAt: { $ne: null, $lt: supersededBefore } }
            ]
        });
    }

    async getTokensValidAfter(uid: string): Promise<Date | null> {
        const user = await this.db.collection<MongoDoc>("rebase_users").findOne({ id: uid });
        return user?.tokensValidAfter ? new Date(user.tokensValidAfter) : null;
    }

    async setTokensValidAfter(uid: string, at: Date): Promise<void> {
        await this.db.collection<MongoDoc>("rebase_users")
            .updateOne({ id: uid }, { $set: { tokensValidAfter: at } });
    }

    async deleteByHash(tokenHash: string): Promise<void> {
        await this.collection.deleteOne({ tokenHash });
    }

    async deleteAllForUser(uid: string): Promise<void> {
        await this.collection.deleteMany({ uid });
    }

    async listForUser(uid: string): Promise<RefreshTokenInfo[]> {
        const docs = await this.collection.find({ uid }).sort({ createdAt: 1 }).toArray();
        return docs.map(doc => this.toInfo(doc));
    }

    async deleteById(id: string, uid: string): Promise<void> {
        await this.collection.deleteOne({ id,
uid });
    }
}

export class MongoPasswordResetTokenService {
    constructor(private db: Db) {}

    private get collection() {
        return this.db.collection<MongoDoc>("rebase_password_reset_tokens");
    }

    async createToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void> {
        await this.collection.deleteMany({ uid,
usedAt: null });

        await this.collection.insertOne({
            _id: new ObjectId().toString(),
            uid,
            tokenHash,
            expiresAt,
            usedAt: null
        });
    }

    async findValidByHash(tokenHash: string): Promise<{ uid: string; expiresAt: Date } | null> {
        const doc = await this.collection.findOne({
            tokenHash,
            usedAt: null,
            expiresAt: { $gt: new Date() }
        });

        if (!doc) return null;

        return {
            uid: doc.uid,
            expiresAt: new Date(doc.expiresAt)
        };
    }

    async markAsUsed(tokenHash: string): Promise<void> {
        await this.collection.updateOne(
            { tokenHash },
            { $set: { usedAt: new Date() } }
        );
    }

    async deleteAllForUser(uid: string): Promise<void> {
        await this.collection.deleteMany({ uid });
    }

    async deleteExpired(): Promise<void> {
        await this.collection.deleteMany({ expiresAt: { $lt: new Date() } });
    }
}

export class MongoTokenRepository implements TokenRepository {
    private refreshTokenService: MongoRefreshTokenService;
    private passwordResetTokenService: MongoPasswordResetTokenService;

    constructor(private db: Db) {
        this.refreshTokenService = new MongoRefreshTokenService(db);
        this.passwordResetTokenService = new MongoPasswordResetTokenService(db);
    }

    async createRefreshToken(uid: string, tokenHash: string, expiresAt: Date, userAgent?: string, ipAddress?: string, session?: RefreshTokenSession): Promise<void> {
        await this.refreshTokenService.createToken(uid, tokenHash, expiresAt, userAgent, ipAddress, session);
    }

    async markRefreshTokenRotated(tokenHash: string): Promise<void> {
        await this.refreshTokenService.markRotated(tokenHash);
    }

    async revokeRefreshTokenSession(sessionId: string): Promise<void> {
        await this.refreshTokenService.revokeSession(sessionId);
    }

    async pruneRefreshTokens(uid: string, sessionId: string, supersededBefore: Date): Promise<void> {
        await this.refreshTokenService.prune(uid, sessionId, supersededBefore);
    }

    async getTokensValidAfter(uid: string): Promise<Date | null> {
        return this.refreshTokenService.getTokensValidAfter(uid);
    }

    async setTokensValidAfter(uid: string, at: Date): Promise<void> {
        await this.refreshTokenService.setTokensValidAfter(uid, at);
    }

    async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenInfo | null> {
        return this.refreshTokenService.findByHash(tokenHash);
    }

    async deleteRefreshToken(tokenHash: string): Promise<void> {
        await this.refreshTokenService.deleteByHash(tokenHash);
    }

    async deleteAllRefreshTokensForUser(uid: string): Promise<void> {
        await this.refreshTokenService.deleteAllForUser(uid);
    }

    async listRefreshTokensForUser(uid: string): Promise<RefreshTokenInfo[]> {
        return this.refreshTokenService.listForUser(uid);
    }

    async deleteRefreshTokenById(id: string, uid: string): Promise<void> {
        await this.refreshTokenService.deleteById(id, uid);
    }

    async createPasswordResetToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void> {
        await this.passwordResetTokenService.createToken(uid, tokenHash, expiresAt);
    }

    async findValidPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenInfo | null> {
        return this.passwordResetTokenService.findValidByHash(tokenHash);
    }

    async markPasswordResetTokenUsed(tokenHash: string): Promise<void> {
        await this.passwordResetTokenService.markAsUsed(tokenHash);
    }

    async deleteAllPasswordResetTokensForUser(uid: string): Promise<void> {
        await this.passwordResetTokenService.deleteAllForUser(uid);
    }

    async deleteExpiredTokens(): Promise<void> {
        await this.passwordResetTokenService.deleteExpired();
    }

    // Magic link token operations

    async createMagicLinkToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void> {
        const col = this.db.collection("magic_link_tokens");
        await col.deleteMany({ uid, usedAt: null });
        await col.insertOne({ uid, tokenHash, expiresAt, usedAt: null, createdAt: new Date() });
    }

    async findValidMagicLinkToken(tokenHash: string): Promise<MagicLinkTokenInfo | null> {
        const col = this.db.collection("magic_link_tokens");
        const doc = await col.findOne({ tokenHash, usedAt: null, expiresAt: { $gt: new Date() } });
        if (!doc) return null;
        return { uid: doc.uid as string, expiresAt: doc.expiresAt as Date };
    }

    async markMagicLinkTokenUsed(tokenHash: string): Promise<void> {
        const col = this.db.collection("magic_link_tokens");
        await col.updateOne({ tokenHash }, { $set: { usedAt: new Date() } });
    }
}

export class MongoAuthRepository implements AuthRepository {
    private userService: MongoUserService;
    private roleService: MongoRoleService;
    private tokenRepository: MongoTokenRepository;

    constructor(private db: Db) {
        this.userService = new MongoUserService(db);
        this.roleService = new MongoRoleService(db);
        this.tokenRepository = new MongoTokenRepository(db);
    }

    async createUser(data: CreateUserData): Promise<UserData> {
        return this.userService.createUser(data);
    }

    async getUserById(id: string): Promise<UserData | null> {
        return this.userService.getUserById(id);
    }

    async getUserByEmail(email: string): Promise<UserData | null> {
        return this.userService.getUserByEmail(email);
    }

    async getUserByIdentity(provider: string, providerId: string): Promise<UserData | null> {
        return this.userService.getUserByIdentity(provider, providerId);
    }

    async getUserIdentities(uid: string): Promise<UserIdentityData[]> {
        return this.userService.getUserIdentities(uid);
    }

    async linkUserIdentity(uid: string, provider: string, providerId: string, profileData?: Record<string, unknown>): Promise<void> {
        return this.userService.linkUserIdentity(uid, provider, providerId, profileData);
    }

    async updateUser(id: string, data: Partial<Omit<CreateUserData, "id">>): Promise<UserData | null> {
        return this.userService.updateUser(id, data);
    }

    async deleteUser(id: string): Promise<void> {
        await this.userService.deleteUser(id);
    }

    async listUsers(): Promise<UserData[]> {
        return this.userService.listUsers();
    }

    async listUsersPaginated(options?: ListUsersOptions): Promise<PaginatedUsersResult> {
        return this.userService.listUsersPaginated(options);
    }

    async updatePassword(id: string, passwordHash: string): Promise<void> {
        await this.userService.updatePassword(id, passwordHash);
    }

    async setEmailVerified(id: string, verified: boolean): Promise<void> {
        await this.userService.setEmailVerified(id, verified);
    }

    async setVerificationToken(id: string, token: string | null): Promise<void> {
        await this.userService.setVerificationToken(id, token);
    }

    async getUserByVerificationToken(token: string): Promise<UserData | null> {
        return this.userService.getUserByVerificationToken(token);
    }

    async getUserRoles(uid: string): Promise<RoleData[]> {
        return this.userService.getUserRoles(uid);
    }

    async getUserRoleIds(uid: string): Promise<string[]> {
        return this.userService.getUserRoleIds(uid);
    }

    async setUserRoles(uid: string, roleIds: string[]): Promise<void> {
        await this.userService.setUserRoles(uid, roleIds);
    }

    async assignDefaultRole(uid: string, roleId: string): Promise<void> {
        await this.userService.assignDefaultRole(uid, roleId);
    }

    async getUserWithRoles(uid: string): Promise<{ user: UserData; roles: RoleData[] } | null> {
        return this.userService.getUserWithRoles(uid);
    }

    async getRoleById(id: string): Promise<RoleData | null> {
        return this.roleService.getRoleById(id);
    }

    async listRoles(): Promise<RoleData[]> {
        return this.roleService.listRoles();
    }

    async createRole(data: CreateRoleData): Promise<RoleData> {
        return this.roleService.createRole(data);
    }

    async updateRole(id: string, data: Partial<Omit<RoleData, "id">>): Promise<RoleData | null> {
        return this.roleService.updateRole(id, data);
    }

    async deleteRole(id: string): Promise<void> {
        await this.roleService.deleteRole(id);
    }

    async createRefreshToken(uid: string, tokenHash: string, expiresAt: Date, userAgent?: string, ipAddress?: string, session?: RefreshTokenSession): Promise<void> {
        await this.tokenRepository.createRefreshToken(uid, tokenHash, expiresAt, userAgent, ipAddress, session);
    }

    async markRefreshTokenRotated(tokenHash: string): Promise<void> {
        await this.tokenRepository.markRefreshTokenRotated(tokenHash);
    }

    async revokeRefreshTokenSession(sessionId: string): Promise<void> {
        await this.tokenRepository.revokeRefreshTokenSession(sessionId);
    }

    async pruneRefreshTokens(uid: string, sessionId: string, supersededBefore: Date): Promise<void> {
        await this.tokenRepository.pruneRefreshTokens(uid, sessionId, supersededBefore);
    }

    async getTokensValidAfter(uid: string): Promise<Date | null> {
        return this.tokenRepository.getTokensValidAfter(uid);
    }

    async setTokensValidAfter(uid: string, at: Date): Promise<void> {
        await this.tokenRepository.setTokensValidAfter(uid, at);
    }

    async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenInfo | null> {
        return this.tokenRepository.findRefreshTokenByHash(tokenHash);
    }

    async deleteRefreshToken(tokenHash: string): Promise<void> {
        await this.tokenRepository.deleteRefreshToken(tokenHash);
    }

    async deleteAllRefreshTokensForUser(uid: string): Promise<void> {
        await this.tokenRepository.deleteAllRefreshTokensForUser(uid);
    }

    async listRefreshTokensForUser(uid: string): Promise<RefreshTokenInfo[]> {
        return this.tokenRepository.listRefreshTokensForUser(uid);
    }

    async deleteRefreshTokenById(id: string, uid: string): Promise<void> {
        await this.tokenRepository.deleteRefreshTokenById(id, uid);
    }

    async createPasswordResetToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void> {
        await this.tokenRepository.createPasswordResetToken(uid, tokenHash, expiresAt);
    }

    async findValidPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenInfo | null> {
        return this.tokenRepository.findValidPasswordResetToken(tokenHash);
    }

    async markPasswordResetTokenUsed(tokenHash: string): Promise<void> {
        await this.tokenRepository.markPasswordResetTokenUsed(tokenHash);
    }

    async deleteAllPasswordResetTokensForUser(uid: string): Promise<void> {
        await this.tokenRepository.deleteAllPasswordResetTokensForUser(uid);
    }

    async deleteExpiredTokens(): Promise<void> {
        await this.tokenRepository.deleteExpiredTokens();
    }

    // Magic link token operations

    async createMagicLinkToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void> {
        await this.tokenRepository.createMagicLinkToken(uid, tokenHash, expiresAt);
    }

    async findValidMagicLinkToken(tokenHash: string): Promise<MagicLinkTokenInfo | null> {
        return this.tokenRepository.findValidMagicLinkToken(tokenHash);
    }

    async markMagicLinkTokenUsed(tokenHash: string): Promise<void> {
        await this.tokenRepository.markMagicLinkTokenUsed(tokenHash);
    }

    // ── MFA: not implemented on this engine ──────────────────────────────
    //
    // The routes are mounted for every backend, so `POST /auth/mfa/enroll`
    // is live here and reaches these. Throwing a bare `Error` made every one
    // of them a 500 — and a 500's message is sanitized on the way out, so the
    // caller was told "Internal Server Error" while the reason stayed in the
    // server log. Someone turning on two-factor auth got a server fault
    // instead of an answer, every time, on this engine.
    //
    // 501 with the reason, which is what `init.ts` already does for an admin
    // surface it mounts and cannot serve: "they answer 501 instead, and stay
    // mounted to say why". The reads below stay as they are — no factor can
    // exist here, so `[]`, `null` and `false` are true rather than merely
    // convenient, and `assertMfaSatisfied` reading `false` correctly leaves
    // the login gate inert.
    async createMfaFactor(uid: string, factorType: "totp", secretEncrypted: string, friendlyName?: string): Promise<MfaFactor> {
        throw new ApiError(
            501,
            "MFA_NOT_SUPPORTED",
            "Multi-factor authentication is not implemented for the MongoDB backend, so a factor cannot be stored. Use a Postgres data source for accounts that need a second factor."
        );
    }
    async getMfaFactors(uid: string): Promise<MfaFactor[]> {
        return [];
    }
    async getMfaFactorById(factorId: string): Promise<(MfaFactor & { secretEncrypted: string }) | null> {
        return null;
    }
    async verifyMfaFactor(factorId: string): Promise<void> {
        throw new ApiError(
            501,
            "MFA_NOT_SUPPORTED",
            "Multi-factor authentication is not implemented for the MongoDB backend, so a factor's verification cannot be stored. Use a Postgres data source for accounts that need a second factor."
        );
    }
    async deleteMfaFactor(factorId: string, uid: string): Promise<void> {
        throw new ApiError(
            501,
            "MFA_NOT_SUPPORTED",
            "Multi-factor authentication is not implemented for the MongoDB backend, so a factor cannot be stored. Use a Postgres data source for accounts that need a second factor."
        );
    }
    async createMfaChallenge(factorId: string, ipAddress?: string): Promise<MfaChallengeInfo> {
        throw new ApiError(
            501,
            "MFA_NOT_SUPPORTED",
            "Multi-factor authentication is not implemented for the MongoDB backend, so a challenge cannot be stored. Use a Postgres data source for accounts that need a second factor."
        );
    }
    async getMfaChallengeById(challengeId: string): Promise<MfaChallengeInfo | null> {
        return null;
    }
    async verifyMfaChallenge(challengeId: string): Promise<void> {
        throw new ApiError(
            501,
            "MFA_NOT_SUPPORTED",
            "Multi-factor authentication is not implemented for the MongoDB backend, so a challenge's verification cannot be stored. Use a Postgres data source for accounts that need a second factor."
        );
    }
    async createRecoveryCodes(uid: string, codeHashes: string[]): Promise<void> {
        throw new ApiError(
            501,
            "MFA_NOT_SUPPORTED",
            "Multi-factor authentication is not implemented for the MongoDB backend, so recovery codes cannot be stored. Use a Postgres data source for accounts that need a second factor."
        );
    }
    async useRecoveryCode(uid: string, codeHash: string): Promise<boolean> {
        return false;
    }
    async getUnusedRecoveryCodeCount(uid: string): Promise<number> {
        return 0;
    }
    async deleteAllRecoveryCodes(uid: string): Promise<void> {
        // No-op
    }
    async hasVerifiedMfaFactors(uid: string): Promise<boolean> {
        return false;
    }
}
