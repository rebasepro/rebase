import { pgSchema, pgTable, varchar, uuid, timestamp, boolean, jsonb, primaryKey, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Factory function to dynamically create the auth tables bound to the specified schema names.
 */
export function createAuthSchema(rolesSchemaName: string = "rebase", usersSchemaName: string = "rebase") {
    const rolesSchema = rolesSchemaName === "public" ? null : pgSchema(rolesSchemaName);
    const usersSchema = usersSchemaName === "public" ? null : pgSchema(usersSchemaName);

    const rolesTableCreator: any = rolesSchema ? rolesSchema.table.bind(rolesSchema) : pgTable;
    const usersTableCreator: any = usersSchema ? usersSchema.table.bind(usersSchema) : pgTable;

    /**
     * Users table - stores both email/password and OAuth users
     */
    const users = usersTableCreator("users", {
        id: uuid("id").defaultRandom().primaryKey(),
        email: varchar("email", { length: 255 }).notNull().unique(),
        passwordHash: varchar("password_hash", { length: 255 }), // NULL for OAuth-only users
        displayName: varchar("display_name", { length: 255 }),
        photoUrl: varchar("photo_url", { length: 500 }),
        emailVerified: boolean("email_verified").default(false).notNull(),
        emailVerificationToken: varchar("email_verification_token", { length: 255 }),
        emailVerificationSentAt: timestamp("email_verification_sent_at"),
        isAnonymous: boolean("is_anonymous").default(false).notNull(),
        metadata: jsonb("metadata").$type<Record<string, any>>().default({}).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull()
    });

    /**
     * Roles table - defines permission sets
     */
    const roles = rolesTableCreator("roles", {
        id: varchar("id", { length: 50 }).primaryKey(), // 'admin', 'editor', 'viewer'
        name: varchar("name", { length: 100 }).notNull(),
        isAdmin: boolean("is_admin").default(false).notNull(),
        defaultPermissions: jsonb("default_permissions").$type<{
            read?: boolean;
            create?: boolean;
            edit?: boolean;
            delete?: boolean;
        }>(),
        collectionPermissions: jsonb("collection_permissions").$type<
            Record<string, {
                read?: boolean;
                create?: boolean;
                edit?: boolean;
                delete?: boolean;
            }>
        >()
    });

    /**
     * User-Role junction table
     */
    const userRoles = rolesTableCreator("user_roles", {
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        roleId: varchar("role_id", { length: 50 }).notNull().references(() => roles.id, { onDelete: "cascade" })
    }, (table: any) => ({
        pk: primaryKey({ columns: [table.userId, table.roleId] })
    }));

    /**
     * Refresh tokens for long-lived sessions
     */
    const refreshTokens = rolesTableCreator("refresh_tokens", {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
        expiresAt: timestamp("expires_at").notNull(),
        userAgent: varchar("user_agent", { length: 500 }),
        ipAddress: varchar("ip_address", { length: 45 }),
        createdAt: timestamp("created_at").defaultNow().notNull()
    }, (table: any) => ({
        uniqueDeviceSession: unique("unique_device_session").on(table.userId, table.userAgent, table.ipAddress)
    }));

    /**
     * Password reset tokens for forgot password flow
     */
    const passwordResetTokens = rolesTableCreator("password_reset_tokens", {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
        expiresAt: timestamp("expires_at").notNull(),
        usedAt: timestamp("used_at"),
        createdAt: timestamp("created_at").defaultNow().notNull()
    });

    /**
     * App config - key/value store for custom settings
     */
    const appConfig = rolesTableCreator("app_config", {
        key: varchar("key", { length: 100 }).primaryKey(),
        value: jsonb("value").notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull()
    });

    /**
     * User identities - maps external OAuth profiles back to local users
     */
    const userIdentities = rolesTableCreator("user_identities", {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        provider: varchar("provider", { length: 50 }).notNull(), // e.g. 'google', 'linkedin'
        providerId: varchar("provider_id", { length: 255 }).notNull(),
        profileData: jsonb("profile_data"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull()
    }, (table: any) => ({
        uniqueProviderId: unique("unique_provider_id").on(table.provider, table.providerId)
    }));

    /**
     * MFA factors table - stores enrolled MFA methods
     */
    const mfaFactors = rolesTableCreator("mfa_factors", {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        factorType: varchar("factor_type", { length: 20 }).notNull(), // 'totp'
        secretEncrypted: varchar("secret_encrypted", { length: 500 }).notNull(),
        friendlyName: varchar("friendly_name", { length: 255 }),
        verified: boolean("verified").default(false).notNull(),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull()
    });

    /**
     * MFA challenges table - tracks active MFA verification attempts
     */
    const mfaChallenges = rolesTableCreator("mfa_challenges", {
        id: uuid("id").defaultRandom().primaryKey(),
        factorId: uuid("factor_id").notNull().references(() => mfaFactors.id, { onDelete: "cascade" }),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        verifiedAt: timestamp("verified_at"),
        ipAddress: varchar("ip_address", { length: 45 }),
        expiresAt: timestamp("expires_at").notNull()
    });

    /**
     * Recovery codes table - backup codes for MFA
     */
    const recoveryCodes = rolesTableCreator("recovery_codes", {
        id: uuid("id").defaultRandom().primaryKey(),
        userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
        codeHash: varchar("code_hash", { length: 255 }).notNull(),
        usedAt: timestamp("used_at"),
        createdAt: timestamp("created_at").defaultNow().notNull()
    });

    return {
        rolesSchema,
        usersSchema,
        users,
        roles,
        userRoles,
        refreshTokens,
        passwordResetTokens,
        appConfig,
        userIdentities,
        mfaFactors,
        mfaChallenges,
        recoveryCodes
    };
}

// Instantiate default schema and tables using the default "rebase" schema
const defaultAuthSchema = createAuthSchema("rebase", "rebase");

export const rebaseSchema = defaultAuthSchema.rolesSchema;
export const usersSchema = defaultAuthSchema.usersSchema;

export const users = defaultAuthSchema.users;
export const roles = defaultAuthSchema.roles;
export const userRoles = defaultAuthSchema.userRoles;
export const refreshTokens = defaultAuthSchema.refreshTokens;
export const passwordResetTokens = defaultAuthSchema.passwordResetTokens;
export const appConfig = defaultAuthSchema.appConfig;
export const userIdentities = defaultAuthSchema.userIdentities;
export const mfaFactors = defaultAuthSchema.mfaFactors;
export const mfaChallenges = defaultAuthSchema.mfaChallenges;
export const recoveryCodes = defaultAuthSchema.recoveryCodes;

// Relations
export const usersRelations = relations(users, ({ many }) => ({
    userRoles: many(userRoles),
    refreshTokens: many(refreshTokens),
    passwordResetTokens: many(passwordResetTokens),
    userIdentities: many(userIdentities),
    mfaFactors: many(mfaFactors),
    recoveryCodes: many(recoveryCodes)
}));

export const rolesRelations = relations(roles, ({ many }) => ({
    userRoles: many(userRoles)
}));

export const userRolesRelations = relations(userRoles, ({ one }) => ({
    user: one(users, {
        fields: [userRoles.userId],
        references: [users.id]
    }),
    role: one(roles, {
        fields: [userRoles.roleId],
        references: [roles.id]
    })
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
    user: one(users, {
        fields: [refreshTokens.userId],
        references: [users.id]
    })
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
    user: one(users, {
        fields: [passwordResetTokens.userId],
        references: [users.id]
    })
}));

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
    user: one(users, {
        fields: [userIdentities.userId],
        references: [users.id]
    })
}));

export const mfaFactorsRelations = relations(mfaFactors, ({ one, many }) => ({
    user: one(users, {
        fields: [mfaFactors.userId],
        references: [users.id]
    }),
    challenges: many(mfaChallenges)
}));

export const mfaChallengesRelations = relations(mfaChallenges, ({ one }) => ({
    factor: one(mfaFactors, {
        fields: [mfaChallenges.factorId],
        references: [mfaFactors.id]
    })
}));

export const recoveryCodesRelations = relations(recoveryCodes, ({ one }) => ({
    user: one(users, {
        fields: [recoveryCodes.userId],
        references: [users.id]
    })
}));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Role = typeof roles.$inferSelect;
export type NewRole = typeof roles.$inferInsert;
export type UserRole = typeof userRoles.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type AppConfig = typeof appConfig.$inferSelect;
export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;
export type MfaFactorRow = typeof mfaFactors.$inferSelect;
export type MfaChallengeRow = typeof mfaChallenges.$inferSelect;
export type RecoveryCodeRow = typeof recoveryCodes.$inferSelect;
