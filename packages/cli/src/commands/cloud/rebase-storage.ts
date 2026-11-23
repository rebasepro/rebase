/**
 * `rebase cloud storage` for Rebase Storage: the platform's own S3-compatible
 * object storage, billed per GB-month over an included allowance.
 *
 * Everything here talks to the control-plane function `rebase-storage`:
 *
 *   GET    <projectId>                       endpoint, buckets, keys, usage, pricing
 *   POST   <projectId>/buckets               create a bucket (names are global)
 *   DELETE <projectId>/buckets/<bucket>
 *   PUT    <projectId>/buckets/<bucket>/cors
 *   POST   <projectId>/keys                  the secret is returned ONCE
 *   POST   <projectId>/keys/<key>/rotate     a new secret, once
 *   DELETE <projectId>/keys/<key>
 *   PUT    <projectId>/limit                 the cap, which decides the bill
 *   GET    <projectId>/usage                 daily traffic
 *   POST   <projectId>/imports               a platform-run copy from another bucket
 *   GET    <projectId>/imports/<importId>
 *
 * `storage list`, `storage create` and `storage attach` stay in `resources.ts`:
 * the listing folds this overview in, and `create` without a bucket name is the
 * older platform-managed provisioning, deprecated in favour of the bucket form.
 */
import fs from "fs";
import arg from "arg";
import chalk from "chalk";
import inquirer from "inquirer";
import {
    GLOBAL_CLOUD_FLAGS,
    confirmDestructive,
    displayProjectRef,
    emit,
    fail,
    isJsonMode,
    keyValues,
    note,
    noteBlank,
    parseCloudArgs,
    requireClient,
    requireKnownAction,
    requireProject,
    success,
    warn,
    type CloudClient
} from "./context";
import { reportCallError, isRouteNotServed, type Unserved } from "./not-served";
import { fmtDate } from "./projects";
import { formatBytes } from "../storage";

/* ─── the wire ─────────────────────────────────────────────────── */

export interface StorageCorsRule {
    allowedOrigins: string[];
    allowedMethods: string[];
    allowedHeaders?: string[];
    exposeHeaders?: string[];
    maxAgeSeconds?: number;
}

export interface StorageBucket {
    id: string;
    name: string;
    createdAt: string;
    cors: StorageCorsRule[] | null;
}

export interface StorageKey {
    id: string;
    name: string;
    accessKeyId: string;
    permission: "read" | "read-write";
    bucket: string | null;
    managed: boolean;
    createdAt: string;
    lastUsedAt: string | null;
}

export interface StorageUsage {
    capBytes: number;
    currentBytes: number | null;
    currentObjects: number | null;
    estimatedBytes: number;
    noncurrentBytes: number | null;
    measuredAt: string | null;
    egressBytesTotal: number;
}

export interface StoragePricing {
    includedBytes: number;
    overagePerGbMonthEur: number;
    billsCurrentVersionsOnly: boolean;
    softDeleteDays: number;
    egress: { fairUseGbPerMonth: number; reservedRateEurPerGb: number; billed: boolean };
}

export interface StorageOverview {
    endpoint: string;
    region: string;
    buckets: StorageBucket[];
    keys: StorageKey[];
    usage: StorageUsage;
    limits: { defaultCapBytes: number; maxCapBytes: number };
    pricing: StoragePricing;
}

/** A key as it is issued: the one response that carries its secret. */
export interface IssuedStorageKey {
    id: string;
    name: string;
    accessKeyId: string;
    secretAccessKey: string;
    permission: "read" | "read-write";
    bucket?: string | null;
    endpoint: string;
    region: string;
}

interface UsageDay {
    day: string;
    requests: number;
    egressBytes: number;
    ingressBytes: number;
    currentBytes: number | null;
}

export const IMPORT_STATUSES = ["queued", "copying", "verifying", "switching", "done", "failed"] as const;
export type StorageImportStatus = typeof IMPORT_STATUSES[number];

export interface StorageImportState {
    status: StorageImportStatus;
    copiedObjects: number;
    copiedBytes: number;
    totalObjects?: number;
    message?: string;
}

/** Bytes per GB as the control plane bills them (binary, like its rate card). */
export const GB = 1024 ** 3;

type Method = "GET" | "POST" | "PUT" | "DELETE";

function call<T>(client: CloudClient, method: Method, path: string, body?: unknown): Promise<T> {
    // The project id and everything after it are a SUB-PATH: `invoke` refuses a
    // function name carrying a `/`.
    return client.functions.invoke<T>("rebase-storage", body, { method, path });
}

function statusOf(error: unknown): number | undefined {
    if (typeof error !== "object" || error === null || !("status" in error)) return undefined;
    return typeof error.status === "number" ? error.status : undefined;
}

function messageOf(error: unknown): string {
    if (error instanceof Error) return error.message;
    return String(error);
}

const UNSERVED: Unserved = {
    what: "Rebase Storage",
    hint: "This control plane is older than the CLI. `rebase cloud storage attach` points the project at a bucket you own."
};

