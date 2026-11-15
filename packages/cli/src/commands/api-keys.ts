/**
 * CLI command: rebase api-keys <action>
 *
 * The project's service keys, through `/api/admin/api-keys`, authenticated with
 * the service key from `.env`.
 *
 * Subcommands:
 *   list    — List the service keys (masked): kind, scopes, roles
 *   get     — Show one key
 *   create  — Create a service key holding the scopes named on the line
 *   revoke  — Revoke a key
 *   scopes  — List the scopes this backend knows, and which the caller holds
 */
import chalk from "chalk";
import arg from "arg";
import { createRebaseClient, RebaseApiError } from "@rebasepro/client";
import {
    ADMIN_SCOPES,
    DATA_PLANE_SCOPES,
    KEY_MANAGEMENT_SCOPES,
    parseScope,
    type ApiKeyMasked,
    type ApiKeyWithSecret,
    type CreateApiKeyRequest,
    type UpdateApiKeyRequest,
    type ScopeSummary
} from "@rebasepro/types";
import { findProjectRoot } from "../utils/project";
import { PROJECT_TARGET_FLAGS, cloudTargetNote, projectServiceKey, resolveBackendAddress } from "../utils/project-target";
import { projectTarget } from "../utils/project-command";
import { confirmDestructive } from "./cloud/context";
import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";
import { cliUserAgent } from "../utils/version";
import { serverUnreachableHint } from "../utils/dev-server";

/** Everything the switch below dispatches, for the did-you-mean. */
export const API_KEYS_SUBCOMMANDS = ["list", "get", "create", "update", "revoke", "scopes"] as const;

/* ═══════════════════════════════════════════════════════════════
   Where the backend is — shared with every project command
   ═══════════════════════════════════════════════════════════════ */

// The address rules (REBASE_BASE_URL, then a live `rebase dev`, nothing
// guessed) moved to `utils/project-target.ts` with the other project
// commands; re-exported here for the callers and tests that import them
// from this module.
export { cloudTargetNote, resolveBackendAddress, type BackendAddress } from "../utils/project-target";

/**
 * The address to send the service key to, or the end of the command.
 *
 * Exits before any request is made: the refusal is the point.
 */
export function requireBackendUrl(env: Record<string, string>, projectRoot: string): string {
    const address = resolveBackendAddress(env, projectRoot);
    const note = cloudTargetNote(address);
    if (note) console.error(chalk.yellow(`  ⚠ ${note}`));
    if (address.url !== null) return address.url;

    console.error(chalk.red("✗ No server to send the request to."));
    console.error(chalk.gray(`  ${address.reason}`));
    process.exit(1);
}

/* ═══════════════════════════════════════════════════════════════
   The backend, through the SDK
   ═══════════════════════════════════════════════════════════════ */

type ProjectClient = ReturnType<typeof createRebaseClient>;

interface Connection {
    client: ProjectClient;
    baseUrl: string;
    /** The variable the service key was read from, for a hint that names it. */
    keyVariable: ServiceKeyVariable;
}

/** Where a service key is read from: the name a scaffold writes, or the older one. */
type ServiceKeyVariable = "REBASE_SERVICE_KEY" | "SERVICE_KEY";

/**
 * An SDK client for this project's backend, holding the service key — or the
 * credential the target flags name, resolved as every project command
 * resolves it (`--project`, `--cloud`, `--url`, `--token`, `--session`).
 *
 * The service key is the project's own machine identity — the `admin` role,
 * every scope — so it is what may list, mint and revoke service keys. It is a
 * static bearer token: no session to restore or refresh, and no socket. An
 * `rk_` key is refused on these routes whatever it holds.
 *
 * The line was already parsed strictly by the action's own spec, which
 * declares the target flags; they are read again here only for their values.
 */
