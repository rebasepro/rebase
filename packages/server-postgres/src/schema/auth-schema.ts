import { pgSchema, pgTable, varchar, uuid, timestamp, boolean, jsonb, text, unique, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Factory function to dynamically create the auth tables bound to the specified schema names.
 */
export function createAuthSchema(usersSchemaName = "rebase") {
    const usersSchema = usersSchemaName === "public" ? null : pgSchema(usersSchemaName);

    const tableCreator = (usersSchema ? usersSchema.table.bind(usersSchema) : pgTable) as typeof pgTable;
    const usersTableCreator = tableCreator;

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
        roles: text("roles").array().default([]).notNull(),
        metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
        /**
         * Sessions that began before this instant are dead, whatever tokens
         * they still hold. Password resets and admin revocations stamp it.
         *
         * Deleting the user's refresh-token rows (which we also do) is not
         * sufficient on its own: a request already in flight can insert a
         * freshly rotated row microseconds after the delete and survive it.
         * This timestamp cannot be outrun that way — it is checked against
         * `refresh_tokens.session_started_at`, which rotation carries forward.
         */
        tokensValidAfter: timestamp("tokens_valid_after"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull()
    });


    /**
     * Refresh tokens for long-lived sessions.
     *
     * A row is one token, not one device. Every token minted from the same
     * sign-in shares a `sessionId`, and rotation ADDS a row rather than
     * replacing one: the superseded token stays on file, flagged `revoked`
     * with a `rotatedAt` stamp. That record is what lets the refresh endpoint
     * tell a client replaying a token it never got an answer for (a response
     * lost to a redeploy, a second tab racing on boot) apart from a stranger
     * presenting a token that was never issued. Deleting the old row on sight
     * — the previous behaviour — made those two cases indistinguishable, and
     * the legitimate one is overwhelmingly the common one.
     *
     * There is deliberately NO unique constraint on (uid, user_agent,
     * ip_address). Keying a session on the IP meant one row per "device",
     * so a second browser profile behind the same NAT silently evicted the
     * first, and a phone changing networks orphaned a row on every hop.
     * User agent and IP are descriptive metadata for the sessions list;
     * `sessionId` is the identity.
     */
    const refreshTokens = tableCreator("refresh_tokens", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
        sessionId: uuid("session_id").defaultRandom().notNull(),
        tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
        expiresAt: timestamp("expires_at").notNull(),
        revoked: boolean("revoked").default(false).notNull(),
        rotatedAt: timestamp("rotated_at"),
        /**
         * When the sign-in this token descends from happened — carried across
         * every rotation, unlike `createdAt`. `users.tokensValidAfter` is
         * compared against this, so a revocation cannot be outrun by a token
         * that rotates immediately after it.
         */
        sessionStartedAt: timestamp("session_started_at").defaultNow().notNull(),
        userAgent: varchar("user_agent", { length: 500 }),
        ipAddress: varchar("ip_address", { length: 45 }),
        createdAt: timestamp("created_at").defaultNow().notNull()
    }, (table) => ({
        sessionIdx: index("idx_refresh_tokens_session").on(table.sessionId)
    }));

    /**
     * Password reset tokens for forgot password flow
     */
    const passwordResetTokens = tableCreator("password_reset_tokens", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
        tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
        expiresAt: timestamp("expires_at").notNull(),
        usedAt: timestamp("used_at"),
        createdAt: timestamp("created_at").defaultNow().notNull()
    });

    /**
     * App config - key/value store for custom settings
     */
    const appConfig = tableCreator("app_config", {
        key: varchar("key", { length: 100 }).primaryKey(),
        value: jsonb("value").notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull()
    });

    /**
     * User identities - maps external OAuth profiles back to local users
     */
    const userIdentities = tableCreator("user_identities", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
        provider: varchar("provider", { length: 50 }).notNull(), // e.g. 'google', 'linkedin'
        providerId: varchar("provider_id", { length: 255 }).notNull(),
        profileData: jsonb("profile_data"),
        createdAt: timestamp("created_at").defaultNow().notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull()
    }, (table) => ({
        uniqueProviderId: unique("unique_provider_id").on(table.provider, table.providerId)
    }));

    /**
     * MFA factors table - stores enrolled MFA methods
     */
    const mfaFactors = tableCreator("mfa_factors", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
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
    const mfaChallenges = tableCreator("mfa_challenges", {
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
    const recoveryCodes = tableCreator("recovery_codes", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
        codeHash: varchar("code_hash", { length: 255 }).notNull(),
        usedAt: timestamp("used_at"),
        createdAt: timestamp("created_at").defaultNow().notNull()
    });

    /**
     * Magic link tokens for passwordless email login
     */
    const magicLinkTokens = tableCreator("magic_link_tokens", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
        tokenHash: varchar("token_hash", { length: 255 }).notNull().unique(),
        expiresAt: timestamp("expires_at").notNull(),
        usedAt: timestamp("used_at"),
        createdAt: timestamp("created_at").defaultNow().notNull()
    });

    return {
        usersSchema,
        users,
        refreshTokens,
        passwordResetTokens,
        appConfig,
        userIdentities,
        mfaFactors,
        mfaChallenges,
        recoveryCodes,
        magicLinkTokens
    };
}

