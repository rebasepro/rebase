/**
 * CLI command: rebase users <action>
 *
 * The accounts of a running app, through its `/api/admin/users`, `/roles` and
 * `/guests` routes — the ones the admin panel's user screen uses. The same
 * target and credential every project command resolves; the service key holds
 * `users:read` and `users:write`, and the server refuses to let any caller
 * grant a role above its own or act on an account that outranks it.
 *
 * Roles are declared in code (the auth table's `auth.roles`); `users roles`
 * lists them and `users update --role` assigns them.
 */
import type arg from "arg";
import chalk from "chalk";

import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";
import { PROJECT_TARGET_FLAGS, type ProjectTarget } from "../utils/project-target";
import {
    cellText,
    emit,
    fail,
    isRecord,
    parsedLine,
    printProjectHelp,
    projectTarget,
    recordsOf,
    requestJson,
    startProjectCommand,
    stringOf,
    type HelpAction
} from "../utils/project-command";
import { confirmDestructive, keyValues, note, success, warn } from "./cloud/context";

/** Everything the switch below dispatches, for the did-you-mean. */
export const USERS_SUBCOMMANDS = [
    "list", "get", "create", "update", "delete", "reset-password", "mfa-reset", "roles", "guests"
] as const;

export async function usersCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
        printUsersHelp();
        return;
    }
    switch (subcommand) {
        case "list":
            await listUsers(rawArgs);
            break;
        case "get":
            await getUser(rawArgs);
            break;
        case "create":
            await createUser(rawArgs);
            break;
        case "update":
            await updateUser(rawArgs);
            break;
        case "delete":
            await deleteUser(rawArgs);
            break;
        case "reset-password":
            await resetPassword(rawArgs, "users reset-password");
            break;
        case "mfa-reset":
            await resetMfa(rawArgs);
            break;
        case "roles":
            await listRoles(rawArgs);
            break;
        case "guests":
            await guests(rawArgs);
            break;
        default:
            unknownCommand(subcommand, USERS_SUBCOMMANDS, "users");
    }
}

/* ═══════════════════════════════════════════════════════════════
   Shared
   ═══════════════════════════════════════════════════════════════ */

const ADMIN = "/api/admin";

function describeUser(user: Record<string, unknown>): Array<[string, string]> {
    const roles = Array.isArray(user.roles) ? user.roles.map(String).join(", ") : "";
    const rows: Array<[string, string]> = [
        ["uid", stringOf(user.uid ?? user.id) ?? ""],
        ["email", stringOf(user.email) ?? ""],
        ["name", stringOf(user.displayName) ?? ""],
        ["roles", roles || chalk.gray("none")]
    ];
    if (user.disabled === true) rows.push(["status", chalk.red("disabled")]);
    if (user.isAnonymous === true) rows.push(["kind", "guest"]);
    if (user.createdAt) rows.push(["created", cellText(user.createdAt)]);
    if (user.lastSignInAt ?? user.lastLoginAt) rows.push(["last sign-in", cellText(user.lastSignInAt ?? user.lastLoginAt)]);
    return rows;
}

function userOf(body: unknown): Record<string, unknown> | undefined {
    if (isRecord(body) && isRecord(body.user)) return body.user;
    return isRecord(body) ? body : undefined;
}

/**
 * An account by uid, or by email when the argument holds an `@` — an exact,
 * case-insensitive match among the search results, never the first fuzzy hit:
 * `/admin/users?search=` matches email or display name with ILIKE, and the
 * first match for `bob@x.com` can be `bob@x.com.au`.
 */
async function resolveUid(target: ProjectTarget, ref: string): Promise<string> {
    if (!ref.includes("@")) return ref;
    const body = await requestJson(target, `${ADMIN}/users`, `Failed to look up ${ref}`, { query: { search: ref, limit: "50" } });
    const users = recordsOf(isRecord(body) ? body.users : undefined);
    const wanted = ref.toLowerCase();
    const match = users.find(user => stringOf(user.email)?.toLowerCase() === wanted);
    const uid = match ? stringOf(match.uid ?? match.id) : undefined;
    if (!uid) {
        fail(`No account has the email ${ref} on ${target.label}.`, "`rebase users list --search <text>` searches by email and name.", "not_found");
    }
    return uid;
}

