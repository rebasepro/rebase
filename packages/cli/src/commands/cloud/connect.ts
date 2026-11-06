/**
 * `rebase cloud connect <url>` — add a self-hosted Rebase instance to your
 * Rebase account, so the Rebase connector in Claude reaches it as it reaches
 * every Cloud project.
 *
 * ## What it does
 *
 *  1. Registers the instance's origin with the control plane
 *     (`POST /api/functions/linked-instances`). The control plane answers the
 *     two variables the instance needs to accept the connector's short-lived
 *     tokens: the platform's public key and the audience it signs them for.
 *     Registering is idempotent per organization and origin, so the command
 *     can be rerun any time.
 *  2. Prints those two lines, and offers to write them into `./.env` when
 *     there is one and somebody is at the terminal to say yes.
 *  3. Waits for the instance to accept the connector
 *     (`POST …/linked-instances/:id/check`), which happens once it restarts
 *     with the variables set.
 *
 * `--list` and `--remove` manage what is registered. Nothing here touches the
 * instance itself: the control plane only ever calls it, and only with tokens
 * the instance verifies against the key printed here.
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";
import inquirer from "inquirer";
import { RebaseApiError } from "@rebasepro/client";
import {
    requireClient,
    parseCloudArgs,
    getContextOrg,
    emit,
    fail,
    note,
    noteBlank,
    printJson,
    reportError,
    confirmDestructive,
    isJsonMode,
    success,
    type CloudClient
} from "./context";
import { isMissingRoute } from "./cron";
import { dotenvLine } from "./env";
import { upsertDotenv } from "./init";

/** The control-plane function that holds linked instances. */
export const LINKED_INSTANCES_FUNCTION = "linked-instances";

/** Where the hosted connector lives, for the line that says what to do next. */
export const CONNECTOR_URL = "https://app.rebase.pro/mcp";

/** The two variables the instance reads to accept the connector's tokens. */
export const PLATFORM_TOKEN_KEY_ENV = "REBASE_PLATFORM_TOKEN_KEY";
export const PLATFORM_TOKEN_AUDIENCE_ENV = "REBASE_PLATFORM_TOKEN_AUDIENCE";

/** How often, and for how long, the command asks whether the instance accepts the connector. */
export const CHECK_INTERVAL_MS = 5_000;
export const CHECK_TIMEOUT_MS = 10 * 60_000;

/** The flags `cloud connect` parses — the help page lists exactly these. */
export const CONNECT_FLAGS = {
    "--name": String,
    "--org": String,
    "--list": Boolean,
    "--remove": String,
    "--no-wait": Boolean
};

/** One linked instance, as the control plane answers it. */
export interface LinkedInstance {
    id: string;
    name: string;
    url: string;
    /** An organization id, or the organization itself. */
    organization?: unknown;
    /** When the instance first accepted the connector, or null while it has not. */
    verifiedAt: string | null;
    createdAt?: string;
}

/** What `POST /linked-instances` answers. */
export interface LinkInstanceResponse {
    instance: LinkedInstance;
    env: Record<string, string>;
    created: boolean;
}

/** Why the instance does not accept the connector yet. */
export type CheckFailureReason = "unreachable" | "not_configured" | "rejected";

/** What `POST /linked-instances/:id/check` answers. */
export type CheckResult =
    | { ok: true; instance: LinkedInstance }
    | { ok: false; reason: CheckFailureReason | string; message?: string };

/* ═══════════════════════════════════════════════════════════════
   Reading what the control plane answers
   ═══════════════════════════════════════════════════════════════ */

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLinkedInstance(value: unknown): value is LinkedInstance {
    return isRecord(value)
        && typeof value.id === "string"
        && typeof value.url === "string"
        && (typeof value.name === "string" || value.name === undefined)
        && (typeof value.verifiedAt === "string" || value.verifiedAt === null || value.verifiedAt === undefined);
}

function isLinkResponse(value: unknown): value is LinkInstanceResponse {
    return isRecord(value)
        && isLinkedInstance(value.instance)
        && isRecord(value.env)
        && typeof value.env[PLATFORM_TOKEN_KEY_ENV] === "string"
        && typeof value.env[PLATFORM_TOKEN_AUDIENCE_ENV] === "string";
}

