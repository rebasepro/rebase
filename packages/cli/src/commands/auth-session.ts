/**
 * CLI commands: rebase auth login | logout | whoami | emails | keys
 *
 * A person's session on a running app — not on Rebase Cloud's control plane,
 * which is `rebase cloud login`. Some of an app's routes answer a person and
 * never a machine: the RLS simulator, the impersonation and simulation
 * headers, live schema apply (a commit needs an author), personal API keys.
 * The service key will never reach them, by design. `rebase auth login`
 * stores a session for one server in `~/.rebase/sessions.json` (keyed by its
 * origin, never in the project directory), and every project command sends
 * it on `--session`; `rebase rls simulate` and `rebase auth keys` send it by
 * default.
 *
 * `auth emails` is the other thing a terminal needs while building auth
 * flows: the development mailbox — every sign-in, reset and magic-link mail a
 * server with no SMTP_HOST captured instead of sending, with its links.
 */
import type arg from "arg";
import chalk from "chalk";
import inquirer from "inquirer";

import { parseCommandArgs, UsageError } from "../utils/args";
import {
    PROJECT_TARGET_FLAGS,
    forgetSession,
    saveSession,
    sessionKey,
    storedSession,
    type ProjectTarget
} from "../utils/project-target";
import {
    emit,
    fail,
    isJsonMode,
    isRecord,
    parsedLine,
    projectTarget,
    recordsOf,
    requestJson,
    stringOf
} from "../utils/project-command";
import { cliUserAgent } from "../utils/version";
import { confirmDestructive, note, success, warn } from "./cloud/context";

/** The subcommands this module answers, beside `reset-password` in `auth.ts`. */
export const AUTH_SESSION_SUBCOMMANDS = ["login", "logout", "whoami", "emails", "keys"] as const;

/** The access token's expiry, from its `exp` claim, in epoch milliseconds. */
export function tokenExpiry(token: string): number {
    const payload = token.split(".")[1];
    if (payload) {
        try {
            const claims: unknown = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
            if (isRecord(claims) && typeof claims.exp === "number") return claims.exp * 1000;
        } catch {
            // Not a JWT we can read: fall through to a short, safe guess.
        }
    }
    return Date.now() + 15 * 60_000;
}

function atTerminal(): boolean {
    return !isJsonMode() && process.stdin.isTTY === true;
}

/** The origin a session is for: the target, reached with no credential of its own. */
async function originTarget(flags: Readonly<Record<string, unknown>>, command: string): Promise<ProjectTarget> {
    return projectTarget({ ...flags, "--anon": true, "--token": undefined, "--session": undefined }, { command });
}

/* ═══════════════════════════════════════════════════════════════
   login
   ═══════════════════════════════════════════════════════════════ */

export const AUTH_LOGIN_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--email": String,
    "-e": "--email",
    "--password": String,
    "--code": String,
    "--web": Boolean,
    "--no-browser": Boolean
} satisfies arg.Spec;

type SignedIn = { user: unknown; accessToken: string; refreshToken?: string };

