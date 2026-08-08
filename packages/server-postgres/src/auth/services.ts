import { eq, getTableName, sql } from "drizzle-orm";
import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { getTableConfig } from "drizzle-orm/pg-core";
import type { RebasePgTable } from "../types";
import { users, refreshTokens, passwordResetTokens, userIdentities, magicLinkTokens } from "../schema/auth-schema";
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
    RefreshTokenSession,
    PasswordResetTokenInfo,
    MagicLinkTokenInfo,
    UserIdentityData,
    ListUsersOptions,
    PaginatedUsersResult,
    MfaFactor,
    MfaChallengeInfo,
    RoleData as Role
} from "@rebasepro/server";
import { toSnakeCase, camelCase } from "@rebasepro/utils";
import { escapeLikePattern } from "../utils/drizzle-conditions";

export type { Role };

export interface AuthSchemaTables {
    users: RebasePgTable;
    refreshTokens: RebasePgTable;
    passwordResetTokens: RebasePgTable;
    appConfig: RebasePgTable;
    userIdentities: RebasePgTable;
}

function getColumnKey(table: RebasePgTable | undefined, ...keys: string[]): string | undefined {
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

function getColumn(table: RebasePgTable | undefined, ...keys: string[]): RebasePgTable[string] | undefined {
    if (!table) return undefined;
    const key = getColumnKey(table, ...keys);
    return key ? table[key] : undefined;
}

/**
 * The single definition of what an email address looks like in storage.
 *
 * Reads have always folded case; writes did not, and normalising was left to
 * each caller. That asymmetry is only ever one forgotten `.toLowerCase()` away
 * from a row no lookup can find — the account exists, every sign-in path
 * reports no such user, and the byte-exact UNIQUE on the column does not stop a
 * duplicate differing only in case. Applied on both sides here so the guarantee
 * belongs to the repository rather than to its callers' discipline; the
 * `lower(email)` unique index added in `ensureAuthTablesExist` is the database
 * half of the same rule.
 *
 * Whitespace goes too: a trailing space survives the fold and reproduces the
 * problem exactly.
 *
 * Re-exported rather than defined here: `@rebasepro/server` and
 * `@rebasepro/server-mongo` write this column too, and a second copy of this
 * rule is the defect it exists to prevent.
 */
import { normalizeEmail } from "@rebasepro/common";
export { normalizeEmail };

/**
 * PostgreSQL implementation of UserRepository.
 * Handles all user-related database operations using Drizzle ORM.
 */
export class UserService implements UserRepository {
    private usersTable: RebasePgTable;
    private userIdentitiesTable: RebasePgTable;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: RebasePgTable | Partial<AuthSchemaTables>
    ) {
        if (tableOrTables && ((tableOrTables as Partial<AuthSchemaTables>).users)) {
            const tables = tableOrTables as Partial<AuthSchemaTables>;
            this.usersTable = (tables.users || users) as RebasePgTable;
            this.userIdentitiesTable = (tables.userIdentities || userIdentities) as RebasePgTable;
        } else {
            const table = tableOrTables as RebasePgTable | undefined;
            this.usersTable = table || (users as unknown as RebasePgTable);
            this.userIdentitiesTable = userIdentities as unknown as RebasePgTable;
        }
    }

    private getQualifiedUsersTableName(): string {
        const name = getTableName(this.usersTable);
        const schema = getTableConfig(this.usersTable).schema || "public";
        return `"${schema}"."${name}"`;
    }

    /**
     * Run a privileged auth write with an explicitly cleared RLS context.
     *
     * The auth services run on the base/owner connection, which by design
     * carries a NULL `app.uid` so the `auth.uid() IS NULL` server-escape
     * in the default policies applies. That NULL is normally guaranteed by
     * `set_config(..., is_local = true)` resetting at transaction end — but a
     * GUC that survives on a pooled connection (or a connection role that
     * doesn't bypass RLS: FORCE ROW LEVEL SECURITY, or a non-owner role)
     * turns the trusted write into an RLS-scoped one and denies it with
     * SQLSTATE 42501. Clearing the GUCs here, transaction-locally at the
     * single chokepoint, makes the server context deterministic instead of
     * trusting whatever state the pool hands us. `auth.uid()` reads '' as
     * NULL via NULLIF, so '' is the server context.
     */
    private async withServerContext<T>(fn: (db: NodePgDatabase) => Promise<T>): Promise<T> {
        return await this.db.transaction(async (tx) => {
            await tx.execute(sql`
                SELECT set_config('app.uid', '', true),
                       set_config('app.user_id', '', true),
                       set_config('app.user_roles', '', true),
                       set_config('app.jwt', '', true)
            `);
            return await fn(tx as unknown as NodePgDatabase);
        });
    }

    private mapRowToUser(row: Record<string, unknown>): UserData {
        if (!row) return row as UserData;

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
            "roles",
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
        if ("email" in data) payload[emailKey] = normalizeEmail(data.email);
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
        const [row] = await this.withServerContext(async (db) =>
            (await db.insert(this.usersTable).values(payload).returning()) as Record<string, unknown>[]
        );
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
        const [row] = await this.db.select().from(this.usersTable).where(eq(emailCol, normalizeEmail(email)));
        return row ? this.mapRowToUser(row as Record<string, unknown>) : null;
    }

    async getUserByIdentity(provider: string, providerId: string): Promise<UserData | null> {
        const userIdCol = getColumn(this.usersTable, "id");
        if (!userIdCol) return null;

        const result = await this.db
            .select({ user: this.usersTable })
            .from(this.usersTable)
            .innerJoin(this.userIdentitiesTable, eq(userIdCol, this.userIdentitiesTable.uid))
            .where(
                sql`${this.userIdentitiesTable.provider} = ${provider} AND ${this.userIdentitiesTable.providerId} = ${providerId}`
            )
            .limit(1);

        if (result.length === 0) return null;
        return this.mapRowToUser(result[0].user as Record<string, unknown>);
    }

    async getUserIdentities(uid: string): Promise<UserIdentityData[]> {
        const schema = getTableConfig(this.userIdentitiesTable).schema || "public";
        const result = await this.db.execute(sql`
            SELECT id, uid, provider, provider_id, profile_data, created_at, updated_at
            FROM ${sql.raw(`"${schema}"."user_identities"`)}
            WHERE uid = ${uid}
        `);

        return result.rows.map((row: Record<string, unknown>) => ({
            id: row.id as string,
            uid: row.uid as string,
            provider: row.provider as string,
            providerId: row.provider_id as string,
            profileData: (row.profile_data as Record<string, unknown> | null) ?? null,
            createdAt: row.created_at as Date,
            updatedAt: row.updated_at as Date
        }));
    }

    async linkUserIdentity(uid: string, provider: string, providerId: string, profileData?: Record<string, unknown>): Promise<void> {
        await this.withServerContext(async (db) => db.insert(this.userIdentitiesTable).values({
            uid,
            provider,
            providerId,
            profileData: profileData || null
        }).onConflictDoNothing({ target: [this.userIdentitiesTable.provider, this.userIdentitiesTable.providerId] }));
    }

    async updateUser(id: string, data: Partial<Omit<CreateUserData, "id">>): Promise<UserData | null> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return null;
        const payload = this.mapPayload(data);
        const updatedAtKey = getColumnKey(this.usersTable, "updatedAt", "updated_at") || "updatedAt";
        payload[updatedAtKey] = new Date();

        const [row] = await this.withServerContext(async (db) =>
            (await db
                .update(this.usersTable)
                .set(payload)
                .where(eq(idCol, id))
                .returning()) as Record<string, unknown>[]
        );
        return row ? this.mapRowToUser(row) : null;
    }

    async deleteUser(id: string): Promise<void> {
        const idCol = getColumn(this.usersTable, "id");
        if (!idCol) return;
        await this.withServerContext(async (db) => db.delete(this.usersTable).where(eq(idCol, id)));
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
        const conditions = [];
        if (roleId) {
            conditions.push(sql`${roleId} = ANY(${sql.raw(usersTableName)}.roles)`);
        }
        if (search) {
            // `search` is a substring search over the admin user list, not a
            // pattern the caller writes: the same reasoning as the collection
            // search path, so it shares that path's helper rather than growing
            // a second copy that can drift. See `escapeLikePattern`.
            const pattern = `%${escapeLikePattern(search)}%`;
            conditions.push(sql`(${sql.raw(usersTableName)}.${sql.raw(emailColumn)} ILIKE ${pattern} OR ${sql.raw(usersTableName)}.${sql.raw(displayNameColumn)} ILIKE ${pattern})`);
        }

        const whereClause = conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

        // Sorting: users with roles first if no role filter, then by requested order
        const orderByClause = roleId
            ? sql`ORDER BY ${sql.raw(usersTableName)}.${sql.raw(orderColumn)} ${direction}`
            : sql`ORDER BY array_length(${sql.raw(usersTableName)}.roles, 1) DESC NULLS LAST, ${sql.raw(usersTableName)}.${sql.raw(orderColumn)} ${direction}`;

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

        await this.withServerContext(async (db) => db
            .update(this.usersTable)
            .set({
                [passwordHashColKey]: passwordHash,
                [updatedAtColKey]: new Date()
            })
            .where(eq(idCol, id)));
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

        await this.withServerContext(async (db) => db
            .update(this.usersTable)
            .set({
                [emailVerifiedColKey]: verified,
                [emailVerificationTokenColKey]: null,
                [updatedAtColKey]: new Date()
            })
            .where(eq(idCol, id)));
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

        await this.withServerContext(async (db) => db
            .update(this.usersTable)
            .set({
                [emailVerificationTokenColKey]: token,
                [emailVerificationSentAtColKey]: token ? new Date() : null,
                [updatedAtColKey]: new Date()
            })
            .where(eq(idCol, id)));
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
     * Get roles for a user from database (inline TEXT[] column)
     */
    async getUserRoles(uid: string): Promise<Role[]> {
        const usersTableName = this.getQualifiedUsersTableName();
        const result = await this.db.execute(sql`
            SELECT roles FROM ${sql.raw(usersTableName)} WHERE id = ${uid}
        `);

        if (result.rows.length === 0) return [];

        const row = result.rows[0] as { roles: string[] | null };
        const roleIds = row.roles ?? [];

        return roleIds.map(id => ({
            id,
            name: id,
            isAdmin: id === "admin",
            defaultPermissions: null,
            collectionPermissions: null
        }));
    }

    /**
     * Get role IDs for a user
     */
    async getUserRoleIds(uid: string): Promise<string[]> {
        const usersTableName = this.getQualifiedUsersTableName();
        const result = await this.db.execute(sql`
            SELECT roles FROM ${sql.raw(usersTableName)} WHERE id = ${uid}
        `);

        if (result.rows.length === 0) return [];

        const row = result.rows[0] as { roles: string[] | null };
        return row.roles ?? [];
    }

    /**
     * Set roles for a user (replaces existing roles)
     */
    async setUserRoles(uid: string, roleIds: string[]): Promise<void> {
        const usersTableName = this.getQualifiedUsersTableName();
        const rolesArray = `{${roleIds.join(",")}}`;
        await this.withServerContext(async (db) => db.execute(sql`
            UPDATE ${sql.raw(usersTableName)}
            SET roles = ${rolesArray}::text[], updated_at = NOW()
            WHERE id = ${uid}
        `));
    }

    /**
     * Assign a specific role to new user (appends if not present)
     */
    async assignDefaultRole(uid: string, roleId: string): Promise<void> {
        const usersTableName = this.getQualifiedUsersTableName();
        await this.withServerContext(async (db) => db.execute(sql`
            UPDATE ${sql.raw(usersTableName)}
            SET roles = array_append(roles, ${roleId}), updated_at = NOW()
            WHERE id = ${uid} AND NOT (${roleId} = ANY(roles))
        `));
    }

    /**
     * Get user with their roles
     */
    async getUserWithRoles(uid: string): Promise<{ user: UserData; roles: Role[] } | null> {
        const user = await this.getUserById(uid);
        if (!user) return null;

        const roles = await this.getUserRoles(uid);
        return { user,
            roles };
    }
}


