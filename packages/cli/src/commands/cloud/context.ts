/**
 * Shared foundation for the `rebase cloud` command family.
 *
 * Everything cloud subcommands need in common lives here:
 *   - credential storage  (~/.rebase/credentials.json, keyed per control-plane host)
 *   - project link file    (.rebase/cloud.json in the project dir)
 *   - control-plane URL resolution
 *   - an authenticated `@rebasepro/client` instance (createCloudClient / requireClient)
 *   - small output helpers shared across subcommands
 *
 * The control plane is itself a Rebase app, so we reuse the same SDK the web
 * console uses (`@rebasepro/client`). Auth, token refresh, the data REST client
 * and function invocation all come from the SDK — the CLI only supplies a
 * file-backed AuthStorage so a login persists across invocations.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import chalk from "chalk";
import arg from "arg";
import inquirer from "inquirer";
import { createRebaseClient, type AuthStorage } from "@rebasepro/client";
import { findProjectRoot } from "../../utils/project";
import { parseCommandArgs } from "../../utils/args";

/* ═══════════════════════════════════════════════════════════════
   Constants & paths
   ═══════════════════════════════════════════════════════════════ */

/** Default hosted control plane (the Rebase Cloud console origin). */
const DEFAULT_CLOUD_URL = "https://app.rebase.pro";

/** The storage key the SDK's auth module reads/writes the session under. */
const SDK_SESSION_KEY = "rebase_auth";

/** ~/.rebase/credentials.json — one file, many hosts. */
function credentialsPath(): string {
    return path.join(os.homedir(), ".rebase", "credentials.json");
}

/** Project-local link file: <project>/.rebase/cloud.json */
export function projectLinkPath(cwd: string = process.cwd()): string {
    const root = findProjectRoot(cwd) || cwd;
    return path.join(root, ".rebase", "cloud.json");
}

/* ═══════════════════════════════════════════════════════════════
   Credentials file model
   ═══════════════════════════════════════════════════════════════

   {
     "current": "https://app.rebase.pro",
     "contexts": {
       "https://app.rebase.pro": { "auth": "<sdk session json>", "org": "42" }
     }
   }
*/

interface CloudContextEntry {
    /** Raw JSON blob the SDK auth module persists (the RebaseSession). */
    auth?: string;
    /** Active organization id for this host, if the user selected one. */
    org?: string;
}

interface CredentialsFile {
    current?: string;
    contexts: Record<string, CloudContextEntry>;
}

function readCredentials(): CredentialsFile {
    try {
        const raw = fs.readFileSync(credentialsPath(), "utf-8");
        const parsed = JSON.parse(raw) as CredentialsFile;
        if (!parsed.contexts) parsed.contexts = {};
        return parsed;
    } catch {
        return { contexts: {} };
    }
}

function writeCredentials(data: CredentialsFile): void {
    const file = credentialsPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Written with private perms — this file holds refresh tokens.
    fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
    try {
        fs.chmodSync(file, 0o600);
    } catch {
        // best effort on platforms without chmod semantics
    }
}

/** Host that a bare `rebase cloud` command should target, if any. */
function currentContextUrl(): string | undefined {
    return readCredentials().current;
}

/** Persist the active organization id for a host. */
export function setContextOrg(url: string, org: string | undefined): void {
    const creds = readCredentials();
    const entry = creds.contexts[url] || {};
    if (org) entry.org = org;
    else delete entry.org;
    creds.contexts[url] = entry;
    writeCredentials(creds);
}

export function getContextOrg(url: string): string | undefined {
    return readCredentials().contexts[url]?.org;
}

/* ═══════════════════════════════════════════════════════════════
   File-backed AuthStorage (per host)
   ═══════════════════════════════════════════════════════════════ */

function createFileAuthStorage(url: string): AuthStorage {
    return {
        getItem(key) {
            if (key !== SDK_SESSION_KEY) return null;
            return readCredentials().contexts[url]?.auth ?? null;
        },
        setItem(key, value) {
            if (key !== SDK_SESSION_KEY) return;
            const creds = readCredentials();
            const entry = creds.contexts[url] || {};
            entry.auth = value;
            creds.contexts[url] = entry;
            if (!creds.current) creds.current = url;
            writeCredentials(creds);
        },
        removeItem(key) {
            if (key !== SDK_SESSION_KEY) return;
            const creds = readCredentials();
            if (creds.contexts[url]) {
                delete creds.contexts[url].auth;
                delete creds.contexts[url].org;
            }
            writeCredentials(creds);
        }
    };
}