const NOT_CONFIGURED_HINT =
    "`rebase cloud storage attach` points the project at an S3-compatible bucket you own instead.";

/** Report a failed `rebase-storage` call: 501 is `not_configured`, a missing route `not_served`. */
function storageError(error: unknown, context: string): never {
    if (statusOf(error) === 501) {
        fail("Rebase Storage is not available on this platform yet.", NOT_CONFIGURED_HINT, "not_configured");
    }
    reportCallError(error, context, UNSERVED);
}

/**
 * The overview, or why there is none — for the listing, which still has the
 * project's attached buckets to show when Rebase Storage is not there.
 */
export async function fetchStorageOverview(
    client: CloudClient,
    projectId: string
): Promise<{ overview: StorageOverview } | { unavailable: "not_configured" | "not_served" | "error"; message: string }> {
    try {
        return { overview: await call<StorageOverview>(client, "GET", projectId) };
    } catch (error) {
        if (statusOf(error) === 501) return { unavailable: "not_configured", message: "Rebase Storage is not available on this platform yet." };
        if (isRouteNotServed(error)) return { unavailable: "not_served", message: "This control plane does not serve Rebase Storage yet." };
        return { unavailable: "error", message: messageOf(error) };
    }
}

/* ─── money and sizes ──────────────────────────────────────────── */

/** What a month at `bytes` costs: nothing up to the allowance, the rate per GB over it. */
export function monthlyCostEur(bytes: number, pricing: StoragePricing): number {
    const overGb = Math.max(0, (bytes - pricing.includedBytes) / GB);
    return overGb * pricing.overagePerGbMonthEur;
}

export function formatEur(amount: number): string {
    return `€${amount.toFixed(2)}`;
}

function formatGb(bytes: number): string {
    const gb = bytes / GB;
    return `${Number.isInteger(gb) ? gb : gb.toFixed(1)} GB`;
}

function percentOf(part: number, whole: number): string {
    if (whole <= 0) return "—";
    const pct = (part / whole) * 100;
    return `${pct < 10 ? pct.toFixed(1) : Math.round(pct)}%`;
}

/** Egress this calendar month (UTC), summed from the daily rows. */
export function egressThisMonth(days: UsageDay[], now: Date = new Date()): number {
    const month = now.toISOString().slice(0, 7);
    return days.filter(d => d.day.startsWith(month)).reduce((sum, d) => sum + (d.egressBytes || 0), 0);
}

/* ─── credentials, printed once ────────────────────────────────── */

/** The lines to paste into a `.env`, in the variable names Rebase's storage reads. */
export function s3EnvLines(key: IssuedStorageKey): string[] {
    const lines = [`S3_ENDPOINT=${key.endpoint}`, `S3_REGION=${key.region}`];
    if (key.bucket) lines.push(`S3_BUCKET=${key.bucket}`);
    lines.push(
        `S3_ACCESS_KEY_ID=${key.accessKeyId}`,
        `S3_SECRET_ACCESS_KEY=${key.secretAccessKey}`,
        "S3_FORCE_PATH_STYLE=true"
    );
    return lines;
}

/** An aws-cli line that proves the key works. */
export function awsCliExample(key: IssuedStorageKey): string {
    const target = key.bucket ? `s3://${key.bucket}/ ` : "";
    return `AWS_ACCESS_KEY_ID=${key.accessKeyId} AWS_SECRET_ACCESS_KEY=${key.secretAccessKey} `
        + `aws s3 ls ${target}--endpoint-url ${key.endpoint} --region ${key.region}`;
}

function printIssuedKey(key: IssuedStorageKey, headline: string): void {
    emit(
        () => {
            success(headline);
            keyValues([
                ["Name", key.name],
                ["Key id", key.id],
                ["Access key", key.accessKeyId],
                ["Permission", key.permission === "read" ? "read-only" : "read-write"],
                ["Bucket", key.bucket ?? "every bucket in the project"],
                ["Endpoint", key.endpoint],
                ["Region", key.region]
            ]);
            noteBlank();
            console.log(chalk.yellow.bold("  The secret is shown ONCE. Copy it now: it cannot be displayed again."));
            console.log(chalk.gray("  Lost it? `rebase cloud storage keys rotate " + key.name + "` issues a new one."));
            noteBlank();
            note(chalk.gray("For your .env:"));
            for (const line of s3EnvLines(key)) console.log(`    ${line}`);
            noteBlank();
            note(chalk.gray("Try it with the aws cli:"));
            console.log(`    ${awsCliExample(key)}`);
            noteBlank();
        },
        {
            success: true,
            ...key,
            bucket: key.bucket ?? null,
            env: s3EnvLines(key),
            awsCli: awsCliExample(key),
            warning: "The secret is returned once and cannot be displayed again."
        }
    );
}

/* ─── create <bucket> ──────────────────────────────────────────── */

