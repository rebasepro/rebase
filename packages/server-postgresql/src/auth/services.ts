import { eq, getTableName, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getTableConfig, PgTable, AnyPgColumn } from "drizzle-orm/pg-core";
import { users, roles, userRoles, refreshTokens, passwordResetTokens, userIdentities } from "../schema/auth-schema";
import {
    UserRepository,
    RoleRepository,
    TokenRepository,
    MfaRepository,
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
    MfaFactor,
    MfaChallengeInfo,
    RoleData as Role
// @ts-ignore
} from "@rebasepro/server-core";
import { toSnakeCase, camelCase } from "@rebasepro/utils";

export type { Role };

export interface AuthSchemaTables {
    users: PgTable & Record<string, AnyPgColumn>;
    roles: PgTable & Record<string, AnyPgColumn>;
    userRoles: PgTable & Record<string, AnyPgColumn>;
    refreshTokens: PgTable & Record<string, AnyPgColumn>;
    passwordResetTokens: PgTable & Record<string, AnyPgColumn>;
    appConfig: PgTable & Record<string, AnyPgColumn>;
    userIdentities: PgTable & Record<string, AnyPgColumn>;
}

function getColumnKey(table: (PgTable & Record<string, AnyPgColumn>) | undefined, ...keys: string[]): string | undefined {
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

function getColumn(table: (PgTable & Record<string, AnyPgColumn>) | undefined, ...keys: string[]): AnyPgColumn | undefined {
    if (!table) return undefined;
    const key = getColumnKey(table, ...keys);
    return key ? table[key] : undefined;
}

/**
 * PostgreSQL implementation of UserRepository.
 * Handles all user-related database operations using Drizzle ORM.
 */
export class UserService implements UserRepository {
    private usersTable: PgTable & Record<string, AnyPgColumn>;
    private userIdentitiesTable: PgTable & Record<string, AnyPgColumn>;
    private userRolesTable: PgTable & Record<string, AnyPgColumn>;
    private rolesTable: PgTable & Record<string, AnyPgColumn>;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: (PgTable & Record<string, AnyPgColumn>) | Partial<AuthSchemaTables>
    ) {
        if (tableOrTables && ((tableOrTables as Partial<AuthSchemaTables>).users || (tableOrTables as Partial<AuthSchemaTables>).roles)) {
            const tables = tableOrTables as Partial<AuthSchemaTables>;
            this.usersTable = (tables.users || users) as unknown as PgTable & Record<string, AnyPgColumn>;
            this.userIdentitiesTable = (tables.userIdentities || userIdentities) as unknown as PgTable & Record<string, AnyPgColumn>;
            this.userRolesTable = (tables.userRoles || userRoles) as unknown as PgTable & Record<string, AnyPgColumn>;
            this.rolesTable = (tables.roles || roles) as unknown as PgTable & Record<string, AnyPgColumn>;
        } else {
            const table = tableOrTables as (PgTable & Record<string, AnyPgColumn>) | undefined;
            this.usersTable = table || (users as unknown as PgTable & Record<string, AnyPgColumn>);
            this.userIdentitiesTable = userIdentities as unknown as PgTable & Record<string, AnyPgColumn>;
            this.userRolesTable = userRoles as unknown as PgTable & Record<string, AnyPgColumn>;
            this.rolesTable = roles as unknown as PgTable & Record<string, AnyPgColumn>;
        }
    }

    private getQualifiedUsersTableName(): string {
        const name = getTableName(this.usersTable);
        const schema = getTableConfig(this.usersTable).schema || "public";
        return `"${schema}"."${name}"`;
    }

    private mapRowToUser(row: Record<string, unknown>): UserData {
        if (!row) return row as unknown as UserData;

        const id = (row.id ?? row.uid) as string;
        const email = row.email as string;
        const passwordHash = (row.password_hash ?? row.passwordHash ?? null) as string | null | undefined;
        const displayName = (row.display_name ?? row.displayName ?? null) as string | null | undefined;
        const photoUrl = (row.photo_url ?? row.photoUrl ?? row.photoURL ?? null) as string | null | undefined;
        const emailVerified = (row.email_verified ?? row.emailVerified ?? false) as boolean;
        const emailVerificationToken = (row.email_verification_token ?? row.emailVerificationToken ?? null) as string | null | undefined;
        const emailVerificationSentAt = (row.email_verification_sent_at ?? row.emailVerificationSentAt ?? null) as string | number | Date | null;
        const isAnonymous = (row.is_anonymous ?? row.isAnonymous ?? false) as boolean;
        const createdAt = (row.created_at ?? row.createdAt) as string | number | Date | undefined;
        const updatedAt = (row.updated_at ?? row.updatedAt) as string | number | Date | undefined;

        const metadata: Record<string, any> = { ...((row.metadata as Record<string, any> | undefined) || {}) };

        const knownKeys = new Set([
            "id", "uid", "email",
            "password_hash", "passwordHash",
            "display_name", "displayName",
            "photo_url", "photoUrl", "photoURL",
            "email_verified", "emailVerified",
            "email_verification_token", "emailVerificationToken",
            "email_verification_sent_at", "emailVerificationSentAt",
            "is_anonymous", "isAnonymous",
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
            isAnonymous,
            createdAt: createdAt ? new Date(createdAt) : new Date(),
            updatedAt: updatedAt ? new Date(updatedAt) : new Date(),
            metadata
        };
    }

    private mapPayload(data: Partial<CreateUserData>): Record<string, unknown> {
        if (!data) return {};

        const payload: Record<string, unknown> = {};

        const idKey = getColumnKey(this.usersTable, "id") || "id";
        const emailKey = getColumnKey(this.usersTable, "email") || "email";
        const passwordHashKey = getColumnKey(this.usersTable, "passwordHash", "password_hash") || "passwordHash";
        const displayNameKey = getColumnKey(this.usersTable, "displayName", "display_name") || "displayName";
        const photoUrlKey = getColumnKey(this.usersTable, "photoUrl", "photo_url") || "photoUrl";
        const emailVerifiedKey = getColumnKey(this.usersTable, "emailVerified", "email_verified") || "emailVerified";
        const emailVerificationTokenKey = getColumnKey(this.usersTable, "emailVerificationToken", "email_verification_token") || "emailVerificationToken";
        const emailVerificationSentAtKey = getColumnKey(this.usersTable, "emailVerificationSentAt", "email_verification_sent_at") || "emailVerificationSentAt";
        const isAnonymousKey = getColumnKey(this.usersTable, "isAnonymous", "is_anonymous") || "isAnonymous";
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
        if ("isAnonymous" in data) payload[isAnonymousKey] = data.isAnonymous;
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
                tableColKey !== isAnonymousKey &&
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
        const [row] = (await this.db.insert(this.usersTable).values(payload).returning()) as Record<string, unknown>[];
        return this.mapRowToUser(row);
    }

    async getUserById(id: string): Promise<UserData | null> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return null;
        const [row] = await this.db.select().from(this.usersTable).where(eq(idCol, id));
        return row ? this.mapRowToUser(row as Record<string, unknown>) : null;
    }

    async getUserByEmail(email: string): Promise<UserData | null> {
        const emailCol = getColumn(this.usersTable, "email");
        if (!emailCol) return null;
        const [row] = await this.db.select().from(this.usersTable).where(eq(emailCol, email.toLowerCase()));
        return row ? this.mapRowToUser(row as Record<string, unknown>) : null;
    }

    async getUserByIdentity(provider: string, providerId: string): Promise<UserData | null> {
        const userIdCol = getColumn(this.usersTable, "id");
        if (!userIdCol) return null;
        
        const result = await this.db
            .select({ user: this.usersTable })
            .from(this.usersTable)
            .innerJoin(this.userIdentitiesTable, eq(userIdCol, this.userIdentitiesTable.userId))
            .where(
                sql`${this.userIdentitiesTable.provider} = ${provider} AND ${this.userIdentitiesTable.providerId} = ${providerId}`
            )
            .limit(1);

        if (result.length === 0) return null;
        return this.mapRowToUser(result[0].user as Record<string, unknown>);
    }

    async getUserIdentities(userId: string): Promise<UserIdentityData[]> {
        const schema = getTableConfig(this.userIdentitiesTable).schema || "public";
        const result = await this.db.execute(sql`
            SELECT id, user_id, provider, provider_id, profile_data, created_at, updated_at
            FROM ${sql.raw(`"${schema}"."user_identities"`)}
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
        await this.db.insert(this.userIdentitiesTable).values({
            userId,
            provider,
            providerId,
            profileData: profileData || null
        }).onConflictDoNothing({ target: [this.userIdentitiesTable.provider, this.userIdentitiesTable.providerId] });
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
            .returning()) as Record<string, unknown>[];
        return row ? this.mapRowToUser(row) : null;
    }

    async deleteUser(id: string): Promise<void> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return;
        await this.db.delete(this.usersTable).where(eq(idCol, id));
    }

    async listUsers(): Promise<UserData[]> {
        const rows = await this.db.select().from(this.usersTable);
        return (rows as Record<string, unknown>[]).map(row => this.mapRowToUser(row));
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
        const rolesSchema = getTableConfig(this.userRolesTable).schema || "public";

        const conditions = [];
        if (roleId) {
            conditions.push(sql`EXISTS (SELECT 1 FROM ${sql.raw(`"${rolesSchema}"."user_roles"`)} ur WHERE ur.user_id = ${sql.raw(usersTableName)}.${sql.raw(idColumn)} AND ur.role_id = ${roleId})`);
        }
        if (search) {
            const pattern = `%${search}%`;
            conditions.push(sql`(${sql.raw(usersTableName)}.${sql.raw(emailColumn)} ILIKE ${pattern} OR ${sql.raw(usersTableName)}.${sql.raw(displayNameColumn)} ILIKE ${pattern})`);
        }

        const whereClause = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

        // Sorting: users with roles first if no role filter, then by requested order
        const orderByClause = roleId
            ? sql`ORDER BY ${sql.raw(usersTableName)}.${sql.raw(orderColumn)} ${direction}`
            : sql`ORDER BY (SELECT count(*) FROM ${sql.raw(`"${rolesSchema}"."user_roles"`)} ur WHERE ur.user_id = ${sql.raw(usersTableName)}.${sql.raw(idColumn)}) DESC, ${sql.raw(usersTableName)}.${sql.raw(orderColumn)} ${direction}`;

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
        const mappedUsers: UserData[] = (rows as Record<string, unknown>[]).map((row) => this.mapRowToUser(row));

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
        return row ? this.mapRowToUser(row as Record<string, unknown>) : null;
    }

    /**
     * Get roles for a user from database
     */
    async getUserRoles(userId: string): Promise<Role[]> {
        const rolesSchema = getTableConfig(this.rolesTable).schema || "public";
        const result = await this.db.execute(sql`
            SELECT r.id, r.name, r.is_admin, r.default_permissions, r.collection_permissions
            FROM ${sql.raw(`"${rolesSchema}"."roles"`)} r
            INNER JOIN ${sql.raw(`"${rolesSchema}"."user_roles"`)} ur ON r.id = ur.role_id
            WHERE ur.user_id = ${userId}
        `);

        return (result.rows as Array<{ id: string; name: string; is_admin: boolean; default_permissions: Record<string, boolean> | null; collection_permissions: Record<string, Record<string, boolean>> | null }>).map(row => ({
            id: row.id,
            name: row.name,
            isAdmin: row.is_admin,
            defaultPermissions: row.default_permissions,
            collectionPermissions: row.collection_permissions
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
        const rolesSchema = getTableConfig(this.userRolesTable).schema || "public";
        // Delete existing roles
        await this.db.execute(sql`DELETE FROM ${sql.raw(`"${rolesSchema}"."user_roles"`)} WHERE user_id = ${userId}`);

        // Insert new roles
        for (const roleId of roleIds) {
            await this.db.execute(sql`
                INSERT INTO ${sql.raw(`"${rolesSchema}"."user_roles"`)} (user_id, role_id)
                VALUES (${userId}, ${roleId})
                ON CONFLICT DO NOTHING
            `);
        }
    }

    /**
     * Assign a specific role to new user
     */
    async assignDefaultRole(userId: string, roleId: string): Promise<void> {
        const rolesSchema = getTableConfig(this.userRolesTable).schema || "public";
        await this.db.execute(sql`
            INSERT INTO ${sql.raw(`"${rolesSchema}"."user_roles"`)} (user_id, role_id)
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
    private rolesTable: PgTable & Record<string, AnyPgColumn>;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: (PgTable & Record<string, AnyPgColumn>) | Partial<AuthSchemaTables>
    ) {
        if (tableOrTables && ((tableOrTables as Partial<AuthSchemaTables>).roles || (tableOrTables as Partial<AuthSchemaTables>).users)) {
            this.rolesTable = ((tableOrTables as Partial<AuthSchemaTables>).roles || roles) as unknown as PgTable & Record<string, AnyPgColumn>;
        } else {
            this.rolesTable = (tableOrTables as unknown as PgTable & Record<string, AnyPgColumn>) || (roles as unknown as PgTable & Record<string, AnyPgColumn>);
        }
    }

    private getQualifiedRolesTableName(): string {
        const name = getTableName(this.rolesTable);
        const schema = getTableConfig(this.rolesTable).schema || "public";
        return `"${schema}"."${name}"`;
    }

    async getRoleById(id: string): Promise<Role | null> {
        const tableName = this.getQualifiedRolesTableName();
        const result = await this.db.execute(sql`
            SELECT id, name, is_admin, default_permissions, collection_permissions
            FROM ${sql.raw(tableName)}
            WHERE id = ${id}
        `);

        if (result.rows.length === 0) return null;

        const row = result.rows[0] as { id: string; name: string; is_admin: boolean; default_permissions: Record<string, boolean> | null; collection_permissions: Record<string, Record<string, boolean>> | null };
        return {
            id: row.id,
            name: row.name,
            isAdmin: row.is_admin,
            defaultPermissions: row.default_permissions,
            collectionPermissions: row.collection_permissions
        };
    }

    async listRoles(): Promise<Role[]> {
        const tableName = this.getQualifiedRolesTableName();
        const result = await this.db.execute(sql`
            SELECT id, name, is_admin, default_permissions, collection_permissions
            FROM ${sql.raw(tableName)}
            ORDER BY name
        `);

        return (result.rows as Array<{ id: string; name: string; is_admin: boolean; default_permissions: Record<string, boolean> | null; collection_permissions: Record<string, Record<string, boolean>> | null }>).map(row => ({
            id: row.id,
            name: row.name,
            isAdmin: row.is_admin,
            defaultPermissions: row.default_permissions,
            collectionPermissions: row.collection_permissions
        }));
    }

    async createRole(data: Omit<Role, "isAdmin" | "collectionPermissions"> & { isAdmin?: boolean; collectionPermissions?: Role["collectionPermissions"] }): Promise<Role> {
        const tableName = this.getQualifiedRolesTableName();
        const result = await this.db.execute(sql`
            INSERT INTO ${sql.raw(tableName)} (id, name, is_admin, default_permissions, collection_permissions)
            VALUES (
                ${data.id},
                ${data.name},
                ${data.isAdmin ?? false},
                ${data.defaultPermissions ? JSON.stringify(data.defaultPermissions) : null}::jsonb,
                ${data.collectionPermissions ? JSON.stringify(data.collectionPermissions) : null}::jsonb
            )
            RETURNING id, name, is_admin, default_permissions, collection_permissions
        `);

        const row = result.rows[0] as { id: string; name: string; is_admin: boolean; default_permissions: Record<string, boolean> | null; collection_permissions: Record<string, Record<string, boolean>> | null };
        return {
            id: row.id,
            name: row.name,
            isAdmin: row.is_admin,
            defaultPermissions: row.default_permissions,
            collectionPermissions: row.collection_permissions
        };
    }

    async updateRole(id: string, data: Partial<Omit<Role, "id">>): Promise<Role | null> {
        const existing = await this.getRoleById(id);
        if (!existing) return null;

        const tableName = this.getQualifiedRolesTableName();
        await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET 
                name = ${data.name ?? existing.name},
                is_admin = ${data.isAdmin ?? existing.isAdmin},
                default_permissions = ${data.defaultPermissions ? JSON.stringify(data.defaultPermissions) : JSON.stringify(existing.defaultPermissions)}::jsonb,
                collection_permissions = ${data.collectionPermissions !== undefined ? (data.collectionPermissions ? JSON.stringify(data.collectionPermissions) : null) : (existing.collectionPermissions ? JSON.stringify(existing.collectionPermissions) : null)}::jsonb
            WHERE id = ${id}
        `);

        return this.getRoleById(id);
    }

    async deleteRole(id: string): Promise<void> {
        const tableName = this.getQualifiedRolesTableName();
        await this.db.execute(sql`DELETE FROM ${sql.raw(tableName)} WHERE id = ${id}`);
    }
}

export class RefreshTokenService {
    private refreshTokensTable: PgTable & Record<string, AnyPgColumn>;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: (PgTable & Record<string, AnyPgColumn>) | Partial<AuthSchemaTables>
    ) {
        if (tableOrTables && ((tableOrTables as Partial<AuthSchemaTables>).refreshTokens || (tableOrTables as Partial<AuthSchemaTables>).users)) {
            this.refreshTokensTable = ((tableOrTables as Partial<AuthSchemaTables>).refreshTokens || refreshTokens) as unknown as PgTable & Record<string, AnyPgColumn>;
        } else {
            this.refreshTokensTable = (tableOrTables as unknown as PgTable & Record<string, AnyPgColumn>) || (refreshTokens as unknown as PgTable & Record<string, AnyPgColumn>);
        }
    }

    private getQualifiedRefreshTokensTableName(): string {
        const name = getTableName(this.refreshTokensTable);
        const schema = getTableConfig(this.refreshTokensTable).schema || "public";
        return `"${schema}"."${name}"`;
    }

    async createToken(userId: string, tokenHash: string, expiresAt: Date, userAgent?: string, ipAddress?: string): Promise<void> {
        // Fallback to empty string because UNIQUE constraints treat NULLs as strictly distinct in standard Postgres.
        // We want (userId, NULL, NULL) to collide and overwrite, so we map undefined/null to empty strings.
        const safeUserAgent = userAgent || "";
        const safeIpAddress = ipAddress || "";

        // Delete any existing session for this user/device combo, then insert.
        // This approach doesn't require the unique_device_session constraint to exist.
        const tableName = this.getQualifiedRefreshTokensTableName();
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} 
            WHERE user_id = ${userId} 
            AND user_agent = ${safeUserAgent} 
            AND ip_address = ${safeIpAddress}
        `);

        await this.db.insert(this.refreshTokensTable)
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
                id: this.refreshTokensTable.id,
                userId: this.refreshTokensTable.userId,
                tokenHash: this.refreshTokensTable.tokenHash,
                expiresAt: this.refreshTokensTable.expiresAt,
                createdAt: this.refreshTokensTable.createdAt,
                userAgent: this.refreshTokensTable.userAgent,
                ipAddress: this.refreshTokensTable.ipAddress
            })
            .from(this.refreshTokensTable)
            .where(eq(this.refreshTokensTable.tokenHash, tokenHash));

        return (token as RefreshTokenInfo) || null;
    }

    async deleteByHash(tokenHash: string): Promise<void> {
        await this.db.delete(this.refreshTokensTable).where(eq(this.refreshTokensTable.tokenHash, tokenHash));
    }

    async deleteAllForUser(userId: string): Promise<void> {
        await this.db.delete(this.refreshTokensTable).where(eq(this.refreshTokensTable.userId, userId));
    }

    async listForUser(userId: string): Promise<RefreshTokenInfo[]> {
        const tokens = await this.db
            .select({
                id: this.refreshTokensTable.id,
                userId: this.refreshTokensTable.userId,
                tokenHash: this.refreshTokensTable.tokenHash,
                expiresAt: this.refreshTokensTable.expiresAt,
                createdAt: this.refreshTokensTable.createdAt,
                userAgent: this.refreshTokensTable.userAgent,
                ipAddress: this.refreshTokensTable.ipAddress
            })
            .from(this.refreshTokensTable)
            .where(eq(this.refreshTokensTable.userId, userId))
            .orderBy(this.refreshTokensTable.createdAt);

        return tokens as RefreshTokenInfo[];
    }

    async deleteById(id: string, userId: string): Promise<void> {
        await this.db.delete(this.refreshTokensTable)
            .where(sql`${this.refreshTokensTable.id} = ${id} AND ${this.refreshTokensTable.userId} = ${userId}`);
    }
}

