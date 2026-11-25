/**
 * CLI command: rebase logs
 *
 * A running server's request and application log — the in-memory ring buffer
 * the Studio Logs Explorer reads, through `/api/admin/logs` — once, or followed
 * live (`-f`, over the route's server-sent events). The buffer is one process's:
 * the `rebase dev` backend, or the one instance `--url` reaches.
 *
 * On a Rebase Cloud project this hands over to `rebase cloud logs --runtime`,
 * which reads every replica's output through the control plane instead of one
 * pod's buffer.
 */
import type arg from "arg";
import chalk from "chalk";

import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";
import { PROJECT_TARGET_FLAGS, failureOf } from "../utils/project-target";
import {
    emit,
    fail,
    isJsonMode,
    isRecord,
    parsedLine,
    printProjectHelp,
    projectTarget,
    recordsOf,
    reportTargetError,
    requestJson,
    startProjectCommand,
    stringOf
} from "../utils/project-command";
import { note } from "./cloud/context";
import { clockTime, formatFields, requestHead } from "./cloud/runtime-logs";

export const LOGS_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--follow": Boolean,
    "-f": "--follow",
    "--level": String,
    "--source": String,
    "--search": String,
    "--grep": "--search",
    "--since": String,
    "--limit": Number,
    "-n": "--limit",
    "--raw": Boolean
} satisfies arg.Spec;

const LEVELS = new Set(["debug", "info", "warn", "error"]);
const SOURCES = new Set(["api", "auth", "storage", "realtime", "system"]);

/**
 * One entry of the buffer as a person reads it, the way `rebase cloud logs
 * --runtime` prints a record: `HH:MM:SS.mmm LEVEL  [source] message  key=value …`,
 * coloured by level, with the metadata of every level on the same line. A
 * request's message already says `GET /path 404 16ms`, so the fields it was
 * built from are not repeated.
 */
export function renderBufferEntry(entry: Record<string, unknown>, now: Date = new Date()): string {
    const level = stringOf(entry.level) ?? "info";
    const paint = level === "error" ? chalk.red : level === "warn" ? chalk.yellow : level === "debug" ? chalk.gray : (s: string) => s;
    const stamp = stringOf(entry.timestamp);
    const time = (stamp !== undefined ? clockTime(stamp, now) : null) ?? stamp ?? "";
    const source = stringOf(entry.source);
    const message = stringOf(entry.message) ?? "";
    const metadata = isRecord(entry.metadata) ? entry.metadata : {};
    const skip: string[] = [];
    const request = requestHead({ message, fields: metadata });
    if (request && message.startsWith(request.head)) {
        skip.push(...request.used);
        // `… — CODE: message` is the failure, already in the message.
        if (typeof metadata.errorCode === "string" && message.includes(metadata.errorCode)) skip.push("errorCode");
        if (typeof metadata.errorMessage === "string" && message.includes(metadata.errorMessage)) skip.push("errorMessage");
    }
    if (metadata.component === source) skip.push("component");
    const fields = formatFields(metadata, skip);
    const head = [
        time ? chalk.gray(time) : null,
        `${paint(level.toUpperCase().padEnd(5))} `,
        source ? chalk.cyan(`[${source}]`) : null,
        paint(message)
    ].filter((p): p is string => p !== null).join(" ");
    return fields ? `${head}  ${chalk.gray(fields)}` : head;
}

/** One line of the log: the entry as JSON under --json, else read. */
/** `--raw`: each entry as the buffer holds it, one JSON object per line, not the readable rendering. Set per run. */
let rawEntries = false;

function printEntry(entry: Record<string, unknown>): void {
    if (isJsonMode() || rawEntries) {
        process.stdout.write(`${JSON.stringify(entry)}\n`);
        return;
    }
    console.log(renderBufferEntry(entry));
}

export async function logsCommand(rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    if (wantsHelp(rawArgs)) {
        printLogsHelp();
        return;
    }
    const { flags } = parsedLine(() => {
        const parsed = parseCommandArgs({
            spec: LOGS_FLAGS,
            rawArgs,
            commandWords: 1,
            command: "logs",
            maxPositionals: 0
        });
        const level = parsed.flags["--level"];
        if (level !== undefined && !LEVELS.has(level)) throw new UsageError(`--level takes debug, info, warn or error (got "${level}").`);
        const source = parsed.flags["--source"];
        if (source !== undefined && !SOURCES.has(source)) throw new UsageError(`--source takes api, auth, storage, realtime or system (got "${source}").`);
        return parsed;
    });

    if (flags["--project"] || flags["--cloud"]) {
        if (flags["--token"] || flags["--session"] || flags["--anon"]) {
            fail("On a Rebase Cloud project `rebase logs` reads the pods' output through the control plane; --token, --session and --anon do not apply.", undefined, "usage");
        }
        await cloudRuntimeLogs(flags);
        return;
    }

    rawEntries = flags["--raw"] === true;
    const target = await projectTarget(flags, { command: "logs" });
    const filter = { level: flags["--level"], source: flags["--source"], search: flags["--search"] };

    if (!flags["--follow"]) {
        const body = await requestJson(target, "/api/admin/logs", "Failed to read the log", {
            query: { ...filter, since: flags["--since"], limit: flags["--limit"]?.toString() }
        });
        const entries = recordsOf(isRecord(body) ? body.entries : undefined);
        if (isJsonMode()) {
            emit(() => undefined, body);
            return;
        }
        if (entries.length === 0) note(`No log entries match on ${target.label}.`);
        // The buffer answers newest first; a log reads oldest first.
        for (const entry of [...entries].reverse()) printEntry(entry);
        return;
    }

    await followLog(target, { ...filter, limit: flags["--limit"]?.toString() });
}

