/**
 * CLI command: rebase storage <action>
 *
 * Whole-store maintenance through the running backend's `/api/admin/storage`,
 * authenticated with the service key from `.env`.
 *
 * Subcommands:
 *   orphans — Stored files no row names; `--delete` deletes them
 *   move    — Copy a folder of files to another storage source, same keys
 */
import chalk from "chalk";
import readline from "node:readline/promises";
import { RebaseApiError } from "@rebasepro/client";
import { requireProjectRoot, readEnvFile } from "../utils/project";
import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";
import { cliUserAgent } from "../utils/version";
import { describeFailure, requireBackendUrl } from "./api-keys";

/** Everything the switch below dispatches, for the did-you-mean. */
export const STORAGE_SUBCOMMANDS = ["orphans", "move"] as const;

/** The flags `rebase storage orphans` takes. */
export const ORPHANS_FLAGS = {
    "--source": String,
    "--older-than": Number,
    "--delete": Boolean,
    "--yes": Boolean,
    "-y": "--yes",
    "--json": Boolean
} as const;

/** The flags `rebase storage move` takes. */
export const MOVE_FLAGS = {
    "--from": String,
    "--to": String,
    "--prefix": String,
    "--delete-source": Boolean,
    "--json": Boolean
} as const;

/** One stored object, as the backend lists it. */
interface StoredObjectEntry {
    key: string;
    size?: number;
    updated?: string;
}

/** What `GET /admin/storage/orphans` answers. */
export interface OrphanReport {
    storageId: string;
    objects: number;
    orphans: StoredObjectEntry[];
    recent: number;
    scanned: string[];
    unscanned: { collection: string; reason: string }[];
}

interface MovedObject {
    key: string;
    outcome: "copied" | "exists" | "failed";
    deleted?: boolean;
    error?: string;
}

interface Backend {
    baseUrl: string;
    request<T>(method: string, path: string, body?: unknown): Promise<T>;
}

/** The project's backend, holding the service key — the `admin` role, every scope. */
function connect(): Backend {
    const projectRoot = requireProjectRoot();
    const env = readEnvFile(projectRoot);
    const serviceKey = env.SERVICE_KEY || env.REBASE_SERVICE_KEY;
    if (!serviceKey) {
        console.error(chalk.red("✗ REBASE_SERVICE_KEY not found in .env — required for storage maintenance."));
        process.exit(1);
    }
    // Only an address this project recorded or the developer named: the
    // request carries the service key. See `resolveBackendAddress`.
    const baseUrl = requireBackendUrl(env, projectRoot).replace(/\/+$/, "");
    return {
        baseUrl,
        async request<T>(method: string, path: string, body?: unknown): Promise<T> {
            let response: Response;
            try {
                response = await fetch(`${baseUrl}/api/admin/storage${path}`, {
                    method,
                    headers: {
                        "Authorization": `Bearer ${serviceKey}`,
                        "Accept": "application/json",
                        "User-Agent": cliUserAgent(),
                        ...(body === undefined ? {} : { "Content-Type": "application/json" })
                    },
                    ...(body === undefined ? {} : { body: JSON.stringify(body) })
                });
            } catch (error: unknown) {
                throw new RebaseApiError(error instanceof Error ? error.message : String(error), { status: 0, code: "NETWORK_ERROR" });
            }
            const answer: unknown = await response.json().catch(() => undefined);
            if (!response.ok) {
                const error = answer && typeof answer === "object" && "error" in answer && answer.error && typeof answer.error === "object"
                    ? answer.error as { message?: unknown; code?: unknown; details?: unknown }
                    : undefined;
                throw new RebaseApiError(
                    typeof error?.message === "string" ? error.message : `The server answered ${response.status}.`,
                    { status: response.status, code: typeof error?.code === "string" ? error.code : undefined, details: error?.details }
                );
            }
            return (answer as { data: T }).data;
        }
    };
}