/** `storage create <bucket>`. Called by `storageCreateCommand` once it has a name. */
export async function storageCreateBucket(rawArgs: string[], name: string): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    let bucket: StorageBucket;
    try {
        bucket = await call<StorageBucket>(client, "POST", `${projectId}/buckets`, { name });
    } catch (error) {
        if (statusOf(error) === 409) {
            fail(
                `A bucket named "${name}" already exists.`,
                "Bucket names are global across Rebase Storage, like S3's: pick another, e.g. one prefixed with your project.",
                "conflict"
            );
        }
        storageError(error, "Failed to create the bucket");
    }
    // The create answer does not carry the endpoint; the overview does. A
    // failure here costs the endpoint line, not the bucket.
    const found = await fetchStorageOverview(client, projectId);
    const overview = "overview" in found ? found.overview : undefined;
    const next = `rebase cloud storage keys create --bucket ${bucket.name}`;
    emit(
        () => {
            success(`Bucket ${bucket.name} created for ${displayProjectRef(rawArgs)}.`);
            keyValues([
                ["Bucket", bucket.name],
                ["Endpoint", overview?.endpoint],
                ["Region", overview?.region]
            ]);
            noteBlank();
            note(chalk.gray("Next, a key to reach it:  ") + chalk.bold(next));
            noteBlank();
        },
        {
            success: true,
            projectId,
            bucket,
            endpoint: overview?.endpoint ?? null,
            region: overview?.region ?? null,
            next
        }
    );
}

/* ─── delete <bucket> ──────────────────────────────────────────── */

export async function storageDeleteBucket(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud storage delete
        command: "cloud storage delete",
        maxPositionals: 1
    });
    const name = positionals[0];
    if (!name) fail("Which bucket?", "Usage: rebase cloud storage delete <bucket> [--yes]", "usage");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    await confirmDestructive({
        yes: Boolean(flags["--yes"]),
        prompt: `Delete bucket "${name}" of ${displayProjectRef(rawArgs)}, and every file in it?`
    });
    let res: { ok?: boolean; deleted?: string; note?: string };
    try {
        res = await call<{ ok?: boolean; deleted?: string; note?: string }>(
            client, "DELETE", `${projectId}/buckets/${encodeURIComponent(name)}`
        );
    } catch (error) {
        storageError(error, "Failed to delete the bucket");
    }
    emit(
        () => {
            success(`Bucket ${res.deleted ?? name} deleted.`);
            if (res.note) note(chalk.gray(res.note));
            noteBlank();
        },
        { success: true, projectId, deleted: res.deleted ?? name, note: res.note ?? null }
    );
}

/* ─── keys ─────────────────────────────────────────────────────── */

/** The action words `rebase cloud storage keys` dispatches. No word means `list`. */
export const STORAGE_KEYS_ACTIONS = ["list", "create", "rotate", "revoke"] as const;

const STORAGE_KEYS_CREATE_FLAGS = { "--name": String, "--read-only": Boolean, "--bucket": String } as const;

/** The word after `storage keys`, read past any flag and its value. */
function keysAction(rawArgs: string[]): string | undefined {
    let words: string[];
    try {
        words = arg({ ...GLOBAL_CLOUD_FLAGS, ...STORAGE_KEYS_CREATE_FLAGS }, { argv: rawArgs.slice(3), permissive: true })._;
    } catch {
        words = arg(GLOBAL_CLOUD_FLAGS, { argv: rawArgs.slice(3), permissive: true })._;
    }
    // storage, keys, <action>
    return words.filter(w => !w.startsWith("-"))[2];
}

export async function storageKeysCommand(rawArgs: string[]): Promise<void> {
    const action = keysAction(rawArgs);
    requireKnownAction("storage keys", action, STORAGE_KEYS_ACTIONS);
    if (action === "create") return storageKeysCreate(rawArgs);
    if (action === "rotate") return storageKeysRotate(rawArgs);
    if (action === "revoke") return storageKeysRevoke(rawArgs);
    return storageKeysList(rawArgs, action === "list");
}

