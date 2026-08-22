/**
 * Deployment lifecycle: `rebase cloud deployments list`, `rollback`, `cancel`.
 *
 * The rollback rule is the load-bearing part. A rollback is only honoured for a
 * SUCCESSFUL deploy that recorded an image (`status === "success" && imageUrl`);
 * anything else 409s `deploy_not_rollbackable` server-side. So this module never
 * offers — and refuses to invoke — a rollback the server would reject, exactly
 * mirroring the console's `isRollbackable`.
 */
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    emit,
    confirmDestructive,
    colorStatus,
    keyValues,
    success,
    fail,
    reportError,
    type CloudClient
} from "./context";

/** A deployment row, as the data API hands it back (camel or snake columns). */
export interface DeploymentRow {
    id: string | number;
    status?: string;
    createdAt?: string | Date;
    created_at?: string | Date;
    finishedAt?: string | Date;
    finished_at?: string | Date;
    imageUrl?: string;
    image_url?: string;
    rollbackOf?: string;
    rollback_of?: string;
    triggeredBy?: string;
    triggered_by?: string;
    triggerSource?: string;
    trigger_source?: string;
    triggeredByUserId?: string;
    triggered_by_user_id?: string;
    gitCommitHash?: string;
    gitCommitMessage?: string;
    deployMessage?: string;
    deploy_message?: string;
    frameworkVersion?: string;
    framework_version?: string;
}