function isCheckResult(value: unknown): value is CheckResult {
    if (!isRecord(value) || typeof value.ok !== "boolean") return false;
    return value.ok ? isLinkedInstance(value.instance) : typeof value.reason === "string";
}

/** The organizations an `organization_required` refusal lists. */
export function organizationsIn(details: unknown): Array<{ id: string; name: string }> {
    if (!isRecord(details) || !Array.isArray(details.organizations)) return [];
    const found: Array<{ id: string; name: string }> = [];
    for (const org of details.organizations) {
        if (!isRecord(org) || (typeof org.id !== "string" && typeof org.id !== "number")) continue;
        found.push({ id: String(org.id), name: typeof org.name === "string" ? org.name : String(org.id) });
    }
    return found;
}

/** An instance's organization, for a reader: its name when the control plane sent one. */
function organizationLabel(organization: unknown): string {
    if (typeof organization === "string" || typeof organization === "number") return String(organization);
    if (isRecord(organization)) {
        if (typeof organization.name === "string") return organization.name;
        if (typeof organization.id === "string" || typeof organization.id === "number") return String(organization.id);
    }
    return "";
}

/* ═══════════════════════════════════════════════════════════════
   The address
   ═══════════════════════════════════════════════════════════════ */

/**
 * The origin of what the person typed: `your-app.com` → `https://your-app.com`,
 * `https://your-app.com/admin?x=1` → `https://your-app.com`. Null when it is
 * not an http(s) address at all.
 */
export function normalizeInstanceUrl(input: string): string | null {
    const trimmed = input.trim();
    if (!trimmed) return null;
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let parsed: URL;
    try {
        parsed = new URL(withScheme);
    } catch {
        return null;
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname) return null;
    return parsed.origin;
}

function requireInstanceUrl(input: string): string {
    const origin = normalizeInstanceUrl(input);
    if (!origin) {
        fail(
            `"${input}" is not an address the connector can reach.`,
            "Pass the instance's public address, e.g. `rebase cloud connect your-app.com`.",
            "invalid_url"
        );
    }
    return origin;
}

/* ═══════════════════════════════════════════════════════════════
   Control-plane calls
   ═══════════════════════════════════════════════════════════════ */

/** Refuse, with what it means here, a call the control plane answered with an error. */
function reportLinkError(e: unknown, context: string): never {
    if (e instanceof RebaseApiError) {
        if (e.status === 404 && isMissingRoute(e.message)) {
            fail(
                "This control plane cannot add self-hosted instances yet.",
                "Cloud projects already reach the connector; self-hosted ones need a newer control plane.",
                "linked_instances_unavailable"
            );
        }
        if (e.code === "invalid_url") {
            fail(e.message || "The control plane refused that address.", "Pass the instance's public https address.", "invalid_url");
        }
        if (e.status === 403 || e.code === "forbidden") {
            fail(
                e.message || "Only an owner or admin of the organization can add instances to it.",
                "Ask an owner or admin of the organization, or pass --org with one you administer.",
                "forbidden"
            );
        }
    }
    reportError(e, context);
}

async function createLink(
    client: CloudClient,
    body: { url: string; name: string; organizationId?: string }
): Promise<LinkInstanceResponse> {
    const res: unknown = await client.functions.invoke<unknown>(LINKED_INSTANCES_FUNCTION, body, { method: "POST" });
    if (!isLinkResponse(res)) {
        fail("The control plane answered without the instance's variables.", undefined, "bad_response");
    }
    return res;
}

/**
 * Register the instance, picking an organization when the account has several
 * and none was named — interactively when somebody can answer, otherwise by
 * listing them and naming `--org`.
 */