async function storageKeysList(rawArgs: string[], explicit: boolean): Promise<void> {
    parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: explicit ? 4 : 3, // cloud storage keys [list]
        command: "cloud storage keys",
        maxPositionals: 0
    });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    let overview: StorageOverview;
    try {
        overview = await call<StorageOverview>(client, "GET", projectId);
    } catch (error) {
        storageError(error, "Failed to list storage keys");
    }
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  Storage keys — project ${displayProjectRef(rawArgs)}`));
            console.log("");
            printKeys(overview.keys);
            noteBlank();
            note(chalk.gray("New key:  ") + chalk.bold("rebase cloud storage keys create [--read-only] [--bucket <b>]"));
            noteBlank();
        },
        { projectId, endpoint: overview.endpoint, region: overview.region, keys: overview.keys }
    );
}

function printKeys(keys: StorageKey[]): void {
    if (keys.length === 0) {
        console.log(chalk.gray("  No keys yet."));
        return;
    }
    const width = Math.max(...keys.map(k => k.name.length));
    for (const k of keys) {
        const scope = k.bucket ? `bucket ${k.bucket}` : "all buckets";
        const used = k.lastUsedAt ? `used ${fmtDate(k.lastUsedAt)}` : "never used";
        const managed = k.managed ? chalk.gray(" · managed by the platform") : "";
        console.log(`  ${chalk.bold(k.name.padEnd(width))}  ${k.accessKeyId}  ${k.permission === "read" ? "read-only " : "read-write"}  `
            + chalk.gray(`${scope} · ${used}`) + managed);
    }
}

async function storageKeysCreate(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({
        spec: { "--name": String, "--read-only": Boolean, "--bucket": String },
        rawArgs,
        commandWords: 4, // cloud storage keys create
        command: "cloud storage keys create",
        maxPositionals: 0
    });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const body: { name?: string; permission: "read" | "read-write"; bucket?: string } = {
        permission: flags["--read-only"] ? "read" : "read-write"
    };
    if (flags["--name"]?.trim()) body.name = flags["--name"].trim();
    if (flags["--bucket"]?.trim()) body.bucket = flags["--bucket"].trim();
    let key: IssuedStorageKey;
    try {
        key = await call<IssuedStorageKey>(client, "POST", `${projectId}/keys`, body);
    } catch (error) {
        storageError(error, "Failed to create the key");
    }
    printIssuedKey(key, `Key ${key.name} created for ${displayProjectRef(rawArgs)}.`);
}

function requireKey(parsed: { flags: { "--yes"?: boolean }; positionals: string[] }, verb: "rotate" | "revoke"): { key: string; yes: boolean } {
    const key = parsed.positionals[0];
    if (!key) fail("Which key?", `Usage: rebase cloud storage keys ${verb} <key> [--yes]. \`rebase cloud storage keys\` lists them.`, "usage");
    return { key, yes: Boolean(parsed.flags["--yes"]) };
}

async function storageKeysRotate(rawArgs: string[]): Promise<void> {
    const { key, yes } = requireKey(parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 4, // cloud storage keys rotate
        command: "cloud storage keys rotate",
        maxPositionals: 1
    }), "rotate");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    await confirmDestructive({
        yes,
        prompt: `Rotate storage key "${key}"? Its current secret stops working at once.`
    });
    let issued: IssuedStorageKey;
    try {
        issued = await call<IssuedStorageKey>(client, "POST", `${projectId}/keys/${encodeURIComponent(key)}/rotate`);
    } catch (error) {
        storageError(error, "Failed to rotate the key");
    }
    printIssuedKey(issued, `Key ${issued.name} rotated: the old secret no longer works.`);
}

async function storageKeysRevoke(rawArgs: string[]): Promise<void> {
    const { key, yes } = requireKey(parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 4, // cloud storage keys revoke
        command: "cloud storage keys revoke",
        maxPositionals: 1
    }), "revoke");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    await confirmDestructive({
        yes,
        prompt: `Revoke storage key "${key}"? Anything using it loses access at once.`
    });
    try {
        await call<{ ok?: boolean }>(client, "DELETE", `${projectId}/keys/${encodeURIComponent(key)}`);
    } catch (error) {
        storageError(error, "Failed to revoke the key");
    }
    emit(
        () => {
            success(`Key ${key} revoked.`);
            noteBlank();
        },
        { success: true, projectId, revoked: key }
    );
}

/* ─── usage ────────────────────────────────────────────────────── */