/** Mark a host as the active context (called on login). */
export function setCurrentContext(url: string): void {
    const creds = readCredentials();
    creds.current = url;
    if (!creds.contexts[url]) creds.contexts[url] = {};
    writeCredentials(creds);
}

/* ═══════════════════════════════════════════════════════════════
   URL resolution
   ═══════════════════════════════════════════════════════════════

   Priority: --url flag > REBASE_CLOUD_URL env > linked project's url
             > stored current context > default hosted URL.
*/

export function resolveCloudUrl(rawArgs: string[]): string {
    const parsed = arg({ "--url": String }, { argv: rawArgs.slice(2),
permissive: true });
    const explicit = parsed["--url"] || process.env.REBASE_CLOUD_URL;
    if (explicit) return normalizeUrl(explicit);

    const link = readLink();
    if (link?.url) return normalizeUrl(link.url);

    const current = currentContextUrl();
    if (current) return normalizeUrl(current);

    return DEFAULT_CLOUD_URL;
}

function normalizeUrl(url: string): string {
    let u = url.trim().replace(/\/+$/, "");
    if (!/^https?:\/\//.test(u)) u = `https://${u}`;
    return u;
}

/* ═══════════════════════════════════════════════════════════════
   Rebase client factory + auth guard
   ═══════════════════════════════════════════════════════════════ */

export type CloudClient = ReturnType<typeof createRebaseClient>;

/**
 * Build an SDK client bound to a control-plane host, backed by the on-disk
 * credential store. `autoRefresh` is disabled so we never leave a dangling
 * setTimeout that keeps the CLI process alive; token refresh is done on demand
 * by `requireClient`.
 */
export function createCloudClient(url: string): CloudClient {
    return createRebaseClient({
        baseUrl: url,
        // Empty string disables the realtime socket — a short-lived CLI has no
        // use for it, and leaving it on opens a connection (and noisy errors)
        // on every invocation.
        websocketUrl: "",
        auth: {
            storage: createFileAuthStorage(url),
            persistSession: true,
            autoRefresh: false
        }
    });
}

/** Two minutes of head-room before a token is treated as expired. */
const EXPIRY_BUFFER_MS = 120_000;

/**
 * Return an authenticated client for the resolved host, refreshing the access
 * token if it is close to expiry. Exits with a helpful message when there is no
 * usable session (never logged in, or the refresh token was revoked).
 */
export async function requireClient(rawArgs: string[]): Promise<{ client: CloudClient; url: string }> {
    const url = resolveCloudUrl(rawArgs);
    const client = createCloudClient(url);
    const session = client.auth.getSession();

    if (!session || !session.accessToken) {
        fail(
            `Not logged in to ${chalk.cyan(url)}.`,
            `Run ${chalk.bold("rebase cloud login")} first.`
        );
    }

    if (session.expiresAt <= Date.now() + EXPIRY_BUFFER_MS) {
        try {
            await client.auth.refreshSession();
        } catch {
            fail(
                `Your session for ${chalk.cyan(url)} has expired.`,
                `Run ${chalk.bold("rebase cloud login")} to sign in again.`
            );
        }
    }

    return { client,
url };
}

/* ═══════════════════════════════════════════════════════════════
   Platform configuration
   ═══════════════════════════════════════════════════════════════ */

/** One place a deploy can actually land, as the control plane describes it. */
export interface DeployTarget {
    clusterId?: string | null;
    provider: string;
    region?: string;
    label?: string;
    baseDomain?: string;
}

export interface PlatformConfig {
    tenantBaseDomain?: string;
    deployTargets?: DeployTarget[];
}

/**
 * The control plane's public, non-secret self-description (`platform-config`).
 *
 * None of it is knowable from the CLI side: it is per-deployment configuration —
 * production serves tenants at `rebase.website` on GKE, a dev control plane at
 * `localhost` on Docker. Guessing produced two separate lies: a congratulation
 * URL that resolved nowhere near the app, and a `provider` the project does not
 * run on (see `createProject`).
 *
 * Cached per host for the process: it is fixed for a control plane's lifetime,
 * and `projects list` formats one host per row off a single fetch.
 *
 * @returns the config, or `undefined` if the control plane doesn't serve
 *   `platform-config` (an older deployment) or the request failed. A failure is
 *   cached too — a short-lived CLI should not retry once per row. Note the
 *   distinction callers rely on: `undefined` means "this control plane cannot
 *   tell us", whereas `deployTargets: []` is a control plane stating that it has
 *   no infrastructure configured.
 */
const platformConfigCache = new Map<string, Promise<PlatformConfig | undefined>>();

export function fetchPlatformConfig(client: CloudClient, url: string): Promise<PlatformConfig | undefined> {
    let pending = platformConfigCache.get(url);
    if (!pending) {
        pending = client.functions
            .invoke<PlatformConfig>("platform-config", undefined, { method: "GET" })
            .then((cfg) => cfg ?? undefined)
            .catch(() => undefined);
        platformConfigCache.set(url, pending);
    }
    return pending;
}

/**
 * The base domain tenant projects are served at, derived from the same
 * TENANT_BASE_DOMAIN the ingress and the console read (see
 * saas/backend/src/utils/tenant-domain.ts).
 */
export function fetchTenantBaseDomain(client: CloudClient, url: string): Promise<string | undefined> {
    return fetchPlatformConfig(client, url).then((cfg) => cfg?.tenantBaseDomain?.trim() || undefined);
}

/**
 * The infrastructure a deploy for this control plane would ACTUALLY use, in the
 * resolver's own preference order (saas/backend/src/k8s/resolve.ts).
 *
 * @returns the targets, or `undefined` when the control plane cannot say.
 */
export function fetchDeployTargets(client: CloudClient, url: string): Promise<DeployTarget[] | undefined> {
    return fetchPlatformConfig(client, url).then((cfg) =>
        Array.isArray(cfg?.deployTargets) ? cfg.deployTargets : undefined
    );
}

/**
 * Public host for a project — `<subdomain>.<base>`, or the bare subdomain when
 * the base domain is unknown.
 *
 * It deliberately never falls back to a guessed domain. The user copies this
 * string into a browser, so a plausible-but-wrong hostname is worse than an
 * obviously incomplete one: `acme.rebase.pro` looks reachable and isn't, while
 * `acme` reads as "the subdomain is acme" and prompts no wasted debugging.
 */
export function formatTenantHost(
    subdomain: string | undefined,
    baseDomain: string | undefined
): string | undefined {
    if (!subdomain) return undefined;
    return baseDomain ? `${subdomain}.${baseDomain}` : subdomain;
}

/** The fields of a project row this module needs to render a host. */
export interface HostableProject {
    subdomain?: string;
    /** Resolved server-side; absent on control planes older than the host hook. */
    host?: string;
}

/**
 * The host to display for a project.
 *
 * Prefers `host` off the record: the control plane resolves it through the same
 * `tenantHost()` the ingress uses, so it accounts for the project's *cluster*
 * base domain. The CLI cannot compute that itself — `clusters` is admin-only
 * under RLS, so a normal user's token cannot read `baseDomain`, and a project on
 * a second cluster is served somewhere the platform default does not name.
 *
 * `baseDomain` (from `platform-config`) remains the fallback for a control plane
 * that predates the hook — right for the single-cluster case, which is every
 * project today.
 */
export function projectHost(
    project: HostableProject,
    baseDomain: string | undefined
): string | undefined {
    return project.host || formatTenantHost(project.subdomain, baseDomain);
}

/* ═══════════════════════════════════════════════════════════════
   Project link file (.rebase/cloud.json)
   ═══════════════════════════════════════════════════════════════ */

export interface ProjectLink {
    url: string;
    projectId: string;
    /** The project's subdomain — the slug users see in console URLs and type into --project. */
    slug?: string;
    projectName?: string;
    orgId?: string;
    /**
     * Base URL of the project's own API.
     *
     * For a cloud project this is a convenience derived from the subdomain. For
     * a **self-hosted** project it is the entire link: there is no control plane
     * to look anything up in, so `projectId` is empty and this is what commands
     * resolve against.
     *
     * Keeping both kinds of link in one file is deliberate. A second link file
     * for self-hosting would fork every command that reads one, and the tooling
     * would drift into being cloud-only by accident.
     */
    apiUrl?: string;
    /**
     * How this checkout is linked. Absent means `cloud` — which is every link
     * written before this field existed.
     */
    mode?: "cloud" | "direct";
}

export function readLink(cwd: string = process.cwd()): ProjectLink | null {
    try {
        return JSON.parse(fs.readFileSync(projectLinkPath(cwd), "utf-8")) as ProjectLink;
    } catch {
        return null;
    }
}

export function writeLink(link: ProjectLink, cwd: string = process.cwd()): void {
    const file = projectLinkPath(cwd);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(link, null, 2));
}