async function connect(rawArgs: string[]): Promise<Connection> {
    const targetFlags = arg(PROJECT_TARGET_FLAGS, { argv: rawArgs.slice(2), permissive: true });
    const target = await projectTarget(targetFlags, { command: "api-keys" });
    const token = await target.bearer();
    const client = createRebaseClient({
        baseUrl: target.baseUrl,
        ...(token ? { token } : {}),
        realtime: false,
        headers: { "User-Agent": cliUserAgent() },
        auth: { persistSession: false, autoRefresh: false }
    });
    const keyVariable = target.credential === "service-key" ? projectServiceKey(findProjectRoot())?.variable : undefined;
    return {
        client,
        baseUrl: target.label,
        keyVariable: keyVariable === "SERVICE_KEY" ? "SERVICE_KEY" : "REBASE_SERVICE_KEY"
    };
}

/**
 * What to print when a request fails: the server's error code and message,
 * which is what says why — `SCOPE_EXCEEDS_CREATOR`, `INVALID_SCOPES`,
 * `ROLE_EXCEEDS_CREATOR`, `KEY_MANAGEMENT_SCOPE` — and a hint where one helps.
 *
 * Exported so its tests can read the lines without a server.
 */
export function describeFailure(
    action: string,
    error: unknown,
    baseUrl: string,
    keyVariable: ServiceKeyVariable = "REBASE_SERVICE_KEY"
): string[] {
    if (!(error instanceof RebaseApiError)) {
        return [`✗ ${action}: ${error instanceof Error ? error.message : String(error)}`];
    }
    if (error.status === 0 || error.code === "NETWORK_ERROR") {
        return [`✗ ${action}: ${error.message}`, ...serverUnreachableHint(baseUrl)];
    }

    const label = [error.code, error.status ? `(${error.status})` : undefined].filter(Boolean).join(" ");
    const lines = [`✗ ${action}${label ? ` — ${label}` : ""}: ${error.message}`];

    if (error.status === 401) {
        lines.push(`  The server at ${baseUrl} did not accept ${keyVariable} from .env — is it this project's server?`);
    }
    // The message names the target that is not there; what *is* there rides
    // in `details`, and is the thing to pick from.
    if (error.code === "UNKNOWN_SCOPE_TARGET" && isRecord(error.details)) {
        for (const [kind, title] of [["collections", "Tables"], ["buckets", "Buckets"], ["functions", "Functions"]] as const) {
            const names = error.details[kind];
            if (Array.isArray(names) && names.length > 0) {
                lines.push(`  ${title}: ${names.map(String).join(", ")}`);
            }
        }
    }
    return lines;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(action: string, error: unknown, connection: Connection): never {
    for (const line of describeFailure(action, error, connection.baseUrl, connection.keyVariable)) {
        console.error(line.startsWith("✗") ? chalk.red(line) : chalk.gray(line));
    }
    process.exit(1);
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
        case "get":
            await getKey(rawArgs);
            break;
        case "create":
            await createKey(rawArgs);
            break;
        case "update":
            await updateKey(rawArgs);
            break;
        case "revoke":
            await revokeKey(rawArgs);
            break;
        case "scopes":
            await listScopes(rawArgs);
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
   Showing a key
   ═══════════════════════════════════════════════════════════════ */

function keyStatus(key: ApiKeyMasked, now: Date): string {
    if (key.revoked_at) return chalk.red("revoked");
    if (key.expires_at && new Date(key.expires_at) < now) return chalk.yellow("expired");
    return chalk.green("active");
}

/**
 * The lines that describe one key: what it is, what it may do and whom it
 * runs as.
 *
 * A service key runs as the RLS role `service` plus its own `roles`; a
 * personal key runs as its owner's roles as they are when it is used, so it
 * has none of its own to show.
 *
 * Exported so its tests can read the lines without a server.
 */
export function describeKey(key: ApiKeyMasked, now: Date = new Date()): string[] {
    const field = (label: string, value: string) => `  ${chalk.gray(`${label}:`.padEnd(12))}${value}`;
    const roles = key.kind === "personal"
        ? `its owner's (${key.owner_uid ?? "unknown"})`
        : ["service", ...key.roles].join(", ");

    const lines = [
        `  ${chalk.bold(key.name)} ${chalk.gray(`[${key.key_prefix}•••]`)} ${keyStatus(key, now)}`,
        field("ID", key.id),
        field("Kind", key.kind),
        field("Scopes", key.scopes.length > 0 ? key.scopes.join(", ") : chalk.gray("none")),
        field("Roles", roles)
    ];
    if (key.rate_limit !== null) lines.push(field("Rate limit", `${key.rate_limit} requests / 15 min`));
    if (key.expires_at) lines.push(field("Expires", new Date(key.expires_at).toLocaleDateString()));
    lines.push(field("Created", new Date(key.created_at).toLocaleDateString()));
    if (key.last_used_at) lines.push(field("Last used", new Date(key.last_used_at).toLocaleDateString()));
    return lines;
}

/* ═══════════════════════════════════════════════════════════════
   list
   ═══════════════════════════════════════════════════════════════ */

/** The flags `rebase api-keys list` takes: none of its own. */
export const LIST_KEYS_FLAGS = { ...PROJECT_TARGET_FLAGS } as const;

async function listKeys(rawArgs: string[]): Promise<void> {
    parseCommandArgs({
        spec: LIST_KEYS_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "api-keys list",
        maxPositionals: 0
    });

    const connection = await connect(rawArgs);
    const { client } = connection;
    let keys: ApiKeyMasked[];
    try {
        ({ keys } = await client.apiKeys.listKeys());
    } catch (e: unknown) {
        fail("Failed to list API keys", e, connection);
    }

    console.log("");
    console.log(chalk.bold("  🔑 API Keys"));
    console.log("");

    if (keys.length === 0) {
        console.log(chalk.gray("  No API keys found."));
        console.log("");
        return;
    }

    const now = new Date();
    for (const key of keys) {
        for (const line of describeKey(key, now)) console.log(line);
        console.log("");
    }
}

/* ═══════════════════════════════════════════════════════════════
   get
   ═══════════════════════════════════════════════════════════════ */

/** The flags `rebase api-keys get` takes. */
export const GET_KEY_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--id": String
} as const;

/**
 * Which key this invocation names, as a positional or as `--id`.
 *
 * Exported so its tests can drive the real parser rather than a copy of it.
 */
export function resolveGetKeyArgs(rawArgs: string[]): { id?: string } {
    const { flags, positionals } = parseCommandArgs({
        spec: GET_KEY_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "api-keys get",
        maxPositionals: 1
    });

    return { id: flags["--id"] || positionals[0] };
}

async function getKey(rawArgs: string[]): Promise<void> {
    const { id } = resolveGetKeyArgs(rawArgs);
    if (!id) {
        throw new UsageError("Key ID is required: rebase api-keys get <key-id> (`rebase api-keys list` shows them).");
    }

    const connection = await connect(rawArgs);
    const { client } = connection;
    let key: ApiKeyMasked;
    try {
        ({ key } = await client.apiKeys.getKey(id));
    } catch (e: unknown) {
        fail("Failed to read API key", e, connection);
    }

    console.log("");
    for (const line of describeKey(key)) console.log(line);
    console.log("");
}

/* ═══════════════════════════════════════════════════════════════
   create
   ═══════════════════════════════════════════════════════════════ */

/** The flags `rebase api-keys create` takes. */
export const CREATE_KEY_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--name": String,
    "--scopes": [String],
    "--full-access": Boolean,
    "--roles": [String],
    "--rate-limit": Number,
    "--expires-in": String,
    "--expires-at": String,
    "-n": "--name"
} satisfies arg.Spec;

