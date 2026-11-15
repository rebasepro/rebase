/**
 * CLI command: rebase cron <action>
 *
 * A running app's scheduled jobs (`backend/crons/*`): list them, read a job's
 * run history, run one now, switch one off or back on. Through the app's
 * `/api/admin/cron` surface, with the target every project command resolves.
 *
 * On a Rebase Cloud project (`--project`, `--cloud`) this needs no Studio
 * access: reads ask the control plane for a short `cron:read` platform token,
 * which any member who may read the project's logs holds, and runs or
 * switches ask for `cron:write`, which an organization owner or admin holds on
 * a project whose Studio switch is on. Nothing long-lived is kept.
 * `rebase cloud cron` is the older, read-only spelling of `list` and `logs`.
 */
import type arg from "arg";
import chalk from "chalk";
import type { CronJobLogEntry, CronJobStatus } from "@rebasepro/types";

import { parseCommandArgs, UsageError, wantsHelp } from "../utils/args";
import { unknownCommand } from "../utils/unknown-command";
import { PROJECT_TARGET_FLAGS } from "../utils/project-target";
import {
    emit,
    isRecord,
    parsedLine,
    printProjectHelp,
    projectTarget,
    requestJson,
    startProjectCommand,
    type HelpAction
} from "../utils/project-command";
import { confirmDestructive, note, success } from "./cloud/context";
import { shortDuration, shortTime } from "./cloud/cron";

/** Everything the switch below dispatches, for the did-you-mean. */
export const CRON_SUBCOMMANDS = ["list", "get", "logs", "run", "enable", "disable", "reset"] as const;

const CRON_PATH = "/api/admin/cron";

export async function cronCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    startProjectCommand(rawArgs);
    if (subcommand === "--help" || wantsHelp(rawArgs)) {
        printCronHelp();
        return;
    }
    switch (subcommand ?? "list") {
        case "list":
            await listJobs(rawArgs);
            break;
        case "get":
            await getJob(rawArgs);
            break;
        case "logs":
            await jobLogs(rawArgs);
            break;
        case "run":
            await runJob(rawArgs);
            break;
        case "enable":
            await switchJob(rawArgs, "enable");
            break;
        case "disable":
            await switchJob(rawArgs, "disable");
            break;
        case "reset":
            await switchJob(rawArgs, "reset");
            break;
        default:
            unknownCommand(subcommand, CRON_SUBCOMMANDS, "cron");
    }
}

/* ═══════════════════════════════════════════════════════════════
   Reading a job
   ═══════════════════════════════════════════════════════════════ */

function isJob(value: unknown): value is CronJobStatus {
    return isRecord(value) && typeof value.id === "string" && typeof value.schedule === "string";
}

function jobsOf(body: unknown): CronJobStatus[] {
    return isRecord(body) && Array.isArray(body.jobs) ? body.jobs.filter(isJob) : [];
}

function jobOf(body: unknown): CronJobStatus | undefined {
    if (isRecord(body) && isJob(body.job)) return body.job;
    return isJob(body) ? body : undefined;
}

function isLogEntry(value: unknown): value is CronJobLogEntry {
    return isRecord(value) && typeof value.startedAt === "string";
}

function stateColor(state: string): string {
    if (state === "error") return chalk.red(state);
    if (state === "running") return chalk.cyan(state);
    if (state === "disabled") return chalk.gray(state);
    return chalk.green(state);
}

function printJob(job: CronJobStatus): void {
    console.log(`  ${chalk.bold(job.id)}  ${job.schedule}  ${stateColor(job.state)}${job.enabled ? "" : chalk.gray("  (off)")}`);
    if (job.description) console.log(chalk.gray(`      ${job.description}`));
    const last = job.lastRunAt ? `${shortTime(job.lastRunAt)} ${chalk.gray(shortDuration(job.lastDurationMs))}` : chalk.gray("never");
    console.log(chalk.gray("      last ") + last + chalk.gray("   next ") + shortTime(job.nextRunAt));
    if (job.state === "error" && job.lastError) console.log(chalk.red(`      ${job.lastError}`));
}