// Instantiate default schema and tables using the default "rebase" schema
const defaultAuthSchema = createAuthSchema("rebase");

export const usersSchema = defaultAuthSchema.usersSchema;

export const users = defaultAuthSchema.users;
export const refreshTokens = defaultAuthSchema.refreshTokens;
export const passwordResetTokens = defaultAuthSchema.passwordResetTokens;
export const appConfig = defaultAuthSchema.appConfig;
export const userIdentities = defaultAuthSchema.userIdentities;
export const mfaFactors = defaultAuthSchema.mfaFactors;
export const mfaChallenges = defaultAuthSchema.mfaChallenges;
export const recoveryCodes = defaultAuthSchema.recoveryCodes;
export const magicLinkTokens = defaultAuthSchema.magicLinkTokens;

// Relations
export const usersRelations = relations(users, ({ many }) => ({
    refreshTokens: many(refreshTokens),
    passwordResetTokens: many(passwordResetTokens),
    userIdentities: many(userIdentities),
    mfaFactors: many(mfaFactors),
    recoveryCodes: many(recoveryCodes),
    magicLinkTokens: many(magicLinkTokens)
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
    user: one(users, {
        fields: [refreshTokens.uid],
        references: [users.id]
    })
}));

export const passwordResetTokensRelations = relations(passwordResetTokens, ({ one }) => ({
    user: one(users, {
        fields: [passwordResetTokens.uid],
        references: [users.id]
    })
}));

export const userIdentitiesRelations = relations(userIdentities, ({ one }) => ({
    user: one(users, {
        fields: [userIdentities.uid],
        references: [users.id]
    })
}));

export const mfaFactorsRelations = relations(mfaFactors, ({ one, many }) => ({
    user: one(users, {
        fields: [mfaFactors.uid],
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
        fields: [recoveryCodes.uid],
        references: [users.id]
    })
}));

export const magicLinkTokensRelations = relations(magicLinkTokens, ({ one }) => ({
    user: one(users, {
        fields: [magicLinkTokens.uid],
        references: [users.id]
    })
}));

// Type exports
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type AppConfig = typeof appConfig.$inferSelect;
export type UserIdentity = typeof userIdentities.$inferSelect;
export type NewUserIdentity = typeof userIdentities.$inferInsert;
export type MfaFactorRow = typeof mfaFactors.$inferSelect;
export type MfaChallengeRow = typeof mfaChallenges.$inferSelect;
export type RecoveryCodeRow = typeof recoveryCodes.$inferSelect;
export type MagicLinkToken = typeof magicLinkTokens.$inferSelect;