/**
 * Options `create` refuses by name, each with the flag that does that job.
 *
 * Checked before the line is parsed: the strict parser would answer them
 * "unknown option", which does not say what to type instead.
 */
export const RETIRED_CREATE_OPTIONS: Readonly<Record<string, string>> = {
    "--permissions":
        "--permissions is gone: name what the key may do with --scopes, e.g. " +
        "--scopes data:read:posts,data:write:posts (`rebase api-keys scopes` lists them).",
    "--admin":
        "--admin is gone: give the key the RLS role with --roles admin, and the admin-plane scopes it needs " +
        "with --scopes, e.g. --scopes users:read,schema:read.",
    "--expires":
        "--expires is gone: use --expires-in <days> (e.g. --expires-in 90) or --expires-at <ISO date>."
};

/** Refuse a retired option, wherever on the line and however it is spelled. */
function refuseRetiredOptions(rawArgs: string[]): void {
    for (const token of rawArgs.slice(2)) {
        // Past `--` everything is a value, never an option.
        if (token === "--") return;
        const name = token.split("=", 1)[0];
        const replacement = Object.prototype.hasOwnProperty.call(RETIRED_CREATE_OPTIONS, name)
            ? RETIRED_CREATE_OPTIONS[name]
            : undefined;
        if (replacement) throw new UsageError(replacement);
    }
}

