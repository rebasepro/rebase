import { eq, getTableName, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { users, userIdentities, refreshTokens, passwordResetTokens } from "../schema/auth-schema";
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
    UserIdentityData,
    ListUsersOptions,
    PaginatedUsersResult,
    RoleData as Role
// @ts-ignore
} from "@rebasepro/server-core";
import { toSnakeCase, camelCase } from "@rebasepro/utils";

export type { Role };

function getColumnKey(table: any, ...keys: string[]): string | undefined {
    if (!table) return undefined;
    for (const key of keys) {
        if (key in table) return key;
        const snake = toSnakeCase(key);
        if (snake in table) return snake;
        const camel = camelCase(key);
        if (camel in table) return camel;
    }
    return undefined;
}

function getColumn(table: any, ...keys: string[]): any {
    const key = getColumnKey(table, ...keys);
    return key ? table[key] : undefined;
}

/**
 * PostgreSQL implementation of UserRepository.
 * Handles all user-related database operations using Drizzle ORM.
 */
export class UserService implements UserRepository {
    private usersTable: any;

    constructor(private db: NodePgDatabase, usersTable?: any) {
        this.usersTable = usersTable || users;
    }

    private getQualifiedUsersTableName(): string {
        const name = getTableName(this.usersTable);
        return `public."${name}"`;
    }

    private mapRowToUser(row: any): UserData {
        if (!row) return row;

        const id = row.id ?? row.uid;
        const email = row.email;
        const passwordHash = row.password_hash ?? row.passwordHash ?? null;
        const displayName = row.display_name ?? row.displayName ?? null;
        const photoUrl = row.photo_url ?? row.photoUrl ?? row.photoURL ?? null;
        const emailVerified = row.email_verified ?? row.emailVerified ?? false;
        const emailVerificationToken = row.email_verification_token ?? row.emailVerificationToken ?? null;
        const emailVerificationSentAt = row.email_verification_sent_at ?? row.emailVerificationSentAt ?? null;
        const createdAt = row.created_at ?? row.createdAt;
        const updatedAt = row.updated_at ?? row.updatedAt;

        const metadata: Record<string, any> = { ...(row.metadata || {}) };

        const knownKeys = new Set([
            "id", "uid", "email",
            "password_hash", "passwordHash",
            "display_name", "displayName",
            "photo_url", "photoUrl", "photoURL",
            "email_verified", "emailVerified",
            "email_verification_token", "emailVerificationToken",
            "email_verification_sent_at", "emailVerificationSentAt",
            "created_at", "createdAt",
            "updated_at", "updatedAt",
            "metadata"
        ]);

        for (const [key, val] of Object.entries(row)) {
            if (!knownKeys.has(key)) {
                const camelKey = camelCase(key);
                metadata[camelKey] = val;
            }
        }

        return {
            id,
            email,
            passwordHash,
            displayName,
            photoUrl,
            emailVerified,
            emailVerificationToken,
            emailVerificationSentAt: emailVerificationSentAt ? new Date(emailVerificationSentAt) : null,
            createdAt: createdAt ? new Date(createdAt) : new Date(),
            updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
            metadata
        };
    }