function requireJobId(positionals: string[], command: string): string {
    if (!positionals[0]) throw new UsageError(`rebase ${command} needs a job id: rebase ${command} <job> (\`rebase cron list\` names them).`);
    return positionals[0];
}

/* ═══════════════════════════════════════════════════════════════
   list / get / logs
   ═══════════════════════════════════════════════════════════════ */

export const CRON_LIST_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function listJobs(rawArgs: string[]): Promise<void> {
    const { flags } = parsedLine(() => parseCommandArgs({
        spec: CRON_LIST_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "cron list",
        maxPositionals: 0
    }));
    const target = await projectTarget(flags, { command: "cron list", platformScopes: ["cron:read"] });
    const body = await requestJson(target, CRON_PATH, "Failed to list cron jobs");
    const jobs = jobsOf(body);
    emit(() => {
        if (jobs.length === 0) note(`No cron jobs are scheduled on ${target.label}.`);
        for (const job of jobs) printJob(job);
        if (isRecord(body) && typeof body.note === "string") note(chalk.yellow(body.note));
    }, body);
}

export const CRON_GET_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

async function getJob(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: CRON_GET_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "cron get",
        maxPositionals: 1
    }));
    const id = parsedLine(() => requireJobId(positionals, "cron get"));
    const target = await projectTarget(flags, { command: "cron get", platformScopes: ["cron:read"] });
    const body = await requestJson(target, `${CRON_PATH}/${encodeURIComponent(id)}`, `Failed to read cron job ${id}`);
    const job = jobOf(body);
    emit(() => (job ? printJob(job) : console.log(JSON.stringify(body, null, 2))), job ?? body);
}

export const CRON_LOGS_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--limit": Number,
    "-n": "--limit"
} satisfies arg.Spec;

async function jobLogs(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: CRON_LOGS_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "cron logs",
        maxPositionals: 1
    }));
    const id = parsedLine(() => {
        const job = requireJobId(positionals, "cron logs");
        const limit = flags["--limit"];
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new UsageError("--limit takes a positive whole number.");
        return job;
    });
    const target = await projectTarget(flags, { command: "cron logs", platformScopes: ["cron:read"] });
    const body = await requestJson(target, `${CRON_PATH}/${encodeURIComponent(id)}/logs`, `Failed to read the runs of ${id}`, {
        query: { limit: flags["--limit"]?.toString() }
    });
    const logs = isRecord(body) && Array.isArray(body.logs) ? body.logs.filter(isLogEntry) : [];
    emit(() => {
        if (logs.length === 0) return note(`${id} has no recorded runs.`);
        for (const run of logs) {
            const mark = run.success ? chalk.green("✓") : chalk.red("✗");
            const tags = [shortDuration(run.durationMs), run.manual ? "manual" : undefined].filter(Boolean).join("  ");
            console.log(`  ${mark} ${shortTime(run.startedAt)}  ${chalk.gray(tags)}`);
            if (run.error) console.log(chalk.red(`      ${run.error}`));
            for (const line of run.logs ?? []) console.log(`      ${line}`);
        }
    }, body);
}

/* ═══════════════════════════════════════════════════════════════
   run / enable / disable / reset
   ═══════════════════════════════════════════════════════════════ */

export const CRON_RUN_FLAGS = {
    ...PROJECT_TARGET_FLAGS,
    "--async": Boolean
} satisfies arg.Spec;

async function runJob(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parsedLine(() => parseCommandArgs({
        spec: CRON_RUN_FLAGS,
        rawArgs,
        commandWords: 2,
        command: "cron run",
        maxPositionals: 1
    }));
    const id = parsedLine(() => requireJobId(positionals, "cron run"));
    const target = await projectTarget(flags, { command: "cron run", platformScopes: ["cron:write"] });
    // A run is not undoable — it sends the emails, charges the cards, prunes
    // the rows its code says to — so it says what it is about to do and waits.
    await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Run cron job ${id} now on ${target.label}?` });
    const body = await requestJson(target, `${CRON_PATH}/${encodeURIComponent(id)}/trigger`, `Failed to run ${id}`, {
        method: "POST",
        query: flags["--async"] ? { async: "1" } : undefined,
        // A synchronous run lasts as long as the job does.
        timeoutMs: flags["--async"] ? 60_000 : 15 * 60_000
    });
    const log = isRecord(body) && isLogEntry(body.log) ? body.log : undefined;
    emit(() => {
        if (flags["--async"]) return success(`Started ${id}; \`rebase cron logs ${id}\` shows how it ends.`);
        if (log && !log.success) {
            console.log(chalk.red(`  ✗ ${id} failed after ${shortDuration(log.durationMs)}: ${log.error ?? "no message"}`));
            for (const line of log.logs ?? []) console.log(`      ${line}`);
            process.exitCode = 1;
            return;
        }
        success(`Ran ${id}${log ? ` in ${shortDuration(log.durationMs)}` : ""}.`);
        for (const line of log?.logs ?? []) console.log(`      ${line}`);
    }, body);
    if (log && !log.success) process.exitCode = 1;
}

