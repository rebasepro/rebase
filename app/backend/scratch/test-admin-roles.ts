import { createPostgresDatabaseConnection } from "../../../packages/server-postgresql/src/connection";
import { PostgresAuthRepository } from "../../../packages/server-postgresql/src/auth/services";
import * as dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, "../../../.env") });

async function test() {
    const databaseUrl = process.env.DATABASE_URL || "postgresql://localhost:5432/rebase";
    console.log("Connecting to:", databaseUrl);
    const { db } = createPostgresDatabaseConnection(databaseUrl);
    const authRepo = new PostgresAuthRepository(db);

    console.log("Listing roles...");
    const roles = await authRepo.listRoles();
    console.log("Roles found:", JSON.stringify(roles, null, 2));

    console.log("Listing user roles for first user...");
    const users = await authRepo.listUsers();
    if (users.length > 0) {
        const uRoles = await authRepo.getUserRoles(users[0].id);
        console.log(`User ${users[0].email} roles:`, JSON.stringify(uRoles, null, 2));
    } else {
        console.log("No users in db.");
    }
}

test().catch(console.error).finally(() => process.exit(0));