    private mapPayload(data: any): Record<string, any> {
        if (!data) return data;

        const payload: Record<string, any> = {};

        const idKey = getColumnKey(this.usersTable, "id") || "id";
        const emailKey = getColumnKey(this.usersTable, "email") || "email";
        const passwordHashKey = getColumnKey(this.usersTable, "passwordHash", "password_hash") || "passwordHash";
        const displayNameKey = getColumnKey(this.usersTable, "displayName", "display_name") || "displayName";
        const photoUrlKey = getColumnKey(this.usersTable, "photoUrl", "photo_url") || "photoUrl";
        const emailVerifiedKey = getColumnKey(this.usersTable, "emailVerified", "email_verified") || "emailVerified";
        const emailVerificationTokenKey = getColumnKey(this.usersTable, "emailVerificationToken", "email_verification_token") || "emailVerificationToken";
        const emailVerificationSentAtKey = getColumnKey(this.usersTable, "emailVerificationSentAt", "email_verification_sent_at") || "emailVerificationSentAt";
        const createdAtKey = getColumnKey(this.usersTable, "createdAt", "created_at") || "createdAt";
        const updatedAtKey = getColumnKey(this.usersTable, "updatedAt", "updated_at") || "updatedAt";
        const metadataKey = getColumnKey(this.usersTable, "metadata") || "metadata";

        if ("id" in data) payload[idKey] = data.id;
        if ("email" in data) payload[emailKey] = data.email;
        if ("passwordHash" in data) payload[passwordHashKey] = data.passwordHash;
        if ("displayName" in data) payload[displayNameKey] = data.displayName;
        if ("photoUrl" in data) payload[photoUrlKey] = data.photoUrl;
        if ("emailVerified" in data) payload[emailVerifiedKey] = data.emailVerified;
        if ("emailVerificationToken" in data) payload[emailVerificationTokenKey] = data.emailVerificationToken;
        if ("emailVerificationSentAt" in data) payload[emailVerificationSentAtKey] = data.emailVerificationSentAt;
        if ("createdAt" in data) payload[createdAtKey] = data.createdAt;
        if ("updatedAt" in data) payload[updatedAtKey] = data.updatedAt;

        const metadata: Record<string, any> = { ...(data.metadata || {}) };
        const remainingMetadata: Record<string, any> = {};

        for (const [key, val] of Object.entries(metadata)) {
            const tableColKey = getColumnKey(this.usersTable, key);
            if (tableColKey && 
                tableColKey !== idKey && 
                tableColKey !== emailKey && 
                tableColKey !== passwordHashKey && 
                tableColKey !== displayNameKey && 
                tableColKey !== photoUrlKey && 
                tableColKey !== emailVerifiedKey && 
                tableColKey !== emailVerificationTokenKey && 
                tableColKey !== emailVerificationSentAtKey && 
                tableColKey !== createdAtKey && 
                tableColKey !== updatedAtKey && 
                tableColKey !== metadataKey) {
                payload[tableColKey] = val;
            } else {
                remainingMetadata[key] = val;
            }
        }

        if (metadataKey in this.usersTable) {
            payload[metadataKey] = remainingMetadata;
        }

        return payload;
    }

    async createUser(data: CreateUserData): Promise<UserData> {
        const payload = this.mapPayload(data);
        const [row] = (await this.db.insert(this.usersTable).values(payload).returning()) as any[];
        return this.mapRowToUser(row);
    }

