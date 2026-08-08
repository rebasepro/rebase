import { Db } from "mongodb";
import { logger } from "@rebasepro/server";

/**
 * Default roles to seed on first run
 */
const DEFAULT_ROLES = [
    {
        _id: "admin",
        id: "admin",
        name: "Admin",
        isAdmin: true,
        defaultPermissions: { read: true,
create: true,
edit: true,
delete: true },
        createdAt: new Date()
    },
    {
        _id: "editor",
        id: "editor",
        name: "Editor",
        isAdmin: false,
        defaultPermissions: { read: true,
create: true,
edit: true,
delete: true },
        createdAt: new Date()
    },
    {
        _id: "viewer",
        id: "viewer",
        name: "Viewer",
        isAdmin: false,
        defaultPermissions: { read: true,
create: false,
edit: false,
delete: false },
        createdAt: new Date()
    }
];

/**
 * Indexes created by releases up to 0.13.0, on snake_case field names the auth
 * services never wrote.
 *
 * MongoDB indexes an absent field as `null`, so a unique index whose every key
 * component is always missing admits exactly **one** document per collection:
 * the second login on the whole deployment failed with `E11000`, as did the
 * second role assignment and the second outstanding password-reset token.
 * Dropping them is therefore part of the fix, not tidying — creating the
 * correct index alongside a broken one leaves the deployment just as broken.
 *
 * `{user_id, user_agent, ip_address}` has a second reason to go: it is the
 * reverted Postgres constraint. `MongoRefreshTokenService.createToken` explains
 * why evicting by that triple signs a second browser out; the unique index
 * expressing the same rule was left behind here.
 */
const LEGACY_INDEX_NAMES: Record<string, string[]> = {
    rebase_user_identities: ["provider_1_provider_id_1", "user_id_1"],
    rebase_user_roles: ["user_id_1_role_id_1", "user_id_1"],
    rebase_refresh_tokens: ["token_hash_1", "user_id_1_user_agent_1_ip_address_1", "user_id_1"],
    rebase_password_reset_tokens: ["token_hash_1", "user_id_1"]
};

export async function ensureAuthCollectionsExist(db: Db): Promise<void> {
    logger.info("🔍 Checking MongoDB auth collections and indexes...");

    try {
        await dropLegacyIndexes(db);

        // Every key below is a field `auth/services.ts` actually writes —
        // camelCase, matching the documents. Verified by
        // `test/MongoAuthServices.test.ts`, which now runs this function.

        // Users
        const users = db.collection("rebase_users");
        await users.createIndex({ email: 1 }, { unique: true });
        await users.createIndex({ id: 1 });

        // User Identities
        const identities = db.collection("rebase_user_identities");
        await identities.createIndex({ provider: 1,
providerId: 1 }, { unique: true });
        await identities.createIndex({ uid: 1 });

        // User Roles (junction collection)
        const userRoles = db.collection("rebase_user_roles");
        await userRoles.createIndex({ uid: 1,
roleId: 1 }, { unique: true });
        await userRoles.createIndex({ roleId: 1 });

        // Refresh Tokens. No unique index on (uid, userAgent, ipAddress):
        // tokens of one sign-in accumulate under a shared sessionId.
        const refreshTokens = db.collection("rebase_refresh_tokens");
        await refreshTokens.createIndex({ tokenHash: 1 }, { unique: true });
        await refreshTokens.createIndex({ uid: 1 });
        await refreshTokens.createIndex({ sessionId: 1 });

        // Password Reset Tokens
        const resetTokens = db.collection("rebase_password_reset_tokens");
        await resetTokens.createIndex({ tokenHash: 1 }, { unique: true });
        await resetTokens.createIndex({ uid: 1 });

        // Seed roles
        await seedDefaultRoles(db);

        logger.info("✅ MongoDB Auth collections ready");
    } catch (error) {
        // Not swallowed. Every index here is load-bearing for auth — a boot
        // that logs this and carries on is a deployment whose second login
        // fails, with a green boot log to say nothing is wrong.
        logger.error("❌ Failed to set up MongoDB auth collections", { error: error });
        throw error;
    }
}

/** Drop the indexes of {@link LEGACY_INDEX_NAMES} that this database still has. */
async function dropLegacyIndexes(db: Db): Promise<void> {
    for (const [collectionName, indexNames] of Object.entries(LEGACY_INDEX_NAMES)) {
        const collection = db.collection(collectionName);
        for (const indexName of indexNames) {
            try {
                await collection.dropIndex(indexName);
                logger.info(`🧹 Dropped stale auth index ${collectionName}.${indexName}`);
            } catch {
                // NamespaceNotFound / IndexNotFound — nothing to drop here.
            }
        }
    }
}

async function seedDefaultRoles(db: Db): Promise<void> {
    const roles = db.collection("rebase_roles");
    const count = await roles.countDocuments();

    if (count > 0) {
        logger.info(`📋 Found ${count} existing roles`);
        return;
    }

    logger.info("🌱 Seeding default roles...");

    for (const role of DEFAULT_ROLES) {
        await roles.updateOne(
            { id: role.id },
            { $setOnInsert: role },
            { upsert: true }
        );
    }

    logger.info("✅ Default roles created: admin, editor, viewer");
}
