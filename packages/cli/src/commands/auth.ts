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
    resolveTsx,
    exitDependenciesNotInstalled
} from "../utils/project";
import { unknownCommand } from "../utils/unknown-command";

/** The backend was reached and refused: not a reason to fall back to the database. */
class ApiAnswered extends Error {}

/** Everything the switch below dispatches, for the did-you-mean. */
export const AUTH_SUBCOMMANDS = ["reset-password"] as const;
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
            unknownCommand(subcommand, AUTH_SUBCOMMANDS, "auth");
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
                throw new ApiAnswered(`Failed to list users: ${searchRes.status} ${searchRes.statusText}`);
            }
            const searchData = await searchRes.json() as unknown;
            if (!searchData || typeof searchData !== "object") {
                throw new Error("Invalid response format from user search API.");
            }

            const matched = selectUserForEmail(searchData, email);
            if (!matched) {
                throw new ApiAnswered(`No user has the email ${email}.`);
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
                throw new ApiAnswered(`Password reset endpoint failed: ${errText || resetRes.statusText}`);
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
            // The backend answered and said no — a password too weak, a user
            // it does not have. That answer stands: writing the hash straight
            // into the database instead skipped the strength rule it had just
            // applied, and ended no sessions. Only a backend that could not be
            // reached is a reason to go round it.
            if (err instanceof ApiAnswered) {
                console.error(chalk.red(`✗ ${errMsg}`));
                process.exitCode = 1;
                return;
            }
            console.warn(chalk.yellow("API reset failed, falling back to direct database update..."));
            console.warn(chalk.gray(`  Details: ${errMsg}`));
        }
    }

    // 2. Direct-DB Fallback
    const backendDir = requireBackendDir(projectRoot);
    const tsxBin = resolveTsx(projectRoot);

    if (!tsxBin) {
        exitDependenciesNotInstalled(projectRoot);
    }

    try {
        const env: Record<string, string> = { ...process.env as Record<string, string> };
        if (envFile) {
            env.DOTENV_CONFIG_PATH = envFile;
        }
        env.REBASE_RESET_EMAIL = email;
        env.REBASE_RESET_PASSWORD = newPassword;
        env.REBASE_ENV_FILE_PATH = envFile || path.join(projectRoot, ".env");

        // The database the `db` family would use, resolved the same way. A
        // stock scaffold leaves DATABASE_URL commented out and runs on the
        // managed database, which only exists in a child's environment when
        // something puts it there — without this the script connected with
        // libpq's defaults, localhost:5432 as the OS user. An external
        // DATABASE_URL adds nothing here: the child already reads it.
        const { prepareDatabaseEnv } = await import("../dev-db/prepare");
        const prepared = await prepareDatabaseEnv(projectRoot, {
            onProgress: (message) => console.log(chalk.gray(`  ${message}`))
        });
        Object.assign(env, prepared.env);

        const scriptContent = resetPasswordScript(wasGenerated);

        const tmpScriptPath = path.join(backendDir, ".tmp-reset-password.ts");
        fs.writeFileSync(tmpScriptPath, scriptContent, "utf-8");

        console.log("");
        console.log(chalk.bold("  🔑 Rebase Auth — Reset Password (Direct DB Fallback)"));
        console.log("");
        console.log(`  ${chalk.gray("Email:")} ${email}`);
        console.log(`  ${chalk.gray("Database:")} ${prepared.description}`);
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

/**
 * The script the direct-database fallback runs under the project's own tsx, so
 * it resolves the project's `@rebasepro/server-postgres` and schema.
 *
 * It ends the account's sessions in the transaction that sets the password,
 * as every door through the API does (`replaceUserPassword`): the refresh
 * tokens and outstanding reset links go, and `tokens_valid_after` voids the
 * access tokens already handed out. An operator resetting a phished account
 * with the backend down is the case this exists for, and a reset that left the
 * attacker's refresh token minting access tokens did not recover anything.
 *
 * It exits 0 only when a row was updated: a missing user and a thrown error are
 * both exit 1. `echoPassword` prints the new password, for a generated one.
 *
 * Exported so its tests can run it.
 */
export function resetPasswordScript(echoPassword: boolean): string {
    return `
import { createPostgresDatabaseConnection } from "@rebasepro/server-postgres";
import { hashPassword } from "@rebasepro/server";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as dotenv from "dotenv";
import path from "path";
import fs from "fs";

dotenv.config({ path: process.env.REBASE_ENV_FILE_PATH, quiet: true });

// Lowercased, as every address is stored (\`normalizeEmail\`): matched as
// typed, "Ops@Acme.test" found no row.
const email = process.env.REBASE_RESET_EMAIL!.trim().toLowerCase();
const newPassword = process.env.REBASE_RESET_PASSWORD!;

const quote = (identifier: string) => '"' + identifier.replace(/"/g, '""') + '"';

async function resetPassword() {
    const { pool } = createPostgresDatabaseConnection(process.env.DATABASE_URL!);
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

    // The physical names, from the table object: the collection may map its
    // properties to other columns, and the statements below are plain SQL.
    const { name: tableName, schema: tableSchema } = getTableConfig(usersTable);
    const usersSchema = tableSchema || "public";
    const users = quote(usersSchema) + "." + quote(tableName);
    const idColumn = quote(usersTable.id.name);
    const emailColumn = quote(usersTable.email.name);
    const passwordColumn = quote((usersTable.passwordHash ?? usersTable.password_hash).name);
    // Where \`ensureAuthTablesExist\` puts the tables that hang off the users
    // table: beside it, or in \`rebase\` when it lives in \`public\`.
    const authSchema = usersSchema === "public" ? "rebase" : usersSchema;

    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const updated = await client.query(
            "UPDATE " + users + " SET " + passwordColumn + " = $1 WHERE " + emailColumn + " = $2 " +
            "RETURNING " + idColumn + " AS id, " + emailColumn + " AS email",
            [hash, email]
        );
        if (updated.rows.length === 0) {
            await client.query("ROLLBACK");
            // Nothing was updated, so nothing was reset. Exiting 0 here reported
            // success for a no-op, which is what a script would have believed.
            console.error("✗ User not found: " + email);
            process.exit(1);
        }
        const uid = updated.rows[0].id;

        // A table or column the server has not created yet (it never booted
        // against this database) holds no session to end.
        const watermark = await client.query(
            "SELECT 1 FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = 'tokens_valid_after'",
            [usersSchema, tableName]
        );
        if (watermark.rows.length > 0) {
            await client.query("UPDATE " + users + " SET tokens_valid_after = NOW() WHERE " + idColumn + " = $1", [uid]);
        }
        for (const table of ["refresh_tokens", "password_reset_tokens"]) {
            const qualified = quote(authSchema) + "." + quote(table);
            const present = await client.query("SELECT to_regclass($1) IS NOT NULL AS present", [qualified]);
            if (present.rows[0]?.present) {
                await client.query("DELETE FROM " + qualified + " WHERE uid = $1", [uid]);
            }
        }
        await client.query("COMMIT");

        console.log("✅ Password reset for: " + updated.rows[0].email);
        console.log("   Every session of this account has ended.");
        ${echoPassword ? 'console.log("   New password: " + newPassword);' : ""}
        process.exit(0);
    } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    } finally {
        client.release();
    }
}

// A thrown error is a failed reset, and exits like one — a refused connection
// that exits 0 reads as a reset to anything checking the exit code.
resetPassword().catch((error) => {
    console.error(error);
    process.exit(1);
});
`;
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