export class RefreshTokenService {
    private refreshTokensTable: RebasePgTable;
    private usersTable: RebasePgTable | null;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: RebasePgTable | Partial<AuthSchemaTables>
    ) {
        if (tableOrTables && ((tableOrTables as Partial<AuthSchemaTables>).refreshTokens || (tableOrTables as Partial<AuthSchemaTables>).users)) {
            this.refreshTokensTable = ((tableOrTables as Partial<AuthSchemaTables>).refreshTokens || refreshTokens) as RebasePgTable;
            this.usersTable = ((tableOrTables as Partial<AuthSchemaTables>).users || users) as RebasePgTable;
        } else {
            this.refreshTokensTable = (tableOrTables as RebasePgTable) || (refreshTokens as unknown as RebasePgTable);
            this.usersTable = users as unknown as RebasePgTable;
        }
    }

    /**
     * Whether the table actually carries a column, so a host application that
     * supplied its own `refresh_tokens` table — one that predates session
     * grouping — degrades instead of throwing on every sign-in.
     */
    private has(column: string): boolean {
        return Boolean((this.refreshTokensTable as unknown as Record<string, unknown>)[column]);
    }

    private col(column: string) {
        return (this.refreshTokensTable as unknown as Record<string, never>)[column];
    }

    /** The columns to read back, narrowed to the ones this table has. */
    private selection() {
        const selection: Record<string, never> = {
            id: this.refreshTokensTable.id,
            uid: this.refreshTokensTable.uid,
            tokenHash: this.refreshTokensTable.tokenHash,
            expiresAt: this.refreshTokensTable.expiresAt,
            createdAt: this.refreshTokensTable.createdAt,
            userAgent: this.refreshTokensTable.userAgent,
            ipAddress: this.refreshTokensTable.ipAddress
        } as unknown as Record<string, never>;
        for (const optional of ["sessionId", "rotatedAt", "revoked", "sessionStartedAt", "aal"]) {
            if (this.has(optional)) selection[optional] = this.col(optional);
        }
        return selection;
    }

    async createToken(
        uid: string,
        tokenHash: string,
        expiresAt: Date,
        userAgent?: string,
        ipAddress?: string,
        session?: RefreshTokenSession
    ): Promise<void> {
        // Empty strings rather than NULLs: the device-session UNIQUE constraint
        // that needed them is gone, but sessions-list UIs already render "" as
        // "unknown device" and would start showing blanks otherwise.
        const safeUserAgent = userAgent || "";
        const safeIpAddress = ipAddress || "";

        // A plain INSERT. Rotation ADDS a token; it does not replace a device's
        // row. Two refreshes racing on the same session therefore both succeed
        // and both end holding a usable token, where the previous upsert had
        // them overwrite each other and logged one of the two tabs out.
        const values: Record<string, unknown> = {
            uid,
            tokenHash,
            expiresAt,
            userAgent: safeUserAgent,
            ipAddress: safeIpAddress
        };
        if (session && this.has("sessionId")) values.sessionId = session.id;
        if (session && this.has("sessionStartedAt")) values.sessionStartedAt = session.startedAt;
        // Written on every token of the session, including the ones rotation
        // mints, because refresh reads the level off whichever row was
        // presented. A table without the column degrades to `aal1` on read,
        // which is the restrictive answer rather than a bypass.
        if (session?.aal && this.has("aal")) values.aal = session.aal;

        await this.db.insert(this.refreshTokensTable).values(values);
    }

    async findByHash(tokenHash: string): Promise<RefreshTokenInfo | null> {
        const [token] = await this.db
            .select(this.selection())
            .from(this.refreshTokensTable)
            .where(eq(this.refreshTokensTable.tokenHash, tokenHash));

        return (token as unknown as RefreshTokenInfo) || null;
    }

    /**
     * Record that a token was rotated away, keeping the row.
     *
     * The row is what lets `/auth/refresh` distinguish "you already used this,
     * here is a fresh one" from "no idea what this is". Deleting it — which is
     * what this used to do — collapsed both into a 401 and signed the user out
     * for the crime of losing a response.
     */
    async markRotated(tokenHash: string): Promise<void> {
        if (!this.has("rotatedAt")) {
            await this.deleteByHash(tokenHash);
            return;
        }
        await this.db
            .update(this.refreshTokensTable)
            .set({ rotatedAt: new Date() })
            .where(eq(this.refreshTokensTable.tokenHash, tokenHash));
    }

    /** Final kill of one sign-in: logout, or revoking a device remotely. */
    async revokeSession(sessionId: string): Promise<void> {
        if (!this.has("sessionId")) return;
        if (this.has("revoked")) {
            await this.db
                .update(this.refreshTokensTable)
                .set({ revoked: true, ...(this.has("rotatedAt") ? { rotatedAt: new Date() } : {}) })
                .where(eq(this.col("sessionId"), sessionId));
            return;
        }
        await this.db.delete(this.refreshTokensTable).where(eq(this.col("sessionId"), sessionId));
    }

    /**
     * Housekeeping: rotation would otherwise leave a row per refresh forever.
     * Superseded rows are only needed for as long as a straggler might still
     * present them, and expired ones are dead weight everywhere.
     */
    async prune(uid: string, sessionId: string, supersededBefore: Date): Promise<void> {
        const uidCol = this.refreshTokensTable.uid;
        const expiresCol = this.refreshTokensTable.expiresAt;
        if (!this.has("rotatedAt") || !this.has("sessionId")) {
            await this.db.delete(this.refreshTokensTable)
                .where(sql`${uidCol} = ${uid} AND ${expiresCol} < NOW()`);
            return;
        }
        const rotatedCol = this.col("rotatedAt");
        const sessionCol = this.col("sessionId");
        await this.db.delete(this.refreshTokensTable).where(sql`
            ${uidCol} = ${uid}
            AND (
                ${expiresCol} < NOW()
                OR (
                    ${sessionCol} = ${sessionId}
                    AND ${rotatedCol} IS NOT NULL
                    AND ${rotatedCol} < ${supersededBefore}
                )
            )
        `);
    }

    async getTokensValidAfter(uid: string): Promise<Date | null> {
        if (!this.usersTable || !(this.usersTable as unknown as Record<string, unknown>).tokensValidAfter) return null;
        const [row] = await this.db
            .select({ tokensValidAfter: (this.usersTable as unknown as Record<string, never>).tokensValidAfter })
            .from(this.usersTable)
            .where(eq(this.usersTable.id, uid));
        const value = (row as { tokensValidAfter?: Date | string | null } | undefined)?.tokensValidAfter;
        return value ? new Date(value) : null;
    }

    async setTokensValidAfter(uid: string, at: Date): Promise<void> {
        if (!this.usersTable || !(this.usersTable as unknown as Record<string, unknown>).tokensValidAfter) return;
        await this.db
            .update(this.usersTable)
            .set({ tokensValidAfter: at })
            .where(eq(this.usersTable.id, uid));
    }

    async deleteByHash(tokenHash: string): Promise<void> {
        await this.db.delete(this.refreshTokensTable).where(eq(this.refreshTokensTable.tokenHash, tokenHash));
    }

    async deleteAllForUser(uid: string): Promise<void> {
        await this.db.delete(this.refreshTokensTable).where(eq(this.refreshTokensTable.uid, uid));
    }

    async listForUser(uid: string): Promise<RefreshTokenInfo[]> {
        const tokens = await this.db
            .select(this.selection())
            .from(this.refreshTokensTable)
            .where(eq(this.refreshTokensTable.uid, uid))
            .orderBy(this.refreshTokensTable.createdAt);

        return tokens as unknown as RefreshTokenInfo[];
    }

    async deleteById(id: string, uid: string): Promise<void> {
        await this.db.delete(this.refreshTokensTable)
            .where(sql`${this.refreshTokensTable.id} = ${id} AND ${this.refreshTokensTable.uid} = ${uid}`);
    }
}