export async function storageUsageCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud storage usage
        command: "cloud storage usage",
        maxPositionals: 0
    });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    let overview: StorageOverview;
    let days: UsageDay[] | null;
    try {
        const [o, u] = await Promise.all([
            call<StorageOverview>(client, "GET", projectId),
            // The daily rows only add this month's egress; without them the
            // figure falls back to the running total, labelled as one.
            call<{ days?: UsageDay[] }>(client, "GET", `${projectId}/usage`).catch(() => null)
        ]);
        overview = o;
        days = u?.days ?? null;
    } catch (error) {
        storageError(error, "Failed to read storage usage");
    }
    const { usage, pricing } = overview;
    const costNow = monthlyCostEur(usage.estimatedBytes, pricing);
    const costAtCap = monthlyCostEur(usage.capBytes, pricing);
    const egressMonth = days ? egressThisMonth(days) : null;
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  Storage usage — project ${displayProjectRef(rawArgs)}`));
            console.log("");
            keyValues([
                ["Stored", `${formatBytes(usage.estimatedBytes)} of a ${formatGb(usage.capBytes)} cap (${percentOf(usage.estimatedBytes, usage.capBytes)})`],
                ["Objects", usage.currentObjects === null ? undefined : String(usage.currentObjects)],
                ["Measured", usage.measuredAt ? fmtDate(usage.measuredAt) : "not measured yet: the figure is an estimate from uploads"],
                ["Included", `${formatGb(pricing.includedBytes)} per month`],
                ["Cost now", `${formatEur(costNow)}/month at current usage (${formatEur(pricing.overagePerGbMonthEur)} per GB-month over ${formatGb(pricing.includedBytes)})`],
                ["At the cap", `${formatEur(costAtCap)}/month`],
                [
                    "Egress",
                    egressMonth === null
                        ? `${formatBytes(usage.egressBytesTotal)} in total`
                        : `${formatBytes(egressMonth)} this month`
                ]
            ]);
            noteBlank();
            note(chalk.gray(pricing.egress.billed
                ? `Egress is billed at ${formatEur(pricing.egress.reservedRateEurPerGb)}/GB.`
                : `Egress is not billed: fair use up to ${pricing.egress.fairUseGbPerMonth} GB a month.`));
            if (pricing.billsCurrentVersionsOnly) {
                note(chalk.gray(`Only current versions are billed; deleted files are kept ${pricing.softDeleteDays} days for recovery.`));
            }
            note(chalk.gray("Change the cap:  ") + chalk.bold("rebase cloud storage limit <GB>"));
            noteBlank();
        },
        {
            projectId,
            usage,
            percentOfCap: usage.capBytes > 0 ? (usage.estimatedBytes / usage.capBytes) * 100 : null,
            monthlyCostEur: Number(costNow.toFixed(2)),
            monthlyCostAtCapEur: Number(costAtCap.toFixed(2)),
            egressBytesThisMonth: egressMonth,
            pricing,
            days
        }
    );
}

/* ─── limit [GB] ───────────────────────────────────────────────── */

export async function storageLimitCommand(rawArgs: string[]): Promise<void> {
    const { positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud storage limit
        command: "cloud storage limit",
        maxPositionals: 1
    });
    const raw = positionals[0];
    let capGb: number | undefined;
    if (raw !== undefined) {
        capGb = Number(raw.replace(/\s*gb$/i, ""));
        if (!Number.isFinite(capGb) || capGb <= 0) {
            fail(`"${raw}" is not a number of gigabytes.`, "Usage: rebase cloud storage limit <GB>, e.g. `limit 50`.", "usage");
        }
    }
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    let overview: StorageOverview;
    try {
        overview = await call<StorageOverview>(client, "GET", projectId);
    } catch (error) {
        storageError(error, "Failed to read the storage cap");
    }

    if (capGb === undefined) {
        const { usage, limits, pricing } = overview;
        emit(
            () => {
                keyValues([
                    ["Cap", formatGb(usage.capBytes)],
                    ["Used", `${formatBytes(usage.estimatedBytes)} (${percentOf(usage.estimatedBytes, usage.capBytes)})`],
                    ["At the cap", `${formatEur(monthlyCostEur(usage.capBytes, pricing))}/month`],
                    ["Highest cap", formatGb(limits.maxCapBytes)]
                ]);
                noteBlank();
                note(chalk.gray("Change it:  ") + chalk.bold("rebase cloud storage limit <GB>"));
                noteBlank();
            },
            {
                projectId,
                capBytes: usage.capBytes,
                estimatedBytes: usage.estimatedBytes,
                maxCapBytes: limits.maxCapBytes,
                monthlyCostAtCapEur: Number(monthlyCostEur(usage.capBytes, pricing).toFixed(2))
            }
        );
        return;
    }

    if (capGb * GB > overview.limits.maxCapBytes) {
        fail(
            `${capGb} GB is above the highest cap, ${formatGb(overview.limits.maxCapBytes)}.`,
            "Ask support for a higher one.",
            "invalid_param"
        );
    }
    let res: { capBytes: number; estimatedBytes: number };
    try {
        res = await call<{ capBytes: number; estimatedBytes: number }>(client, "PUT", `${projectId}/limit`, { capGb });
    } catch (error) {
        storageError(error, "Failed to set the storage cap");
    }
    const costAtCap = monthlyCostEur(res.capBytes, overview.pricing);
    if (res.estimatedBytes > res.capBytes) {
        warn(
            `The new cap is below what the project already stores (${formatBytes(res.estimatedBytes)}).`,
            "Uploads are refused until usage is back under it."
        );
    }
    emit(
        () => {
            success(`Storage cap set to ${formatGb(res.capBytes)}.`);
            keyValues([
                ["Used", `${formatBytes(res.estimatedBytes)} (${percentOf(res.estimatedBytes, res.capBytes)})`],
                ["At the cap", `${formatEur(costAtCap)}/month at most (${formatGb(overview.pricing.includedBytes)} included)`]
            ]);
            noteBlank();
        },
        {
            success: true,
            projectId,
            capBytes: res.capBytes,
            estimatedBytes: res.estimatedBytes,
            monthlyCostAtCapEur: Number(costAtCap.toFixed(2))
        }
    );
}

/* ─── cors <bucket> ────────────────────────────────────────────── */

const CORS_METHODS = ["GET", "HEAD", "PUT", "POST", "DELETE"];

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(v => typeof v === "string");
}

/** Whether a parsed JSON value is one CORS rule in the wire's shape. */
export function isCorsRule(value: unknown): value is StorageCorsRule {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    if (!("allowedOrigins" in value) || !isStringArray(value.allowedOrigins)) return false;
    if (!("allowedMethods" in value) || !isStringArray(value.allowedMethods)) return false;
    if ("allowedHeaders" in value && value.allowedHeaders !== undefined && !isStringArray(value.allowedHeaders)) return false;
    if ("exposeHeaders" in value && value.exposeHeaders !== undefined && !isStringArray(value.exposeHeaders)) return false;
    if ("maxAgeSeconds" in value && value.maxAgeSeconds !== undefined && typeof value.maxAgeSeconds !== "number") return false;
    return true;
}

/** A rules file: an array of rules, or `{ "rules": [...] }`. */
export function parseCorsFile(text: string, file: string): StorageCorsRule[] {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch (error) {
        fail(`${file} is not valid JSON: ${messageOf(error)}`, undefined, "usage");
    }
    const rules = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) && "rules" in parsed
        ? parsed.rules
        : parsed;
    if (!Array.isArray(rules) || !rules.every(isCorsRule)) {
        fail(
            `${file} is not a list of CORS rules.`,
            "Each rule: { \"allowedOrigins\": [\"https://app.example\"], \"allowedMethods\": [\"GET\", \"PUT\"], "
            + "\"allowedHeaders\"?: [...], \"exposeHeaders\"?: [...], \"maxAgeSeconds\"?: 3600 }",
            "usage"
        );
    }
    return rules;
}

export async function storageCorsCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: {
            "--allow-origin": [String],
            "--allow-method": [String],
            "--allow-header": [String],
            "--clear": Boolean,
            "--file": String
        },
        rawArgs,
        commandWords: 3, // cloud storage cors
        command: "cloud storage cors",
        maxPositionals: 1
    });
    const name = positionals[0];
    if (!name) fail("Which bucket?", "Usage: rebase cloud storage cors <bucket> [--allow-origin <o>]... | --file <rules.json> | --clear", "usage");

    const origins = flags["--allow-origin"] ?? [];
    const methods = (flags["--allow-method"] ?? []).map(m => m.toUpperCase());
    const headers = flags["--allow-header"] ?? [];
    const clear = flags["--clear"] === true;
    const file = flags["--file"];
    const modes = [clear, file !== undefined, origins.length > 0].filter(Boolean).length;
    if (modes > 1) {
        fail("Pick one of --clear, --file and --allow-origin.", "Each replaces the bucket's whole rule set.", "usage");
    }
    if (origins.length === 0 && (methods.length > 0 || headers.length > 0)) {
        fail("--allow-method and --allow-header need --allow-origin.", "A rule says which origins it is for.", "usage");
    }
    const unknownMethod = methods.find(m => !CORS_METHODS.includes(m));
    if (unknownMethod) fail(`${unknownMethod} is not a CORS method.`, `One of ${CORS_METHODS.join(", ")}.`, "usage");

    let rules: StorageCorsRule[] | undefined;
    if (clear) rules = [];
    else if (file !== undefined) {
        let text: string;
        try {
            text = fs.readFileSync(file, "utf8");
        } catch (error) {
            fail(`Cannot read ${file}: ${messageOf(error)}`, undefined, "usage");
        }
        rules = parseCorsFile(text, file);
    } else if (origins.length > 0) {
        const rule: StorageCorsRule = { allowedOrigins: origins, allowedMethods: methods.length ? methods : ["GET", "HEAD"] };
        if (headers.length) rule.allowedHeaders = headers;
        rules = [rule];
    }

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    // No rule given: show what the bucket has.
    if (rules === undefined) {
        let overview: StorageOverview;
        try {
            overview = await call<StorageOverview>(client, "GET", projectId);
        } catch (error) {
            storageError(error, "Failed to read the bucket's CORS rules");
        }
        const bucket = overview.buckets.find(b => b.name === name || b.id === name);
        if (!bucket) fail(`No bucket named "${name}" in this project.`, "`rebase cloud storage` lists them.", "not_found");
        emit(() => printCors(bucket.name, bucket.cors ?? []), { projectId, bucket: bucket.name, cors: bucket.cors ?? [] });
        return;
    }

    const cleared = rules.length === 0;
    let res: { id: string; name: string; cors: StorageCorsRule[] | null };
    try {
        res = await call<{ id: string; name: string; cors: StorageCorsRule[] | null }>(
            client, "PUT", `${projectId}/buckets/${encodeURIComponent(name)}/cors`, { rules }
        );
    } catch (error) {
        storageError(error, "Failed to set the bucket's CORS rules");
    }
    emit(
        () => {
            success(cleared ? `CORS rules cleared on ${res.name}.` : `CORS rules set on ${res.name}.`);
            printCors(res.name, res.cors ?? []);
        },
        { success: true, projectId, bucket: res.name, cors: res.cors ?? [] }
    );
}

function printCors(bucket: string, rules: StorageCorsRule[]): void {
    console.log("");
    if (rules.length === 0) {
        note(chalk.gray(`${bucket} has no CORS rules: browsers on other origins cannot read or upload to it directly.`));
        noteBlank();
        return;
    }
    for (const [i, r] of rules.entries()) {
        console.log(`  ${chalk.bold(`Rule ${i + 1}`)}`);
        keyValues([
            ["Origins", r.allowedOrigins.join(", ")],
            ["Methods", r.allowedMethods.join(", ")],
            ["Headers", r.allowedHeaders?.join(", ")],
            ["Expose", r.exposeHeaders?.join(", ")],
            ["Max age", r.maxAgeSeconds === undefined ? undefined : `${r.maxAgeSeconds}s`]
        ]);
    }
    noteBlank();
}

/* ─── import ───────────────────────────────────────────────────── */

/** Where the source secret may come from when `--secret-access-key` is not on the line. */
export const IMPORT_SECRET_VARIABLE = "REBASE_IMPORT_SECRET_ACCESS_KEY";

let importPollMs = 3000;

/** @internal For tests: poll without waiting three seconds a round. */
export function setImportPollMsForTest(ms: number): void {
    importPollMs = ms;
}

/** `s3://bucket/some/prefix` → `{ bucket, prefix }`. */
export function parseS3Url(value: string): { bucket: string; prefix?: string } | undefined {
    const m = /^s3:\/\/([^/]+)(?:\/(.*))?$/.exec(value.trim());
    if (!m || !m[1]) return undefined;
    const prefix = m[2] && m[2].length > 0 ? m[2] : undefined;
    return prefix ? { bucket: m[1], prefix } : { bucket: m[1] };
}