    async getUserById(id: string): Promise<UserData | null> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return null;
        const [row] = await this.db.select().from(this.usersTable).where(eq(idCol, id));
        return row ? this.mapRowToUser(row) : null;
    }

    async getUserByEmail(email: string): Promise<UserData | null> {
        const emailCol = getColumn(this.usersTable, "email");
        if (!emailCol) return null;
        const [row] = await this.db.select().from(this.usersTable).where(eq(emailCol, email.toLowerCase()));
        return row ? this.mapRowToUser(row) : null;
    }

    async getUserByIdentity(provider: string, providerId: string): Promise<UserData | null> {
        const userIdCol = getColumn(this.usersTable, "id");
        if (!userIdCol) return null;
        
        const result = await this.db
            .select({ user: this.usersTable })
            .from(this.usersTable)
            .innerJoin(userIdentities, eq(userIdCol, userIdentities.userId))
            .where(
                sql`${userIdentities.provider} = ${provider} AND ${userIdentities.providerId} = ${providerId}`
            )
            .limit(1);

        if (result.length === 0) return null;
        return this.mapRowToUser(result[0].user);
    }

    async getUserIdentities(userId: string): Promise<UserIdentityData[]> {
        const result = await this.db.execute(sql`
            SELECT id, user_id, provider, provider_id, profile_data, created_at, updated_at
            FROM rebase.user_identities
            WHERE user_id = ${userId}
        `);

        return result.rows.map((row: Record<string, unknown>) => ({
            id: row.id as string,
            userId: row.user_id as string,
            provider: row.provider as string,
            providerId: row.provider_id as string,
            profileData: (row.profile_data as Record<string, unknown> | null) ?? null,
            createdAt: row.created_at as Date,
            updatedAt: row.updated_at as Date
        }));
    }

    async linkUserIdentity(userId: string, provider: string, providerId: string, profileData?: Record<string, unknown>): Promise<void> {
        await this.db.insert(userIdentities).values({
            userId,
            provider,
            providerId,
            profileData: profileData || null
        }).onConflictDoNothing({ target: [userIdentities.provider, userIdentities.providerId] });
    }

    async updateUser(id: string, data: Partial<Omit<CreateUserData, "id">>): Promise<UserData | null> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return null;
        const payload = this.mapPayload(data);
        const updatedAtKey = getColumnKey(this.usersTable, "updatedAt", "updated_at") || "updatedAt";
        payload[updatedAtKey] = new Date();

        const [row] = (await this.db
            .update(this.usersTable)
            .set(payload)
            .where(eq(idCol, id))
            .returning()) as any[];
        return row ? this.mapRowToUser(row) : null;
    }

    async deleteUser(id: string): Promise<void> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return;
        await this.db.delete(this.usersTable).where(eq(idCol, id));
    }

    async listUsers(): Promise<UserData[]> {
        const rows = await this.db.select().from(this.usersTable);
        return rows.map(row => this.mapRowToUser(row));
    }

    async listUsersPaginated(options?: ListUsersOptions): Promise<PaginatedUsersResult> {
        const limit = options?.limit ?? 25;
        const offset = options?.offset ?? 0;
        const search = options?.search?.trim() || "";
        const orderBy = options?.orderBy || "createdAt";
        const orderDir = options?.orderDir || "desc";
        const roleId = options?.roleId;

        const orderCol = getColumn(this.usersTable, orderBy);
        const orderColumn = orderCol ? orderCol.name : "created_at";
        const direction = orderDir === "asc" ? sql`ASC` : sql`DESC`;

        const emailCol = getColumn(this.usersTable, "email");
        const emailColumn = emailCol ? emailCol.name : "email";
        const displayNameCol = getColumn(this.usersTable, "displayName", "display_name");
        const displayNameColumn = displayNameCol ? displayNameCol.name : "display_name";
        const idCol = getColumn(this.usersTable, "id");
        const idColumn = idCol ? idCol.name : "id";

        const usersTableName = this.getQualifiedUsersTableName();

        const conditions = [];
        if (roleId) {
            conditions.push(sql`EXISTS (SELECT 1 FROM rebase.user_roles ur WHERE ur.user_id = ${sql.raw(usersTableName)}.${sql.raw(idColumn)} AND ur.role_id = ${roleId})`);
        }
        if (search) {
            const pattern = `%${search}%`;
            conditions.push(sql`(${sql.raw(usersTableName)}.${sql.raw(emailColumn)} ILIKE ${pattern} OR ${sql.raw(usersTableName)}.${sql.raw(displayNameColumn)} ILIKE ${pattern})`);
        }

        const whereClause = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

        // Sorting: users with roles first if no role filter, then by requested order
        const orderByClause = roleId
            ? sql`ORDER BY ${sql.raw(usersTableName)}.${sql.raw(orderColumn)} ${direction}`
            : sql`ORDER BY (SELECT count(*) FROM rebase.user_roles ur WHERE ur.user_id = ${sql.raw(usersTableName)}.${sql.raw(idColumn)}) DESC, ${sql.raw(usersTableName)}.${sql.raw(orderColumn)} ${direction}`;

        const countResult = await this.db.execute(sql`
            SELECT count(*)::int as total FROM ${sql.raw(usersTableName)}
            ${whereClause}
        `);
        const total = (countResult.rows[0] as { total: number }).total;

        const dataResult = await this.db.execute(sql`
            SELECT * FROM ${sql.raw(usersTableName)}
            ${whereClause}
            ${orderByClause}
            LIMIT ${limit} OFFSET ${offset}
        `);
        const rows = dataResult.rows;

        // Map rows to camelCase UserData
        const mappedUsers: UserData[] = rows.map((row: any) => this.mapRowToUser(row));

        return { users: mappedUsers,
            total,
            limit,
            offset };
    }

    /**
     * Update user's password hash
     */
    async updatePassword(id: string, passwordHash: string): Promise<void> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return;
        const passwordHashColKey = getColumnKey(this.usersTable, "passwordHash", "password_hash") || "passwordHash";
        const updatedAtColKey = getColumnKey(this.usersTable, "updatedAt", "updated_at") || "updatedAt";

        await this.db
            .update(this.usersTable)
            .set({
                [passwordHashColKey]: passwordHash,
                [updatedAtColKey]: new Date()
            })
            .where(eq(idCol, id));
    }

    /**
     * Set email verification status
     */
    async setEmailVerified(id: string, verified: boolean): Promise<void> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return;
        const emailVerifiedColKey = getColumnKey(this.usersTable, "emailVerified", "email_verified") || "emailVerified";
        const emailVerificationTokenColKey = getColumnKey(this.usersTable, "emailVerificationToken", "email_verification_token") || "emailVerificationToken";
        const updatedAtColKey = getColumnKey(this.usersTable, "updatedAt", "updated_at") || "updatedAt";

        await this.db
            .update(this.usersTable)
            .set({
                [emailVerifiedColKey]: verified,
                [emailVerificationTokenColKey]: null,
                [updatedAtColKey]: new Date()
            })
            .where(eq(idCol, id));
    }

    /**
     * Set email verification token
     */
    async setVerificationToken(id: string, token: string | null): Promise<void> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return;
        const emailVerificationTokenColKey = getColumnKey(this.usersTable, "emailVerificationToken", "email_verification_token") || "emailVerificationToken";
        const emailVerificationSentAtColKey = getColumnKey(this.usersTable, "emailVerificationSentAt", "email_verification_sent_at") || "emailVerificationSentAt";
        const updatedAtColKey = getColumnKey(this.usersTable, "updatedAt", "updated_at") || "updatedAt";

        await this.db
            .update(this.usersTable)
            .set({
                [emailVerificationTokenColKey]: token,
                [emailVerificationSentAtColKey]: token ? new Date() : null,
                [updatedAtColKey]: new Date()
            })
            .where(eq(idCol, id));
    }

    /**
     * Find user by email verification token
     */
    async getUserByVerificationToken(token: string): Promise<UserData | null> {
        const tokenCol = getColumn(this.usersTable, "emailVerificationToken", "email_verification_token");
        if (!tokenCol) return null;
        const [row] = await this.db
            .select()
            .from(this.usersTable)
            .where(eq(tokenCol, token));
        return row ? this.mapRowToUser(row) : null;
    }

    /**
     * Get roles for a user from database
     */
    async getUserRoles(userId: string): Promise<Role[]> {
        const result = await this.db.execute(sql`
            SELECT r.id, r.name, r.is_admin, r.default_permissions, r.collection_permissions, r.config
            FROM rebase.roles r
            INNER JOIN rebase.user_roles ur ON r.id = ur.role_id
            WHERE ur.user_id = ${userId}
        `);

        return (result.rows as Array<{ id: string; name: string; is_admin: boolean; default_permissions: Record<string, boolean> | null; collection_permissions: Record<string, Record<string, boolean>> | null; config: Record<string, unknown> | null }>).map(row => ({
            id: row.id,
            name: row.name,
            isAdmin: row.is_admin,
            defaultPermissions: row.default_permissions,
            collectionPermissions: row.collection_permissions,
            config: row.config
        }));
    }

    /**
     * Get role IDs for a user
     */
    async getUserRoleIds(userId: string): Promise<string[]> {
        const roles = await this.getUserRoles(userId);
        return roles.map(r => r.id);
    }

    /**
     * Set roles for a user
     */
    async setUserRoles(userId: string, roleIds: string[]): Promise<void> {
        // Delete existing roles
        await this.db.execute(sql`DELETE FROM rebase.user_roles WHERE user_id = ${userId}`);

        // Insert new roles
        for (const roleId of roleIds) {
            await this.db.execute(sql`
                INSERT INTO rebase.user_roles (user_id, role_id)
                VALUES (${userId}, ${roleId})
                ON CONFLICT DO NOTHING
            `);
        }
    }

    /**
     * Assign a specific role to new user
     */
    async assignDefaultRole(userId: string, roleId: string): Promise<void> {
        await this.db.execute(sql`
            INSERT INTO rebase.user_roles (user_id, role_id)
            VALUES (${userId}, ${roleId})
            ON CONFLICT DO NOTHING
        `);
    }

    /**
     * Get user with their roles
     */
    async getUserWithRoles(userId: string): Promise<{ user: UserData; roles: Role[] } | null> {
        const user = await this.getUserById(userId);
        if (!user) return null;

        const roles = await this.getUserRoles(userId);
        return { user,
            roles };
    }
}