/**
 * Password reset token service
 */
export class PasswordResetTokenService {
    private passwordResetTokensTable: RebasePgTable;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: RebasePgTable | Partial<AuthSchemaTables>
    ) {
        if (tableOrTables && ((tableOrTables as Partial<AuthSchemaTables>).passwordResetTokens || (tableOrTables as Partial<AuthSchemaTables>).users)) {
            this.passwordResetTokensTable = ((tableOrTables as Partial<AuthSchemaTables>).passwordResetTokens || passwordResetTokens) as RebasePgTable;
        } else {
            this.passwordResetTokensTable = (tableOrTables as RebasePgTable) || (passwordResetTokens as unknown as RebasePgTable);
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
    async createToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void> {
        // Delete any existing unused tokens for this user
        const tableName = this.getQualifiedPasswordResetTokensTableName();
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} 
            WHERE uid = ${uid} AND used_at IS NULL
        `);

        await this.db.insert(this.passwordResetTokensTable).values({
            uid,
            tokenHash,
            expiresAt
        });
    }

    /**
     * Find a valid (not expired, not used) token by hash
     */
    async findValidByHash(tokenHash: string): Promise<{ uid: string; expiresAt: Date } | null> {
        const [token] = await this.db
            .select({
                uid: this.passwordResetTokensTable.uid,
                expiresAt: this.passwordResetTokensTable.expiresAt
            })
            .from(this.passwordResetTokensTable)
            .where(eq(this.passwordResetTokensTable.tokenHash, tokenHash)) as unknown as Array<{ uid: string; expiresAt: Date }>;

        if (!token) return null;

        // Check if expired or used
        const tableName = this.getQualifiedPasswordResetTokensTableName();
        const result = await this.db.execute(sql`
            SELECT uid, expires_at 
            FROM ${sql.raw(tableName)} 
            WHERE token_hash = ${tokenHash} 
              AND used_at IS NULL 
              AND expires_at > NOW()
        `);

        if (result.rows.length === 0) return null;

        const row = result.rows[0] as { uid: string; expires_at: string | number | Date };
        return {
            uid: row.uid,
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
    async deleteAllForUser(uid: string): Promise<void> {
        await this.db.delete(this.passwordResetTokensTable).where(eq(this.passwordResetTokensTable.uid, uid));
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
 * Magic link token service.
 * Handles magic link token storage for passwordless email login.
 */
export class MagicLinkTokenService {
    private magicLinkTokensTable: RebasePgTable;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: RebasePgTable | Partial<AuthSchemaTables>
    ) {
        this.magicLinkTokensTable = (magicLinkTokens as unknown as RebasePgTable);
    }

    private getQualifiedTableName(): string {
        const name = getTableName(this.magicLinkTokensTable);
        const schema = getTableConfig(this.magicLinkTokensTable).schema || "public";
        return `"${schema}"."${name}"`;
    }

    async createToken(uid: string, tokenHash: string, expiresAt: Date): Promise<void> {
        // Delete any existing unused tokens for this user
        const tableName = this.getQualifiedTableName();
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} 
            WHERE uid = ${uid} AND used_at IS NULL
        `);

        await this.db.insert(this.magicLinkTokensTable).values({
            uid,
            tokenHash,
            expiresAt
        });
    }

    async findValidByHash(tokenHash: string): Promise<MagicLinkTokenInfo | null> {
        const tableName = this.getQualifiedTableName();
        const result = await this.db.execute(sql`
            SELECT uid, expires_at 
            FROM ${sql.raw(tableName)} 
            WHERE token_hash = ${tokenHash} 
              AND used_at IS NULL 
              AND expires_at > NOW()
        `);

        if (result.rows.length === 0) return null;

        const row = result.rows[0] as { uid: string; expires_at: string | number | Date };
        return {
            uid: row.uid,
            expiresAt: new Date(row.expires_at)
        };
    }

    async markAsUsed(tokenHash: string): Promise<void> {
        await this.db
            .update(this.magicLinkTokensTable)
            .set({ usedAt: new Date() })
            .where(eq(this.magicLinkTokensTable.tokenHash, tokenHash));
    }
}

