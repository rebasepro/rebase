import { Db } from "mongodb";
import { logger } from "@rebasepro/server-core";

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

export async function ensureAuthCollectionsExist(db: Db): Promise<void> {
    logger.info("🔍 Checking MongoDB auth collections and indexes...");

    try {
        // Users
        const users = db.collection("rebase_users");
        await users.createIndex({ email: 1 }, { unique: true });

        // User Identities
        const identities = db.collection("rebase_user_identities");
        await identities.createIndex({ provider: 1,
provider_id: 1 }, { unique: true });
        await identities.createIndex({ user_id: 1 });

        // User Roles (junction collection)
        const userRoles = db.collection("rebase_user_roles");
        await userRoles.createIndex({ user_id: 1,
role_id: 1 }, { unique: true });
        await userRoles.createIndex({ user_id: 1 });

        // Refresh Tokens
        const refreshTokens = db.collection("rebase_refresh_tokens");
        await refreshTokens.createIndex({ token_hash: 1 }, { unique: true });
        await refreshTokens.createIndex({ user_id: 1,
user_agent: 1,
ip_address: 1 }, { unique: true });
        await refreshTokens.createIndex({ user_id: 1 });

        // Password Reset Tokens
        const resetTokens = db.collection("rebase_password_reset_tokens");
        await resetTokens.createIndex({ token_hash: 1 }, { unique: true });
        await resetTokens.createIndex({ user_id: 1 });

        // Seed roles
        await seedDefaultRoles(db);

        logger.info("✅ MongoDB Auth collections ready");
    } catch (error) {
        logger.error("❌ Failed to set up MongoDB auth collections", { error: error });
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