/**
 * A list flag's values, whether repeated (`--scopes a --scopes b`) or
 * comma-separated (`--scopes a,b`) — or both — trimmed and deduplicated.
 * Whitespace separates too: no scope or role name contains any.
 */
function splitList(values: readonly string[] | undefined): string[] {
    const out = new Set<string>();
    for (const value of values ?? []) {
        for (const entry of value.split(/[\s,]+/)) {
            if (entry) out.add(entry);
        }
    }
    return [...out];
}

const DAY_MS = 86_400_000;

function resolveExpiry(expiresIn: string | undefined, expiresAt: string | undefined, now: Date): string | null {
    if (expiresIn !== undefined && expiresAt !== undefined) {
        throw new UsageError("Pass --expires-in or --expires-at, not both.");
    }
    if (expiresIn !== undefined) {
        const days = /^\d+$/.test(expiresIn.trim()) ? Number(expiresIn.trim()) : NaN;
        if (!Number.isSafeInteger(days) || days < 1) {
            throw new UsageError(`--expires-in takes a whole number of days, e.g. --expires-in 90 (got "${expiresIn}").`);
        }
        return new Date(now.getTime() + days * DAY_MS).toISOString();
    }
    if (expiresAt !== undefined) {
        const parsed = new Date(expiresAt);
        if (isNaN(parsed.getTime())) {
            throw new UsageError(`--expires-at takes an ISO date, e.g. --expires-at 2027-01-31 (got "${expiresAt}").`);
        }
        if (parsed.getTime() <= now.getTime()) {
            throw new UsageError(`--expires-at must be in the future (got ${parsed.toISOString()}).`);
        }
        return parsed.toISOString();
    }
    return null;
}

/** What `rebase api-keys create` was asked to mint. */
export interface CreateKeyPlan {
    name: string;
    /** The scopes named with `--scopes`, or `"held"` for `--full-access`. */
    scopes: string[] | "held";
    /** RLS roles beside `service`. */
    roles: string[];
    rate_limit: number | null;
    expires_at: string | null;
}

/**
 * What this invocation asks to be created.
 *
 * The name may be given either way — `--name "My Key"` or as the single
 * positional — and under the old permissive parse an undeclared flag became
 * that positional: `rebase api-keys create --debug --full-access` created a
 * key called `--debug` with access to everything, and `--debug` is what the
 * CLI prints after every failure as the thing to re-run with. Strict parsing
 * makes the flag an error instead of a name.
 *
 * What the key may do has to be asked for by name — `--scopes` or
 * `--full-access` — never defaulted: a forgotten flag must not mint a key that
 * reaches everything.
 *
 * Exported so its tests can drive the real parser rather than a copy of it.
 */