async function readStdin(): Promise<string> {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks).toString("utf8").trim();
}

/** The source bucket's secret: the flag, `-` for stdin, the variable, or a masked prompt. */
async function resolveImportSecret(flag: string | undefined): Promise<string> {
    if (flag === "-") {
        const secret = await readStdin();
        if (!secret) fail("Nothing arrived on stdin for --secret-access-key -.", undefined, "input_required");
        return secret;
    }
    if (flag) return flag;
    const fromVariable = process.env[IMPORT_SECRET_VARIABLE];
    if (fromVariable) return fromVariable;
    if (isJsonMode() || process.stdin.isTTY !== true) {
        fail(
            "The source bucket's secret access key is required, and there is no terminal to ask on.",
            `Set ${IMPORT_SECRET_VARIABLE}, pipe it with \`--secret-access-key -\`, or pass --secret-access-key.`,
            "input_required"
        );
    }
    const answers = await inquirer.prompt([
        { type: "password", name: "secret", message: "Source secret access key:", mask: "•" }
    ]);
    const secret = String(answers.secret ?? "").trim();
    if (!secret) fail("A secret access key is required.", undefined, "input_required");
    return secret;
}

function isImportStatus(value: unknown): value is StorageImportStatus {
    return typeof value === "string" && (IMPORT_STATUSES as readonly string[]).includes(value);
}