/** `--role a --role b` or `--role a,b`, deduplicated. */
function rolesOf(values: readonly string[] | undefined): string[] | undefined {
    if (!values) return undefined;
    return [...new Set(values.flatMap(value => value.split(",")).map(role => role.trim()).filter(Boolean))];
}

/* ═══════════════════════════════════════════════════════════════
   list / get
   ═══════════════════════════════════════════════════════════════ */

export const LIST_USERS_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--search": String,
    "-s": "--search",
    "--role": String,
    "--limit": Number,
    "-n": "--limit",
    "--offset": Number
} satisfies arg.Spec;

async function listUsers(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: LIST_USERS_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users list",
        maxPositionals: 0
    }));
    const target = await projectTarget(flags, { command: "users list" });
    const body = await requestJson(target, `${ADMIN}/users`, "Failed to list users", {
        query: {
            search: flags["--search"],
            role: flags["--role"],
            limit: flags["--limit"]?.toString(),
            offset: flags["--offset"]?.toString()
        }
    });
    const users = recordsOf(isRecord(body) ? body.users : undefined);
    const total = isRecord(body) && typeof body.total === "number" ? body.total : users.length;
    emit(() => {
        if (users.length === 0) return note("No users match.");
        for (const user of users) {
            const roles = Array.isArray(user.roles) ? user.roles.map(String).join(", ") : "";
            const flagsText = [user.disabled === true ? chalk.red("disabled") : "", user.isAnonymous === true ? chalk.gray("guest") : ""].filter(Boolean).join(" ");
            console.log(`  ${chalk.bold(stringOf(user.email) ?? stringOf(user.uid) ?? "?")}  ${chalk.gray(stringOf(user.uid ?? user.id) ?? "")}  ${roles ? chalk.cyan(roles) : ""} ${flagsText}`.trimEnd());
        }
        if (total > users.length) note(chalk.gray(`${users.length} of ${total}; --offset ${(flags["--offset"] ?? 0) + users.length} for the next page.`));
    }, body);
}

export const GET_USER_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function getUser(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: GET_USER_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users get",
        maxPositionals: 1
    }));
    const ref = parsedLine(() => {
        if (!positionals[0]) throw new UsageError("rebase users get needs a uid or an email: rebase users get <uid|email>.");
        return positionals[0];
    });
    const target = await projectTarget(flags, { command: "users get" });
    const uid = await resolveUid(target, ref);
    const body = await requestJson(target, `${ADMIN}/users/${encodeURIComponent(uid)}`, `Failed to read ${ref}`);
    const user = userOf(body);
    emit(() => keyValues(user ? describeUser(user) : []), user ?? body);
}

/* ═══════════════════════════════════════════════════════════════
   create / update / delete
   ═══════════════════════════════════════════════════════════════ */

export const CREATE_USER_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--email": String,
    "-e": "--email",
    "--name": String,
    "--role": [String],
    "--password": String,
    "--skip-password-policy": Boolean
} satisfies arg.Spec;