export async function authLogin(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: AUTH_LOGIN_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "auth login",
        maxPositionals: 0
    }));
    if (flags["--token"] || flags["--session"] || flags["--anon"]) {
        fail("`rebase auth login` signs in; --token, --session and --anon pick a credential for other commands.", undefined, "usage");
    }
    const target = await originTarget(flags, "auth login");
    const origin = target.baseUrl;
    const { createRebaseClient } = await import("@rebasepro/client");
    const client = createRebaseClient({
        baseUrl: origin,
        realtime: false,
        headers: { "User-Agent": cliUserAgent() },
        auth: { persistSession: false, autoRefresh: false }
    });

    const config = await requestJson(target, "/api/auth/config", `Could not read how ${origin} signs people in`).catch(() => null);
    const deviceLogin = isRecord(config) && (config.deviceLogin === true || isRecord(config.deviceLogin));

    let signedIn: SignedIn;
    const email = flags["--email"];
    if (flags["--web"] || (!email && deviceLogin)) {
        if (!deviceLogin) {
            fail(`${origin} does not offer signing in through a browser.`, "Pass --email <address> to sign in with a password.", "device_login_unavailable");
        }
        signedIn = await signInWithBrowser(client.auth, flags["--no-browser"] !== true);
    } else {
        let address = email;
        if (!address) {
            if (!atTerminal()) fail("Signing in needs an email and a password, and there is no terminal to ask on.", "Pass --email <address> --password <password>.", "input_required");
            ({ address } = await inquirer.prompt([{ type: "input", name: "address", message: "Email:" }]));
        }
        let password = flags["--password"];
        if (!password) {
            if (!atTerminal()) fail("Signing in needs a password, and there is no terminal to ask on.", "Pass --password <password>.", "input_required");
            ({ password } = await inquirer.prompt([{ type: "password", name: "password", message: "Password:", mask: "*" }]));
        }
        const who = String(address ?? "").trim();
        const secret = String(password ?? "");
        signedIn = await withSecondFactor(client.auth, flags["--code"], () => client.auth.signInWithEmail(who, secret));
    }

    const user = isRecord(signedIn.user) ? signedIn.user : {};
    const roles = Array.isArray(user.roles) ? user.roles.map(String) : [];
    saveSession(origin, {
        accessToken: signedIn.accessToken,
        ...(signedIn.refreshToken ? { refreshToken: signedIn.refreshToken } : {}),
        expiresAt: tokenExpiry(signedIn.accessToken),
        ...(stringOf(user.email) ? { email: stringOf(user.email) } : {}),
        ...(stringOf(user.uid ?? user.id) ? { uid: stringOf(user.uid ?? user.id) } : {})
    });
    emit(() => {
        success(`Signed in to ${sessionKey(origin)} as ${stringOf(user.email) ?? stringOf(user.uid) ?? "?"}${roles.length ? ` (${roles.join(", ")})` : ""}.`);
        note(chalk.gray("Commands send this session with --session; `rebase rls simulate` and `rebase auth keys` send it by default."));
    }, { origin: sessionKey(origin), user: { uid: stringOf(user.uid ?? user.id) ?? null, email: stringOf(user.email) ?? null, roles } });
}

type ProjectAuth = Awaited<ReturnType<typeof import("@rebasepro/client")["createRebaseClient"]>>["auth"];

/** The `MFA_REQUIRED` refusal's details: the pending token and the factors to answer with. */
function pendingSecondFactor(error: unknown): { mfaToken: string; factors: Array<{ id: string; name: string }> } | null {
    if (!isRecord(error) || error.code !== "MFA_REQUIRED" || !isRecord(error.details)) return null;
    const mfaToken = stringOf(error.details.mfaToken);
    const factors = recordsOf(error.details.factors)
        .map(f => ({ id: stringOf(f.id) ?? "", name: stringOf(f.friendlyName) ?? stringOf(f.factorType) ?? "factor" }))
        .filter(f => f.id);
    return mfaToken && factors.length > 0 ? { mfaToken, factors } : null;
}

/** Run a sign-in; when the account has two-factor authentication on, answer the challenge. */
async function withSecondFactor(auth: ProjectAuth, code: string | undefined, signIn: () => Promise<SignedIn>): Promise<SignedIn> {
    try {
        return await signIn();
    } catch (e) {
        const pending = pendingSecondFactor(e);
        if (!pending) throw e;
        let answer = code;
        if (!answer) {
            if (!atTerminal()) fail("This account has two-factor authentication on, and there is no terminal to ask for the code on.", "Pass --code <code>.", "mfa_required");
            ({ answer } = await inquirer.prompt([{ type: "input", name: "answer", message: "Code from your authenticator app (or a recovery code):" }]));
        }
        const options = { mfaToken: pending.mfaToken };
        const { challengeId } = await auth.mfa.challenge(pending.factors[0].id, options);
        return auth.mfa.verifyChallenge(challengeId, String(answer ?? "").replace(/\s+/g, ""), options);
    }
}

/** The framework's device sign-in: show the link and code, then poll until it is approved. */
async function signInWithBrowser(auth: ProjectAuth, openBrowser: boolean): Promise<SignedIn> {
    const started = await auth.startDeviceLogin({ clientName: `Rebase CLI on ${(await import("os")).hostname()}` });
    process.stderr.write(`To sign in, open ${started.verificationUriComplete}\n  and check that it shows the code ${started.userCode}.\n`);
    if (openBrowser && atTerminal()) {
        const { openUrl } = await import("./cloud/context");
        openUrl(started.verificationUriComplete);
    }
    const deadline = Date.now() + started.expiresIn * 1000;
    let interval = started.interval;
    while (Date.now() < deadline) {
        await new Promise(resolve => setTimeout(resolve, interval * 1000));
        const result = await auth.pollDeviceLogin(started.deviceCode);
        if (result.status === "approved") return { user: result.user, accessToken: result.accessToken, refreshToken: result.refreshToken };
        if (result.status === "denied") fail("The sign-in was denied in the browser.", undefined, "access_denied");
        if (result.status === "expired") break;
        interval = result.interval;
    }
    fail("The sign-in link expired before it was approved.", "Run `rebase auth login` again.", "expired_token");
}