/**
 * PostgreSQL implementation of RoleRepository.
 * Handles all role-related database operations using Drizzle ORM.
 */
export class RoleService implements RoleRepository {
    constructor(private db: NodePgDatabase) { }

    async getRoleById(id: string): Promise<Role | null> {
        const result = await this.db.execute(sql`
            SELECT id, name, is_admin, default_permissions, collection_permissions, config
            FROM rebase.roles
            WHERE id = ${id}
        `);

        if (result.rows.length === 0) return null;

        const row = result.rows[0] as { id: string; name: string; is_admin: boolean; default_permissions: Record<string, boolean> | null; collection_permissions: Record<string, Record<string, boolean>> | null; config: Record<string, unknown> | null };
        return {
            id: row.id,
            name: row.name,
            isAdmin: row.is_admin,
            defaultPermissions: row.default_permissions,
            collectionPermissions: row.collection_permissions,
            config: row.config
        };
    }

    async listRoles(): Promise<Role[]> {
        const result = await this.db.execute(sql`
            SELECT id, name, is_admin, default_permissions, collection_permissions, config
            FROM rebase.roles
            ORDER BY name
        `);

        return (result.rows as Array<{ id: string; name: string; is_admin: boolean; default_permissions: Record<string, boolean> | null; collection_permissions: Record<string, Record<string, boolean>> | null; config: Record<string, unknown> | null }>).map(row => ({
            id: row.id,
            name: row.name,
            isAdmin: row.is_admin,
            defaultPermissions: row.default_permissions,
            collectionPermissions: row.collection_permissions,
            config: row.config
        }));
    }