/**
 * PostgreSQL implementation of TokenRepository.
 * Combines refresh token and password reset token operations.
 */
export class PostgresTokenRepository implements TokenRepository {
    private refreshTokenService: RefreshTokenService;
    private passwordResetTokenService: PasswordResetTokenService;
    private magicLinkTokenService: MagicLinkTokenService;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: RebasePgTable | Partial<AuthSchemaTables>
    ) {
        this.refreshTokenService = new RefreshTokenService(db, tableOrTables);
        this.passwordResetTokenService = new PasswordResetTokenService(db, tableOrTables);
        this.magicLinkTokenService = new MagicLinkTokenService(db, tableOrTables);
    }

    // Refresh token operations

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

    // Password reset token operations

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
        await this.magicLinkTokenService.createToken(uid, tokenHash, expiresAt);
    }

    async findValidMagicLinkToken(tokenHash: string): Promise<MagicLinkTokenInfo | null> {
        return this.magicLinkTokenService.findValidByHash(tokenHash);
    }

    async markMagicLinkTokenUsed(tokenHash: string): Promise<void> {
        await this.magicLinkTokenService.markAsUsed(tokenHash);
    }
}

/**
 * PostgreSQL implementation of AuthRepository.
 * Combines user, role, and token repository operations.
 * This provides a convenient single-class interface for all auth operations.
 */