export function removeLink(cwd: string = process.cwd()): boolean {
    const file = projectLinkPath(cwd);
    if (fs.existsSync(file)) {
        fs.rmSync(file);
        return true;
    }
    return false;
}

/**
 * Flags that may appear anywhere on a `rebase cloud` line, including *before*
 * the resource group.
 *
 * They have to be declared wherever positionals are resolved, because `arg`'s
 * `permissive: true` does not merely tolerate an undeclared flag — it pushes it
 * into `_` alongside the positionals, and for a flag that takes a value it
 * pushes the value in too. So `cloud --project acme storage create` parsed
 * without this spec yields `_` of `["--project", "acme", "storage", "create"]`,
 * and the group reads as `"acme"`: a real project name, in the group position,
 * dispatching to nothing. Skipping tokens that start with `-` does not save you
 * there — the damage is the orphaned value, which looks exactly like a
 * positional.
 *
 * Only genuinely global flags belong here. Group-specific ones (`--bucket`,
 * `--region`, …) are declared by the handler that owns them and always follow
 * the group, so they cannot shift the group or action.
 *
 * `-p` is `--project` in eighteen places and `--password` in `login`. That
 * ambiguity does not matter to the one caller that reads this spec: it resolves
 * positionals and never looks at a flag's value, so all it needs to know is
 * that `-p` takes one. Anything that wants the value must keep declaring it
 * itself, with the meaning its own command gives it.
 */
