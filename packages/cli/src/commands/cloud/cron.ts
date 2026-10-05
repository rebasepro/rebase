/**
 * `rebase cloud cron` — a deployed project's scheduled jobs and their run
 * history, read with the `rebase cloud` login.
 *
 * ## Why this is not just `curl /api/admin/cron`
 *
 * The run history lives in the app itself — `rebase.cron_logs`, served by the
 * runtime's `/api/admin/cron/:id/logs` — behind the app's admin gate. A project
 * owner is signed in to the *control plane*, which that gate has never heard
 * of, and holds none of what it accepts: often no admin account in the app yet,
 * no `rk_` key, and rightly not the service key, which is admin on the whole API.
 * Pod stdout (`rebase cloud debug logs`) covers the last half hour or so; the
 * history covers every run.
 *
 * ## How it reaches the runtime
 *
 * Two legs, each over a channel `rebase cloud debug` already uses:
 *
 *  1. The control plane, as the signed-in person (`debug logs`' channel):
 *     `POST /api/functions/runtime-token/<project>` checks the caller may read
 *     this project's logs and answers a token — `rpt_…`, ES256, bound to this
 *     project, `cron:read` only, minutes long.
 *  2. The runtime at its public address (`debug health`'s channel), with that
 *     token as the bearer. The runtime verifies it against the platform's
 *     public key and grants `cron:read` and nothing else — it cannot trigger,
 *     disable, or read anything but cron.
 *
 * A fresh token per command: nothing is cached, so nothing long-lived ends up
 * on this machine.
 */
import chalk from "chalk";
import type { CronJobLogEntry, CronJobStatus } from "@rebasepro/types";
import {
    requireClient,
    requireProject,
    parseCloudArgs,
    displayProjectRef,
    emit,
    fail,
    reportError,
    requireKnownAction,
    type CloudClient
} from "./context";
import { resolveOrigin } from "./debug";

/** The control-plane function that mints runtime tokens. */
export const RUNTIME_TOKEN_FUNCTION = "runtime-token";

/** The one scope these commands ask the platform for. */
export const CRON_READ_SCOPE = "cron:read";

/** Where the runtime serves its cron surface. */
const CRON_PATH = "/api/admin/cron";

const RUNTIME_TIMEOUT_MS = 15_000;

/** What `runtime-token` answers. */
export interface RuntimeTokenResponse {
    /** `rpt_…` — the bearer the runtime accepts. */
    token: string;
    /** ISO timestamp; past it the runtime refuses the token. */
    expiresAt?: string;
    /** What the token was granted, which may be narrower than what was asked. */
    scopes?: string[];
}

/** What the runtime's `GET /api/admin/cron` answers. */
interface CronListResponse {
    jobs?: CronJobStatus[];
    skipped?: number;
    rejected?: Array<{ id: string; name: string; schedule: string; reason: string }>;
    note?: string;
}

/** The runtime's error envelope, as far as these commands read it. */
interface ErrorEnvelope {
    error?: { code?: string; message?: string };
}

/**
 * A 404 that is about the route, not the project: the JSON envelope a Rebase
 * backend answers for an unmatched path, or the bare one a router answers
 * before that handler exists.
 */
export function isMissingRoute(message: string | undefined): boolean {
    return /^No route for |^(404 )?Not Found$/i.test((message ?? "").trim());
}

/**
 * Ask the control plane for a token the project's runtime will accept.
 *
 * A missing route means this control plane has no `runtime-token` function
 * yet, which is a different fix from "no such project" and is said so.
 */
export async function mintRuntimeToken(
    client: CloudClient,
    projectId: string,
    scopes: string[]
): Promise<RuntimeTokenResponse> {
    let res: RuntimeTokenResponse;
    try {
        res = await client.functions.invoke<RuntimeTokenResponse>(RUNTIME_TOKEN_FUNCTION, { scopes }, {
            method: "POST",
            path: projectId
        });
    } catch (e) {
        const err = e as { status?: number; message?: string };
        if (err.status === 404 && isMissingRoute(err.message)) {
            fail(
                "This control plane does not issue runtime tokens yet, so the CLI cannot read the app's cron history.",
                "Until it does, `rebase cloud debug logs` shows what jobs printed in the last half hour.",
                "runtime_token_unavailable"
            );
        }
        reportError(e, "Failed to get a runtime token from the control plane");
    }
    if (typeof res?.token !== "string" || res.token.length === 0) {
        fail("The control plane answered without a runtime token.", undefined, "runtime_token_unavailable");
    }
    return res;
}

/**
 * GET a path on the runtime with a platform token, and refuse — with what it
 * means for this command — anything but a 2xx.
 *
 * `notFound` words the 404, which means different things per route: no cron
 * surface at all on the list, no such job on its logs.
 */