    async createRole(data: Omit<Role, "isAdmin" | "collectionPermissions"> & { isAdmin?: boolean; collectionPermissions?: Role["collectionPermissions"] }): Promise<Role> {
        const result = await this.db.execute(sql`
            INSERT INTO rebase.roles (id, name, is_admin, default_permissions, collection_permissions, config)
            VALUES (
                ${data.id},
                ${data.name},
                ${data.isAdmin ?? false},
                ${data.defaultPermissions ? JSON.stringify(data.defaultPermissions) : null}::jsonb,
                ${data.collectionPermissions ? JSON.stringify(data.collectionPermissions) : null}::jsonb,
                ${data.config ? JSON.stringify(data.config) : null}::jsonb
            )
            RETURNING id, name, is_admin, default_permissions, collection_permissions, config
        `);

        const row = result.rows[0] as { id: string; name: string; is_admin: boolean; default_permissions: Record<string, boolean> | null; collection_permissions: Record<string, Record<string, boolean>> | null; config: Record<string, unknown> | null };
        return {
            id: row.id,
            name: row.name,
            isAdmin: row.is_admin,
            defaultPermissions: row.default_permissions,
            collectionPermissions: row.collection_permissions,
            config: row.config
        };
    }

    async updateRole(id: string, data: Partial<Omit<Role, "id">>): Promise<Role | null> {
        // For now, use simpler approach
        const existing = await this.getRoleById(id);
        if (!existing) return null;

        await this.db.execute(sql`
            UPDATE rebase.roles 
            SET 
                name = ${data.name ?? existing.name},
                is_admin = ${data.isAdmin ?? existing.isAdmin},
                default_permissions = ${data.defaultPermissions ? JSON.stringify(data.defaultPermissions) : JSON.stringify(existing.defaultPermissions)}::jsonb,
                collection_permissions = ${data.collectionPermissions !== undefined ? (data.collectionPermissions ? JSON.stringify(data.collectionPermissions) : null) : (existing.collectionPermissions ? JSON.stringify(existing.collectionPermissions) : null)}::jsonb,
                config = ${data.config ? JSON.stringify(data.config) : (existing.config ? JSON.stringify(existing.config) : null)}::jsonb
            WHERE id = ${id}
        `);

        return this.getRoleById(id);
    }