function fail(action: string, error: unknown, baseUrl: string): never {
    for (const line of describeFailure(action, error, baseUrl)) {
        console.error(line.startsWith("✗") ? chalk.red(line) : chalk.gray(line));
    }
    if (error instanceof RebaseApiError && error.status === 404 && error.code !== "UNKNOWN_STORAGE_SOURCE") {
        console.error(chalk.gray("  This backend has no storage maintenance routes: they arrived in 0.25, and need storage configured."));
    }
    process.exit(1);
}

/** Bytes, as a person reads them. */
export function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value.toFixed(value < 10 ? 1 : 0)} ${units[unit]}`;
}

/**
 * The lines that describe an orphan scan. Exported so its tests can read them
 * without a server.
 */
export function describeOrphanReport(report: OrphanReport, olderThanHours: number): string[] {
    const lines: string[] = [];
    const bytes = report.orphans.reduce((sum, orphan) => sum + (orphan.size ?? 0), 0);
    lines.push(`  ${report.objects} file(s) in source "${report.storageId}", ${report.scanned.length} collection(s) read.`);
    if (report.orphans.length === 0) {
        lines.push("  No file older than " + `${olderThanHours}h is unused.`);
    } else {
        lines.push(`  ${report.orphans.length} file(s) no row names, ${formatBytes(bytes)}:`);
        for (const orphan of report.orphans) {
            lines.push(`    ${orphan.key}${orphan.size !== undefined ? `  ${formatBytes(orphan.size)}` : ""}${orphan.updated ? `  ${orphan.updated}` : ""}`);
        }
    }
    if (report.recent > 0) {
        const one = report.recent === 1;
        const more = report.orphans.length > 0 ? "more " : "";
        lines.push(`  ${report.recent} ${more}unused ${one ? "file is" : "files are"} left out: ` +
            `${one ? "it is" : "they are"} newer than ${olderThanHours}h, or ${one ? "its" : "their"} age is unknown, ` +
            "and an upload can be saved before the row that names it.");
    }
    for (const entry of report.unscanned) {
        lines.push(`  ⚠ ${entry.collection} could not be read (${entry.reason}): a file only it names is listed above.`);
    }
    return lines;
}

async function confirm(question: string): Promise<boolean> {
    const prompt = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
        return /^y(es)?$/i.test((await prompt.question(question)).trim());
    } finally {
        prompt.close();
    }
}

async function orphans(rawArgs: string[]): Promise<void> {
    const { flags } = parseCommandArgs({ spec: ORPHANS_FLAGS, rawArgs, commandWords: 2, command: "storage orphans", maxPositionals: 0 });
    const olderThan = flags["--older-than"] ?? 24;
    if (!Number.isFinite(olderThan) || olderThan < 0) {
        throw new UsageError("--older-than takes a number of hours, 0 or more.");
    }
    const query = new URLSearchParams({ olderThanHours: String(olderThan) });
    if (flags["--source"]) query.set("storageId", flags["--source"]);
    const backend = connect();

    let report: OrphanReport;
    try {
        report = await backend.request<OrphanReport>("GET", `/orphans?${query}`);
    } catch (error: unknown) {
        fail("Failed to scan storage", error, backend.baseUrl);
    }

    if (!flags["--delete"]) {
        if (flags["--json"]) {
            console.log(JSON.stringify(report, null, 2));
            return;
        }
        console.log("");
        for (const line of describeOrphanReport(report, olderThan)) console.log(line);
        if (report.orphans.length > 0) {
            console.log("");
            console.log(chalk.gray("  Nothing was deleted. Run again with --delete to delete them."));
        }
        console.log("");
        return;
    }

    if (!flags["--json"]) {
        console.log("");
        for (const line of describeOrphanReport(report, olderThan)) console.log(line);
        console.log("");
    }
    if (report.orphans.length === 0) return;
    if (report.unscanned.length > 0) {
        console.error(chalk.red("✗ Not deleting: some collections could not be read, so a file they name would look unused."));
        process.exit(1);
    }
    if (!flags["--yes"]) {
        if (!process.stdin.isTTY) {
            throw new UsageError("--delete deletes files for good; pass --yes to confirm when there is no terminal to ask.");
        }
        if (!await confirm(`  Delete these ${report.orphans.length} file(s) for good? [y/N] `)) {
            console.log(chalk.gray("  Nothing was deleted."));
            return;
        }
    }

    let result: { deleted: string[]; failed: { key: string; error: string }[] };
    try {
        // The server finds them again before it deletes: a file a row has
        // named since the list was printed is not deleted.
        result = await backend.request("DELETE", `/orphans?${query}`);
    } catch (error: unknown) {
        fail("Failed to delete unused files", error, backend.baseUrl);
    }
    if (flags["--json"]) {
        console.log(JSON.stringify(result, null, 2));
    } else {
        console.log(chalk.green(`  ✓ Deleted ${result.deleted.length} file(s).`));
        for (const failure of result.failed) console.error(chalk.red(`  ✗ ${failure.key}: ${failure.error}`));
        console.log("");
    }
    if (result.failed.length > 0) process.exitCode = 1;
}

async function move(rawArgs: string[]): Promise<void> {
    const { flags } = parseCommandArgs({ spec: MOVE_FLAGS, rawArgs, commandWords: 2, command: "storage move", maxPositionals: 0 });
    const from = flags["--from"];
    const to = flags["--to"];
    if (!from && !to) {
        throw new UsageError("Name the sources: --from <source> --to <source>. The default source is \"(default)\", and either may be left out for it.");
    }
    const backend = connect();
    const counts = { copied: 0, exists: 0, failed: 0, deleted: 0 };
    const failures: MovedObject[] = [];
    let cursor: string | undefined;
    do {
        let page: { moved: MovedObject[]; cursor?: string };
        try {
            page = await backend.request("POST", "/move", {
                from,
                to,
                prefix: flags["--prefix"],
                cursor,
                deleteSource: flags["--delete-source"] === true
            });
        } catch (error: unknown) {
            fail("Failed to move files", error, backend.baseUrl);
        }
        for (const object of page.moved) {
            counts[object.outcome]++;
            if (object.deleted) counts.deleted++;
            if (object.outcome === "failed") failures.push(object);
        }
        if (!flags["--json"] && process.stdout.isTTY) {
            process.stdout.write(`\r  ${counts.copied} copied, ${counts.exists} already there, ${counts.failed} failed…`);
        }
        cursor = page.cursor;
    } while (cursor);

    // The source listed again, by a walk of its own: a move reports what its
    // walk saw, and a walk that skipped files once reported success over the
    // half it moved.
    const verified = await listLeftBehind(backend, {
        from,
        to,
        prefix: flags["--prefix"],
        deleteSource: flags["--delete-source"] === true
    }, flags["--json"] === true);
    const reported = new Set(failures.map(failure => failure.key));
    const leftBehind = verified?.filter(entry => !reported.has(entry.key)) ?? [];

    if (flags["--json"]) {
        console.log(JSON.stringify({ ...counts, failures, verified: verified !== undefined, notMoved: verified ?? [] }, null, 2));
    } else {
        if (process.stdout.isTTY) process.stdout.write("\n");
        console.log(chalk.green(`  ✓ ${counts.copied} copied, ${counts.exists} already there` +
            `${flags["--delete-source"] ? `, ${counts.deleted} deleted from the source` : ""}.`));
        for (const failure of failures) console.error(chalk.red(`  ✗ ${failure.key}: ${failure.error ?? "failed"}`));
        if (verified === undefined) {
            console.log(chalk.gray("  This backend cannot list the source again (it needs a backend newer than 0.25.1), so the CLI did not check for files the move left behind."));
        } else if (leftBehind.length > 0) {
            console.error(chalk.red(`  ✗ Listed again, the source holds ${leftBehind.length} more file(s) the move did not report: ${leftBehind.length} file(s) were not moved.`));
            for (const entry of leftBehind) console.error(chalk.red(`    ${entry.key}: ${entry.reason}`));
            console.error(chalk.gray("  Run the same move again to pick them up."));
        }
        if (counts.copied + counts.exists > 0 && !flags["--delete-source"]) {
            console.log(chalk.gray("  The source keeps its copies. Point the property at the new source, then run again with --delete-source."));
        }
    }
    if (failures.length > 0 || leftBehind.length > 0) process.exitCode = 1;
}

/**
 * Every file under the moved folder the move did not move, read by the
 * backend's `/move/verify` — or `undefined` from a backend without it.
 */
async function listLeftBehind(
    backend: Backend,
    request: { from?: string; to?: string; prefix?: string; deleteSource: boolean },
    quiet: boolean
): Promise<{ key: string; reason: string }[] | undefined> {
    const notMoved: { key: string; reason: string }[] = [];
    let cursor: string | undefined;
    let checked = 0;
    do {
        let page: { checked: number; notMoved: { key: string; reason: string }[]; cursor?: string };
        try {
            page = await backend.request("POST", "/move/verify", { ...request, ...(cursor ? { cursor } : {}), limit: 500 });
        } catch (error: unknown) {
            if (error instanceof RebaseApiError && error.status === 404 && error.code !== "UNKNOWN_STORAGE_SOURCE") return undefined;
            fail("Failed to list the source again after the move", error, backend.baseUrl);
        }
        checked += page.checked;
        notMoved.push(...page.notMoved);
        if (!quiet && process.stdout.isTTY) {
            process.stdout.write(`\r  Checking the source again: ${checked} file(s) listed…`);
        }
        cursor = page.cursor;
    } while (cursor);
    return notMoved;
}

export async function storageCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    if (!subcommand || subcommand === "--help" || wantsHelp(rawArgs)) {
        printStorageHelp();
        return;
    }
    switch (subcommand) {
        case "orphans":
            await orphans(rawArgs);
            break;
        case "move":
            await move(rawArgs);
            break;
        default:
            unknownCommand(subcommand, STORAGE_SUBCOMMANDS, "storage");
    }
}

function printStorageHelp(): void {
    console.log(`