export async function runtimeGet<T>(
    origin: string,
    path: string,
    token: string,
    notFound: { message: string; hint?: string; code: string }
): Promise<T> {
    let res: Response;
    try {
        res = await fetch(`${origin}${path}`, {
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            redirect: "manual",
            signal: AbortSignal.timeout(RUNTIME_TIMEOUT_MS)
        });
    } catch (e) {
        fail(
            `Could not reach the app at ${origin}: ${e instanceof Error ? e.message : String(e)}`,
            "`rebase cloud debug health` checks whether the deployment is answering at all.",
            "runtime_unreachable"
        );
    }

    const text = await res.text();
    let body: unknown;
    try {
        body = text ? JSON.parse(text) : undefined;
    } catch {
        body = undefined;
    }
    if (res.ok) return body as T;

    const error = (body as ErrorEnvelope | undefined)?.error;
    const said = error?.message ? ` (${error.message})` : "";

    if (res.status === 401) {
        if (error?.code === "PLATFORM_TOKENS_OFF" || error?.code === "INVALID_PLATFORM_TOKEN") {
            fail(
                `The app refused the platform's token${said}.`,
                "The platform sets the key it verifies with when it deploys; redeploying the project picks it up.",
                "runtime_token_refused"
            );
        }
        // A runtime that predates platform tokens parses `rpt_…` as a user
        // session and answers the generic refusal.
        fail(
            `This deployment's runtime does not accept platform tokens${said}.`,
            "Runtimes from before platform tokens accept only an admin of the app, an `rk_` key or the service key. " +
                "Redeploy to move to a runtime that accepts them.",
            "runtime_token_refused"
        );
    }
    if (res.status === 404) fail(notFound.message, notFound.hint, notFound.code);
    if (res.status === 501 && error?.code === "ADMIN_SURFACE_UNAVAILABLE") {
        fail(`The app has its admin surfaces switched off${said}.`, undefined, "admin_surface_unavailable");
    }
    fail(
        `The app answered ${res.status} for ${path}${said}.`,
        res.status >= 500 ? "`rebase cloud debug errors` shows what the server logged." : undefined,
        res.status === 400 ? "usage" : "runtime_error"
    );
}

/** Everything both actions need before their one request. */
async function connect(rawArgs: string[]): Promise<{ origin: string; token: string }> {
    const { client, url } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    // The origin first: a project with no address cannot be read, and that is
    // worth knowing before asking anyone to mint anything.
    const origin = await resolveOrigin(rawArgs, client, url, projectId);
    const { token } = await mintRuntimeToken(client, projectId, [CRON_READ_SCOPE]);
    return { origin, token };
}

const NO_CRON_SURFACE = {
    message: "This deployment serves no cron surface.",
    hint: "The app was built without a crons directory, or its runtime does not serve the cron admin routes.",
    code: "cron_not_served"
};

/** `2026-10-05T10:31:00.000Z` → `2026-10-05 10:31:00Z`, or `—`. */
export function shortTime(iso: string | undefined): string {
    if (!iso) return "—";
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? iso : `${date.toISOString().slice(0, 19).replace("T", " ")}Z`;
}

/** Milliseconds as `850ms`, `2.4s` or `3m 10s`. */
export function shortDuration(ms: number | undefined): string {
    if (ms === undefined || !Number.isFinite(ms)) return "";
    if (ms < 1000) return `${Math.round(ms)}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`;
}

function stateColor(state: string): string {
    if (state === "error") return chalk.red(state);
    if (state === "running") return chalk.cyan(state);
    if (state === "disabled") return chalk.gray(state);
    if (state === "success") return chalk.green(state);
    return state;
}

/* ═══════════════════════════════════════════════════════════════
   cron list
   ═══════════════════════════════════════════════════════════════ */

/** The flags `cron list` parses — the help page lists exactly these. */
export const CRON_LIST_FLAGS = { "--host": String };