/* ═══════════════════════════════════════════════════════════════
   logout / whoami
   ═══════════════════════════════════════════════════════════════ */

export const AUTH_LOGOUT_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

export async function authLogout(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: AUTH_LOGOUT_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "auth logout",
        maxPositionals: 0
    }));
    const target = await originTarget(flags, "auth logout");
    const session = storedSession(target.baseUrl);
    if (!session) {
        emit(() => note(`No session is stored for ${sessionKey(target.baseUrl)}.`), { origin: sessionKey(target.baseUrl), signedOut: false });
        return;
    }
    // End it on the server too, so the refresh token stops working there and
    // not only here. A server that cannot be reached still loses it locally.
    if (session.refreshToken) {
        await target.request("/api/auth/logout", { method: "POST", json: { refreshToken: session.refreshToken }, timeoutMs: 10_000 }).catch(() => undefined);
    }
    forgetSession(target.baseUrl);
    emit(() => success(`Signed out of ${sessionKey(target.baseUrl)}.`), { origin: sessionKey(target.baseUrl), signedOut: true });
}

export const AUTH_WHOAMI_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

/**
 * Who the server takes this command to be: `/api/auth/me` for a person's
 * session or token, and the scopes the credential holds (`/api/auth/scopes`),
 * which answers keys and the service key too.
 */
export async function authWhoami(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: AUTH_WHOAMI_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "auth whoami",
        maxPositionals: 0
    }));
    const usesSession = !flags["--token"] && !flags["--anon"];
    const target = await projectTarget(flags, { command: "auth whoami", ...(usesSession && !flags["--session"] ? { defaultCredential: "person" as const } : {}) });
    const scopes = await requestJson(target, "/api/auth/scopes", "Failed to read what this credential holds");
    const me = target.credential === "session" || target.credential === "token"
        ? await target.request("/api/auth/me", { timeoutMs: 15_000 }).then(async res => (res.ok ? res.json() as Promise<unknown> : null)).catch(() => null)
        : null;
    const user = isRecord(me) && isRecord(me.user) ? me.user : isRecord(me) ? me : undefined;
    const held = isRecord(scopes) && Array.isArray(scopes.held) ? scopes.held.map(String) : [];
    emit(() => {
        console.log(`  ${chalk.gray("server".padEnd(10))}${target.label}`);
        console.log(`  ${chalk.gray("as".padEnd(10))}${user ? `${stringOf(user.email) ?? stringOf(user.uid) ?? "?"} (${target.credential})` : target.credential}`);
        if (user && Array.isArray(user.roles)) console.log(`  ${chalk.gray("roles".padEnd(10))}${user.roles.map(String).join(", ") || chalk.gray("none")}`);
        console.log(`  ${chalk.gray("scopes".padEnd(10))}${held.length ? held.join(", ") : chalk.gray("none")}`);
    }, { server: target.label, credential: target.credential, user: user ?? null, scopes: held });
}

/* ═══════════════════════════════════════════════════════════════
   emails — the development mailbox
   ═══════════════════════════════════════════════════════════════ */

export const AUTH_EMAILS_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--latest": Boolean,
    "--to": String,
    "--clear": Boolean,
    "--links": Boolean
} satisfies arg.Spec;

export async function authEmails(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: AUTH_EMAILS_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "auth emails",
        maxPositionals: 0
    }));
    const target = await projectTarget(flags, { command: "auth emails" });
    if (flags["--clear"]) {
        await requestJson(target, "/api/admin/dev/emails", "Failed to clear the development mailbox", { method: "DELETE" });
        emit(() => success("Cleared the development mailbox."), { cleared: true });
        return;
    }
    const body = await requestJson(target, "/api/admin/dev/emails", "Failed to read the development mailbox");
    let messages = recordsOf(isRecord(body) ? body.messages : undefined);
    if (flags["--to"]) {
        const to = flags["--to"].toLowerCase();
        messages = messages.filter(message => stringOf(message.to)?.toLowerCase().includes(to));
    }
    if (flags["--latest"]) messages = messages.slice(0, 1);
    if (flags["--links"]) {
        // Only the links, one per line: what a script pipes into the next step.
        for (const message of messages) for (const link of Array.isArray(message.links) ? message.links : []) process.stdout.write(`${String(link)}\n`);
        return;
    }
    emit(() => {
        if (messages.length === 0) return note("The development mailbox is empty.");
        for (const message of messages) {
            console.log(`  ${chalk.gray(stringOf(message.at) ?? "")}  ${chalk.bold(stringOf(message.to) ?? "?")}  ${stringOf(message.subject) ?? ""}`);
            for (const link of Array.isArray(message.links) ? message.links : []) console.log(`      ${chalk.cyan(String(link))}`);
        }
    }, { messages });
}

