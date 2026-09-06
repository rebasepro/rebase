/**
 * CLI command: rebase api-keys <action>
 *
 * Subcommands:
 *   list    — List all API keys (masked)
 *   create  — Create a new API key
 *   revoke  — Revoke an existing API key
 */
import chalk from "chalk";
import {
    requireProjectRoot,
    readEnvFile
} from "../utils/project";
import { parseCommandArgs, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";
import fs from "fs";
import path from "path";

/** Everything the switch below dispatches, for the did-you-mean. */
const API_KEYS_SUBCOMMANDS = ["list", "create", "revoke"] as const;

/* ═══════════════════════════════════════════════════════════════
   Env helper — reads SERVICE_KEY and PORT from .env
   ═══════════════════════════════════════════════════════════════ */

/**
 * Was a hand-rolled `indexOf("=")` loop. It keyed `export KEY=value` as
 * `export KEY` and carried a trailing `# comment` into the value — so a key
 * that was present read as absent, or reached an `Authorization` header with a
 * comment attached and came back 401. See `readEnvFile`.
 */
const loadEnv = readEnvFile;

function resolveBaseUrl(env: Record<string, string>, projectRoot?: string): string {
    // An explicit override always wins.
    if (env.REBASE_BASE_URL) return env.REBASE_BASE_URL;

    // `rebase dev` runs on a derived per-project port, not the .env PORT, and
    // records the URL it actually bound. Without this, these commands default to
    // :3001 and report "Is the Rebase server running?" while it is running.
    if (projectRoot) {
        try {
            const urlFile = path.join(projectRoot, ".rebase-dev-url");
            if (fs.existsSync(urlFile)) {
                const devUrl = fs.readFileSync(urlFile, "utf-8").trim();
                if (devUrl) return devUrl;
            }
        } catch { /* fall through to the configured port */ }
    }

    const port = env.PORT || env.REBASE_PORT || "3001";
    return `http://localhost:${port}`;
}

/* ═══════════════════════════════════════════════════════════════
   Entry
   ═══════════════════════════════════════════════════════════════ */

export async function apiKeysCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    // `--help` is answered before dispatch, never by a handler. `cli.ts` only
    // rewrites the subcommand to `"--help"` when none was named, so
    // `rebase api-keys list --help` used to *list the keys* and
    // `rebase api-keys revoke --help` sent `DELETE /api/admin/api-keys/--help`.
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
        printApiKeysHelp();
        return;
    }

    switch (subcommand) {
        case "list":
            await listKeys(rawArgs);
            break;
        case "create":
            await createKey(rawArgs);
            break;
        case "revoke":
            await revokeKey(rawArgs);
            break;
        default:
            // The shape every other family uses. This one printed a bare line
            // to stderr *and* the whole help page to stdout, so a typo wrote
            // twenty lines to a stream a `--json` caller reads, with no `✗`, no
            // pointer at `--help`, and no did-you-mean — `craete` is one
            // transposition from `create`.
            unknownCommand(subcommand, API_KEYS_SUBCOMMANDS, "api-keys");
    }
}

/* ═══════════════════════════════════════════════════════════════
   list
   ═══════════════════════════════════════════════════════════════ */

async function listKeys(_rawArgs: string[]): Promise<void> {
    const projectRoot = requireProjectRoot();
    const env = loadEnv(projectRoot);
    const baseUrl = resolveBaseUrl(env, projectRoot);
    const serviceKey = env.SERVICE_KEY || env.REBASE_SERVICE_KEY;

    if (!serviceKey) {
        console.error(chalk.red("✗ SERVICE_KEY not found in .env — required for admin operations."));
        process.exit(1);
    }

    try {
        const res = await fetch(`${baseUrl}/api/admin/api-keys`, {
            headers: { Authorization: `Bearer ${serviceKey}` }
        });
        if (!res.ok) {
            const body = await res.text();
            console.error(chalk.red(`✗ Failed to list API keys: ${res.status} ${body}`));
            process.exit(1);
        }

        const { keys } = await res.json() as { keys: Array<{
            id: string; name: string; key_prefix: string;
            permissions: Array<{ collection: string; operations: string[] }>;
            rate_limit: number | null; revoked_at: string | null;
            expires_at: string | null; last_used_at: string | null;
            created_at: string;
        }>};

        console.log("");
        console.log(chalk.bold("  🔑 API Keys"));
        console.log("");

        if (keys.length === 0) {
            console.log(chalk.gray("  No API keys found."));
            console.log("");
            return;
        }

        for (const key of keys) {
            const status = key.revoked_at ? chalk.red("revoked")
                : (key.expires_at && new Date(key.expires_at) < new Date()) ? chalk.yellow("expired")
                : chalk.green("active");

            const perms = key.permissions.map(p =>
                `${p.collection}(${p.operations.join(",")})`
            ).join(", ");

            console.log(`  ${chalk.bold(key.name)} ${chalk.gray(`[${key.key_prefix}•••]`)} ${status}`);
            console.log(`  ${chalk.gray("ID:")} ${key.id}`);
            console.log(`  ${chalk.gray("Permissions:")} ${perms || "none"}`);
            console.log(`  ${chalk.gray("Created:")} ${new Date(key.created_at).toLocaleDateString()}`);
            if (key.last_used_at) {
                console.log(`  ${chalk.gray("Last used:")} ${new Date(key.last_used_at).toLocaleDateString()}`);
            }
            console.log("");
        }
    } catch (e: unknown) {
        console.error(chalk.red(`✗ ${e instanceof Error ? e.message : String(e)}`));
        console.error(chalk.gray("  Is the Rebase server running?"));
        process.exit(1);
    }
}