/**
 * Password reset token service
 */
export class PasswordResetTokenService {
    private passwordResetTokensTable: PgTable & Record<string, AnyPgColumn>;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: (PgTable & Record<string, AnyPgColumn>) | Partial<AuthSchemaTables>
    ) {
        if (tableOrTables && ((tableOrTables as Partial<AuthSchemaTables>).passwordResetTokens || (tableOrTables as Partial<AuthSchemaTables>).users)) {
            this.passwordResetTokensTable = ((tableOrTables as Partial<AuthSchemaTables>).passwordResetTokens || passwordResetTokens) as unknown as PgTable & Record<string, AnyPgColumn>;
        } else {
            this.passwordResetTokensTable = (tableOrTables as unknown as PgTable & Record<string, AnyPgColumn>) || (passwordResetTokens as unknown as PgTable & Record<string, AnyPgColumn>);
        }
    }

    private getQualifiedPasswordResetTokensTableName(): string {
        const name = getTableName(this.passwordResetTokensTable);
        const schema = getTableConfig(this.passwordResetTokensTable).schema || "public";
        return `"${schema}"."${name}"`;
    }

    /**
     * Create a password reset token
     */
    async createToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
        // Delete any existing unused tokens for this user
        const tableName = this.getQualifiedPasswordResetTokensTableName();
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} 
            WHERE user_id = ${userId} AND used_at IS NULL
        `);

        await this.db.insert(this.passwordResetTokensTable).values({
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
                userId: this.passwordResetTokensTable.userId,
                expiresAt: this.passwordResetTokensTable.expiresAt
            })
            .from(this.passwordResetTokensTable)
            .where(eq(this.passwordResetTokensTable.tokenHash, tokenHash)) as unknown as Array<{ userId: string; expiresAt: Date }>;

        if (!token) return null;

        // Check if expired or used
        const tableName = this.getQualifiedPasswordResetTokensTableName();
        const result = await this.db.execute(sql`
            SELECT user_id, expires_at 
            FROM ${sql.raw(tableName)} 
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
            .update(this.passwordResetTokensTable)
            .set({ usedAt: new Date() })
            .where(eq(this.passwordResetTokensTable.tokenHash, tokenHash));
    }

    /**
     * Delete all tokens for a user
     */
    async deleteAllForUser(userId: string): Promise<void> {
        await this.db.delete(this.passwordResetTokensTable).where(eq(this.passwordResetTokensTable.userId, userId));
    }

    /**
     * Clean up expired tokens
     */
    async deleteExpired(): Promise<void> {
        const tableName = this.getQualifiedPasswordResetTokensTableName();
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} 
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

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: (PgTable & Record<string, AnyPgColumn>) | Partial<AuthSchemaTables>
    ) {
        this.refreshTokenService = new RefreshTokenService(db, tableOrTables);
        this.passwordResetTokenService = new PasswordResetTokenService(db, tableOrTables);
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

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: (PgTable & Record<string, AnyPgColumn>) | Partial<AuthSchemaTables>
    ) {
        this.userService = new UserService(db, tableOrTables);
        this.roleService = new RoleService(db, tableOrTables);
        this.tokenRepository = new PostgresTokenRepository(db, tableOrTables);
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
            collectionPermissions: data.collectionPermissions ?? null
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

    // MFA operations (delegate to MfaService)

    private _mfaService: MfaService | null = null;
    private getMfaService(): MfaService {
        if (!this._mfaService) {
            this._mfaService = new MfaService(this.db);
        }
        return this._mfaService;
    }

    async createMfaFactor(userId: string, factorType: "totp", secretEncrypted: string, friendlyName?: string): Promise<MfaFactor> {
        return this.getMfaService().createMfaFactor(userId, factorType, secretEncrypted, friendlyName);
    }

    async getMfaFactors(userId: string): Promise<MfaFactor[]> {
        return this.getMfaService().getMfaFactors(userId);
    }

    async getMfaFactorById(factorId: string): Promise<(MfaFactor & { secretEncrypted: string }) | null> {
        return this.getMfaService().getMfaFactorById(factorId);
    }

    async verifyMfaFactor(factorId: string): Promise<void> {
        return this.getMfaService().verifyMfaFactor(factorId);
    }

    async deleteMfaFactor(factorId: string, userId: string): Promise<void> {
        return this.getMfaService().deleteMfaFactor(factorId, userId);
    }

    async createMfaChallenge(factorId: string, ipAddress?: string): Promise<MfaChallengeInfo> {
        return this.getMfaService().createMfaChallenge(factorId, ipAddress);
    }

    async getMfaChallengeById(challengeId: string): Promise<MfaChallengeInfo | null> {
        return this.getMfaService().getMfaChallengeById(challengeId);
    }

    async verifyMfaChallenge(challengeId: string): Promise<void> {
        return this.getMfaService().verifyMfaChallenge(challengeId);
    }

    async createRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
        return this.getMfaService().createRecoveryCodes(userId, codeHashes);
    }

    async useRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
        return this.getMfaService().useRecoveryCode(userId, codeHash);
    }

    async getUnusedRecoveryCodeCount(userId: string): Promise<number> {
        return this.getMfaService().getUnusedRecoveryCodeCount(userId);
    }

    async deleteAllRecoveryCodes(userId: string): Promise<void> {
        return this.getMfaService().deleteAllRecoveryCodes(userId);
    }

    async hasVerifiedMfaFactors(userId: string): Promise<boolean> {
        return this.getMfaService().hasVerifiedMfaFactors(userId);
    }
}