export function resolveCreateKeyArgs(rawArgs: string[], now: Date = new Date()): CreateKeyPlan {
    refuseRetiredOptions(rawArgs);

    const { flags, positionals } = parseCommandArgs({
        spec: CREATE_KEY_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "api-keys create",
        maxPositionals: 1
    });

    const name = (flags["--name"] || positionals[0] || "").trim();
    if (!name) {
        throw new UsageError('A key needs a name: rebase api-keys create "CI" --scopes data:read');
    }

    const named = splitList(flags["--scopes"]);
    const fullAccess = flags["--full-access"] === true;
    if (fullAccess && named.length > 0) {
        throw new UsageError("Pass --scopes or --full-access, not both: --full-access already means every scope you hold.");
    }
    if (!fullAccess && named.length === 0) {
        throw new UsageError(
            "Name what the key may do: --scopes data:read:posts,data:write:posts, or --full-access for every " +
            "scope you hold. `rebase api-keys scopes` lists them."
        );
    }

    const rateLimit = flags["--rate-limit"];
    if (rateLimit !== undefined && (!Number.isSafeInteger(rateLimit) || rateLimit < 1)) {
        throw new UsageError("--rate-limit takes a whole number of requests per 15-minute window, e.g. --rate-limit 500.");
    }

    return {
        name,
        scopes: fullAccess ? "held" : named,
        roles: splitList(flags["--roles"]),
        rate_limit: rateLimit ?? null,
        expires_at: resolveExpiry(flags["--expires-in"], flags["--expires-at"], now)
    };
}

/**
 * The scopes `--full-access` puts on a key: every one the caller holds, less
 * key management, which no key may hold.
 *
 * Exported so its tests can check the subtraction without a server.
 */
export function grantableScopes(held: readonly string[]): string[] {
    const management: readonly string[] = KEY_MANAGEMENT_SCOPES;
    return held.filter(entry => !management.includes(parseScope(entry)?.scope ?? entry));
}

async function createKey(rawArgs: string[]): Promise<void> {
    const plan = resolveCreateKeyArgs(rawArgs);
    const connection = await connect(rawArgs);
    const { client } = connection;

    let scopes: string[];
    if (plan.scopes === "held") {
        let held: string[];
        try {
            ({ held } = await client.personalKeys.listScopes());
        } catch (e: unknown) {
            fail("Failed to read the scopes you hold", e, connection);
        }
        scopes = grantableScopes(held);
        if (scopes.length === 0) {
            console.error(chalk.red("✗ You hold no scope a key may carry, so --full-access has nothing to grant."));
            process.exit(1);
        }
    } else {
        scopes = plan.scopes;
    }

    const request: CreateApiKeyRequest = {
        name: plan.name,
        scopes,
        ...(plan.roles.length > 0 ? { roles: plan.roles } : {}),
        ...(plan.rate_limit !== null ? { rate_limit: plan.rate_limit } : {}),
        ...(plan.expires_at !== null ? { expires_at: plan.expires_at } : {})
    };

    let created: ApiKeyWithSecret;
    try {
        ({ key: created } = await client.apiKeys.createKey(request));
    } catch (e: unknown) {
        fail("Failed to create API key", e, connection);
    }

    console.log("");
    console.log(chalk.bold.green("  ✓ API key created"));
    console.log("");
    for (const line of describeKey(created)) console.log(line);
    console.log("");
    console.log(chalk.bold.yellow("  ⚠ Copy your key now — it won't be shown again:"));
    console.log("");
    console.log(`  ${chalk.cyan(created.key)}`);
    console.log("");
}

/* ═══════════════════════════════════════════════════════════════
   update
   ═══════════════════════════════════════════════════════════════ */

