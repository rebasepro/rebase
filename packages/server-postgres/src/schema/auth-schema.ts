import { pgSchema, pgTable, uuid, timestamp, boolean, jsonb, text, unique, index, integer, bigint } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Factory function to dynamically create the auth tables bound to the specified schema names.
 *
 * This module builds queries; it does not create tables. `ensureAuthTablesExist`
 * owns the DDL, which makes everything here a *claim* about a database it cannot
 * enforce — and the claims drifted. Every column below was declared
 * `varchar(n)` while the DDL created it as `TEXT`: `user_agent` as varchar(500),
 * `ip_address` as varchar(45), `secret_encrypted` as varchar(500), every
 * `token_hash` as varchar(255). None of it was true of any database this
 * framework ever provisioned. Harmless at runtime — drizzle does not enforce a
 * length client-side, so the widths only ever misled the next reader — but a
 * schema module that describes columns that do not exist is worse than no
 * schema module. They are `text` here now because they are TEXT there.
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
        email: text("email").notNull().unique(),
        passwordHash: text("password_hash"), // NULL for OAuth-only users
        displayName: text("display_name"),
        photoUrl: text("photo_url"),
        emailVerified: boolean("email_verified").default(false).notNull(),
        emailVerificationToken: text("email_verification_token"),
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
        tokenHash: text("token_hash").notNull().unique(),
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
        /**
         * The assurance level the sign-in was established at — `aal2` only
         * where a second factor was actually presented. Carried across
         * rotations, because refresh is not a new authentication and has
         * nothing else to read the level from.
         */
        aal: text("aal"),
        userAgent: text("user_agent"),
        ipAddress: text("ip_address"),
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
        tokenHash: text("token_hash").notNull().unique(),
        expiresAt: timestamp("expires_at").notNull(),
        usedAt: timestamp("used_at"),
        createdAt: timestamp("created_at").defaultNow().notNull()
    });

    /**
     * App config - key/value store for custom settings
     */
    const appConfig = tableCreator("app_config", {
        key: text("key").primaryKey(),
        value: jsonb("value").notNull(),
        updatedAt: timestamp("updated_at").defaultNow().notNull()
    });

    /**
     * User identities - maps external OAuth profiles back to local users
     */
    const userIdentities = tableCreator("user_identities", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
        provider: text("provider").notNull(), // e.g. 'google', 'linkedin'
        providerId: text("provider_id").notNull(),
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
        factorType: text("factor_type").notNull(), // 'totp'
        secretEncrypted: text("secret_encrypted").notNull(),
        friendlyName: text("friendly_name"),
        verified: boolean("verified").default(false).notNull(),
        /**
         * The highest TOTP time step ever accepted for this factor. RFC 6238
         * §5.2 forbids accepting an OTP twice, and the ±1 step window that
         * exists for clock drift is also a 90-second replay window: without
         * this, one observed code buys a fresh session for a minute and a half.
         */
        lastUsedCounter: bigint("last_used_counter", { mode: "number" }),
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
        ipAddress: text("ip_address"),
        /** Failed guesses recorded against this challenge; bounded by the route. */
        attempts: integer("attempts").default(0).notNull(),
        expiresAt: timestamp("expires_at").notNull()
    });

    /**
     * Recovery codes table - backup codes for MFA
     */
    const recoveryCodes = tableCreator("recovery_codes", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
        codeHash: text("code_hash").notNull(),
        usedAt: timestamp("used_at"),
        createdAt: timestamp("created_at").defaultNow().notNull()
    });

    /**
     * Magic link tokens for passwordless email login
     */
    const magicLinkTokens = tableCreator("magic_link_tokens", {
        id: uuid("id").defaultRandom().primaryKey(),
        uid: uuid("uid").notNull().references(() => users.id, { onDelete: "cascade" }),
        tokenHash: text("token_hash").notNull().unique(),
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