async function linkInstance(
    client: CloudClient,
    body: { url: string; name: string; organizationId?: string },
    commandLine: string
): Promise<LinkInstanceResponse> {
    try {
        return await createLink(client, body);
    } catch (e) {
        if (!(e instanceof RebaseApiError) || e.code !== "organization_required") reportLinkError(e, "Failed to add the instance");
        const organizations = organizationsIn(e.details);
        const interactive = !isJsonMode() && process.stdin.isTTY === true;
        if (interactive && organizations.length > 0) {
            const { picked } = await inquirer.prompt<{ picked: string }>([
                {
                    type: "select",
                    name: "picked",
                    message: "You belong to several organizations. Add the instance to which one?",
                    choices: organizations.map(org => ({ name: `${org.name}  ${chalk.gray(org.id)}`, value: org.id }))
                }
            ]);
            try {
                return await createLink(client, { ...body, organizationId: picked });
            } catch (retry) {
                reportLinkError(retry, "Failed to add the instance");
            }
        }
        const message = "You belong to several organizations; say which one the instance belongs to.";
        const hint = `Rerun with --org <id>: ${commandLine} --org ${organizations[0]?.id ?? "<id>"}. ` +
            "`rebase cloud use <org>` makes one the default.";
        if (isJsonMode()) {
            printJson({ error: { message, code: "organization_required", hint, organizations } });
            process.exit(1);
        }
        console.error("");
        console.error(chalk.red(`  ✗ ${message}`));
        console.error("");
        for (const org of organizations) console.error(`    ${chalk.bold(org.id)}  ${org.name}`);
        console.error("");
        console.error(chalk.gray(`  ${hint}`));
        console.error("");
        process.exit(1);
    }
}

/** Ask the control plane whether the instance accepts the connector now. */
export async function checkInstance(client: CloudClient, id: string): Promise<CheckResult> {
    const res: unknown = await client.functions.invoke<unknown>(LINKED_INSTANCES_FUNCTION, undefined, {
        method: "POST",
        path: `${encodeURIComponent(id)}/check`
    });
    if (!isCheckResult(res)) {
        fail("The control plane answered the check with something this CLI cannot read.", undefined, "bad_response");
    }
    return res;
}

/** A check that failed on the way — the control plane briefly down — rather than with an answer. */
function isTransient(e: unknown): boolean {
    return e instanceof RebaseApiError && (e.status === 0 || (e.status !== undefined && e.status >= 500));
}

/** What a failed check means, for the waiting line. */
export function describeCheckFailure(result: { reason: string; message?: string }): string {
    switch (result.reason) {
        case "unreachable":
            return "the control plane cannot reach it yet";
        case "not_configured":
            return "it does not have the variables yet";
        case "rejected":
            return `it refused the connector's token${result.message ? ` (${result.message})` : ""}`;
        default:
            return result.message ?? result.reason;
    }
}

/**
 * Check every `intervalMs` until the instance accepts the connector or
 * `timeoutMs` passes. `onWaiting` hears each refusal, so the caller can keep
 * one status line current.
 */
export async function waitForInstance(
    client: CloudClient,
    id: string,
    opts: {
        intervalMs?: number;
        timeoutMs?: number;
        sleep?: (ms: number) => Promise<void>;
        now?: () => number;
        onWaiting?: (result: { reason: string; message?: string }) => void;
    } = {}
): Promise<CheckResult> {
    const intervalMs = opts.intervalMs ?? CHECK_INTERVAL_MS;
    const timeoutMs = opts.timeoutMs ?? CHECK_TIMEOUT_MS;
    const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
    const now = opts.now ?? Date.now;
    const deadline = now() + timeoutMs;
    let last: CheckResult = { ok: false, reason: "unreachable" };
    for (;;) {
        try {
            last = await checkInstance(client, id);
            if (last.ok) return last;
            opts.onWaiting?.(last);
        } catch (e) {
            if (!isTransient(e)) reportLinkError(e, "Failed to check the instance");
        }
        if (now() + intervalMs > deadline) return last;
        await sleep(intervalMs);
    }
}

/* ═══════════════════════════════════════════════════════════════
   cloud connect <url>
   ═══════════════════════════════════════════════════════════════ */

function connectedLine(name: string): string {
    return `Connected. Ask Claude about ${name} through the Rebase connector (${CONNECTOR_URL}).`;
}