/** The flags `rebase api-keys update` takes. */
export const UPDATE_KEY_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--id": String,
    "--name": String,
    "--scopes": [String],
    "--roles": [String],
    "--rate-limit": Number,
    "--no-rate-limit": Boolean,
    "--expires-in": String,
    "--expires-at": String,
    "--no-expiry": Boolean,
    "-n": "--name"
} satisfies arg.Spec;

/**
 * Which key, and what to change on it: only what the line names is sent, so
 * an update never resets a field it did not mention. Exported for its tests.
 */
export function resolveUpdateKeyArgs(rawArgs: string[], now: Date = new Date()): { id?: string; change: UpdateApiKeyRequest } {
    const { flags, positionals } = parseCommandArgs({
        spec: UPDATE_KEY_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "api-keys update",
        maxPositionals: 1
    });
    if (flags["--rate-limit"] !== undefined && flags["--no-rate-limit"]) {
        throw new UsageError("--rate-limit sets a limit and --no-rate-limit removes it; give one.");
    }
    if ((flags["--expires-in"] !== undefined || flags["--expires-at"] !== undefined) && flags["--no-expiry"]) {
        throw new UsageError("--expires-in/--expires-at set an expiry and --no-expiry removes it; give one.");
    }
    const change: UpdateApiKeyRequest = {};
    if (flags["--name"] !== undefined) change.name = flags["--name"];
    if (flags["--scopes"] !== undefined) change.scopes = splitList(flags["--scopes"]);
    if (flags["--roles"] !== undefined) change.roles = splitList(flags["--roles"]);
    if (flags["--rate-limit"] !== undefined) change.rate_limit = flags["--rate-limit"];
    if (flags["--no-rate-limit"]) change.rate_limit = null;
    const expiry = resolveExpiry(flags["--expires-in"], flags["--expires-at"], now);
    if (expiry !== null) change.expires_at = expiry;
    if (flags["--no-expiry"]) change.expires_at = null;
    if (Object.keys(change).length === 0) {
        throw new UsageError("Nothing to change: pass --name, --scopes, --roles, --rate-limit, --no-rate-limit, --expires-in, --expires-at or --no-expiry.");
    }
    return { id: flags["--id"] || positionals[0], change };
}

async function updateKey(rawArgs: string[]): Promise<void> {
    const { id, change } = resolveUpdateKeyArgs(rawArgs);
    if (!id) {
        throw new UsageError("Key ID is required: rebase api-keys update <key-id> --scopes … (`rebase api-keys list` shows them).");
    }
    const connection = await connect(rawArgs);
    let key: ApiKeyMasked;
    try {
        ({ key } = await connection.client.apiKeys.updateKey(id, change));
    } catch (e: unknown) {
        fail("Failed to update API key", e, connection);
    }
    console.log("");
    console.log(chalk.bold.green("  ✓ API key updated"));
    console.log("");
    for (const line of describeKey(key)) console.log(line);
    console.log("");
}

/* ═══════════════════════════════════════════════════════════════
   revoke
   ═══════════════════════════════════════════════════════════════ */

/** The flags `rebase api-keys revoke` takes. */
export const REVOKE_KEY_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
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
export function resolveRevokeKeyArgs(rawArgs: string[]): { id?: string; yes: boolean } {
    const { flags, positionals } = parseCommandArgs({
        spec: REVOKE_KEY_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "api-keys revoke",
        maxPositionals: 1
    });

    return { id: flags["--id"] || positionals[0], yes: flags["--yes"] === true };
}

async function revokeKey(rawArgs: string[]): Promise<void> {
    const { id, yes } = resolveRevokeKeyArgs(rawArgs);

    if (!id) {
        throw new UsageError("Key ID is required: rebase api-keys revoke <key-id> (`rebase api-keys list` shows them).");
    }

    const connection = await connect(rawArgs);
    // Everything holding the key stops working at once, and a revoked key
    // cannot be restored — only replaced.
    await confirmDestructive({ yes, prompt: `Revoke API key ${id} on ${connection.baseUrl}? Anything using it stops working.` });
    const { client } = connection;
    try {
        await client.apiKeys.revokeKey(id);
    } catch (e: unknown) {
        fail("Failed to revoke API key", e, connection);
    }

    console.log("");
    console.log(chalk.bold.green("  ✓ API key revoked"));
    console.log(`  ${chalk.gray("ID:")} ${id}`);
    console.log("");
}

