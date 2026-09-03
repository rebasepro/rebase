/**
 * CLI command: rebase auth <action>
 *
 * Subcommands:
 *   reset-password — Reset a user's password
 */
import chalk from "chalk";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { randomBytes } from "node:crypto";
import {
    requireProjectRoot,
    requireBackendDir,
    findEnvFile,
    readEnvFile,
    resolveTsx
} from "../utils/project";
import { parseCommandArgs, wantsHelp } from "../utils/args";

/** A user as the admin API returns it, reduced to what this command needs. */
export interface ResolvedUser {
    id: string;
    email: string;
}

/**
 * Pick the user with exactly this email out of a search response.
 *
 * `/api/admin/users?search=` is an `ILIKE '%…%'` over email **or display
 * name**, ordered by role count descending. This used to take row `[0]` and
 * reset it, then print the email it had been *given* as confirmation — so two
 * ordinary situations ended in a successful-looking reset of somebody else's
 * account:
 *
 *   - a substring collision: `bob@example.com` also matches
 *     `robert.bob@example.com`;
 *   - a display name, which is user-controlled and accepted up to 255
 *     characters with no constraint on its content, containing an address
 *     belonging to someone else.
 *
 * The ordering makes it worse rather than better — `array_length(roles) DESC
 * NULLS LAST` puts the most privileged match first, so the account most likely
 * to be reset by mistake is an admin's.
 *
 * Returns `undefined` when nothing matched exactly, which the caller reports
 * rather than falling through to a guess. The direct-database fallback below
 * has always matched with `eq(usersTable.email, email)`; this is the same
 * definition, so the command no longer resets different accounts depending on
 * whether the backend happened to be running.
 */
export function selectUserForEmail(payload: unknown, email: string): ResolvedUser | undefined {
    const wanted = email.trim().toLowerCase();
    if (!wanted) return undefined;

    const rows: unknown[] = Array.isArray(payload)
        ? payload
        : (payload && typeof payload === "object" && Array.isArray((payload as { users?: unknown }).users)
            ? (payload as { users: unknown[] }).users
            : []);

    for (const row of rows) {
        if (!row || typeof row !== "object") continue;
        const record = row as Record<string, unknown>;
        const rowEmail = typeof record.email === "string" ? record.email.trim().toLowerCase() : undefined;
        if (!rowEmail || rowEmail !== wanted) continue;

        const id = typeof record.id === "string"
            ? record.id
            : (typeof record.uid === "string" ? record.uid : undefined);
        if (!id) continue;

        return { id, email: record.email as string };
    }

    return undefined;
}

export async function authCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    // `--help` is answered here and never reaches a handler. `cli.ts` only
    // rewrites the subcommand to `"--help"` when no subcommand was named, so
    // `rebase auth reset-password --help` used to *run the reset*: `--help`
    // became the email, the backend was contacted, `.tmp-reset-password.ts` was
    // written into the user's `backend/`, and a database UPDATE ran for a user
    // named `--help`. A flag whose whole job is to print text cannot be allowed
    // to reach code that writes.
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
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

/**
 * The flags `rebase auth reset-password` takes.
 *
 * `-p` was advertised in this command's own help and never declared here, so
 * `arg` — running permissively — pushed it into the positionals and the value
 * *after* it shifted out of reach: anyone following the help set the account's
 * password to the two-character string `-p`. Declared now, and `auth.test.ts`
 * asserts that the help and this spec list the same aliases.
 */
export const RESET_PASSWORD_FLAGS = {
    "--email": String,
    "--password": String,
    "-e": "--email",
    "-p": "--password"
} as const;

/**
 * Which account, and which password, this invocation names.
 *
 * Both may still be absent — the caller reports a missing email — but neither
 * can be a flag. `parseCommandArgs` parses the whole line strictly, so an
 * undeclared flag is an error rather than a positional. That is what stops
 * `rebase auth reset-password bob@example.com --debug` from setting Bob's
 * password to `--debug`, which is the flag the CLI itself prints after every
 * failure as the thing to re-run with.
 *
 * Exported so its tests can drive the real parser rather than a copy of it.
 */
export function resolveResetPasswordArgs(rawArgs: string[]): {
    email?: string;
    password?: string;
} {
    const { flags, positionals } = parseCommandArgs({
        spec: RESET_PASSWORD_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "auth reset-password",
        maxPositionals: 2
    });

    // Both spellings are supported: `<email> [password]` and `--email/--password`.
    return {
        email: flags["--email"] || positionals[0],
        password: flags["--password"] || positionals[1]
    };
}