async function createUser(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: CREATE_USER_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users create",
        maxPositionals: 1
    }));
    const email = parsedLine(() => {
        const value = flags["--email"] ?? positionals[0];
        if (!value || !value.includes("@")) throw new UsageError("rebase users create needs an email: rebase users create <email> [--role admin].");
        return value.trim();
    });
    const target = await projectTarget(flags, { command: "users create" });
    const roles = rolesOf(flags["--role"]);
    const body = await requestJson(target, `${ADMIN}/users`, `Failed to create ${email}`, {
        method: "POST",
        json: {
            email,
            ...(flags["--name"] ? { displayName: flags["--name"] } : {}),
            ...(flags["--password"] ? { password: flags["--password"] } : {}),
            ...(roles ? { roles } : {}),
            ...(flags["--skip-password-policy"] ? { skipPasswordPolicy: true } : {})
        }
    });
    const user = userOf(body);
    const temporary = isRecord(body) ? stringOf(body.temporaryPassword) : undefined;
    emit(() => {
        success(`Created ${email}${roles?.length ? ` (${roles.join(", ")})` : ""} on ${target.label}.`);
        if (user) keyValues(describeUser(user));
        if (isRecord(body) && body.invitationSent === true) note("An invitation was emailed.");
        if (temporary) {
            warn("No invitation could be sent, so the server set a temporary password. It is shown this once:", temporary);
        }
    }, body);
}

export const UPDATE_USER_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--email": String,
    "--name": String,
    "--role": [String],
    "--add-role": [String],
    "--remove-role": [String],
    "--disable": Boolean,
    "--enable": Boolean
} satisfies arg.Spec;

async function updateUser(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: UPDATE_USER_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users update",
        maxPositionals: 1
    }));
    const ref = parsedLine(() => {
        if (!positionals[0]) throw new UsageError("rebase users update needs a uid or an email: rebase users update <uid|email> --role admin.");
        if (flags["--disable"] && flags["--enable"]) throw new UsageError("--disable and --enable contradict each other.");
        if (flags["--role"] && (flags["--add-role"] || flags["--remove-role"])) {
            throw new UsageError("--role sets the whole list; --add-role and --remove-role change it. Use one or the other.");
        }
        return positionals[0];
    });
    const target = await projectTarget(flags, { command: "users update" });
    const uid = await resolveUid(target, ref);

    let roles = rolesOf(flags["--role"]);
    const adding = rolesOf(flags["--add-role"]);
    const removing = rolesOf(flags["--remove-role"]);
    let before: string[] | undefined;
    if (adding || removing || roles) {
        const current = userOf(await requestJson(target, `${ADMIN}/users/${encodeURIComponent(uid)}`, `Failed to read ${ref}`));
        before = Array.isArray(current?.roles) ? current.roles.map(String) : [];
        if (adding || removing) {
            roles = [...new Set([...before, ...(adding ?? [])])].filter(role => !(removing ?? []).includes(role));
        }
    }
    const change: Record<string, unknown> = {
        ...(flags["--email"] ? { email: flags["--email"] } : {}),
        ...(flags["--name"] !== undefined ? { displayName: flags["--name"] } : {}),
        ...(roles ? { roles } : {}),
        ...(flags["--disable"] ? { disabled: true } : {}),
        ...(flags["--enable"] ? { disabled: false } : {})
    };
    if (Object.keys(change).length === 0) {
        parsedLine(() => {
            throw new UsageError("Nothing to change: pass --role, --add-role, --remove-role, --name, --email, --disable or --enable.");
        });
    }
    // Granting a role hands out what that role may do; disabling locks
    // somebody out. Both say what they are about to do and wait.
    const granted = roles && before ? roles.filter(role => !before?.includes(role)) : [];
    if (granted.length > 0 || flags["--disable"]) {
        const what = [granted.length ? `grant ${granted.join(", ")}` : "", flags["--disable"] ? "disable the account" : ""].filter(Boolean).join(" and ");
        await confirmDestructive({ yes: flags["--yes"] === true, prompt: `${what[0].toUpperCase()}${what.slice(1)} for ${ref} on ${target.label}?` });
    }
    const body = await requestJson(target, `${ADMIN}/users/${encodeURIComponent(uid)}`, `Failed to update ${ref}`, { method: "PUT", json: change });
    const user = userOf(body);
    emit(() => {
        success(`Updated ${ref}.`);
        if (user) keyValues(describeUser(user));
    }, body);
}