function str(dep: DeploymentRow, camel: keyof DeploymentRow, snake: keyof DeploymentRow): string | null {
    const raw = (dep[camel] ?? dep[snake]) as unknown;
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function isoOf(dep: DeploymentRow, camel: keyof DeploymentRow, snake: keyof DeploymentRow): string | null {
    const raw = (dep[camel] ?? dep[snake]) as unknown;
    if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString();
    return typeof raw === "string" && raw.trim() !== "" ? raw.trim() : null;
}

function deploymentImage(dep: DeploymentRow): string | null {
    return str(dep, "imageUrl", "image_url");
}

/**
 * The backend's rule EXACTLY: a rollback is honoured only for a successful
 * deploy that recorded an image. Any other row 409s `deploy_not_rollbackable`.
 */
export function isRollbackable(dep: DeploymentRow): boolean {
    return dep.status === "success" && deploymentImage(dep) !== null;
}

/** finishedAt − createdAt in ms, or null (still running / missing / skewed). */
export function deploymentDurationMs(dep: DeploymentRow): number | null {
    const created = isoOf(dep, "createdAt", "created_at");
    const finished = isoOf(dep, "finishedAt", "finished_at");
    if (!created || !finished) return null;
    const a = new Date(created).getTime();
    const b = new Date(finished).getTime();
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    const ms = b - a;
    return ms >= 0 ? ms : null;
}

function formatDuration(ms: number): string {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    if (totalSec < 60) return `${totalSec}s`;
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    if (m < 60) return s ? `${m}m ${s}s` : `${m}m`;
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return mm ? `${h}h ${mm}m` : `${h}h`;
}

const TRIGGERED_BY = ["user", "automation", "unknown"] as const;
const TRIGGER_SOURCES = ["console", "cli", "webhook", "unknown"] as const;

export function triggerInfo(dep: DeploymentRow): { by: string; source: string; userId: string } {
    const byRaw = (dep.triggeredBy ?? dep.triggered_by) as unknown;
    const srcRaw = (dep.triggerSource ?? dep.trigger_source) as unknown;
    const by = typeof byRaw === "string" && (TRIGGERED_BY as readonly string[]).includes(byRaw) ? byRaw : "unknown";
    const source =
        typeof srcRaw === "string" && (TRIGGER_SOURCES as readonly string[]).includes(srcRaw) ? srcRaw : "unknown";
    return { by,
source,
userId: str(dep, "triggeredByUserId", "triggered_by_user_id") ?? "" };
}

/** Shape one deployment row into the stable JSON view the CLI publishes. */
export function deploymentView(dep: DeploymentRow): Record<string, unknown> {
    const durationMs = deploymentDurationMs(dep);
    return {
        id: String(dep.id),
        status: dep.status ?? null,
        createdAt: isoOf(dep, "createdAt", "created_at"),
        finishedAt: isoOf(dep, "finishedAt", "finished_at"),
        durationMs,
        image: deploymentImage(dep),
        rollbackOf: str(dep, "rollbackOf", "rollback_of"),
        isRollback: str(dep, "rollbackOf", "rollback_of") !== null,
        rollbackable: isRollbackable(dep),
        trigger: triggerInfo(dep),
        // The caller's own label for this deploy, and the framework THIS BUNDLE
        // installed. Without them a `--source` project's history is N rows
        // carrying an identical placeholder commit message, distinguishable only
        // by timestamp — which is not enough to answer "did mine go out?".
        //
        // Published as `builtAgainst` — the manifest field it comes from
        // (`runtime.builtAgainst`, read off the installed `@rebasepro/server`) —
        // and NOT as `frameworkVersion`, which is what `cloud status` calls the
        // framework the runtime IMAGE ships. The two are routinely different:
        // the image supplies the server, the bundle supplies the driver. Under
        // one name they read as the control plane disagreeing with itself, and
        // that is how this was reported as a bug.
        message: str(dep, "deployMessage", "deploy_message"),
        builtAgainst: str(dep, "frameworkVersion", "framework_version"),
        commit: {
            hash: str(dep, "gitCommitHash", "gitCommitHash"),
            message: str(dep, "gitCommitMessage", "gitCommitMessage")
        }
    };
}

/** What `POST /api/functions/deploy/cancel` answers. */
export interface CancelResponse {
    success: boolean;
    /**
     * The deployment that was cancelled — `null` when there was none.
     *
     * Nullable because "nothing was in flight" is a real, successful outcome
     * and not an error: a project's `status` column can claim `deploying` while
     * no deployment row backs the claim, and cancelling is what clears it.
     */
    deploymentId: string | null;
    buildJobDeleted: boolean;
    /** The request cleared a stuck `deploying` claim rather than stopping a build. */
    unstranded?: boolean;
    /** The status the project settled on when it did. */
    projectStatus?: string | null;
}

/**
 * What `rebase cloud cancel` says it did.
 *
 * Split out of the command because there are now two outcomes behind one
 * `success: true`, and only one of them is "a build was stopped". The control
 * plane learned to clear a project stranded at `deploying` with no deployment
 * row behind it — the state `prospector` was wedged in for five days — and it
 * reports that through this same endpoint. An unbranched caller printed
 * "Cancelled deployment null" for it, which reads as a bug in the thing that
 * had just fixed the bug.
 *
 * The ABSENT ID is what decides, not the `unstranded` flag: the flag is the
 * server being explicit, and it is the newer half of the contract. Branching on
 * the id means a client that meets a control plane which grew the behaviour
 * without the flag still says something true.
 */
export function cancelView(res: CancelResponse): {
    /** The headline, for `success()`. */
    headline: string;
    /** Dimmed follow-ups, printed under it. */
    notes: string[];
    /** The stable JSON view, which is what a piped run gets. */
    json: Record<string, unknown>;
} {
    const deploymentId = res.deploymentId ? String(res.deploymentId) : null;
    const projectStatus =
        typeof res.projectStatus === "string" && res.projectStatus.length > 0 ? res.projectStatus : null;

    if (!deploymentId) {
        return {
            headline:
                "No deploy was in flight — cleared this project's stuck 'deploying' status" +
                (projectStatus ? ` (now ${chalk.bold(projectStatus)})` : ""),
            notes: ["Its status claimed a deploy that no deployment backed. Redeploy is available again."],
            json: { success: true,
deploymentId: null,
buildJobDeleted: false,
unstranded: true,
projectStatus }
        };
    }

    return {
        headline: `Cancelled deployment ${chalk.bold(deploymentId)}`,
        notes: res.buildJobDeleted ? ["The build job was deleted."] : [],
        json: { success: true,
deploymentId,
buildJobDeleted: Boolean(res.buildJobDeleted),
unstranded: Boolean(res.unstranded),
projectStatus }
    };
}

async function fetchDeployments(client: CloudClient, projectId: string, limit = 100): Promise<DeploymentRow[]> {
    const res = await client.data.collection("deployments").find({
        where: { project: ["==", projectId] },
        orderBy: ["createdAt", "desc"],
        limit
    });
    return res.data as unknown as DeploymentRow[];
}

/**
 * Rows shown when `--limit` is not given.
 *
 * History is unbounded and grows one row per deploy, so "all of it" is the
 * wrong default in both directions: a wall of near-identical lines in a
 * terminal, and — since JSON mode is entered automatically for any non-TTY
 * stdout — a project's entire history dumped at anything that pipes the
 * command. Recent deploys are what the question is almost always about.
 */
export const DEFAULT_DEPLOYMENTS_LIMIT = 20;

/** Hard ceiling on `--limit`, matching the backend's own page size. */
const MAX_DEPLOYMENTS_LIMIT = 100;

/** `--limit N`, bounded. A garbage value is a refusal, never a silent default. */
export function parseDeploymentsLimit(raw: number | undefined): number {
    if (raw === undefined) return DEFAULT_DEPLOYMENTS_LIMIT;
    if (!Number.isInteger(raw) || raw < 1 || raw > MAX_DEPLOYMENTS_LIMIT) {
        fail(`--limit must be a whole number between 1 and ${MAX_DEPLOYMENTS_LIMIT}.`, undefined, "usage");
    }
    return raw;
}

export async function deploymentsListCommand(rawArgs: string[]): Promise<void> {
    // `--limit` is validated below and a typo of it must not silently fall back
    // to the default page — the refusal is the whole point of the bound.
    const { flags: args } = parseCloudArgs({
        spec: { "--limit": Number,
"--all": Boolean },
        rawArgs,
        commandWords: 2, // cloud deployments
        command: "cloud deployments list",
        maxPositionals: 1 // the `list` action word, when written out
    });
    const limit = args["--all"] ? MAX_DEPLOYMENTS_LIMIT : parseDeploymentsLimit(args["--limit"]);
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const rows = await fetchDeployments(client, projectId, limit);
        const views = rows.map(deploymentView);
        // Never let a truncated list read as a complete one. `truncated` is in
        // the JSON for the same reason the note is in the human output.
        const truncated = views.length === limit;
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🚀 Deployments — project ${projectRef}`));
                console.log("");
                if (!views.length) {
                    console.log(chalk.gray("  No deployments yet. Deploy with `rebase cloud deploy`."));
                    console.log("");
                    return;
                }
                for (const v of views) {
                    const dur = v.durationMs !== null ? formatDuration(v.durationMs as number) : chalk.gray("running");
                    const trig = (v.trigger as { source: string }).source;
                    const roll = v.rollbackable ? chalk.green(" ↺ rollbackable") : "";
                    console.log(
                        `  ${chalk.gray(`[${v.id}]`)} ${colorStatus(v.status as string)}  ${chalk.gray(String(v.createdAt ?? "—"))}  ${dur}  ${chalk.gray(trig)}${roll}`
                    );
                    // The label and the framework this bundle was built against
                    // are what make one row distinguishable from the next;
                    // indented under it so the status line stays scannable when
                    // they are absent. Spelled "built against" so it cannot be
                    // read as the framework `cloud status` reports, which is the
                    // image's.
                    const label = [v.message, v.builtAgainst ? `built against @rebasepro/* ${v.builtAgainst}` : null]
                        .filter(Boolean)
                        .join("  ·  ");
                    if (label) console.log(`      ${chalk.gray(label)}`);
                }
                if (truncated) {
                    console.log("");
                    console.log(chalk.gray(`  Showing the ${limit} most recent. Use \`--limit N\` or \`--all\` for more.`));
                }
                console.log("");
            },
            { projectId,
limit,
truncated,
deployments: views }
        );
    } catch (e) {
        reportError(e, "Failed to list deployments");
    }
}

/**
 * The deployment id `rollback`/`cancel` was given, if any.
 *
 * Both take an optional id, which is what made the old operand filter so easy
 * to trip: `rebase cloud rollback -p acme` — the documented way to act on an
 * unlinked project — read `--project`'s value as the id and refused with
 * "Deployment acme not found", and `cancel -p acme` sent "acme" to the server
 * as the deployment to cancel. Strict parsing consumes the flag with its value,
 * so an id given as a flag value is never mistaken for an argument.
 */
export function resolveDeploymentIdArg(rawArgs: string[], command: string) {
    const { flags, positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 2, // cloud <rollback|cancel>
        command,
        maxPositionals: 1
    });
    return { flags,
id: positionals[0] };
}

export async function rollbackCommand(rawArgs: string[]): Promise<void> {
    // `rollback [deploymentId]` — the id, when given, is the only argument.
    const { flags: args, id: explicitId } = resolveDeploymentIdArg(rawArgs, "cloud rollback");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    // Fetch history — the only step here that can fail with a server error.
    let rows: DeploymentRow[];
    try {
        rows = await fetchDeployments(client, projectId);
    } catch (e) {
        reportError(e, "Failed to read deployment history");
    }
    if (!rows!.length) fail("No deployments to roll back to.", undefined, "no_deployments");

    // Select + validate the target OUTSIDE any catch — a refusal here is a
    // deliberate exit, never a server error to re-wrap.
    let target: DeploymentRow | undefined;
    if (explicitId) {
        target = rows!.find((d) => String(d.id) === explicitId);
        if (!target) fail(`Deployment ${explicitId} not found for project ${projectRef}.`, undefined, "not_found");
        // Refuse locally rather than let the server 409 — this is the safety
        // contract, mirrored from the backend's rollback rule.
        if (!isRollbackable(target!)) {
            fail(
                `Deployment ${explicitId} is not rollbackable (needs a successful deploy that recorded an image).`,
                "List candidates with `rebase cloud deployments list`.",
                "deploy_not_rollbackable"
            );
        }
    } else {
        const rollbackable = rows!.filter(isRollbackable);
        if (!rollbackable.length) {
            fail(
                "No rollbackable deployment found (needs a successful deploy that recorded an image).",
                "List history with `rebase cloud deployments list`.",
                "deploy_not_rollbackable"
            );
        }
        // Prefer the previous good image when the newest deploy is itself good
        // (rolling back to the live image is a no-op); otherwise the most recent
        // good one.
        target = rollbackable.find((d) => String(d.id) !== String(rows![0].id)) ?? rollbackable[0];
    }

    await confirmDestructive({
        yes: Boolean(args["--yes"]),
        prompt: `Roll project ${projectRef} back to deployment ${target!.id}? This starts a new deployment.`
    });

    try {
        const res = await client.functions.invoke<{
            success: boolean;
            deployment: { id: string };
            rolledBackTo: string;
            imageUrl: string;
        }>("deploy", { projectId,
deploymentId: String(target!.id),
client: "cli" }, { path: "rollback" });

        emit(
            () => {
                success(`Rolling back to deployment ${chalk.bold(String(target!.id))}`);
                keyValues([
                    ["New deployment", res.deployment?.id ? String(res.deployment.id) : undefined],
                    ["Rolled back to", res.rolledBackTo],
                    ["Image", res.imageUrl]
                ]);
                console.log(chalk.gray("  Follow it with `rebase cloud logs -f`."));
                console.log("");
            },
            {
                success: true,
                deploymentId: res.deployment?.id ?? null,
                rolledBackTo: res.rolledBackTo,
                imageUrl: res.imageUrl
            }
        );
    } catch (e) {
        reportError(e, "Failed to roll back");
    }
}

export async function cancelCommand(rawArgs: string[]): Promise<void> {
    const { flags: args, id: explicitId } = resolveDeploymentIdArg(rawArgs, "cloud cancel");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    await confirmDestructive({
        yes: Boolean(args["--yes"]),
        prompt: `Cancel the in-flight build for project ${projectRef}?`
    });

    try {
        const res = await client.functions.invoke<CancelResponse>(
            "deploy",
            explicitId ? { projectId,
deploymentId: explicitId } : { projectId },
            { path: "cancel" }
        );
        const view = cancelView(res);
        emit(
            () => {
                success(view.headline);
                for (const note of view.notes) console.log(chalk.gray(`  ${note}`));
                console.log("");
            },
            view.json
        );
    } catch (e) {
        const err = e as { status?: number };
        if (err?.status === 404) {
            fail("No deployment in progress to cancel.", undefined, "not_found");
        }
        reportError(e, "Failed to cancel deployment");
    }
}