/* ═══════════════════════════════════════════════════════════════
   scopes
   ═══════════════════════════════════════════════════════════════ */

/** The flags `rebase api-keys scopes` takes: none of its own. */
export const SCOPES_LIST_FLAGS = { ...PROJECT_TARGET_FLAGS } as const;

const PLANES: ReadonlyArray<{ plane: ScopeSummary["plane"]; title: string; note: string }> = [
    { plane: "data", title: "Data", note: "narrow what a key reaches; row-level security still decides the rows" },
    { plane: "admin", title: "Admin", note: "nobody holds these unless a role grants them; the admin role holds all" },
    { plane: "app", title: "App", note: "declared by this app under auth.scopes on the users table" }
];

/**
 * The scope catalogue as printed lines: one section per plane, each scope with
 * its label and what its target names, marked when the caller holds it.
 *
 * Exported so its tests can read the lines without a server.
 */
export function describeScopes(scopes: readonly ScopeSummary[], held: readonly string[]): string[] {
    const management: readonly string[] = KEY_MANAGEMENT_SCOPES;
    const width = Math.max(0, ...scopes.map(s => s.scope.length)) + 2;
    const labelWidth = Math.max(0, ...scopes.map(s => s.label.length)) + 2;
    const lines: string[] = [];
    for (const { plane, title, note } of PLANES) {
        const inPlane = scopes.filter(s => s.plane === plane);
        if (inPlane.length === 0) continue;
        lines.push(`  ${chalk.bold(title)} ${chalk.gray(`— ${note}`)}`);
        for (const s of inPlane) {
            const mark = held.includes(s.scope) ? chalk.green("✓") : " ";
            const extra = management.includes(s.scope)
                ? chalk.gray("never on a key")
                : s.target ? chalk.gray(`:<${s.target}>`) : "";
            lines.push(`  ${mark} ${s.scope.padEnd(width)}${extra ? s.label.padEnd(labelWidth) : s.label}${extra}`);
        }
        lines.push("");
    }
    return lines;
}

async function listScopes(rawArgs: string[]): Promise<void> {
    parseCommandArgs({
        spec: SCOPES_LIST_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "api-keys scopes",
        maxPositionals: 0
    });

    const connection = await connect(rawArgs);
    const { client } = connection;
    let catalogue: { scopes: ScopeSummary[]; held: string[] };
    try {
        catalogue = await client.personalKeys.listScopes();
    } catch (e: unknown) {
        fail("Failed to read the scopes", e, connection);
    }

    console.log("");
    console.log(chalk.bold("  Scopes") + chalk.gray("  (✓ = you hold it; :<target> narrows it to one)"));
    console.log("");
    for (const line of describeScopes(catalogue.scopes, catalogue.held)) console.log(line);
}

/* ═══════════════════════════════════════════════════════════════
   Help
   ═══════════════════════════════════════════════════════════════ */