export const DELETE_USER_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function deleteUser(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: DELETE_USER_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users delete",
        maxPositionals: 1
    }));
    const ref = parsedLine(() => {
        if (!positionals[0]) throw new UsageError("rebase users delete needs a uid or an email: rebase users delete <uid|email>.");
        return positionals[0];
    });
    const target = await projectTarget(flags, { command: "users delete" });
    const uid = await resolveUid(target, ref);
    await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Delete the account ${ref} on ${target.label}? This cannot be undone.` });
    await requestJson(target, `${ADMIN}/users/${encodeURIComponent(uid)}`, `Failed to delete ${ref}`, { method: "DELETE" });
    emit(() => success(`Deleted ${ref}.`), { uid, deleted: true });
}

/* ═══════════════════════════════════════════════════════════════
   reset-password / mfa-reset
   ═══════════════════════════════════════════════════════════════ */

export const RESET_PASSWORD_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--email": String,
    "-e": "--email",
    "--password": String
} satisfies arg.Spec;

/**
 * Reset an account's password: an emailed reset invitation, or — with
 * `--password`, or when no email can be sent — a password set now. Exported
 * for `rebase auth reset-password`, the older spelling, which keeps its
 * direct-database fallback for a server that is not running.
 */
export async function resetPassword(rawArgs: string[], command: "users reset-password"): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: RESET_PASSWORD_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users reset-password",
        maxPositionals: 1
    }));
    const ref = parsedLine(() => {
        const value = flags["--email"] ?? positionals[0];
        if (!value) throw new UsageError(`rebase ${command} needs an email or uid: rebase ${command} <email|uid> [--password <new>].`);
        return value;
    });
    const target = await projectTarget(flags, { command });
    const uid = await resolveUid(target, ref);
    const body = await requestJson(target, `${ADMIN}/users/${encodeURIComponent(uid)}/reset-password`, `Failed to reset the password of ${ref}`, {
        method: "POST",
        ...(flags["--password"] ? { json: { password: flags["--password"] } } : {})
    });
    const temporary = isRecord(body) ? stringOf(body.temporaryPassword) : undefined;
    emit(() => {
        if (flags["--password"]) success(`Set a new password for ${ref}.`);
        else if (isRecord(body) && body.invitationSent === true) success(`Emailed a reset link to ${ref}.`);
        else success(`Reset the password of ${ref}.`);
        if (temporary) warn("No email could be sent, so the server set a temporary password. It is shown this once:", temporary);
    }, body);
}

export const MFA_RESET_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function resetMfa(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: MFA_RESET_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users mfa-reset",
        maxPositionals: 1
    }));
    const ref = parsedLine(() => {
        if (!positionals[0]) throw new UsageError("rebase users mfa-reset needs a uid or an email.");
        return positionals[0];
    });
    const target = await projectTarget(flags, { command: "users mfa-reset" });
    const uid = await resolveUid(target, ref);
    await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Remove every second factor and recovery code of ${ref}, and sign them out everywhere?` });
    const body = await requestJson(target, `${ADMIN}/users/${encodeURIComponent(uid)}/mfa`, `Failed to reset the second factors of ${ref}`, { method: "DELETE" });
    const removed = isRecord(body) && typeof body.removedFactors === "number" ? body.removedFactors : undefined;
    emit(() => success(`Removed ${removed ?? "the"} second factor(s) of ${ref}; their sessions are ended.`), body);
}

/* ═══════════════════════════════════════════════════════════════
   roles
   ═══════════════════════════════════════════════════════════════ */

