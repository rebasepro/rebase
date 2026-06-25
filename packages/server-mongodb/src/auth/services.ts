import { Db, ObjectId } from "mongodb";

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
    PasswordResetTokenInfo,
    MagicLinkTokenInfo,
    UserIdentityData,
    ListUsersOptions,
    PaginatedUsersResult,
    MfaFactor,
    MfaChallengeInfo
} from "@rebasepro/server-core";

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
            email: data.email.toLowerCase(),
            passwordHash: data.passwordHash ?? null,
            displayName: data.displayName ?? null,
            photoUrl: data.photoUrl ?? null,
            emailVerified: data.emailVerified ?? false,
            createdAt: now,
            updatedAt: now
        };
        await this.collection.insertOne(doc);
        return toUser(doc);
    }

    async getUserById(id: string): Promise<UserData | null> {
        const doc = await this.collection.findOne({ id });
        return doc ? toUser(doc) : null;
    }

    async getUserByEmail(email: string): Promise<UserData | null> {
        const doc = await this.collection.findOne({ email: email.toLowerCase() });
        return doc ? toUser(doc) : null;
    }

    async getUserByIdentity(provider: string, providerId: string): Promise<UserData | null> {
        const identity = await this.identitiesCollection.findOne({ provider,
providerId });
        if (!identity) return null;
        return this.getUserById(identity.userId);
    }

    async getUserIdentities(userId: string): Promise<UserIdentityData[]> {
        const docs = await this.identitiesCollection.find({ userId }).toArray();
        return docs.map(doc => ({
            id: doc.id,
            userId: doc.userId,
            provider: doc.provider,
            providerId: doc.providerId,
            profileData: doc.profileData ?? null,
            createdAt: new Date(doc.createdAt),
            updatedAt: new Date(doc.updatedAt)
        }));
    }

    async linkUserIdentity(userId: string, provider: string, providerId: string, profileData?: Record<string, unknown>): Promise<void> {
        const now = new Date();
        await this.identitiesCollection.updateOne(
            { provider,
providerId },
            {
                $setOnInsert: {
                    _id: new ObjectId().toString(),
                    id: new ObjectId().toString(),
                    userId,
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
        if (typeof updateData.email === "string") updateData.email = updateData.email.toLowerCase();

        await this.collection.updateOne({ id }, { $set: updateData });
        return this.getUserById(id);
    }

    async deleteUser(id: string): Promise<void> {
        await this.collection.deleteOne({ id });
        await this.identitiesCollection.deleteMany({ userId: id });
        await this.userRolesCollection.deleteMany({ userId: id });
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
            const userIds = userRoles.map(ur => ur.userId);
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

    async getUserRoles(userId: string): Promise<RoleData[]> {
        const userRoles = await this.userRolesCollection.find({ userId }).toArray();
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

    async getUserRoleIds(userId: string): Promise<string[]> {
        const userRoles = await this.userRolesCollection.find({ userId }).toArray();
        return userRoles.map(ur => ur.roleId);
    }

    async setUserRoles(userId: string, roleIds: string[]): Promise<void> {
        await this.userRolesCollection.deleteMany({ userId });
            if (roleIds.length > 0) {
            const docs = roleIds.map(roleId => ({
                _id: new ObjectId().toString(),
                userId,
                roleId
            }));
            await this.userRolesCollection.insertMany(docs);
        }
    }

    async assignDefaultRole(userId: string, roleId: string): Promise<void> {
        await this.userRolesCollection.updateOne(
            { userId,
roleId },
            { $setOnInsert: { _id: new ObjectId().toString(),
userId,
roleId } },
            { upsert: true }
        );
    }

    async getUserWithRoles(userId: string): Promise<{ user: UserData; roles: RoleData[] } | null> {
        const user = await this.getUserById(userId);
        if (!user) return null;
        const roles = await this.getUserRoles(userId);
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

    async createToken(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string, ipAddress?: string): Promise<void> {
        const safeUserAgent = userAgent || "";
        const safeIpAddress = ipAddress || "";

        await this.collection.deleteMany({
            userId,
            userAgent: safeUserAgent,
            ipAddress: safeIpAddress
        });

        await this.collection.insertOne({
            _id: new ObjectId().toString(),
            id: new ObjectId().toString(),
            userId,
            tokenHash,
            expiresAt,
            createdAt: new Date(),
            userAgent: safeUserAgent,
            ipAddress: safeIpAddress
        });
    }

    async findByHash(tokenHash: string): Promise<RefreshTokenInfo | null> {
        const doc = await this.collection.findOne({ tokenHash });
        if (!doc) return null;
        return {
            id: doc.id,
            userId: doc.userId,
            tokenHash: doc.tokenHash,
            expiresAt: new Date(doc.expiresAt),
            createdAt: new Date(doc.createdAt),
            userAgent: doc.userAgent,
            ipAddress: doc.ipAddress
        };
    }

    async deleteByHash(tokenHash: string): Promise<void> {
        await this.collection.deleteOne({ tokenHash });
    }

    async deleteAllForUser(userId: string): Promise<void> {
        await this.collection.deleteMany({ userId });
    }

    async listForUser(userId: string): Promise<RefreshTokenInfo[]> {
        const docs = await this.collection.find({ userId }).sort({ createdAt: 1 }).toArray();
        return docs.map(doc => ({
            id: doc.id,
            userId: doc.userId,
            tokenHash: doc.tokenHash,
            expiresAt: new Date(doc.expiresAt),
            createdAt: new Date(doc.createdAt),
            userAgent: doc.userAgent,
            ipAddress: doc.ipAddress
        }));
    }

    async deleteById(id: string, userId: string): Promise<void> {
        await this.collection.deleteOne({ id,
userId });
    }
}

export class MongoPasswordResetTokenService {
    constructor(private db: Db) {}

    private get collection() {
        return this.db.collection<MongoDoc>("rebase_password_reset_tokens");
    }

    async createToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
        await this.collection.deleteMany({ userId,
usedAt: null });

        await this.collection.insertOne({
            _id: new ObjectId().toString(),
            userId,
            tokenHash,
            expiresAt,
            usedAt: null
        });
    }

    async findValidByHash(tokenHash: string): Promise<{ userId: string; expiresAt: Date } | null> {
        const doc = await this.collection.findOne({
            tokenHash,
            usedAt: null,
            expiresAt: { $gt: new Date() }
        });

        if (!doc) return null;

        return {
            userId: doc.userId,
            expiresAt: new Date(doc.expiresAt)
        };
    }

    async markAsUsed(tokenHash: string): Promise<void> {
        await this.collection.updateOne(
            { tokenHash },
            { $set: { usedAt: new Date() } }
        );
    }

    async deleteAllForUser(userId: string): Promise<void> {
        await this.collection.deleteMany({ userId });
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

    async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string, ipAddress?: string): Promise<void> {
        await this.refreshTokenService.createToken(userId, tokenHash, expiresAt, userAgent, ipAddress);
    }

    async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenInfo | null> {
        return this.refreshTokenService.findByHash(tokenHash);
    }

    async deleteRefreshToken(tokenHash: string): Promise<void> {
        await this.refreshTokenService.deleteByHash(tokenHash);
    }

    async deleteAllRefreshTokensForUser(userId: string): Promise<void> {
        await this.refreshTokenService.deleteAllForUser(userId);
    }

    async listRefreshTokensForUser(userId: string): Promise<RefreshTokenInfo[]> {
        return this.refreshTokenService.listForUser(userId);
    }

    async deleteRefreshTokenById(id: string, userId: string): Promise<void> {
        await this.refreshTokenService.deleteById(id, userId);
    }

    async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
        await this.passwordResetTokenService.createToken(userId, tokenHash, expiresAt);
    }

    async findValidPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenInfo | null> {
        return this.passwordResetTokenService.findValidByHash(tokenHash);
    }

    async markPasswordResetTokenUsed(tokenHash: string): Promise<void> {
        await this.passwordResetTokenService.markAsUsed(tokenHash);
    }

    async deleteAllPasswordResetTokensForUser(userId: string): Promise<void> {
        await this.passwordResetTokenService.deleteAllForUser(userId);
    }

    async deleteExpiredTokens(): Promise<void> {
        await this.passwordResetTokenService.deleteExpired();
    }

    // Magic link token operations

    async createMagicLinkToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
        const col = this.db.collection("magic_link_tokens");
        await col.deleteMany({ userId, usedAt: null });
        await col.insertOne({ userId, tokenHash, expiresAt, usedAt: null, createdAt: new Date() });
    }

    async findValidMagicLinkToken(tokenHash: string): Promise<MagicLinkTokenInfo | null> {
        const col = this.db.collection("magic_link_tokens");
        const doc = await col.findOne({ tokenHash, usedAt: null, expiresAt: { $gt: new Date() } });
        if (!doc) return null;
        return { userId: doc.userId as string, expiresAt: doc.expiresAt as Date };
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

    async getUserIdentities(userId: string): Promise<UserIdentityData[]> {
        return this.userService.getUserIdentities(userId);
    }

    async linkUserIdentity(userId: string, provider: string, providerId: string, profileData?: Record<string, unknown>): Promise<void> {
        return this.userService.linkUserIdentity(userId, provider, providerId, profileData);
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

    async getUserRoles(userId: string): Promise<RoleData[]> {
        return this.userService.getUserRoles(userId);
    }

    async getUserRoleIds(userId: string): Promise<string[]> {
        return this.userService.getUserRoleIds(userId);
    }

    async setUserRoles(userId: string, roleIds: string[]): Promise<void> {
        await this.userService.setUserRoles(userId, roleIds);
    }

    async assignDefaultRole(userId: string, roleId: string): Promise<void> {
        await this.userService.assignDefaultRole(userId, roleId);
    }

    async getUserWithRoles(userId: string): Promise<{ user: UserData; roles: RoleData[] } | null> {
        return this.userService.getUserWithRoles(userId);
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

    async createRefreshToken(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string, ipAddress?: string): Promise<void> {
        await this.tokenRepository.createRefreshToken(userId, tokenHash, expiresAt, userAgent, ipAddress);
    }

    async findRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenInfo | null> {
        return this.tokenRepository.findRefreshTokenByHash(tokenHash);
    }

    async deleteRefreshToken(tokenHash: string): Promise<void> {
        await this.tokenRepository.deleteRefreshToken(tokenHash);
    }

    async deleteAllRefreshTokensForUser(userId: string): Promise<void> {
        await this.tokenRepository.deleteAllRefreshTokensForUser(userId);
    }

    async listRefreshTokensForUser(userId: string): Promise<RefreshTokenInfo[]> {
        return this.tokenRepository.listRefreshTokensForUser(userId);
    }

    async deleteRefreshTokenById(id: string, userId: string): Promise<void> {
        await this.tokenRepository.deleteRefreshTokenById(id, userId);
    }

    async createPasswordResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
        await this.tokenRepository.createPasswordResetToken(userId, tokenHash, expiresAt);
    }

    async findValidPasswordResetToken(tokenHash: string): Promise<PasswordResetTokenInfo | null> {
        return this.tokenRepository.findValidPasswordResetToken(tokenHash);
    }

    async markPasswordResetTokenUsed(tokenHash: string): Promise<void> {
        await this.tokenRepository.markPasswordResetTokenUsed(tokenHash);
    }

    async deleteAllPasswordResetTokensForUser(userId: string): Promise<void> {
        await this.tokenRepository.deleteAllPasswordResetTokensForUser(userId);
    }

    async deleteExpiredTokens(): Promise<void> {
        await this.tokenRepository.deleteExpiredTokens();
    }

    // Magic link token operations

    async createMagicLinkToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
        await this.tokenRepository.createMagicLinkToken(userId, tokenHash, expiresAt);
    }

    async findValidMagicLinkToken(tokenHash: string): Promise<MagicLinkTokenInfo | null> {
        return this.tokenRepository.findValidMagicLinkToken(tokenHash);
    }

    async markMagicLinkTokenUsed(tokenHash: string): Promise<void> {
        await this.tokenRepository.markMagicLinkTokenUsed(tokenHash);
    }

    // MFA Repository Stub
    async createMfaFactor(userId: string, factorType: "totp", secretEncrypted: string, friendlyName?: string): Promise<MfaFactor> {
        throw new Error("MFA is not implemented for MongoDB");
    }
    async getMfaFactors(userId: string): Promise<MfaFactor[]> {
        return [];
    }
    async getMfaFactorById(factorId: string): Promise<(MfaFactor & { secretEncrypted: string }) | null> {
        return null;
    }
    async verifyMfaFactor(factorId: string): Promise<void> {
        throw new Error("MFA is not implemented for MongoDB");
    }
    async deleteMfaFactor(factorId: string, userId: string): Promise<void> {
        throw new Error("MFA is not implemented for MongoDB");
    }
    async createMfaChallenge(factorId: string, ipAddress?: string): Promise<MfaChallengeInfo> {
        throw new Error("MFA is not implemented for MongoDB");
    }
    async getMfaChallengeById(challengeId: string): Promise<MfaChallengeInfo | null> {
        return null;
    }
    async verifyMfaChallenge(challengeId: string): Promise<void> {
        throw new Error("MFA is not implemented for MongoDB");
    }
    async createRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
        throw new Error("MFA is not implemented for MongoDB");
    }
    async useRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
        return false;
    }
    async getUnusedRecoveryCodeCount(userId: string): Promise<number> {
        return 0;
    }
    async deleteAllRecoveryCodes(userId: string): Promise<void> {
        // No-op
    }
    async hasVerifiedMfaFactors(userId: string): Promise<boolean> {
        return false;
    }
}