    async deleteRole(id: string): Promise<void> {
        await this.db.execute(sql`DELETE FROM rebase.roles WHERE id = ${id}`);
    }
}

export class RefreshTokenService {
    constructor(private db: NodePgDatabase) { }

    async createToken(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string, ipAddress?: string): Promise<void> {
        // Fallback to empty string because UNIQUE constraints treat NULLs as strictly distinct in standard Postgres.
        // We want (userId, NULL, NULL) to collide and overwrite, so we map undefined/null to empty strings.
        const safeUserAgent = userAgent || "";
        const safeIpAddress = ipAddress || "";

        // Delete any existing session for this user/device combo, then insert.
        // This approach doesn't require the unique_device_session constraint to exist.
        await this.db.execute(sql`
            DELETE FROM rebase.refresh_tokens 
            WHERE user_id = ${userId} 
            AND user_agent = ${safeUserAgent} 
            AND ip_address = ${safeIpAddress}
        `);

        await this.db.insert(refreshTokens)
            .values({
                userId,
                tokenHash,
                expiresAt,
                userAgent: safeUserAgent,
                ipAddress: safeIpAddress
            });
    }

    async findByHash(tokenHash: string): Promise<RefreshTokenInfo | null> {
        const [token] = await this.db
            .select({
                id: refreshTokens.id,
                userId: refreshTokens.userId,
                tokenHash: refreshTokens.tokenHash,
                expiresAt: refreshTokens.expiresAt,
                createdAt: refreshTokens.createdAt,
                userAgent: refreshTokens.userAgent,
                ipAddress: refreshTokens.ipAddress
            })
            .from(refreshTokens)
            .where(eq(refreshTokens.tokenHash, tokenHash));

        return token || null;
    }

    async deleteByHash(tokenHash: string): Promise<void> {
        await this.db.delete(refreshTokens).where(eq(refreshTokens.tokenHash, tokenHash));
    }

    async deleteAllForUser(userId: string): Promise<void> {
        await this.db.delete(refreshTokens).where(eq(refreshTokens.userId, userId));
    }

    async listForUser(userId: string): Promise<RefreshTokenInfo[]> {
        const tokens = await this.db
            .select({
                id: refreshTokens.id,
                userId: refreshTokens.userId,
                tokenHash: refreshTokens.tokenHash,
                expiresAt: refreshTokens.expiresAt,
                createdAt: refreshTokens.createdAt,
                userAgent: refreshTokens.userAgent,
                ipAddress: refreshTokens.ipAddress
            })
            .from(refreshTokens)
            .where(eq(refreshTokens.userId, userId))
            .orderBy(refreshTokens.createdAt);

        return tokens;
    }

    async deleteById(id: string, userId: string): Promise<void> {
        await this.db.delete(refreshTokens)
            .where(sql`${refreshTokens.id} = ${id} AND ${refreshTokens.userId} = ${userId}`);
    }
}

/**
 * Password reset token service
 */
export class PasswordResetTokenService {
    constructor(private db: NodePgDatabase) { }

    /**
     * Create a password reset token
     */
    async createToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
        // Delete any existing unused tokens for this user
        await this.db.execute(sql`
            DELETE FROM rebase.password_reset_tokens 
            WHERE user_id = ${userId} AND used_at IS NULL
        `);