// =============================================================================
// MFA SERVICE
// =============================================================================

/**
 * PostgreSQL implementation of MfaRepository.
 * Handles all MFA-related database operations.
 */
export class MfaService implements MfaRepository {
    constructor(private db: NodePgDatabase, private schemaName: string = "rebase") {}

    private qualify(tableName: string): string {
        return `"${this.schemaName}"."${tableName}"`;
    }

    async createMfaFactor(
        userId: string,
        factorType: "totp",
        secretEncrypted: string,
        friendlyName?: string
    ): Promise<MfaFactor> {
        const tableName = this.qualify("mfa_factors");
        const result = await this.db.execute(sql`
            INSERT INTO ${sql.raw(tableName)} (user_id, factor_type, secret_encrypted, friendly_name)
            VALUES (${userId}, ${factorType}, ${secretEncrypted}, ${friendlyName ?? null})
            RETURNING id, user_id, factor_type, friendly_name, verified, created_at, updated_at
        `);

        const row = result.rows[0] as Record<string, unknown>;
        return {
            id: row.id as string,
            userId: row.user_id as string,
            factorType: row.factor_type as "totp",
            friendlyName: (row.friendly_name as string | null) ?? undefined,
            verified: row.verified as boolean,
            createdAt: new Date(row.created_at as string),
            updatedAt: new Date(row.updated_at as string)
        };
    }