export class PostgresAuthRepository implements AuthRepository {
    private userService: UserService;
    private tokenRepository: PostgresTokenRepository;

    constructor(
        private db: NodePgDatabase,
        tableOrTables?: RebasePgTable | Partial<AuthSchemaTables>
    ) {
        this.userService = new UserService(db, tableOrTables);
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

    // Role operations (roles are inline on users, synthesized from string IDs)

    async getRoleById(id: string): Promise<RoleData | null> {
        return {
            id,
            name: id,
            isAdmin: id === "admin",
            defaultPermissions: null,
            collectionPermissions: null
        };
    }

    async listRoles(): Promise<RoleData[]> {
        return [
            { id: "admin",
name: "Admin",
isAdmin: true,
defaultPermissions: null,
collectionPermissions: null },
            { id: "editor",
name: "Editor",
isAdmin: false,
defaultPermissions: null,
collectionPermissions: null },
            { id: "viewer",
name: "Viewer",
isAdmin: false,
defaultPermissions: null,
collectionPermissions: null }
        ];
    }

    async createRole(_data: CreateRoleData): Promise<RoleData> {
        return {
            id: _data.id,
            name: _data.name,
            isAdmin: _data.isAdmin ?? false,
            defaultPermissions: _data.defaultPermissions ?? null,
            collectionPermissions: _data.collectionPermissions ?? null
        };
    }

    async updateRole(id: string, data: Partial<Omit<RoleData, "id">>): Promise<RoleData | null> {
        return {
            id,
            name: data.name ?? id,
            isAdmin: data.isAdmin ?? (id === "admin"),
            defaultPermissions: data.defaultPermissions ?? null,
            collectionPermissions: data.collectionPermissions ?? null
        };
    }

    async deleteRole(_id: string): Promise<void> {
        // No-op: roles are inline strings on users
    }

    // Token operations (delegate to PostgresTokenRepository)

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

    // MFA operations (delegate to MfaService)

    private _mfaService: MfaService | null = null;
    private getMfaService(): MfaService {
        if (!this._mfaService) {
            this._mfaService = new MfaService(this.db);
        }
        return this._mfaService;
    }

    async createMfaFactor(uid: string, factorType: "totp", secretEncrypted: string, friendlyName?: string): Promise<MfaFactor> {
        return this.getMfaService().createMfaFactor(uid, factorType, secretEncrypted, friendlyName);
    }

    async getMfaFactors(uid: string): Promise<MfaFactor[]> {
        return this.getMfaService().getMfaFactors(uid);
    }

    async getMfaFactorById(factorId: string): Promise<(MfaFactor & { secretEncrypted: string }) | null> {
        return this.getMfaService().getMfaFactorById(factorId);
    }

    async verifyMfaFactor(factorId: string): Promise<void> {
        return this.getMfaService().verifyMfaFactor(factorId);
    }

    async deleteMfaFactor(factorId: string, uid: string): Promise<void> {
        return this.getMfaService().deleteMfaFactor(factorId, uid);
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

    async createRecoveryCodes(uid: string, codeHashes: string[]): Promise<void> {
        return this.getMfaService().createRecoveryCodes(uid, codeHashes);
    }

    async useRecoveryCode(uid: string, codeHash: string): Promise<boolean> {
        return this.getMfaService().useRecoveryCode(uid, codeHash);
    }

    async getUnusedRecoveryCodeCount(uid: string): Promise<number> {
        return this.getMfaService().getUnusedRecoveryCodeCount(uid);
    }

    async deleteAllRecoveryCodes(uid: string): Promise<void> {
        return this.getMfaService().deleteAllRecoveryCodes(uid);
    }

    async hasVerifiedMfaFactors(uid: string): Promise<boolean> {
        return this.getMfaService().hasVerifiedMfaFactors(uid);
    }

    async claimMfaFactorCounter(factorId: string, counter: number): Promise<boolean> {
        return this.getMfaService().claimMfaFactorCounter(factorId, counter);
    }

    async recordMfaChallengeAttempt(challengeId: string): Promise<number> {
        return this.getMfaService().recordMfaChallengeAttempt(challengeId);
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
    constructor(private db: NodePgDatabase, private schemaName = "rebase") {}

    private qualify(tableName: string): string {
        return `"${this.schemaName}"."${tableName}"`;
    }

    async createMfaFactor(
        uid: string,
        factorType: "totp",
        secretEncrypted: string,
        friendlyName?: string
    ): Promise<MfaFactor> {
        const tableName = this.qualify("mfa_factors");
        const result = await this.db.execute(sql`
            INSERT INTO ${sql.raw(tableName)} (uid, factor_type, secret_encrypted, friendly_name)
            VALUES (${uid}, ${factorType}, ${secretEncrypted}, ${friendlyName ?? null})
            RETURNING id, uid, factor_type, friendly_name, verified, created_at, updated_at
        `);

        const row = result.rows[0] as Record<string, unknown>;
        return {
            id: row.id as string,
            uid: row.uid as string,
            factorType: row.factor_type as "totp",
            friendlyName: (row.friendly_name as string | null) ?? undefined,
            verified: row.verified as boolean,
            createdAt: new Date(row.created_at as string),
            updatedAt: new Date(row.updated_at as string)
        };
    }

    async getMfaFactors(uid: string): Promise<MfaFactor[]> {
        const tableName = this.qualify("mfa_factors");
        const result = await this.db.execute(sql`
            SELECT id, uid, factor_type, friendly_name, verified, created_at, updated_at
            FROM ${sql.raw(tableName)}
            WHERE uid = ${uid}
            ORDER BY created_at
        `);

        return (result.rows as Array<Record<string, unknown>>).map(row => ({
            id: row.id as string,
            uid: row.uid as string,
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
            SELECT id, uid, factor_type, secret_encrypted, friendly_name, verified, last_used_counter, created_at, updated_at
            FROM ${sql.raw(tableName)}
            WHERE id = ${factorId}
        `);

        if (result.rows.length === 0) return null;

        const row = result.rows[0] as Record<string, unknown>;
        return {
            id: row.id as string,
            uid: row.uid as string,
            factorType: row.factor_type as "totp",
            secretEncrypted: row.secret_encrypted as string,
            friendlyName: (row.friendly_name as string | null) ?? undefined,
            verified: row.verified as boolean,
            // BIGINT comes back as a string from node-postgres.
            lastUsedCounter: row.last_used_counter === null || row.last_used_counter === undefined
                ? null
                : Number(row.last_used_counter),
            createdAt: new Date(row.created_at as string),
            updatedAt: new Date(row.updated_at as string)
        };
    }

    /**
     * Spend a TOTP time step, once and only once.
     *
     * One statement: the `WHERE` is the check, the `UPDATE` is the act, and
     * `RETURNING` reports which of two concurrent requests carrying the same
     * six digits won. Reading the counter and then writing it would let both
     * pass — the exact replay this closes.
     */
    async claimMfaFactorCounter(factorId: string, counter: number): Promise<boolean> {
        const tableName = this.qualify("mfa_factors");
        const result = await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET last_used_counter = ${counter}, updated_at = NOW()
            WHERE id = ${factorId}
              AND (last_used_counter IS NULL OR last_used_counter < ${counter})
            RETURNING id
        `);

        return result.rows.length > 0;
    }

    async verifyMfaFactor(factorId: string): Promise<void> {
        const tableName = this.qualify("mfa_factors");
        await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET verified = TRUE, updated_at = NOW()
            WHERE id = ${factorId}
        `);
    }

    async deleteMfaFactor(factorId: string, uid: string): Promise<void> {
        const tableName = this.qualify("mfa_factors");
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)}
            WHERE id = ${factorId} AND uid = ${uid}
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
            SELECT id, factor_id, created_at, verified_at, ip_address, attempts, expires_at
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
            ipAddress: (row.ip_address as string | null) ?? undefined,
            attempts: Number(row.attempts ?? 0)
        };
    }

    /**
     * Count one failed guess against a challenge and report the new total.
     *
     * Incremented in the database rather than in the route so that guesses
     * arriving in parallel — the shape any real brute-force takes — cannot
     * share a single increment.
     */
    async recordMfaChallengeAttempt(challengeId: string): Promise<number> {
        const tableName = this.qualify("mfa_challenges");
        const result = await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET attempts = attempts + 1
            WHERE id = ${challengeId}
            RETURNING attempts
        `);

        if (result.rows.length === 0) return 0;
        return Number((result.rows[0] as { attempts: number | string }).attempts);
    }

    async verifyMfaChallenge(challengeId: string): Promise<void> {
        const tableName = this.qualify("mfa_challenges");
        await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET verified_at = NOW()
            WHERE id = ${challengeId}
        `);
    }

    async createRecoveryCodes(uid: string, codeHashes: string[]): Promise<void> {
        const tableName = this.qualify("recovery_codes");
        // Delete existing codes first
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} WHERE uid = ${uid}
        `);

        // Insert new codes
        for (const hash of codeHashes) {
            await this.db.execute(sql`
                INSERT INTO ${sql.raw(tableName)} (uid, code_hash)
                VALUES (${uid}, ${hash})
            `);
        }
    }

    async useRecoveryCode(uid: string, codeHash: string): Promise<boolean> {
        const tableName = this.qualify("recovery_codes");
        const result = await this.db.execute(sql`
            UPDATE ${sql.raw(tableName)}
            SET used_at = NOW()
            WHERE uid = ${uid} AND code_hash = ${codeHash} AND used_at IS NULL
            RETURNING id
        `);

        return result.rows.length > 0;
    }

    async getUnusedRecoveryCodeCount(uid: string): Promise<number> {
        const tableName = this.qualify("recovery_codes");
        const result = await this.db.execute(sql`
            SELECT COUNT(*)::int as count FROM ${sql.raw(tableName)}
            WHERE uid = ${uid} AND used_at IS NULL
        `);

        return (result.rows[0] as { count: number }).count;
    }

    async deleteAllRecoveryCodes(uid: string): Promise<void> {
        const tableName = this.qualify("recovery_codes");
        await this.db.execute(sql`
            DELETE FROM ${sql.raw(tableName)} WHERE uid = ${uid}
        `);
    }

    async hasVerifiedMfaFactors(uid: string): Promise<boolean> {
        const tableName = this.qualify("mfa_factors");
        const result = await this.db.execute(sql`
            SELECT COUNT(*)::int as count FROM ${sql.raw(tableName)}
            WHERE uid = ${uid} AND verified = TRUE
        `);

        return (result.rows[0] as { count: number }).count > 0;
    }
}

// =============================================================================
// PostgreSQL Type Aliases (for consistent naming with other implementations)
// =============================================================================

/** PostgreSQL user repository implementation */
export type PostgresUserRepository = UserService;