function describeImport(state: StorageImportState): string {
    const of = state.totalObjects !== undefined ? `/${state.totalObjects}` : "";
    return `${state.status} · ${state.copiedObjects}${of} objects · ${formatBytes(state.copiedBytes)}`;
}

/** Poll an import until it is `done` or `failed`, printing each change. */
async function followImport(client: CloudClient, projectId: string, importId: string): Promise<StorageImportState> {
    let last = "";
    for (;;) {
        let state: StorageImportState;
        try {
            state = await call<StorageImportState>(client, "GET", `${projectId}/imports/${encodeURIComponent(importId)}`);
        } catch (error) {
            storageError(error, "Failed to read the import's progress");
        }
        const line = describeImport(state);
        if (!isJsonMode() && line !== last) note(chalk.gray(line));
        last = line;
        if (state.status === "done" || state.status === "failed" || !isImportStatus(state.status)) return state;
        await new Promise(resolve => setTimeout(resolve, importPollMs));
    }
}

function reportImportEnd(projectId: string, importId: string, state: StorageImportState): void {
    if (state.status === "failed") {
        fail(`Import ${importId} failed${state.message ? `: ${state.message}` : "."}`, "Nothing was switched over. Fix the cause and start it again.", "import_failed");
    }
    emit(
        () => {
            if (state.status === "done") success(`Import ${importId} done: ${state.copiedObjects} objects, ${formatBytes(state.copiedBytes)}.`);
            else note(`Import ${importId}: ${describeImport(state)}`);
            if (state.message) note(chalk.gray(state.message));
            noteBlank();
        },
        { projectId, importId, ...state }
    );
}