    async getMfaFactors(userId: string): Promise<MfaFactor[]> {
        const tableName = this.qualify("mfa_factors");
        const result = await this.db.execute(sql`
            SELECT id, user_id, factor_type, friendly_name, verified, created_at, updated_at
            FROM ${sql.raw(tableName)}
            WHERE user_id = ${userId}
            ORDER BY created_at
        `);

        return (result.rows as Array<Record<string, unknown>>).map(row => ({
            id: row.id as string,
            userId: row.user_id as string,
            factorType: row.factor_type as "totp",
            friendlyName: (row.friendly_name as string | null) ?? undefined,
            verified: row.verified as boolean,
            createdAt: new Date(row.created_at as string),
            updatedAt: new Date(row.updated_at as string)
        }));
    }

    async getMfaFactorById(factorId: string): Promise<(MfaFactor & { secretEncrypted: string }) | null> {
        const tableName = this.qualify("mfa_factors");
        const result = await this.db.execute(sql`
            SELECT id, user_id, factor_type, secret_encrypted, friendly_name, verified, created_at, updated_at
            FROM ${sql.raw(tableName)}
            WHERE id = ${factorId}
        `);

        if (result.rows.length === 0) return null;

        const row = result.rows[0] as Record<string, unknown>;
        return {
            id: row.id as string,
            userId: row.user_id as string,
            factorType: row.factor_type as "totp",
            secretEncrypted: row.secret_encrypted as string,
            friendlyName: (row.friendly_name as string | null) ?? undefined,
            verified: row.verified as boolean,
            createdAt: new Date(row.created_at as string),
            updatedAt: new Date(row.updated_at as string)
        };
    }