function printApiKeysHelp() {
    const keyable = ADMIN_SCOPES.filter(scope => !(KEY_MANAGEMENT_SCOPES as readonly string[]).includes(scope));
    console.log(`
${chalk.bold("rebase api-keys")} — Manage service API keys

${chalk.green.bold("Usage")}
  rebase api-keys ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("list")}              List the service keys: kind, scopes, roles
  ${chalk.blue.bold("get")} ${chalk.gray("<id>")}          Show one key
  ${chalk.blue.bold("create")}            Create a service key
  ${chalk.blue.bold("update")} ${chalk.gray("<id>")}       Change a key's name, scopes, roles, limit or expiry
  ${chalk.blue.bold("revoke")} ${chalk.gray("<id>")}       Revoke a key ${chalk.gray("(asks first; --yes skips)")}
  ${chalk.blue.bold("scopes")}            List the scopes this backend knows, and which you hold

${chalk.green.bold("create Options")}
  ${chalk.blue("--name, -n")}        Key name ${chalk.gray("(required; or the first argument)")}
  ${chalk.blue("--scopes")}          What the key may do, comma-separated or repeated
                    ${chalk.gray("(required unless --full-access)")}
  ${chalk.blue("--full-access")}     Every scope you hold, less keys:read and keys:write
  ${chalk.blue("--roles")}           RLS roles the key runs as beside ${chalk.gray("service")}, e.g. admin
  ${chalk.blue("--rate-limit")}      Requests per 15-min window ${chalk.gray("(default: the server's API-key limit)")}
  ${chalk.blue("--expires-in")}      Days until the key expires
  ${chalk.blue("--expires-at")}      Expiry as an ISO date, e.g. 2027-01-31

${chalk.green.bold("update Options")}  ${chalk.gray("only what you name changes")}
  ${chalk.blue("--name, -n")}        New name
  ${chalk.blue("--scopes")}          Replace the scopes ${chalk.gray("(never more than you hold)")}
  ${chalk.blue("--roles")}           Replace the roles
  ${chalk.blue("--rate-limit")}      Requests per 15-min window; ${chalk.blue("--no-rate-limit")} back to the server's
  ${chalk.blue("--expires-in")}      Days from now; ${chalk.blue("--expires-at")} an ISO date; ${chalk.blue("--no-expiry")} never

${chalk.green.bold("get / update / revoke Options")}
  ${chalk.blue("--id")}              API key ID ${chalk.gray("(or the first argument)")}

${chalk.green.bold("Target options")}  ${chalk.gray("(every command)")}
  ${chalk.blue("--project <slug>")}  A Rebase Cloud project, through the console's Studio proxy
  ${chalk.blue("--cloud")}           The Rebase Cloud project this directory is linked to
  ${chalk.blue("--url <server>")}    A server at this address ${chalk.gray("(else REBASE_BASE_URL, then \`rebase dev\`)")}
  ${chalk.blue("--token <bearer>")}  Send this bearer instead of the service key ${chalk.gray("(an rk_ key is always refused here)")}
  ${chalk.blue("--session")}         Send the session \`rebase auth login\` stored ${chalk.gray("(an admin's)")}
  ${chalk.blue("--anon")}            Send no credential
  ${chalk.blue("--json")}            Accepted; these commands print text
  ${chalk.blue("--yes")}             Skip the revoke prompt

${chalk.green.bold("Scopes")}
  A scope is ${chalk.blue("resource:action")}, optionally narrowed to one target:
  ${chalk.blue("data:read:posts")} reads the posts table and nothing else.
  Data   ${DATA_PLANE_SCOPES.join(", ")}
         ${chalk.gray("target: a table slug, a storage source id (default), a function name")}
  Admin  ${keyable.join(", ")}
  App    whatever the app declares under auth.scopes ${chalk.gray("(rebase api-keys scopes)")}

${chalk.green.bold("Examples")}
  rebase api-keys list
  rebase api-keys create "Analytics" --scopes data:read:events
  rebase api-keys create -n "Blog CI" --scopes data:read:posts,data:write:posts --expires-in 90
  rebase api-keys create -n "Mailer" --scopes "functions:invoke:send-email,storage:read:(default)"
  rebase api-keys create -n "Ops" --full-access --roles admin --expires-at 2027-01-31
  rebase api-keys get abc123-def456
  rebase api-keys update abc123-def456 --scopes data:read:posts --expires-in 30
  rebase api-keys revoke abc123-def456 --yes
`);
}