export async function storageImportCommand(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({
        spec: {
            "--from": String,
            "--endpoint": String,
            "--region": String,
            "--access-key-id": String,
            "--secret-access-key": String,
            "--to": String,
            "--switch-app": Boolean,
            "--wait": Boolean,
            "--status": String,
            "--from-app-storage": Boolean
        },
        rawArgs,
        commandWords: 3, // cloud storage import
        command: "cloud storage import",
        maxPositionals: 0
    });
    const wait = flags["--wait"] === true;

    // Following an import already started.
    const statusOfImport = flags["--status"];
    if (statusOfImport !== undefined) {
        const startFlags = ["--from", "--endpoint", "--region", "--access-key-id", "--secret-access-key", "--to", "--switch-app", "--from-app-storage"] as const;
        const stray = startFlags.filter(f => flags[f] !== undefined);
        if (stray.length) fail(`--status reads an import; it does not take ${stray.join(", ")}.`, undefined, "usage");
        const { client } = await requireClient(rawArgs);
        const projectId = await requireProject(rawArgs, client);
        if (wait) {
            reportImportEnd(projectId, statusOfImport, await followImport(client, projectId, statusOfImport));
            return;
        }
        let state: StorageImportState;
        try {
            state = await call<StorageImportState>(client, "GET", `${projectId}/imports/${encodeURIComponent(statusOfImport)}`);
        } catch (error) {
            storageError(error, "Failed to read the import");
        }
        reportImportEnd(projectId, statusOfImport, state);
        return;
    }

    // The project's own current bucket, read with the key the platform already
    // holds for it: nothing to type, nothing secret on the line.
    if (flags["--from-app-storage"] === true) {
        const sourceFlags = ["--from", "--endpoint", "--region", "--access-key-id", "--secret-access-key"] as const;
        const stray = sourceFlags.filter(f => flags[f] !== undefined);
        if (stray.length) fail(`--from-app-storage reads the app's current bucket; it does not take ${stray.join(", ")}.`, undefined, "usage");
        if (!flags["--to"]) fail("Missing --to.", "Run `rebase cloud storage import --help`.", "usage");
        const target = flags["--to"];
        const { client } = await requireClient(rawArgs);
        const projectId = await requireProject(rawArgs, client);
        let started: { importId: string; status: StorageImportStatus };
        try {
            started = await call<{ importId: string; status: StorageImportStatus }>(client, "POST", `${projectId}/imports`, {
                fromCurrentStorage: true,
                bucket: target,
                switchApp: flags["--switch-app"] === true
            });
        } catch (error) {
            storageError(error, "Failed to start the import");
        }
        if (!wait) {
            const follow = `rebase cloud storage import --status ${started.importId} --wait`;
            emit(
                () => {
                    success(`Import ${started.importId} started: the app's current bucket → ${target}.`);
                    note(chalk.gray("Follow it:  ") + chalk.bold(follow));
                },
                { success: true, projectId, importId: started.importId, status: started.status, source: "app-storage", bucket: target, switchApp: flags["--switch-app"] === true, follow }
            );
            return;
        }
        if (!isJsonMode()) success(`Import ${started.importId} started: the app's current bucket → ${target}.`);
        reportImportEnd(projectId, started.importId, await followImport(client, projectId, started.importId));
        return;
    }

    const from = flags["--from"];
    const source = from ? parseS3Url(from) : undefined;
    const missing = [
        !from && "--from",
        !flags["--region"] && "--region",
        !flags["--access-key-id"] && "--access-key-id",
        !flags["--to"] && "--to"
    ].filter((f): f is string => typeof f === "string");
    if (missing.length) {
        fail(`Missing ${missing.join(", ")}.`, "Run `rebase cloud storage import --help`.", "usage");
    }
    if (!source) fail(`--from takes s3://<bucket>[/<prefix>], not "${from}".`, undefined, "usage");
    const region = flags["--region"]!;
    // AWS S3 needs no endpoint on the line: it follows from the region.
    const endpoint = flags["--endpoint"] ?? `https://s3.${region}.amazonaws.com`;
    if (!/^https?:\/\//.test(endpoint)) fail(`--endpoint takes a URL, not "${endpoint}".`, undefined, "usage");
    const accessKeyId = flags["--access-key-id"]!;
    const target = flags["--to"]!;

    const secretAccessKey = await resolveImportSecret(flags["--secret-access-key"]);
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    let started: { importId: string; status: StorageImportStatus };
    try {
        started = await call<{ importId: string; status: StorageImportStatus }>(client, "POST", `${projectId}/imports`, {
            source: { endpoint, region, bucket: source.bucket, accessKeyId, secretAccessKey, ...(source.prefix ? { prefix: source.prefix } : {}) },
            bucket: target,
            switchApp: flags["--switch-app"] === true
        });
    } catch (error) {
        storageError(error, "Failed to start the import");
    }
    // What is echoed back never carries the secret.
    const described = {
        projectId,
        importId: started.importId,
        status: started.status,
        source: { endpoint, region, bucket: source.bucket, prefix: source.prefix ?? null, accessKeyId },
        bucket: target,
        switchApp: flags["--switch-app"] === true
    };

    if (!wait) {
        const follow = `rebase cloud storage import --status ${started.importId} --wait`;
        emit(
            () => {
                success(`Import ${started.importId} started: ${from} → ${target}.`);
                keyValues([["Status", started.status], ["Switch the app", described.switchApp ? "yes, once verified" : "no"]]);
                noteBlank();
                note(chalk.gray("The platform copies it; this terminal can close. Follow it:  ") + chalk.bold(follow));
                noteBlank();
            },
            { success: true, ...described, follow }
        );
        return;
    }

    if (!isJsonMode()) {
        success(`Import ${started.importId} started: ${from} → ${target}.`);
    }
    reportImportEnd(projectId, started.importId, await followImport(client, projectId, started.importId));
}