export const CRON_SWITCH_FLAGS = { ...PROJECT_TARGET_FLAGS } satisfies arg.Spec;

/**
 * `enable` and `disable` override the job's code for every process, across
 * redeploys; `reset` drops the override, so the code decides again.
 */
async function switchJob(rawArgs: string[], how: "enable" | "disable" | "reset"): Promise<void> {
    const command = `cron ${how}`;
    // One literal call per action: the help and parse guards read the command
    // name out of each call.
    const parse = {
        enable: () => parseCommandArgs({ spec: CRON_SWITCH_FLAGS, rawArgs, commandWords: 2, command: "cron enable", maxPositionals: 1 }),
        disable: () => parseCommandArgs({ spec: CRON_SWITCH_FLAGS, rawArgs, commandWords: 2, command: "cron disable", maxPositionals: 1 }),
        reset: () => parseCommandArgs({ spec: CRON_SWITCH_FLAGS, rawArgs, commandWords: 2, command: "cron reset", maxPositionals: 1 })
    }[how];
    const { flags, positionals } = parsedLine(parse);
    const id = parsedLine(() => requireJobId(positionals, command));
    const target = await projectTarget(flags, { command, platformScopes: ["cron:write"] });
    if (how === "disable") {
        // Silently stopping a scheduled backup is the failure this prompt is for.
        await confirmDestructive({ yes: flags["--yes"] === true, prompt: `Switch off cron job ${id} on ${target.label}, until it is enabled again?` });
    }
    const enabled = how === "enable" ? true : how === "disable" ? false : null;
    const body = await requestJson(target, `${CRON_PATH}/${encodeURIComponent(id)}`, `Failed to ${how} ${id}`, {
        method: "PUT",
        json: { enabled }
    });
    const job = jobOf(body);
    emit(() => {
        success(how === "reset" ? `${id} follows its code again.` : `${id} is ${how === "enable" ? "on" : "off"}.`);
        if (job) printJob(job);
    }, body);
}

/* ═══════════════════════════════════════════════════════════════
   Help
   ═══════════════════════════════════════════════════════════════ */

export const CRON_ACTIONS: HelpAction[] = [
    { action: "list", description: "The scheduled jobs: schedule, state, last and next run (the default)" },
    { action: "get", args: "<job>", description: "One job" },
    { action: "logs", args: "<job>", description: "A job's run history, newest first", flags: [["--limit, -n <n>", "At most this many runs"]] },
    { action: "run", args: "<job>", description: "Run a job now (confirms)", flags: [["--async", "Answer once it has started; `logs` shows how it ends"]] },
    { action: "enable", args: "<job>", description: "Switch a job on for every process, across redeploys" },
    { action: "disable", args: "<job>", description: "Switch a job off (confirms)" },
    { action: "reset", args: "<job>", description: "Drop the on/off override: the job's code decides again" }
];

function printCronHelp(): void {
    printProjectHelp({
        command: "cron",
        title: "A running app's scheduled jobs: list, history, run now, switch off",
        actions: CRON_ACTIONS,
        notes: [
            "On a Rebase Cloud project, reads need log access and run/enable/disable/reset need an organization owner or admin with Studio switched on.",
            "Examples:",
            "  rebase cron run cleanup-sessions --yes",
            "  rebase cron logs nightly-backup -n 5 --project acme"
        ]
    });
}