/* ═══════════════════════════════════════════════════════════════
   create
   ═══════════════════════════════════════════════════════════════ */

/** The flags `rebase api-keys create` takes. */
export const CREATE_KEY_FLAGS = {
    "--name": String,
    "--permissions": String,
    "--full-access": Boolean,
    "--admin": Boolean,
    "--rate-limit": Number,
    "--expires": String,
    "-n": "--name"
} as const;

/**
 * What this invocation asks to be created.
 *
 * The name may be given either way — `--name "My Key"` or as the single
 * positional — and under the old permissive parse an undeclared flag became
 * that positional: `rebase api-keys create --debug --full-access` created a
 * key called `--debug` with read/write/delete on every collection, and
 * `--debug` is what the CLI prints after every failure as the thing to re-run
 * with. Strict parsing makes the flag an error instead of a name.
 *
 * Exported so its tests can drive the real parser rather than a copy of it.
 */
export function resolveCreateKeyArgs(rawArgs: string[]) {
    const { flags, positionals } = parseCommandArgs({
        spec: CREATE_KEY_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "api-keys create",
        maxPositionals: 1
    });

    return { flags,
name: flags["--name"] || positionals[0] };
}

async function createKey(rawArgs: string[]): Promise<void> {
    const { flags: args, name } = resolveCreateKeyArgs(rawArgs);

    const permissionsRaw = args["--permissions"];

    if (!name) {
        console.error(chalk.red("✗ Name is required."));
        console.log("");
        console.log(chalk.gray('  Usage: rebase api-keys create --name "My Key" --permissions \'[{"collection":"*","operations":["read"]}]\''));
        process.exit(1);
    }

    let permissions: Array<{ collection: string; operations: string[] }>;
    if (permissionsRaw) {
        try {
            permissions = JSON.parse(permissionsRaw);
        } catch {
            console.error(chalk.red("✗ Invalid --permissions JSON."));
            console.log(chalk.gray('  Example: \'[{"collection":"*","operations":["read","write"]}]\''));
            process.exit(1);
            return; // unreachable but satisfies TS
        }
    } else if (args["--full-access"]) {
        permissions = [{ collection: "*",
operations: ["read", "write", "delete"] }];
    } else {
        // No silent full-access default: a "scoped keys" feature should not
        // hand out read/write/delete on every collection when the flag is
        // simply forgotten. Full access must be asked for by name.
        console.error(chalk.red("✗ Specify what the key may access: --permissions '<json>' or --full-access."));
        console.log("");
        console.log(chalk.gray('  Scoped:      rebase api-keys create -n "Analytics" --permissions \'[{"collection":"events","operations":["read"]}]\''));
        console.log(chalk.gray('  Functions:   add {"collection":"functions/<name>","operations":["write"]} to invoke a custom function'));
        console.log(chalk.gray('  Storage:     add {"collection":"storage","operations":["read","write"]} for file storage'));
        console.log(chalk.gray('  Full access: rebase api-keys create -n "CI" --full-access'));
        process.exit(1);
        return; // unreachable but satisfies TS
    }

    let expires_at: string | null = null;
    const expiresFlag = args["--expires"];
    if (expiresFlag) {
        const days: Record<string, number> = { "7d": 7,
"30d": 30,
"90d": 90,
"1y": 365 };
        if (days[expiresFlag]) {
            expires_at = new Date(Date.now() + days[expiresFlag] * 86400000).toISOString();
        } else {
            const parsed = new Date(expiresFlag);
            if (isNaN(parsed.getTime())) {
                console.error(chalk.red("✗ Invalid --expires value. Use 7d, 30d, 90d, 1y, or an ISO date."));
                process.exit(1);
            }
            expires_at = parsed.toISOString();
        }
    }

    const projectRoot = requireProjectRoot();
    const env = loadEnv(projectRoot);
    const baseUrl = resolveBaseUrl(env, projectRoot);
    const serviceKey = env.SERVICE_KEY || env.REBASE_SERVICE_KEY;

    if (!serviceKey) {
        console.error(chalk.red("✗ SERVICE_KEY not found in .env — required for admin operations."));
        process.exit(1);
    }

    try {
        const body: Record<string, unknown> = {
            name,
            permissions,
            admin: args["--admin"] ?? false,
            rate_limit: args["--rate-limit"] ?? null,
            expires_at
        };

        const res = await fetch(`${baseUrl}/api/admin/api-keys`, {
            method: "POST",
            headers: {
                Authorization: `Bearer ${serviceKey}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        if (!res.ok) {
            const errBody = await res.text();
            console.error(chalk.red(`✗ Failed to create API key: ${res.status} ${errBody}`));
            process.exit(1);
        }

        const { key } = await res.json() as { key: { name: string; key: string; key_prefix: string; id: string } };

        console.log("");
        console.log(chalk.bold.green("  ✓ API key created successfully"));
        console.log("");
        console.log(`  ${chalk.gray("Name:")}   ${key.name}`);
        console.log(`  ${chalk.gray("ID:")}     ${key.id}`);
        console.log(`  ${chalk.gray("Prefix:")} ${key.key_prefix}`);
        console.log("");
        console.log(chalk.bold.yellow("  ⚠ Copy your key now — it won't be shown again:"));
        console.log("");
        console.log(`  ${chalk.cyan(key.key)}`);
        console.log("");
    } catch (e: unknown) {
        console.error(chalk.red(`✗ ${e instanceof Error ? e.message : String(e)}`));
        console.error(chalk.gray("  Is the Rebase server running?"));
        process.exit(1);
    }
}

/* ═══════════════════════════════════════════════════════════════
   revoke
   ═══════════════════════════════════════════════════════════════ */

/** The flags `rebase api-keys revoke` takes. */
export const REVOKE_KEY_FLAGS = {
    "--id": String
} as const;

/**
 * Which key this invocation names.
 *
 * The id is a positional, so the permissive parse handed one straight to the
 * DELETE: `rebase api-keys revoke --foo` sent
 * `DELETE /api/admin/api-keys/--foo`, and `rebase --debug api-keys revoke <id>`
 * shifted the words along and revoked the key named `revoke`.
 *
 * Exported so its tests can drive the real parser rather than a copy of it.
 */
export function resolveRevokeKeyArgs(rawArgs: string[]): { id?: string } {
    const { flags, positionals } = parseCommandArgs({
        spec: REVOKE_KEY_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "api-keys revoke",
        maxPositionals: 1
    });

    return { id: flags["--id"] || positionals[0] };
}

async function revokeKey(rawArgs: string[]): Promise<void> {
    const { id } = resolveRevokeKeyArgs(rawArgs);

    if (!id) {
        console.error(chalk.red("✗ Key ID is required."));
        console.log("");
        console.log(chalk.gray("  Usage: rebase api-keys revoke <key-id>"));
        process.exit(1);
    }

    const projectRoot = requireProjectRoot();
    const env = loadEnv(projectRoot);
    const baseUrl = resolveBaseUrl(env, projectRoot);
    const serviceKey = env.SERVICE_KEY || env.REBASE_SERVICE_KEY;

    if (!serviceKey) {
        console.error(chalk.red("✗ SERVICE_KEY not found in .env — required for admin operations."));
        process.exit(1);
    }

    try {
        const res = await fetch(`${baseUrl}/api/admin/api-keys/${encodeURIComponent(id)}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${serviceKey}` }
        });

        if (!res.ok) {
            const errBody = await res.text();
            console.error(chalk.red(`✗ Failed to revoke API key: ${res.status} ${errBody}`));
            process.exit(1);
        }

        console.log("");
        console.log(chalk.bold.green("  ✓ API key revoked successfully"));
        console.log(`  ${chalk.gray("ID:")} ${id}`);
        console.log("");
    } catch (e: unknown) {
        console.error(chalk.red(`✗ ${e instanceof Error ? e.message : String(e)}`));
        console.error(chalk.gray("  Is the Rebase server running?"));
        process.exit(1);
    }
}

/* ═══════════════════════════════════════════════════════════════
   Help
   ═══════════════════════════════════════════════════════════════ */

function printApiKeysHelp() {
    console.log(`
${chalk.bold("rebase api-keys")} — Manage Service API Keys

${chalk.green.bold("Usage")}
  rebase api-keys ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("list")}              List all API keys
  ${chalk.blue.bold("create")}            Create a new API key
  ${chalk.blue.bold("revoke")}            Revoke an API key

${chalk.green.bold("create Options")}
  ${chalk.blue("--name, -n")}        Key name ${chalk.gray("(required)")}
  ${chalk.blue("--permissions")}     JSON array of permissions ${chalk.gray("(required unless --full-access)")}
                    ${chalk.gray('Collections by slug; custom functions as "functions" or "functions/<name>"')}
  ${chalk.blue("--full-access")}     Grant read/write/delete on every collection and function
  ${chalk.blue("--admin")}           Grant admin role (admin routes + RLS admin policies)
  ${chalk.blue("--rate-limit")}      Requests per 15-min window ${chalk.gray("(default: 1000)")}
  ${chalk.blue("--expires")}         Expiration: 7d, 30d, 90d, 1y, or ISO date

${chalk.green.bold("revoke Options")}
  ${chalk.blue("--id")}              API key ID to revoke ${chalk.gray("(or positional arg)")}

${chalk.green.bold("Examples")}
  rebase api-keys list
  rebase api-keys create --name "Analytics" --permissions '[{"collection":"events","operations":["read"]}]'
  rebase api-keys create -n "Full Access" --full-access --expires 90d
  rebase api-keys revoke abc123-def456
`);
}