/* ═══════════════════════════════════════════════════════════════
   keys — your own personal API keys
   ═══════════════════════════════════════════════════════════════ */

export const AUTH_KEYS_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--name": String,
    "-n": "--name",
    "--scopes": [String],
    "--expires-in": String
} satisfies arg.Spec;

/**
 * A person's own `rk_` keys (`/api/auth/keys`): list, create, revoke. They act
 * as their owner, with the owner's live roles, narrowed to the scopes named.
 * The server answers a person's session only, and only when the auth table
 * sets `auth.personalKeys: true`. Service keys are `rebase api-keys`.
 */
export async function authKeys(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: AUTH_KEYS_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "auth keys",
        maxPositionals: 2
    }));
    const action = positionals[0] ?? "list";
    if (!["list", "create", "revoke"].includes(action)) {
        const { unknownCommand } = await import("../utils/unknown-command");
        unknownCommand(action, ["list", "create", "revoke"], "auth keys");
    }
    const target = await projectTarget(flags, { command: "auth keys", defaultCredential: "person" });

    if (action === "create") {
        const { scopes, expiresAt } = parsedLine(() => {
            const list = (flags["--scopes"] ?? []).flatMap(s => s.split(",")).map(s => s.trim()).filter(Boolean);
            if (list.length === 0) throw new UsageError("rebase auth keys create needs --scopes, e.g. --scopes data:read:posts (never more than you hold).");
            let expires: string | undefined;
            if (flags["--expires-in"]) {
                const days = Number(flags["--expires-in"].replace(/d$/, ""));
                if (!Number.isFinite(days) || days <= 0) throw new UsageError("--expires-in takes a number of days, e.g. 30 or 30d.");
                expires = new Date(Date.now() + days * 86_400_000).toISOString();
            }
            return { scopes: list, expiresAt: expires };
        });
        const body = await requestJson(target, "/api/auth/keys", "Failed to create the key", {
            method: "POST",
            json: { name: flags["--name"] ?? "CLI key", scopes, ...(expiresAt ? { expires_at: expiresAt } : {}) }
        });
        const secret = isRecord(body) ? stringOf(body.key) ?? (isRecord(body.key) ? stringOf(body.key.key) : undefined) : undefined;
        emit(() => {
            success(`Created a personal key holding ${scopes.join(", ")}.`);
            if (secret) warn("It is shown this once:", secret);
        }, body);
        return;
    }

    if (action === "revoke") {
        const id = parsedLine(() => {
            if (!positionals[1]) throw new UsageError("rebase auth keys revoke needs the key's id (`rebase auth keys` lists them).");
            return positionals[1];
        });
        await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Revoke your key ${id} on ${target.label}? Anything using it stops working.` });
        await requestJson(target, `/api/auth/keys/${encodeURIComponent(id)}`, `Failed to revoke ${id}`, { method: "DELETE" });
        emit(() => success(`Revoked ${id}.`), { id, revoked: true });
        return;
    }

    const body = await requestJson(target, "/api/auth/keys", "Failed to list your keys");
    const keys = recordsOf(isRecord(body) ? body.keys : body);
    emit(() => {
        if (keys.length === 0) return note("You have no personal keys on this server.");
        for (const key of keys) {
            const scopes = Array.isArray(key.scopes) ? key.scopes.map(String).join(", ") : "";
            const state = key.revoked_at ? chalk.red("revoked") : chalk.green("active");
            console.log(`  ${chalk.bold(stringOf(key.name) ?? "?")} ${chalk.gray(`[${stringOf(key.key_prefix) ?? ""}•••]`)} ${state}  ${chalk.gray(stringOf(key.id) ?? "")}`);
            if (scopes) console.log(chalk.gray(`      ${scopes}`));
        }
    }, body);
}