export const ROLES_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function listRoles(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: ROLES_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users roles",
        maxPositionals: 0
    }));
    const target = await projectTarget(flags, { command: "users roles" });
    const body = await requestJson(target, `${ADMIN}/roles`, "Failed to list roles");
    const roles = recordsOf(isRecord(body) ? body.roles : undefined);
    emit(() => {
        if (roles.length === 0) return note("No roles are declared (the auth table's auth.roles).");
        for (const role of roles) {
            const scopes = Array.isArray(role.scopes) ? role.scopes.map(String).join(", ") : "";
            console.log(`  ${chalk.bold(stringOf(role.id ?? role.name) ?? "?")}${role.name && role.id && role.name !== role.id ? ` ${chalk.gray(String(role.name))}` : ""}`);
            if (scopes) console.log(chalk.gray(`      ${scopes}`));
        }
    }, body);
}

/* ═══════════════════════════════════════════════════════════════
   guests
   ═══════════════════════════════════════════════════════════════ */

export const GUESTS_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--older-than": String,
    "--limit": Number,
    "-n": "--limit"
} satisfies arg.Spec;

/** `30d`, `12h`, `2w`, or a bare number of days, as a date that far in the past. Exported for tests. */
export function olderThan(value: string, now: Date = new Date()): Date {
    const match = /^(\d+)\s*([hdw]?)$/i.exec(value.trim());
    if (!match) throw new UsageError(`--older-than takes an age like 30d, 12h or 2w (got "${value}").`);
    const amount = Number(match[1]);
    const unit = (match[2] || "d").toLowerCase();
    const hours = unit === "h" ? amount : unit === "w" ? amount * 24 * 7 : amount * 24;
    return new Date(now.getTime() - hours * 3_600_000);
}

/**
 * Guest accounts — the ones anonymous sign-in leaves behind: `users guests`
 * lists them (the oldest first), `users guests delete <uid>` deletes one, and
 * `users guests prune --older-than 30d` deletes every guest not seen since,
 * a batch at a time; without --yes it only says how many it would delete.
 */