        await this.db.insert(passwordResetTokens).values({
            userId,
            tokenHash,
            expiresAt
        });
    }

    /**
     * Find a valid (not expired, not used) token by hash
     */
    async findValidByHash(tokenHash: string): Promise<{ userId: string; expiresAt: Date } | null> {
        const [token] = await this.db
            .select({
                userId: passwordResetTokens.userId,
                expiresAt: passwordResetTokens.expiresAt
            })
            .from(passwordResetTokens)
            .where(eq(passwordResetTokens.tokenHash, tokenHash));

        if (!token) return null;

        // Check if expired or used
        const result = await this.db.execute(sql`
            SELECT user_id, expires_at 
            FROM rebase.password_reset_tokens 
            WHERE token_hash = ${tokenHash} 
              AND used_at IS NULL 
              AND expires_at > NOW()
        `);

        if (result.rows.length === 0) return null;

        const row = result.rows[0] as { user_id: string; expires_at: string | number | Date };
        return {
            userId: row.user_id,
            expiresAt: new Date(row.expires_at)
        };
    }

    /**
     * Mark token as used
     */
    async markAsUsed(tokenHash: string): Promise<void> {
        await this.db
            .update(passwordResetTokens)
            .set({ usedAt: new Date() })
            .where(eq(passwordResetTokens.tokenHash, tokenHash));
    }

    /**
     * Delete all tokens for a user
     */
    async deleteAllForUser(userId: string): Promise<void> {
        await this.db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, userId));
    }

    /**
     * Clean up expired tokens
     */
    async deleteExpired(): Promise<void> {
        await this.db.execute(sql`
            DELETE FROM rebase.password_reset_tokens 
            WHERE expires_at < NOW()
        `);
    }
}

/**
 * PostgreSQL implementation of TokenRepository.
 * Combines refresh token and password reset token operations.
 */
export class PostgresTokenRepository implements TokenRepository {
    private refreshTokenService: RefreshTokenService;
    private passwordResetTokenService: PasswordResetTokenService;

    constructor(private db: NodePgDatabase) {
        this.refreshTokenService = new RefreshTokenService(db);
        this.passwordResetTokenService = new PasswordResetTokenService(db);
    }

    // Refresh token operations

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

    // Password reset token operations

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
}

/**
 * PostgreSQL implementation of AuthRepository.
 * Combines user, role, and token repository operations.
 * This provides a convenient single-class interface for all auth operations.
 */
export class PostgresAuthRepository implements AuthRepository {
    private userService: UserService;
    private roleService: RoleService;
    private tokenRepository: PostgresTokenRepository;

    constructor(private db: NodePgDatabase, usersTable?: any) {
        this.userService = new UserService(db, usersTable);
        this.roleService = new RoleService(db);
        this.tokenRepository = new PostgresTokenRepository(db);
    }

    // User operations (delegate to UserService)

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

    // Role operations (delegate to RoleService)

    async getRoleById(id: string): Promise<RoleData | null> {
        return this.roleService.getRoleById(id);
    }

    async listRoles(): Promise<RoleData[]> {
        return this.roleService.listRoles();
    }

    async createRole(data: CreateRoleData): Promise<RoleData> {
        return this.roleService.createRole({
            ...data,
            defaultPermissions: data.defaultPermissions ?? null,
            collectionPermissions: data.collectionPermissions ?? null,
            config: data.config ?? null
        });
    }

    async updateRole(id: string, data: Partial<Omit<RoleData, "id">>): Promise<RoleData | null> {
        return this.roleService.updateRole(id, data);
    }

    async deleteRole(id: string): Promise<void> {
        await this.roleService.deleteRole(id);
    }

    // Token operations (delegate to PostgresTokenRepository)

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
}

// =============================================================================
// PostgreSQL Type Aliases (for consistent naming with other implementations)
// =============================================================================

/** PostgreSQL user repository implementation */
export type PostgresUserRepository = UserService;

/** PostgreSQL role repository implementation */
export type PostgresRoleRepository = RoleService;