/** Offer to write the two variables into `./.env`, when there is one and somebody to ask. */
async function offerDotenv(env: Record<string, string>, yes: boolean): Promise<string | null> {
    const file = path.resolve(".env");
    if (!fs.existsSync(file) || process.stdin.isTTY !== true || isJsonMode()) return null;
    if (!yes) {
        const { write } = await inquirer.prompt<{ write: boolean }>([
            { type: "confirm", name: "write", default: true, message: "Add them to ./.env?" }
        ]);
        if (!write) return null;
    }
    upsertDotenv(file, PLATFORM_TOKEN_KEY_ENV, env[PLATFORM_TOKEN_KEY_ENV]);
    upsertDotenv(file, PLATFORM_TOKEN_AUDIENCE_ENV, env[PLATFORM_TOKEN_AUDIENCE_ENV]);
    return file;
}

async function connectInstance(rawArgs: string[], input: string, flags: { name?: string; org?: string; noWait: boolean; yes: boolean }): Promise<void> {
    const origin = requireInstanceUrl(input);
    const name = flags.name?.trim() || new URL(origin).hostname;
    const { client, url: controlPlane } = await requireClient(rawArgs);
    const organizationId = flags.org || getContextOrg(controlPlane);

    const linked = await linkInstance(
        client,
        { url: origin, name, ...(organizationId ? { organizationId } : {}) },
        `rebase cloud connect ${input}`
    );
    const instance = linked.instance;
    const shownName = instance.name || name;

    // One check before anything else: an instance that already accepts the
    // connector needs no variables printed and no restart.
    let check: CheckResult | null;
    try {
        check = await checkInstance(client, instance.id);
    } catch (e) {
        if (!isTransient(e)) reportLinkError(e, "Failed to check the instance");
        check = null;
    }

    if (isJsonMode()) {
        printJson({ ...linked, check });
        return;
    }

    if (check?.ok) {
        success(
            instance.verifiedAt
                ? `${instance.url} is already connected to your Rebase account.`
                : `${instance.url} is in your Rebase account and accepts the connector.`
        );
        console.log(`  ${connectedLine(shownName)}`);
        console.log("");
        return;
    }

    const lines = [PLATFORM_TOKEN_KEY_ENV, PLATFORM_TOKEN_AUDIENCE_ENV].map(key =>
        dotenvLine(key, linked.env[key]) ?? `${key}=${linked.env[key]}`);
    console.log("");
    console.log(chalk.bold.green(
        linked.created
            ? `  ✓ Added ${instance.url} to your Rebase account as "${shownName}".`
            : `  ✓ ${instance.url} is already in your Rebase account as "${shownName}".`
    ));
    console.log("");
    console.log("  Set these two variables on that server:");
    console.log("");
    for (const line of lines) console.log(line);
    console.log("");
    console.log("  Then restart it.");
    console.log("");

    const wrote = await offerDotenv(linked.env, flags.yes);
    if (wrote) success(`Set ${PLATFORM_TOKEN_KEY_ENV} and ${PLATFORM_TOKEN_AUDIENCE_ENV} in ${wrote}. Restart the server to load them.`);

    if (flags.noWait) {
        note(`Once it has restarted, ${chalk.bold(`rebase cloud connect ${input}`)} checks the connection.`);
        noteBlank();
        return;
    }

    const waiting = `Waiting for ${instance.url} to accept the connector — restart it with these variables. ` +
        "Ctrl+C to stop; rerun this command any time.";
    const live = process.stderr.isTTY === true;
    if (live) process.stderr.write(`  ${waiting}`);
    else note(waiting);
    const result = await waitForInstance(client, instance.id, {
        onWaiting: (failure) => {
            if (live) process.stderr.write(`\r\x1b[2K  ${waiting} ${chalk.gray(`(${describeCheckFailure(failure)})`)}`);
        }
    });
    if (live) process.stderr.write("\n");

    if (!result.ok) {
        fail(
            `${instance.url} did not accept the connector within ${CHECK_TIMEOUT_MS / 60_000} minutes: ` +
                `${describeCheckFailure(result)}.`,
            `Set the two variables on that server, restart it, then run \`rebase cloud connect ${input}\` again.`,
            "not_connected"
        );
    }
    console.log("");
    console.log(chalk.bold.green(`  ✓ ${connectedLine(shownName)}`));
    console.log("");
}