/**
 * Tail `/api/admin/logs/stream`: a `snapshot` event with the backlog, then an
 * `append` event per batch. Runs until interrupted or the server closes it.
 */
async function followLog(
    target: Awaited<ReturnType<typeof projectTarget>>,
    query: Record<string, string | undefined>
): Promise<void> {
    let res: Response;
    try {
        res = await target.request("/api/admin/logs/stream", { query, headers: { Accept: "text/event-stream" } });
    } catch (e) {
        reportTargetError(e, target);
    }
    if (!res.ok || !res.body) {
        const body: unknown = await res.json().catch(() => null);
        reportTargetError(failureOf(res.status, body, target, "Failed to follow the log"), target);
    }
    if (!isJsonMode()) note(`Following the log of ${target.label}. Ctrl-C to stop.`);
    process.once("SIGINT", () => process.exit(0));

    const decoder = new TextDecoder();
    let buffer = "";
    const reader = res.body.getReader();
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf("\n\n")) !== -1) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            handleFrame(frame);
        }
    }
    if (!isJsonMode()) note("The server closed the stream.");
}

/** One server-sent event: `event:` and `data:` lines. */
function handleFrame(frame: string): void {
    let event = "message";
    const data: string[] = [];
    for (const line of frame.split("\n")) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        else if (line.startsWith("data:")) data.push(line.slice(5).trimStart());
    }
    if (data.length === 0) return;
    let payload: unknown;
    try {
        payload = JSON.parse(data.join("\n"));
    } catch {
        return;
    }
    if (!isRecord(payload)) return;
    const entries = recordsOf(payload.entries);
    // The snapshot is oldest-first, as are the appends.
    for (const entry of entries) printEntry(entry);
    if (event === "append" && typeof payload.dropped === "number" && payload.dropped > 0 && !isJsonMode()) {
        console.log(chalk.yellow(`  … ${payload.dropped} entries dropped (the stream fell behind)`));
    }
}

/** The pods' output, through `rebase cloud logs --runtime`, with this command's flags translated. */
async function cloudRuntimeLogs(flags: Record<string, unknown>): Promise<void> {
    const argv = ["node", "rebase", "cloud", "logs", "--runtime"];
    const project = typeof flags["--project"] === "string" ? flags["--project"] : undefined;
    if (project) argv.push("--project", project);
    if (flags["--follow"] === true) argv.push("--follow");
    if (typeof flags["--since"] === "string") argv.push("--since", flags["--since"]);
    if (typeof flags["--limit"] === "number") argv.push("--tail", String(flags["--limit"]));
    if (typeof flags["--search"] === "string") argv.push("--grep", flags["--search"]);
    if (typeof flags["--level"] === "string") argv.push("--level", flags["--level"]);
    if (flags["--json"] === true) argv.push("--json");
    if (flags["--raw"] === true) argv.push("--raw");
    if (typeof flags["--source"] === "string") {
        process.stderr.write(chalk.yellow("  ⚠ --source filters one server's own log buffer; the pods' output has no sources, so it is ignored.\n"));
    }
    const { cloudCommand } = await import("./cloud");
    await cloudCommand("logs", argv);
}

function printLogsHelp(): void {
    printProjectHelp({
        command: "logs",
        usage: "[--follow]",
        title: "A running server's log: once, or followed live",
        actions: [
            {
                action: "logs",
                description: "The newest entries of the server's log buffer, oldest first",
                flags: [
                    ["--follow, -f", "Keep printing entries as they are logged"],
                    ["--level <level>", "debug, info, warn or error"],
                    ["--source <source>", "api, auth, storage, realtime or system"],
                    ["--search, --grep <text>", "Only entries whose message holds this"],
                    ["--since <iso>", "Only entries after this time"],
                    ["--limit, -n <n>", "At most this many entries"],
                    ["--raw", "Each entry as stored (one JSON object per line), not the readable line; with --project, the pods' original lines"]
                ]
            }
        ],
        notes: [
            "The buffer is one process's: `rebase dev`'s backend, or the instance --url reaches.",
            "With --project or --cloud this is `rebase cloud logs --runtime`: every pod's output, through the control plane."
        ]
    });
}