${chalk.bold("rebase storage")} — Maintain stored files, through the running backend

${chalk.green.bold("Usage")}
  rebase storage ${chalk.blue("<command>")} [options]

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("orphans")}           List the stored files no row names
  ${chalk.blue.bold("move")}              Copy a folder of files to another storage source, same keys

${chalk.green.bold("orphans Options")}
  ${chalk.blue("--source")}          Storage source key ${chalk.gray("(default: the default source)")}
  ${chalk.blue("--older-than")}      Hours a file must be old to count ${chalk.gray("(default: 24)")}
  ${chalk.blue("--delete")}          Delete them, after asking
  ${chalk.blue("--yes, -y")}         Do not ask ${chalk.gray("(required with --delete when there is no terminal)")}
  ${chalk.blue("--json")}            Print the report as JSON

${chalk.green.bold("move Options")}
  ${chalk.blue("--from")}            Source to copy from ${chalk.gray("(default: the default source)")}
  ${chalk.blue("--to")}              Source to copy to ${chalk.gray("(default: the default source)")}
  ${chalk.blue("--prefix")}          Folder to copy ${chalk.gray("(default: everything)")}
  ${chalk.blue("--delete-source")}   Delete each file from the source once the target holds it
  ${chalk.blue("--json")}            Print the counts as JSON

${chalk.green.bold("Notes")}
  A file is unused when no string in any row of any collection names it —
  a key, a URL, a ${chalk.blue("rebase-storage:")} reference in text — whatever property
  or source holds it. Files newer than ${chalk.blue("--older-than")} are left out: the admin
  panel uploads a file before the row that names it is saved. Files your own
  tables name, outside collections, are not seen: check before deleting.

  Both read ${chalk.blue("REBASE_SERVICE_KEY")} from .env and need the backend running.
`);
}