/**
 * A password for a reset that was not given one.
 *
 * This used to be a constant, and `--help` printed it as the default. Reset is
 * the documented way back into an account nobody can sign in to — an admin,
 * usually — so the recovery path set every such account to a fixed string that
 * ships inside a public repository and a published npm package, and left it
 * there until somebody remembered to change it.
 *
 * base64url of 18 random bytes: 24 characters, ~144 bits, no shell-quoting
 * hazard, and nothing that reads like a placeholder somebody might keep.
 */
export function generatePassword(): string {
    return randomBytes(18).toString("base64url");
}

async function resetPassword(rawArgs: string[]): Promise<void> {
    const { email, password: providedPassword } = resolveResetPasswordArgs(rawArgs);
    // Generated once, so both reset paths set and report the same thing.
    const wasGenerated = !providedPassword;
    const newPassword = providedPassword || generatePassword();

    if (!email) {
        console.error(chalk.red("✗ Email is required."));
        console.log("");
        console.log(chalk.gray("  Usage: rebase auth reset-password <email> [new-password]"));
        console.log(chalk.gray("         rebase auth reset-password --email user@example.com --password NewPass123!"));
        process.exit(1);
    }

    const projectRoot = requireProjectRoot();

    // 1. Try API-first reset
    // Was a single-key regex, which did not match `export REBASE_SERVICE_KEY=…`
    // and kept a trailing `# comment` in the value. The command then fell
    // through to the direct-database path as though no key were configured.
    const envFile = findEnvFile(projectRoot);
    const envServiceKey: string | undefined = readEnvFile(projectRoot).REBASE_SERVICE_KEY;

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
            const finalPass = newPassword;
            const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
            // Not `limit=1`: the search is fuzzy and ordered by role count, so
            // the exact match is not necessarily first — asking for one row can
            // make it unreachable. Ask for a page, then match exactly.
            const searchUrl = `${cleanBaseUrl}/api/admin/users?search=${encodeURIComponent(email)}&limit=50`;
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

            const matched = selectUserForEmail(searchData, email);
            if (!matched) {
                throw new Error(`No user has the email ${email}.`);
            }

            const resetUrl = `${cleanBaseUrl}/api/admin/users/${matched.id}/reset-password`;
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
            // The address as stored, not as typed — they differ in case often
            // enough that echoing the input hides which account was touched.
            console.log(`  ${chalk.gray("Email:")} ${matched.email}`);
            // Echoed only when we invented it. A password the operator typed
            // is already theirs; printing it again only adds scrollback.
            console.log(`  ${chalk.gray("Password:")} ${wasGenerated ? finalPass : "*".repeat(finalPass.length)}`);
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
        env.REBASE_RESET_PASSWORD = newPassword;
        env.REBASE_ENV_FILE_PATH = envFile || path.join(projectRoot, ".env");

        const scriptContent = `
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import { hashPassword } from "@rebasepro/server";
import { eq } from "drizzle-orm";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: process.env.REBASE_ENV_FILE_PATH, quiet: true });

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
        ${wasGenerated ? 'console.log("   New password: " + newPassword);' : ""}
        process.exit(0);
    }
    // Nothing was updated, so nothing was reset. Exiting 0 here reported
    // success for a no-op, which is what a script would have believed.
    console.error("✗ User not found: " + email);
    process.exit(1);
}

resetPassword().catch(console.error);
`;

        const tmpScriptPath = path.join(backendDir, ".tmp-reset-password.ts");
        fs.writeFileSync(tmpScriptPath, scriptContent, "utf-8");

        console.log("");
        console.log(chalk.bold("  🔑 Rebase Auth — Reset Password (Direct DB Fallback)"));
        console.log("");
        console.log(`  ${chalk.gray("Email:")} ${email}`);
        if (!wasGenerated) {
            console.log(`  ${chalk.gray("Password:")} ${"*".repeat(newPassword.length)}`);
        }
        console.log("");

        const child = spawn(tsxBin, [tmpScriptPath], {
            cwd: backendDir,
            stdio: "inherit",
            env
        });

        // The script is written into the user's backend directory, so every
        // exit has to remove it. Without an `error` handler a failed spawn
        // raises an unhandled event, the process dies before `close`, and
        // `.tmp-reset-password.ts` is left behind to be committed.
        const cleanup = () => {
            try { fs.unlinkSync(tmpScriptPath); } catch { /* already gone */ }
        };

        return new Promise((resolve) => {
            child.on("error", (err) => {
                cleanup();
                console.error(chalk.red("✗ Could not run the reset script."));
                console.error(chalk.gray(`  ${err.message}`));
                process.exit(1);
            });
            child.on("close", (code) => {
                cleanup();
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
  ${chalk.blue("--password, -p")}     New password (default: one is generated and printed)

${chalk.green.bold("Examples")}
  rebase auth reset-password user@example.com
  rebase auth reset-password --email user@example.com --password MyNewPass!
`);
}