/* ═══════════════════════════════════════════════════════════════
   cloud connect --list / --remove
   ═══════════════════════════════════════════════════════════════ */

async function listInstances(client: CloudClient): Promise<LinkedInstance[]> {
    let res: unknown;
    try {
        res = await client.functions.invoke<unknown>(LINKED_INSTANCES_FUNCTION, undefined, { method: "GET" });
    } catch (e) {
        reportLinkError(e, "Failed to list linked instances");
    }
    if (!isRecord(res) || !Array.isArray(res.instances)) {
        fail("The control plane answered without a list of instances.", undefined, "bad_response");
    }
    return res.instances.filter(isLinkedInstance);
}

async function listCommand(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const instances = await listInstances(client);
    emit(
        () => {
            console.log("");
            if (instances.length === 0) {
                console.log(chalk.gray("  No self-hosted instances in your Rebase account."));
                console.log(chalk.gray("  Add one with ") + chalk.bold("rebase cloud connect <url>"));
                console.log("");
                return;
            }
            const nameWidth = Math.max(4, ...instances.map(i => (i.name ?? "").length));
            const urlWidth = Math.max(3, ...instances.map(i => i.url.length));
            console.log(chalk.gray(`  ${"NAME".padEnd(nameWidth)}  ${"URL".padEnd(urlWidth)}  ${"STATUS".padEnd(9)}  ORG`));
            for (const instance of instances) {
                const status = instance.verifiedAt ? chalk.green("connected") : chalk.yellow("waiting  ");
                console.log(
                    `  ${chalk.bold((instance.name ?? "").padEnd(nameWidth))}  ${instance.url.padEnd(urlWidth)}  ${status}  ` +
                        chalk.gray(organizationLabel(instance.organization))
                );
            }
            console.log("");
        },
        { instances }
    );
}

async function removeCommand(rawArgs: string[], ref: string, yes: boolean): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const instances = await listInstances(client);
    const origin = normalizeInstanceUrl(ref);
    const target = instances.find(i => i.id === ref)
        ?? (origin ? instances.find(i => normalizeInstanceUrl(i.url) === origin) : undefined);
    if (!target) {
        fail(
            `No linked instance matches "${ref}".`,
            "`rebase cloud connect --list` names them.",
            "not_found"
        );
    }
    await confirmDestructive({
        yes,
        prompt: `Remove ${target.name || target.url} (${target.url}) from your Rebase account? The connector stops reaching it.`
    });
    try {
        await client.functions.invoke<unknown>(LINKED_INSTANCES_FUNCTION, undefined, {
            method: "DELETE",
            path: encodeURIComponent(target.id)
        });
    } catch (e) {
        reportLinkError(e, "Failed to remove the instance");
    }
    success(`Removed ${target.url} from your Rebase account.`);
    emit(() => {}, { deleted: true, instance: target });
}

/* ═══════════════════════════════════════════════════════════════
   Dispatch
   ═══════════════════════════════════════════════════════════════ */

export async function connectCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: CONNECT_FLAGS,
        rawArgs,
        commandWords: 2, // cloud connect
        command: "cloud connect",
        maxPositionals: 1
    });
    const input = positionals[0];
    const list = flags["--list"] === true;
    const remove = flags["--remove"];
    const yes = flags["--yes"] === true;

    if ([list, remove !== undefined, input !== undefined].filter(Boolean).length > 1) {
        fail("Pass one of: an address, --list, or --remove <url-or-id>.", "Run `rebase cloud connect --help`.", "usage");
    }
    if (list) {
        await listCommand(rawArgs);
        return;
    }
    if (remove !== undefined) {
        await removeCommand(rawArgs, remove, yes);
        return;
    }
    if (!input) {
        fail(
            "Name the instance to add: `rebase cloud connect <url>`.",
            "Its public address, e.g. `rebase cloud connect your-app.com`. `--list` shows the ones already added.",
            "usage"
        );
    }
    await connectInstance(rawArgs, input, {
        name: flags["--name"],
        org: flags["--org"],
        noWait: flags["--no-wait"] === true,
        yes
    });
}