    async verifyMfaFactor(factorId: string): Promise<void> {
        const tableName = this.qualify("mfa_factors");
        await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET verified = TRUE, updated_at = NOW()
            WHERE id = ${factorId}
        `);
    }

    async deleteMfaFactor(factorId: string, userId: string): Promise<void> {
        const tableName = this.qualify("mfa_factors");
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)}
            WHERE id = ${factorId} AND user_id = ${userId}
        `);
    }

    async createMfaChallenge(factorId: string, ipAddress?: string): Promise<MfaChallengeInfo> {
        const tableName = this.qualify("mfa_challenges");
        // Challenges expire in 5 minutes
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
        const result = await this.db.execute(sql`
            INSERT INTO ${sql.raw(tableName)} (factor_id, ip_address, expires_at)
            VALUES (${factorId}, ${ipAddress ?? null}, ${expiresAt})
            RETURNING id, factor_id, created_at, verified_at, ip_address
        `);

        const row = result.rows[0] as Record<string, unknown>;
        return {
            id: row.id as string,
            factorId: row.factor_id as string,
            createdAt: new Date(row.created_at as string),
            verifiedAt: row.verified_at ? new Date(row.verified_at as string) : undefined,
            ipAddress: (row.ip_address as string | null) ?? undefined
        };
    }

    async getMfaChallengeById(challengeId: string): Promise<MfaChallengeInfo | null> {
        const tableName = this.qualify("mfa_challenges");
        const result = await this.db.execute(sql`
            SELECT id, factor_id, created_at, verified_at, ip_address, expires_at
            FROM ${sql.raw(tableName)}
            WHERE id = ${challengeId} AND expires_at > NOW() AND verified_at IS NULL
        `);

        if (result.rows.length === 0) return null;

        const row = result.rows[0] as Record<string, unknown>;
        return {
            id: row.id as string,
            factorId: row.factor_id as string,
            createdAt: new Date(row.created_at as string),
            verifiedAt: row.verified_at ? new Date(row.verified_at as string) : undefined,
            ipAddress: (row.ip_address as string | null) ?? undefined
        };
    }

    async verifyMfaChallenge(challengeId: string): Promise<void> {
        const tableName = this.qualify("mfa_challenges");
        await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET verified_at = NOW()
            WHERE id = ${challengeId}
        `);
    }

    async createRecoveryCodes(userId: string, codeHashes: string[]): Promise<void> {
        const tableName = this.qualify("recovery_codes");
        // Delete existing codes first
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} WHERE user_id = ${userId}
        `);

        // Insert new codes
        for (const hash of codeHashes) {
            await this.db.execute(sql`
                INSERT INTO ${sql.raw(tableName)} (user_id, code_hash)
                VALUES (${userId}, ${hash})
            `);
        }
    }

    async useRecoveryCode(userId: string, codeHash: string): Promise<boolean> {
        const tableName = this.qualify("recovery_codes");
        const result = await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET used_at = NOW()
            WHERE user_id = ${userId} AND code_hash = ${codeHash} AND used_at IS NULL
            RETURNING id
        `);

        return result.rows.length > 0;
    }

    async getUnusedRecoveryCodeCount(userId: string): Promise<number> {
        const tableName = this.qualify("recovery_codes");
        const result = await this.db.execute(sql`
            SELECT COUNT(*)::int as count FROM ${sql.raw(tableName)}
            WHERE user_id = ${userId} AND used_at IS NULL
        `);

        return (result.rows[0] as { count: number }).count;
    }

    async deleteAllRecoveryCodes(userId: string): Promise<void> {
        const tableName = this.qualify("recovery_codes");
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} WHERE user_id = ${userId}
        `);
    }

    async hasVerifiedMfaFactors(userId: string): Promise<boolean> {
        const tableName = this.qualify("mfa_factors");
        const result = await this.db.execute(sql`
            SELECT COUNT(*)::int as count FROM ${sql.raw(tableName)}
            WHERE user_id = ${userId} AND verified = TRUE
        `);

        return (result.rows[0] as { count: number }).count > 0;
    }
}

// =============================================================================
// PostgreSQL Type Aliases (for consistent naming with other implementations)
// =============================================================================

/** PostgreSQL user repository implementation */
export type PostgresUserRepository = UserService;

/** PostgreSQL role repository implementation */
export type PostgresRoleRepository = RoleService;
