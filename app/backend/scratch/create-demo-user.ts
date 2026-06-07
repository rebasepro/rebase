import { createPostgresDatabaseConnection } from "../../../packages/server-postgresql/src/connection";
import { PostgresAuthRepository } from "../../../packages/server-postgresql/src/auth/services";
import { hashPassword } from "../../../packages/server-core/src/auth/password";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

async function createDemoUser() {
    const databaseUrl = process.env.DATABASE_URL || "postgresql://demo:Rb4923c80c3d5ec154b747dd1a309ea321@34.159.171.8:5432/rebase_demo";
    console.log("Connecting to database at:", databaseUrl);
    const { db, pool } = createPostgresDatabaseConnection(databaseUrl);
    const authRepo = new PostgresAuthRepository(db);

    const email = "demo@rebase.pro";
    const password = "DemoRebase2026!";
    const displayName = "Demo User";

    console.log(`Checking if user ${email} already exists...`);
    const existing = await authRepo.getUserByEmail(email);

    let user;
    if (existing) {
        console.log(`User ${email} already exists with ID: ${existing.id}. Re-hashing password and promoting to admin...`);
        const passwordHash = await hashPassword(password);
        await authRepo.updateUser(existing.id, {
            displayName,
            passwordHash
        });
        user = existing;
    } else {
        console.log(`Creating user ${email}...`);
        const passwordHash = await hashPassword(password);
        user = await authRepo.createUser({
            email,
            displayName,
            passwordHash,
            emailVerified: true
        });
        console.log(`User created successfully with ID: ${user.id}`);
    }

    console.log(`Setting roles to ["admin"] for user ID: ${user.id}...`);
    await authRepo.setUserRoles(user.id, ["admin"]);

    console.log("Verifying roles...");
    const roles = await authRepo.getUserRoleIds(user.id);
    console.log(`Roles for ${email}:`, roles);

    await pool.end();
}

createDemoUser().catch(console.error).finally(() => process.exit(0));