async function guests(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: GUESTS_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "users guests",
        maxPositionals: 2
    }));
    const action = positionals[0] ?? "list";
    if (!["list", "delete", "prune"].includes(action)) {
        unknownCommand(action, ["list", "delete", "prune"], "users guests");
    }
    const target = await projectTarget(flags, { command: "users guests" });
    const before = flags["--older-than"] ? parsedLine(() => olderThan(flags["--older-than"] ?? "")) : undefined;

    if (action === "delete") {
        const uid = parsedLine(() => {
            if (!positionals[1]) throw new UsageError("rebase users guests delete needs the guest's uid.");
            return positionals[1];
        });
        await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Delete the guest ${uid} on ${target.label}?` });
        await requestJson(target, `${ADMIN}/guests/${encodeURIComponent(uid)}`, `Failed to delete guest ${uid}`, { method: "DELETE" });
        emit(() => success(`Deleted guest ${uid}.`), { uid, deleted: true });
        return;
    }

    if (action === "prune") {
        if (!before) parsedLine(() => {
            throw new UsageError("rebase users guests prune needs --older-than <age> (e.g. 30d): the guests not seen since then are deleted.");
        });
        const cutoff = before ?? new Date();
        const listed = await requestJson(target, `${ADMIN}/guests`, "Failed to count guests", { query: { lastSeenBefore: cutoff.toISOString(), limit: "1" } });
        const total = isRecord(listed) && typeof listed.total === "number" ? listed.total : undefined;
        if (!flags["--yes"]) {
            emit(
                () => note(`${total ?? "Some"} guest(s) were last seen before ${cutoff.toISOString()}. Re-run with --yes to delete them.`),
                { lastSeenBefore: cutoff.toISOString(), wouldDelete: total ?? null, deleted: 0 }
            );
            return;
        }
        let deleted = 0;
        let offset = 0;
        for (;;) {
            const body = await requestJson(target, `${ADMIN}/guests`, "Failed to delete guests", {
                method: "DELETE",
                query: { lastSeenBefore: cutoff.toISOString(), ...(offset ? { offset: String(offset) } : {}) }
            });
            const batch = isRecord(body) && typeof body.deleted === "number" ? body.deleted : 0;
            const skipped = isRecord(body) && typeof body.skipped === "number" ? body.skipped : 0;
            const remaining = isRecord(body) && typeof body.remaining === "number" ? body.remaining : 0;
            deleted += batch;
            offset += skipped;
            if (remaining === 0 || (batch === 0 && skipped === 0)) break;
        }
        emit(() => success(`Deleted ${deleted} guest(s) last seen before ${cutoff.toISOString()}.`), { lastSeenBefore: cutoff.toISOString(), deleted });
        return;
    }

    const body = await requestJson(target, `${ADMIN}/guests`, "Failed to list guests", {
        query: { lastSeenBefore: before?.toISOString(), limit: flags["--limit"]?.toString() }
    });
    const list = recordsOf(isRecord(body) ? body.guests : undefined);
    const total = isRecord(body) && typeof body.total === "number" ? body.total : list.length;
    emit(() => {
        note(`${total} guest account(s)${before ? ` last seen before ${before.toISOString()}` : ""}.`);
        for (const guest of list) {
            console.log(`  ${stringOf(guest.uid ?? guest.id) ?? "?"}  ${chalk.gray(`last seen ${cellText(guest.lastSeenAt ?? guest.lastSignInAt ?? guest.createdAt)}`)}`);
        }
    }, body);
}

/* ═══════════════════════════════════════════════════════════════
   Help
   ═══════════════════════════════════════════════════════════════ */

export const USERS_ACTIONS: HelpAction[] = [
    { action: "list", description: "The accounts, newest first", flags: [["--search, -s <text>", "Match email or name"], ["--role <role>", "Only accounts holding this role"], ["--limit, -n <n>", "Page size"], ["--offset <n>", "Skip this many"]] },
    { action: "get", args: "<uid|email>", description: "One account" },
    {
        action: "create",
        args: "<email>",
        description: "Create an account; it is emailed an invitation, or shown a temporary password",
        flags: [["--email, -e <email>", "The email (or as the argument)"], ["--name <name>", "Display name"], ["--role <role>", "A role to give it (repeatable, or a,b)"], ["--password <password>", "Set this password instead of inviting"], ["--skip-password-policy", "Accept a password the policy would refuse (imports)"]]
    },
    {
        action: "update",
        args: "<uid|email>",
        description: "Change roles, name, email, or switch the account off (confirms grants and --disable)",
        flags: [["--role <role>", "Set the whole role list (repeatable, or a,b)"], ["--add-role <role>", "Add a role"], ["--remove-role <role>", "Remove a role"], ["--name <name>", "Display name"], ["--email <email>", "Email"], ["--disable", "No sign-in, every token refused at once"], ["--enable", "Switch it back on"]]
    },
    { action: "delete", args: "<uid|email>", description: "Delete an account (confirms)" },
    { action: "reset-password", args: "<email|uid>", description: "Email a reset link, or set a password now", flags: [["--email, -e <email>", "The account (or as the argument)"], ["--password <password>", "Set this password instead of emailing a link"]] },
    { action: "mfa-reset", args: "<uid|email>", description: "Remove every second factor and recovery code, end the sessions (confirms)" },
    { action: "roles", description: "The roles the app declares, and their scopes" },
    {
        action: "guests",
        args: "[list|delete <uid>|prune]",
        description: "Anonymous sign-in's guest accounts: list, delete one, delete the stale ones",
        flags: [["--older-than <age>", "30d, 12h, 2w: only guests not seen since"], ["--limit, -n <n>", "At most this many listed"]]
    }
];

function printUsersHelp(): void {
    printProjectHelp({
        command: "users",
        title: "The accounts of a running app: list, create, roles, resets",
        actions: USERS_ACTIONS,
        notes: [
            "Examples:",
            "  rebase users create ada@example.com --role admin",
            "  rebase users update bob@example.com --add-role editor",
            "  rebase users guests prune --older-than 30d --yes",
            "No caller may grant a role above its own, or act on an account that outranks it — the server refuses both."
        ]
    });
}