export const GLOBAL_CLOUD_FLAGS = {
    "--json": Boolean,
    "--yes": Boolean,
    "--help": Boolean,
    "--project": String,
    "-p": "--project",
    "-y": "--yes",
    "-h": "--help"
} as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The raw project reference to operate on: explicit `--project` flag wins,
 * otherwise the linked project. Exits with guidance when neither is present.
 * The value is a slug (the project's subdomain, as shown in console URLs) or,
 * for old scripts and link files, a raw project UUID.
 */
export function requireProjectRef(rawArgs: string[]): string {
    const parsed = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    if (parsed["--project"]) return parsed["--project"];
    const link = readLink();
    if (link?.projectId) return link.projectId;
    fail(
        "No project specified and this directory is not linked.",
        `Pass ${chalk.bold("--project <slug>")} or run ${chalk.bold("rebase cloud link")}.`
    );
}

/**
 * Resolve a project reference — slug or UUID — to the internal id the API
 * takes, or undefined when no such project is visible. Slugs cost one lookup;
 * UUIDs pass through untouched so linked directories and old scripts skip the
 * round-trip.
 */
export async function lookupProjectId(ref: string, client: CloudClient): Promise<string | undefined> {
    if (UUID_RE.test(ref)) return ref;
    const res = await client.data.collection("projects").find({
        where: { subdomain: ["==", ref] },
        limit: 1
    });
    const row = res.data[0] as { id?: string | number } | undefined;
    return row?.id === undefined ? undefined : String(row.id);
}

/** Like `lookupProjectId`, but exits with guidance when the ref matches nothing. */
export async function resolveProjectRef(ref: string, client: CloudClient): Promise<string> {
    const id = await lookupProjectId(ref, client);
    if (id === undefined) {
        fail(
            `No project with slug ${chalk.bold(ref)}.`,
            `List yours with ${chalk.bold("rebase cloud projects")}.`
        );
    }
    return id;
}

/** `requireProjectRef` + `resolveProjectRef` in one step. */
export async function requireProject(rawArgs: string[], client: CloudClient): Promise<string> {
    return resolveProjectRef(requireProjectRef(rawArgs), client);
}

/**
 * The project reference to SHOW: the slug the user typed or the linked slug.
 * Never resolves — for human output only. Old link files predate `slug` and
 * fall back to the stored id.
 */
export function displayProjectRef(rawArgs: string[]): string {
    const parsed = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    if (parsed["--project"]) return parsed["--project"];
    const link = readLink();
    return link?.slug || link?.projectId || "";
}

/* ═══════════════════════════════════════════════════════════════
   Machine-readable output mode
   ═══════════════════════════════════════════════════════════════

   Rebase is built for agents, and the CLI is their primary interface. An agent
   must never scrape a colorized table, so every cloud command can emit a single
   JSON value instead of human output.

   JSON mode is on when ANY of these hold:
     • `--json` was passed,
     • `REBASE_JSON=1` is set, or
     • stdout is not a TTY (piped/redirected — i.e. a program is reading it).

   In JSON mode a command prints exactly one JSON value to stdout and nothing
   else; errors print `{"error":{...}}` and exit non-zero. The mode is a
   process-global set once, at dispatch, by `initOutputMode` — every helper here
   (fail, reportError, emit) reads it so the whole family is consistent.
*/

let JSON_MODE = false;

/**
 * Resolve and latch the output mode for this invocation. Call once at the top of
 * `cloudCommand`, before anything can print or `fail`. Returns the resolved mode
 * (handy for tests, which otherwise leave it at its `false` default).
 */
export function initOutputMode(rawArgs: string[]): boolean {
    const parsed = arg({ "--json": Boolean }, { argv: rawArgs.slice(2),
permissive: true });
    JSON_MODE =
        Boolean(parsed["--json"]) ||
        process.env.REBASE_JSON === "1" ||
        process.stdout.isTTY !== true;
    return JSON_MODE;
}

/** Whether the current invocation is emitting machine-readable JSON. */
export function isJsonMode(): boolean {
    return JSON_MODE;
}

/** Force the mode (tests only — production latches it via `initOutputMode`). */
export function setJsonModeForTest(value: boolean): void {
    JSON_MODE = value;
}

/** Strip ANSI colour codes — JSON output must never carry terminal escapes. */
// eslint-disable-next-line no-control-regex
const ANSI_RE = /\[[0-9;]*m/g;
function stripAnsi(s: string): string {
    return s.replace(ANSI_RE, "");
}

/**
 * Write one JSON value to stdout, followed by a newline.
 *
 * Indented, because the overwhelmingly common reader is a person or an agent
 * looking at a terminal — JSON mode is entered automatically whenever stdout is
 * not a TTY, so `rebase cloud deployments list` piped anywhere at all produced
 * a project's entire deployment history as one unwrapped line. `JSON.parse`
 * does not care about the whitespace; everything else does.
 */
export function printJson(value: unknown): void {
    process.stdout.write(JSON.stringify(value, null, 2) + "\n");
}

/**
 * The one output primitive every new command uses: in JSON mode emit `json`
 * (and nothing else); otherwise run `human`. Keeping the two behind a single
 * call is what guarantees a command can never print a table AND a JSON blob.
 */
export function emit(human: () => void, json: unknown): void {
    if (JSON_MODE) printJson(json);
    else human();
}

/* ═══════════════════════════════════════════════════════════════
   Output helpers
   ═══════════════════════════════════════════════════════════════ */

/**
 * Print a warning (+ optional hint) — in every output mode, always to stderr.
 *
 * `emit` is for a command's *result*, and JSON mode legitimately replaces the
 * human rendering of one. A warning is not a result: it says the command is
 * about to do something the caller may not have meant, and that is exactly as
 * true when the output is piped. Gating one on `!isJsonMode()` deleted it
 * precisely where nobody was watching the terminal — a `--source` deploy ejected
 * a live project off the managed runtime and said so only to a TTY that wasn't
 * there.
 *
 * stdout carries the JSON value and nothing else, so warnings go to stderr:
 * a machine parser reading stdout cannot be corrupted by one. Only the
 * *formatting* may depend on the mode — colour and indentation for a terminal,
 * plain ASCII otherwise. Whether a warning is emitted at all may not.
 *
 * Anything a caller might branch on belongs in the JSON payload as well; stderr
 * is for whoever reads the transcript afterwards.
 */
export function warn(message: string, hint?: string): void {
    if (JSON_MODE) {
        process.stderr.write(`warning: ${stripAnsi(message)}\n`);
        if (hint) process.stderr.write(`  ${stripAnsi(hint)}\n`);
        return;
    }
    console.error("");
    console.error(chalk.yellow(`  ⚠ ${message}`));
    if (hint) console.error(chalk.gray(`    ${hint}`));
}

/** Print an error (+ optional hint) and exit non-zero. Never returns. */
export function fail(message: string, hint?: string, code?: string): never {
    if (JSON_MODE) {
        printJson({ error: { message: stripAnsi(message),
code: code ?? null,
hint: hint ? stripAnsi(hint) : undefined } });
        process.exit(1);
    }
    console.error("");
    console.error(chalk.red(`  ✗ ${message}`));
    if (hint) console.error(chalk.gray(`  ${hint}`));
    console.error("");
    process.exit(1);
}

/**
 * Confirm a destructive/irreversible action, respecting non-interactive use.
 *
 * With `--yes`/`-y` it proceeds silently. In JSON mode or a non-TTY it REFUSES
 * to prompt — a prompt that can hang is a known repo landmine — and fails,
 * telling the caller to pass `--yes`. Only an interactive terminal gets a real
 * confirm prompt; declining there aborts cleanly (exit 0).
 */
export async function confirmDestructive(opts: { yes: boolean; prompt: string }): Promise<void> {
    if (opts.yes) return;
    if (JSON_MODE || process.stdin.isTTY !== true) {
        fail(
            "This action is destructive and needs confirmation.",
            `Re-run with ${chalk.bold("--yes")} to proceed.`,
            "confirmation_required"
        );
    }
    const { confirmed } = (await inquirer.prompt([
        { type: "confirm",
name: "confirmed",
default: false,
message: opts.prompt }
    ] as unknown as Parameters<typeof inquirer.prompt>[0])) as { confirmed: boolean };
    if (!confirmed) {
        console.log(chalk.gray("  Aborted."));
        process.exit(0);
    }
}

/**
 * Resolve one cloud command's flags and ARGUMENTS from the full `process.argv`.
 *
 * This replaces `cloudPositionals`, which was `rawArgs.slice(3).filter(a =>
 * !a.startsWith("-"))`. Dropping `-`-prefixed tokens looks like it solves the
 * permissive-parse problem and does not: a flag that takes a VALUE leaves the
 * value behind, an ordinary word in the argument position that no filter can
 * tell from a real one. `--project` is the flag every one of these commands
 * documents, so the failure was reachable from the help page:
 *
 *   rebase cloud env unset -p acme            → removed the variable "acme"
 *   rebase cloud env set KEY -p acme          → stored the value "acme"
 *   rebase cloud domains add -p acme          → registered the domain "acme"
 *   rebase cloud webhooks delete -p acme 42   → deleted webhook "acme", not 42
 *   rebase cloud cancel -p acme               → cancelled deployment id "acme"
 *
 * The filter's other half is quieter. A flag nobody declared *is* dropped by
 * it — but only from the operands, never from the run: nothing rejects it, so
 * the command proceeds with the argument missing or defaulted. `db backup
 * --dry-run` listed backups, `domains remove --dry-run` detached the domain,
 * and `env set KEY=v --secrett` stored the value as an ordinary variable that
 * `env reveal` will hand back. The one place an undeclared flag became the
 * argument outright is `projects info|delete`, which resolved its id through
 * `positionals()` instead — that skips only LEADING `-` tokens, so `projects
 * delete --force` looked up a project named "--force".
 *
 * So: parse the whole line strictly, through the same `parseCommandArgs` the
 * non-cloud commands use — `arg` then consumes each declared flag *with its
 * value* wherever it appears, and rejects the undeclared, leaving `_` holding
 * the command words followed by the real arguments. `commandWords` counts from
 * `cloud` itself (`cloud env set` ⇒ 3), and is applied to the parsed
 * positionals, so a flag written before the group shifts nothing.
 *
 * Two things this adds over calling `parseCommandArgs` directly, and the reason
 * it is worth a wrapper:
 *
 *  - `GLOBAL_CLOUD_FLAGS` is merged in. `--json`, `--yes` and `--project` may
 *    appear anywhere on a cloud line including before the group, so a strict
 *    parse that did not declare them would reject the CLI's own documented
 *    usage. (`parseCommandArgs` adds `--debug`/`--help` on top of that.)
 *  - A parse error is reported through `fail`, not thrown. A throw reaches
 *    `bin/rebase.js`, which prints `✗ …` to stderr — which is right for every
 *    other command and wrong here: `rebase cloud` is in JSON mode whenever
 *    stdout is not a TTY, i.e. always for the agents this family is built for,
 *    and it promises them exactly one JSON value. `fail` keeps that promise,
 *    with the same `usage` code the other refusals in this family use.
 */
export function parseCloudArgs<S extends arg.Spec>(opts: {
    spec: S;
    rawArgs: string[];
    commandWords: number;
    /** Names the command in errors, e.g. `cloud env set` (no leading `rebase`). */
    command: string;
    maxPositionals?: number;
}): { flags: arg.Result<S & typeof GLOBAL_CLOUD_FLAGS>; positionals: string[] } {
    const spec = { ...GLOBAL_CLOUD_FLAGS,
...opts.spec };
    try {
        const parsed = parseCommandArgs({ ...opts,
spec });
        return { flags: parsed.flags,
positionals: parsed.positionals };
    } catch (err) {
        fail(err instanceof Error ? err.message : String(err), undefined, "usage");
    }
}

export function success(message: string): void {
    console.log("");
    console.log(chalk.bold.green(`  ✓ ${message}`));
    console.log("");
}

/** Colorize a deployment / resource status token. */
export function colorStatus(status: string | undefined): string {
    switch (status) {
        case "active":
        case "success":
        case "connected":
            return chalk.green(status);
        case "deploying":
        case "provisioning":
        case "pending_billing":
        case "untested":
            return chalk.yellow(status ?? "");
        case "failed":
            return chalk.red(status);
        case "stopped":
            return chalk.gray(status);
        default:
            return chalk.gray(status ?? "unknown");
    }
}

/**
 * Render a two-column key/value block with aligned keys. Empty rows are skipped
 * — including `null`, which the API sends for an unset column and which used to
 * print the literal string "null" (e.g. `Custom domain: null`).
 */
export function keyValues(rows: Array<[string, string | null | undefined]>): void {
    const width = Math.max(...rows.map(([k]) => k.length));
    for (const [k, v] of rows) {
        if (v === undefined || v === null || v === "") continue;
        console.log(`  ${chalk.gray(`${k}:`.padEnd(width + 1))} ${v}`);
    }
}

/**
 * Surface an SDK/HTTP error consistently. The SDK throws RebaseApiError with
 * a `.status` and `.message`; anything else falls back to its string form.
 */
export function reportError(e: unknown, context: string): never {
    const err = e as { status?: number; message?: string; code?: string };
    if (JSON_MODE) {
        printJson({
            error: {
                message: err?.message ? stripAnsi(err.message) : String(e),
                code: err?.code ?? null,
                status: err?.status ?? null,
                context
            }
        });
        process.exit(1);
    }
    const status = err?.status ? ` (${err.status})` : "";
    fail(`${context}${status}: ${err?.message ?? String(e)}`);
}

/**
 * Open a URL in the user's default browser (best effort). Always prints the URL
 * first so it stays usable over SSH or when no browser is available.
 */
export function openUrl(target: string, label = "Opening"): void {
    console.log("");
    console.log(`  ${label} ${chalk.cyan(target)}`);
    console.log("");
    const opener =
        process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    try {
        const child = spawn(opener, [target], {
            stdio: "ignore",
            detached: true,
            shell: process.platform === "win32"
        });
        child.on("error", () => {
            /* URL already printed for manual copy */
        });
        child.unref();
    } catch {
        /* URL already printed */
    }
}