async function listCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({
        spec: CRON_LIST_FLAGS,
        rawArgs,
        commandWords: 3,
        command: "cloud cron list",
        maxPositionals: 0
    });
    const { origin, token } = await connect(rawArgs);
    const res = await runtimeGet<CronListResponse>(origin, CRON_PATH, token, NO_CRON_SURFACE);
    const jobs = res?.jobs ?? [];

    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  ⏰ Cron — ${displayProjectRef(rawArgs)}`) + chalk.gray(`  ${origin}`));
            console.log("");
            if (jobs.length === 0) {
                console.log(chalk.gray("  No cron jobs are scheduled on this deployment."));
            } else {
                // Padded on the plain text: a colour code has length and no width.
                const lastRun = (job: CronJobStatus): { at: string; took: string } => ({
                    at: shortTime(job.lastRunAt),
                    took: job.lastRunAt ? shortDuration(job.lastDurationMs) : ""
                });
                const lastText = (job: CronJobStatus): string => [lastRun(job).at, lastRun(job).took].filter(Boolean).join(" ");
                const idWidth = Math.max(3, ...jobs.map(job => job.id.length));
                const scheduleWidth = Math.max(8, ...jobs.map(job => job.schedule.length));
                const stateWidth = Math.max(5, ...jobs.map(job => job.state.length));
                const lastWidth = Math.max(8, ...jobs.map(job => lastText(job).length));
                console.log(chalk.gray(
                    `  ${"JOB".padEnd(idWidth)}  ${"SCHEDULE".padEnd(scheduleWidth)}  ${"STATE".padEnd(stateWidth)}  ` +
                    `${"LAST RUN".padEnd(lastWidth)}  NEXT RUN`
                ));
                for (const job of jobs) {
                    const { at, took } = lastRun(job);
                    const pad = (text: string, width: number) => " ".repeat(Math.max(0, width - text.length));
                    console.log(
                        `  ${chalk.bold(job.id)}${pad(job.id, idWidth)}  ${job.schedule.padEnd(scheduleWidth)}  ` +
                        `${stateColor(job.state)}${pad(job.state, stateWidth)}  ` +
                        `${at}${took ? ` ${chalk.gray(took)}` : ""}${pad(lastText(job), lastWidth)}  ${shortTime(job.nextRunAt)}`
                    );
                    if (job.state === "error" && job.lastError) {
                        console.log(chalk.red(`  ${" ".repeat(idWidth)}  ${job.lastError}`));
                    }
                }
            }
            if (res?.note) {
                console.log("");
                console.log(chalk.yellow(`  ⚠ ${res.note}`));
                for (const rejected of res.rejected ?? []) {
                    console.log(chalk.yellow(`    ${rejected.id} (${rejected.schedule}): ${rejected.reason}`));
                }
            }
            console.log("");
            if (jobs.length > 0) {
                console.log(chalk.gray("  A job's run history:  ") + chalk.bold("rebase cloud cron logs <job>"));
                console.log("");
            }
        },
        {
            origin,
            jobs,
            skipped: res?.skipped ?? 0,
            rejected: res?.rejected ?? [],
            note: res?.note ?? null
        }
    );
}

/* ═══════════════════════════════════════════════════════════════
   cron logs <job>
   ═══════════════════════════════════════════════════════════════ */

/** The flags `cron logs` parses — the help page lists exactly these. */
export const CRON_LOGS_FLAGS = { "--limit": Number, "--host": String };

async function logsCommand(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: CRON_LOGS_FLAGS,
        rawArgs,
        commandWords: 3,
        command: "cloud cron logs",
        maxPositionals: 1
    });
    const jobId = positionals[0];
    if (!jobId) {
        fail("Name the job: `rebase cloud cron logs <job>`.", "`rebase cloud cron list` names them.", "usage");
    }
    const limit = flags["--limit"];
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
        fail(`--limit must be a positive whole number; received ${String(limit)}.`, undefined, "usage");
    }

    const { origin, token } = await connect(rawArgs);
    const query = limit !== undefined ? `?limit=${limit}` : "";
    const res = await runtimeGet<{ logs?: CronJobLogEntry[] }>(
        origin,
        `${CRON_PATH}/${encodeURIComponent(jobId)}/logs${query}`,
        token,
        {
            message: `No cron job named "${jobId}" on this deployment (or no cron surface at all).`,
            hint: "`rebase cloud cron list` names the jobs it runs.",
            code: "not_found"
        }
    );
    const logs = res?.logs ?? [];

    emit(
        () => {
            console.log("");
            console.log(
                chalk.bold(`  📜 Cron runs — ${jobId} on ${displayProjectRef(rawArgs)}`) +
                    chalk.gray(`  newest first, ${logs.length} run${logs.length === 1 ? "" : "s"}`)
            );
            console.log("");
            if (logs.length === 0) {
                console.log(chalk.gray("  This job has no recorded runs."));
                console.log("");
                return;
            }
            for (const run of logs) {
                const mark = run.success ? chalk.green("✓") : chalk.red("✗");
                const tags = [shortDuration(run.durationMs), run.manual ? "manual" : undefined].filter(Boolean).join("  ");
                console.log(`  ${mark} ${shortTime(run.startedAt)}  ${chalk.gray(tags)}`);
                if (run.error) console.log(chalk.red(`      ${run.error}`));
                for (const line of run.logs ?? []) console.log(`      ${line}`);
            }
            console.log("");
        },
        { origin, job: jobId, logs }
    );
}

/* ═══════════════════════════════════════════════════════════════
   Dispatch
   ═══════════════════════════════════════════════════════════════ */

const CRON_ACTIONS = ["list", "logs"] as const;

export async function cronCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    requireKnownAction("cron", action, CRON_ACTIONS);
    if (action === "logs") {
        await logsCommand(rawArgs);
        return;
    }
    await listCommand(rawArgs);
}
