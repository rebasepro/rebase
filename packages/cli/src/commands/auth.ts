/**
 * CLI command: rebase auth <action>
 *
 * Subcommands:
 *   reset-password — Reset a user's password
 */
import arg from "arg";
import chalk from "chalk";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import {
    requireProjectRoot,
    requireBackendDir,
    findEnvFile,
    resolveTsx
} from "../utils/project";

export async function authCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    if (!subcommand || subcommand === "--help") {
        printAuthHelp();
        return;
    }

    switch (subcommand) {
        case "reset-password":
            await resetPassword(rawArgs);
            break;
        default:
            console.error(chalk.red(`Unknown auth command: ${subcommand}`));
            console.log("");
            printAuthHelp();
            process.exit(1);
    }
}

async function resetPassword(rawArgs: string[]): Promise<void> {
    const args = arg(
        {
            "--email": String,
            "--password": String,
            "-e": "--email",
            "-p": "--password"
        },
        {
            argv: rawArgs.slice(4), // skip "node rebase auth reset-password"
            permissive: true
        }
    );

    // Support both --email flag and positional args
    const email = args["--email"] || args._[0];
    const newPassword = args["--password"] || args._[1];

    if (!email) {
        console.error(chalk.red("✗ Email is required."));
        console.log("");
        console.log(chalk.gray("  Usage: rebase auth reset-password <email> [new-password]"));
        console.log(chalk.gray("         rebase auth reset-password --email user@example.com --password NewPass123!"));
        process.exit(1);
    }

    const projectRoot = requireProjectRoot();

    // 1. Try API-first reset
    let envServiceKey: string | undefined;
    const envFile = findEnvFile(projectRoot);
    if (envFile && fs.existsSync(envFile)) {
        try {
            const envContent = fs.readFileSync(envFile, "utf8");
            const match = envContent.match(/^\s*REBASE_SERVICE_KEY\s*=\s*['"]?(.*?)['"]?\s*$/m);
            if (match && match[1]) {
                envServiceKey = match[1];
            }
        } catch {
            // Ignore
        }
    }

    let baseUrl = process.env.REBASE_BASE_URL;
    let serviceKey = process.env.REBASE_SERVICE_KEY || envServiceKey;

    const statePath = path.join(projectRoot, ".rebase", "state.json");
    if (fs.existsSync(statePath)) {
        try {
            const state = JSON.parse(fs.readFileSync(statePath, "utf8")) as Record<string, unknown>;
            if (state && typeof state === "object") {
                if (typeof state.baseUrl === "string" && !baseUrl) {
                    baseUrl = state.baseUrl;
                }
                if (typeof state.serviceKey === "string" && !serviceKey) {
                    serviceKey = state.serviceKey;
                }
            }
        } catch {
            // Ignore
        }
    }

    const devUrlPath = path.join(projectRoot, ".rebase-dev-url");
    if (fs.existsSync(devUrlPath) && !baseUrl) {
        try {
            baseUrl = fs.readFileSync(devUrlPath, "utf8").trim();
        } catch {
            // Ignore
        }
    }

    if (baseUrl && serviceKey) {
        console.log("Trying API-first reset via running backend...");
        try {
            const finalPass = newPassword || "NewPassword123!";
            const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
            const searchUrl = `${cleanBaseUrl}/api/admin/users?search=${encodeURIComponent(email)}&limit=1`;
            const searchRes = await fetch(searchUrl, {
                headers: {
                    "Authorization": `Bearer ${serviceKey}`,
                    "Accept": "application/json"
                }
            });
            if (!searchRes.ok) {
                throw new Error(`Failed to list users: ${searchRes.statusText}`);
            }
            const searchData = await searchRes.json() as unknown;
            if (!searchData || typeof searchData !== "object") {
                throw new Error("Invalid response format from user search API.");
            }

            let userId: string | undefined;
            if (Array.isArray(searchData)) {
                const firstUser = searchData[0] as unknown;
                if (firstUser && typeof firstUser === "object" && "id" in firstUser && typeof (firstUser as { id: unknown }).id === "string") {
                    userId = (firstUser as { id: string }).id;
                } else if (firstUser && typeof firstUser === "object" && "uid" in firstUser && typeof (firstUser as { uid: unknown }).uid === "string") {
                    userId = (firstUser as { uid: string }).uid;
                }
            } else if ("users" in searchData && Array.isArray((searchData as { users: unknown }).users)) {
                const users = (searchData as { users: unknown[] }).users;
                const firstUser = users[0];
                if (firstUser && typeof firstUser === "object" && "id" in firstUser && typeof (firstUser as { id: unknown }).id === "string") {
                    userId = (firstUser as { id: string }).id;
                } else if (firstUser && typeof firstUser === "object" && "uid" in firstUser && typeof (firstUser as { uid: unknown }).uid === "string") {
                    userId = (firstUser as { uid: string }).uid;
                }
            }

            if (!userId) {
                throw new Error(`User not found with email: ${email}`);
            }

            const resetUrl = `${cleanBaseUrl}/api/admin/users/${userId}/reset-password`;
            const resetRes = await fetch(resetUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${serviceKey}`,
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({ password: finalPass })
            });

            if (!resetRes.ok) {
                const errText = await resetRes.text();
                throw new Error(`Password reset endpoint failed: ${errText || resetRes.statusText}`);
            }

            console.log("API reset successful.");
            console.log(chalk.bold("  🔑 Rebase Auth — Reset Password (via API)"));
            console.log("");
            console.log(`  ${chalk.gray("Email:")} ${email}`);
            console.log(`  ${chalk.gray("Password:")} ${finalPass}`);
            console.log("");
            return;
        } catch (err) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.warn(chalk.yellow("API reset failed, falling back to direct database update..."));
            console.warn(chalk.gray(`  Details: ${errMsg}`));
        }
    }

    // 2. Direct-DB Fallback
    const backendDir = requireBackendDir(projectRoot);
    const tsxBin = resolveTsx(projectRoot);

    if (!tsxBin) {
        console.error(chalk.red("✗ Could not find tsx binary."));
        process.exit(1);
    }

    try {
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        if (envFile) {
            env.DOTENV_CONFIG_PATH = envFile;
        }
        env.REBASE_RESET_EMAIL = email;
        env.REBASE_RESET_PASSWORD = newPassword || "NewPassword123!";
        env.REBASE_ENV_FILE_PATH = envFile || path.join(projectRoot, ".env");

        const scriptContent = `
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import { hashPassword } from "@rebasepro/server";
import { eq } from "drizzle-orm";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: process.env.REBASE_ENV_FILE_PATH });

const email = process.env.REBASE_RESET_EMAIL!;
const newPassword = process.env.REBASE_RESET_PASSWORD!;

async function resetPassword() {
    const { db } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);
    const hash = await hashPassword(newPassword);

    let usersTable;
    try {
        const schemaPath = path.resolve("./src/schema.generated.ts");
        if (fs.existsSync(schemaPath)) {
            const schema = await import("file://" + schemaPath);
            usersTable = schema.users || schema.tables?.users;
        }
    } catch (e) {
        // ignore and fallback
    }

    if (!usersTable) {
        const pgServer = await import("@rebasepro/server-postgres");
        usersTable = pgServer.users;
    }

    const passwordHashKey = (usersTable.passwordHash || "passwordHash" in usersTable) ? "passwordHash" : "password_hash";

    const result = await db.update(usersTable)
        .set({ [passwordHashKey]: hash })
        .where(eq(usersTable.email, email))
        .returning({
            id: usersTable.id,
            email: usersTable.email
        });

    if (result.length > 0) {
        console.log("✅ Password reset for: " + result[0].email);
        ${!newPassword ? 'console.log("   New password: " + newPassword);' : ""}
    } else {
        console.log("✗ User not found: " + email);
    }
    process.exit(0);
}

resetPassword().catch(console.error);
`;

        const tmpScriptPath = path.join(backendDir, ".tmp-reset-password.ts");
        fs.writeFileSync(tmpScriptPath, scriptContent, "utf-8");

        console.log("");
        console.log(chalk.bold("  🔑 Rebase Auth — Reset Password (Direct DB Fallback)"));
        console.log("");
        console.log(`  ${chalk.gray("Email:")} ${email}`);
        if (newPassword) {
            console.log(`  ${chalk.gray("Password:")} ${"*".repeat(newPassword.length)}`);
        }
        console.log("");

        const child = spawn(tsxBin, [tmpScriptPath], {
            cwd: backendDir,
            stdio: "inherit",
            env
        });

        return new Promise((resolve) => {
            child.on("close", (code) => {
                // Clean up temp script
                try { fs.unlinkSync(tmpScriptPath); } catch { /* ignore */ }
                if (code !== 0) {
                    process.exit(code ?? 1);
                }
                resolve();
            });
        });
    } catch (err) {
        console.error(chalk.red("✗ Direct database update failed."));
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    }
}

function printAuthHelp() {
    console.log(`
${chalk.bold("rebase auth")} — Authentication management commands

${chalk.green.bold("Usage")}
  rebase auth ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("reset-password")}    Reset a user's password

${chalk.green.bold("reset-password Options")}
  ${chalk.blue("--email, -e")}        User's email address
  ${chalk.blue("--password, -p")}     New password (default: NewPassword123!)

${chalk.green.bold("Examples")}
  rebase auth reset-password user@example.com
  rebase auth reset-password --email user@example.com --password MyNewPass!
`);
}
