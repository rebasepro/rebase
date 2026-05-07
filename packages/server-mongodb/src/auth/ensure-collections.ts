import { Db } from "mongodb";

/**
 * Default roles to seed on first run
 */
const DEFAULT_ROLES = [
    {
        _id: "admin",
        id: "admin",
        name: "Admin",
        is_admin: true,
        default_permissions: { read: true, create: true, edit: true, delete: true },
        config: { createCollections: true, editCollections: "all", deleteCollections: "all" },
        created_at: new Date()
    },
    {
        _id: "editor",
        id: "editor",
        name: "Editor",
        is_admin: false,
        default_permissions: { read: true, create: true, edit: true, delete: true },
        config: { createCollections: true, editCollections: "own", deleteCollections: "own" },
        created_at: new Date()
    },
    {
        _id: "viewer",
        id: "viewer",
        name: "Viewer",
        is_admin: false,
        default_permissions: { read: true, create: false, edit: false, delete: false },
        config: null,
        created_at: new Date()
    }
];

export async function ensureAuthCollectionsExist(db: Db): Promise<void> {
    console.log("🔍 Checking MongoDB auth collections and indexes...");

    try {
        // Users
        const users = db.collection("__rebase_users");
        await users.createIndex({ email: 1 }, { unique: true });

        // User Identities
        const identities = db.collection("__rebase_user_identities");
        await identities.createIndex({ provider: 1, provider_id: 1 }, { unique: true });
        await identities.createIndex({ user_id: 1 });

        // User Roles (junction collection)
        const userRoles = db.collection("__rebase_user_roles");
        await userRoles.createIndex({ user_id: 1, role_id: 1 }, { unique: true });
        await userRoles.createIndex({ user_id: 1 });

        // Refresh Tokens
        const refreshTokens = db.collection("__rebase_refresh_tokens");
        await refreshTokens.createIndex({ token_hash: 1 }, { unique: true });
        await refreshTokens.createIndex({ user_id: 1, user_agent: 1, ip_address: 1 }, { unique: true });
        await refreshTokens.createIndex({ user_id: 1 });

        // Password Reset Tokens
        const resetTokens = db.collection("__rebase_password_reset_tokens");
        await resetTokens.createIndex({ token_hash: 1 }, { unique: true });
        await resetTokens.createIndex({ user_id: 1 });

        // Seed roles
        await seedDefaultRoles(db);

        console.log("✅ MongoDB Auth collections ready");
    } catch (error) {
        console.error("❌ Failed to set up MongoDB auth collections:", error);
    }
}

async function seedDefaultRoles(db: Db): Promise<void> {
    const roles = db.collection("__rebase_roles");
    const count = await roles.countDocuments();

    if (count > 0) {
        console.log(`📋 Found ${count} existing roles`);
        return;
    }

    console.log("🌱 Seeding default roles...");

    for (const role of DEFAULT_ROLES) {
        await roles.updateOne(
            { id: role.id },
            { $setOnInsert: role },
            { upsert: true }
        );
    }

    console.log("✅ Default roles created: admin, editor, viewer");
}
