import fs from "fs";
/**
 * `rebase cloud` resource subcommands: status, metrics, webhooks, storage,
 * clusters, billing.
 */
import {
    computeApplyCommand,
    computeWindowCommand,
    databaseAppliedOf,
    describeDatabaseApplied,
    describePending,
    isRestartUnconfirmed,
    patchRestartsDatabase,
    readMaintenance,
    DATABASE_CHANGE_BILLING,
    DATABASE_RESTART_IMPACT,
    DATABASE_RESTART_NOTICE,
    DATABASE_RESTART_REFUSAL,
    MAINTENANCE_NOT_SERVED_NOTE
} from "./maintenance";
import arg from "arg";
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    lookupProjectId,
    displayProjectRef,
    readLink,
    colorStatus,
    emit,
    printGroupHelp,
    keyValues,
    fetchTenantBaseDomain,
    projectHost,
    openUrl,
    parseCloudArgs,
    requireKnownAction,
    success,
    fail,
    reportError,
    note,
    noteBlank,
    billingAccountIdOf,
    grantForLink,
    appKeyExpiryNote,
    projectDotenvSetsAppKey,
    warn,
    confirmDestructive,
    type CloudClient
} from "./context";
import { DEFAULT_STORAGE_SOURCE_KEY } from "@rebasepro/types";
import { firstRow, latestDeployment, fmtDate } from "./projects";
import { wantsRawError } from "./errors";
import { billingInvoices, billingUpcoming } from "./billing-invoices";
import { switchOn } from "../../utils/args";
import { reportCallError, type Unserved } from "./not-served";
import { NO_ORG_HINT, requireOrg } from "./org-scope";
import { describeDomainStatus, projectDomainStates } from "./domains";
import { driftSentence, frameworkDrift, localFrameworkVersion } from "./framework-drift";
import { warnDeprecated } from "@rebasepro/common";
import {
    fetchStorageOverview,
    formatEur,
    monthlyCostEur,
    storageCorsCommand,
    storageCreateBucket,
    storageDeleteBucket,
    storageImportCommand,
    storageKeysCommand,
    storageLimitCommand,
    storageUsageCommand,
    type StorageOverview
} from "./rebase-storage";
import { formatBytes } from "../storage";

/* ─── status: quick project dashboard ──────────────────────────── */

/** The control plane's verdict on what a tenant's uploads actually do. */
interface StorageState {
    effective?: { kind?: string; summary?: string; storageType?: string; missing?: string[] };
    source?: string;
    configured?: string;
    overridden?: boolean;
}

/**
 * One line describing this project's storage — or `undefined` when the control
 * plane could not be asked, which prints as a blank rather than a guess.
 *
 * `status` used to render the `storages` row and nothing else, so a project
 * whose bucket is configured through its own `STORAGE_TYPE`/`S3_*` variables —
 * the supported path, and the one `mergeStorageEnv` deliberately lets WIN over
 * the row — was reported as `Storage: none` while its pod logged `Initialized
 * storage backends count: 1` against a live bucket. Storage is the thing an app
 * refuses to boot without, so that false negative sends someone off to
 * provision a bucket they already have. The row is not the answer; the tenant's
 * resolved environment is, and the control plane computes it with the same two
 * functions the build log uses.
 */
export function describeStorageState(state: StorageState | undefined): string | undefined {
    const verdict = state?.effective;
    if (!verdict?.kind) return undefined;
    const via = state?.overridden ? chalk.gray(" · from env vars") : "";
    switch (verdict.kind) {
        case "durable":
            return `${chalk.green("durable")}${verdict.summary ? ` · ${verdict.summary}` : ""}${via}`;
        case "ephemeral":
            // Not "none": nothing is configured, so uploads land on the pod
            // filesystem and are lost at the next restart. That is a state, and
            // a bad one — saying "none" makes it sound merely unset.
            return `${chalk.yellow("ephemeral")} ${chalk.gray("· uploads are lost on restart")}`;
        case "incomplete":
            return `${chalk.red("incomplete")} ${chalk.gray(`· missing ${(verdict.missing ?? []).join(", ")}`)}`;
        case "unrecognized":
            return `${chalk.red("unrecognized")} ${chalk.gray(`· STORAGE_TYPE=${verdict.storageType ?? "?"}`)}`;
        default:
            return undefined;
    }
}

/**
 * One line describing the database.
 *
 * `connectionStatus` is written `"untested"` at creation and only ever changed
 * by `rebase cloud db test`, so `managed (untested)` was reporting the absence
 * of a manual test as though it were the database's condition — on a project
 * that had just deployed against it. A never-tested database says only its
 * type; the verdict appears once there is one.
 */
export function describeDatabaseState(db: Record<string, unknown> | undefined): string | undefined {
    if (!db) return undefined;
    const type = typeof db.type === "string" ? db.type : "database";
    const connection = db.connectionStatus;
    if (connection === "connected" || connection === "failed") {
        return `${type} (${colorStatus(connection)})`;
    }
    return `${type} ${chalk.gray("· not tested (`rebase cloud db test`)")}`;
}

/* ─── what a project is waiting for ────────────────────────────── */

/**
 * The one thing standing between this project and a live URL, if anything is.
 *
 * `status` alone cannot answer that, and the gap is not cosmetic. A project
 * created through `projects create` is written `status: "provisioning"` and has
 * no database until one is attached — so the platform is not provisioning
 * anything, it is waiting for a second command that nothing in the output names.
 * "Provisioning" reads as *work in progress*, and the correct response to work
 * in progress is to wait. So the correct response to this state, for a person
 * and an agent alike, is the one thing that is guaranteed never to resolve it.
 *
 * That cost 43 minutes of polling on a first deploy, and an unattended agent
 * would still be polling: nothing about the state changes, ever, so there is no
 * timeout short enough to be wrong and no timeout long enough to be right.
 *
 * `blockedOn: null` is therefore load-bearing — it is the CLI saying "waiting is
 * the correct thing to do here", which is the only condition under which a
 * caller should poll. Everything else names a command.
 */
export interface BlockedState {
    /** A stable slug, or `null` when the platform genuinely is working. */
    blockedOn: string | null;
    /** The exact command that unblocks it. `null` when nothing is blocked. */
    nextAction: string | null;
}

/** Deployment states that mean the platform is still doing something. */
const IN_FLIGHT = new Set(["deploying", "building", "pending", "queued"]);

/**
 * Did this deploy get past its build and die booting?
 *
 * Matched on the control plane's own sentence, which is text this project emits
 * (`awaitRolloutOrRollback`) rather than anything a customer's build can produce
 * — so it is a signal about our state machine, not a guess about a log. Being
 * wrong points a reader at the other log, which is recoverable; not answering at
 * all pointed everyone at the empty one.
 */
function bootFailed(logs: string | null | undefined): boolean {
    return typeof logs === "string" && /did not become ready within/i.test(logs);
}

/**
 * The live app's public `GET /api/auth/config`, or `undefined` when it does
 * not answer in time or is not a Rebase backend. Read by `status` for the
 * sign-in methods the app switched on and cannot offer (`unavailable`).
 */
export async function readAuthConfig(
    appUrl: string,
    fetchImpl: typeof fetch = fetch
): Promise<{ unavailable?: { magicLink?: string; emailOtp?: string } } | undefined> {
    const origin = /^https?:\/\//.test(appUrl) ? appUrl : `https://${appUrl}`;
    try {
        const res = await fetchImpl(`${origin.replace(/\/+$/, "")}/api/auth/config`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(4000)
        });
        if (!res.ok) return undefined;
        const body: unknown = await res.json();
        if (typeof body !== "object" || body === null) return undefined;
        const unavailable = (body as { unavailable?: unknown }).unavailable;
        return typeof unavailable === "object" && unavailable !== null
            ? { unavailable: unavailable as { magicLink?: string; emailOtp?: string } }
            : {};
    } catch {
        return undefined;
    }
}

export function resolveBlockedState(input: {
    projectStatus?: string | null;
    /** The project's database row, or undefined when none is attached. */
    database?: { connectionStatus?: string | null } | undefined;
    lastDeploy?: { status?: string | null; logs?: string | null } | undefined;
    /** What the live app's `GET /api/auth/config` answered, when it answered. */
    authConfig?: { unavailable?: { magicLink?: string; emailOtp?: string } } | undefined;
}): BlockedState {
    // First, because it is the state that never resolves itself. A project
    // with no database cannot deploy, and no amount of waiting attaches one.
    //
    // Unless it already did. A project whose last deploy SUCCEEDED has a
    // database by definition — the deploy path provisions the managed stack and
    // the runtime ensures the schema at boot, neither of which can happen
    // without one. For a long time that path wrote no `databases` row, so this
    // branch fired on projects that were serving traffic: it reported
    // `blockedOn: no_database` beside `status: active`, and named `db create`
    // as the remedy — the one command that could provision a SECOND database
    // and repoint the app at it, away from the rows.
    //
    // So the absence of a row is only conclusive before anything has deployed.
    // Afterwards it describes the control plane's bookkeeping, not the project,
    // and `db create` must never be suggested for it.
    if (!input.database && input.lastDeploy?.status !== "success") {
        return {
            blockedOn: "no_database",
            nextAction: "rebase cloud db create --type managed"
        };
    }

    // A deploy in flight is the one case where waiting is right. Said
    // explicitly rather than by omission, so a caller can tell "nothing to do"
    // apart from "this CLI has no opinion".
    if (input.lastDeploy && IN_FLIGHT.has(String(input.lastDeploy.status))) {
        return { blockedOn: null,
nextAction: null };
    }

    if (!input.lastDeploy) {
        return { blockedOn: "never_deployed",
nextAction: "rebase cloud deploy" };
    }

    // A failed deploy is not a wait either: the project stays exactly as it is
    // until someone reads the log and deploys again. WHICH log is the whole
    // question, and `rebase cloud logs` is the build one.
    //
    // A readiness timeout means the build succeeded — the image was pushed and
    // the pod was started — and the process then died on boot. So the build log
    // this named is clean, and reads as a deploy that failed for no reason. The
    // reason is in the container's log, behind a flag nothing mentioned. Four
    // failures on one project were diagnosed that way, at five minutes each.
    if (input.lastDeploy.status && input.lastDeploy.status !== "success") {
        return {
            blockedOn: "last_deploy_failed",
            nextAction: bootFailed(input.lastDeploy.logs)
                ? "rebase cloud logs --runtime"
                : "rebase cloud logs"
        };
    }

    // A database that has been attached but never reached — the deploy
    // succeeded and the app cannot talk to its own store.
    if (input.database?.connectionStatus === "failed") {
        return { blockedOn: "database_unreachable",
nextAction: "rebase cloud db test" };
    }

    // Live, and nobody can sign in: the app switched magic-link (or email
    // code) sign-in on, and the deployment has no email service, so the route
    // answers 503. Rebase Cloud sends no mail of its own, and nothing else in
    // a deploy or a status said so.
    const unavailable = input.authConfig?.unavailable;
    if (unavailable?.magicLink === "EMAIL_NOT_CONFIGURED" || unavailable?.emailOtp === "EMAIL_NOT_CONFIGURED") {
        return {
            blockedOn: "email_not_configured",
            nextAction: "rebase cloud env set SMTP_HOST <host> (and SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM), then rebase cloud deploy"
        };
    }

    return { blockedOn: null,
nextAction: null };
}

/**
 * One line describing what engine is serving this project.
 *
 * Three numbers are in play and they are easy to conflate — I have watched it
 * happen. The **runtime version** (`1.2.0`) is the contract line a bundle's
 * range resolves against; its major IS the contract major. The **framework
 * version** (`0.11.0`) is the `@rebasepro` release the runtime image ships. They
 * move independently on purpose: tying the contract line to the framework would
 * make `^1` become `^0.11`, and pre-1.0 caret is restrictive, so every framework
 * minor would fall outside every project's range and force a rebuild to receive
 * an engine upgrade — the opposite of what the bundle/runtime split is for.
 *
 * So both are printed, rather than leaving anyone to infer one from a Docker tag.
 */
export function describeRuntime(project: {
    runtimeMode?: string | null;
    runtimeVersion?: string | null;
    runtimeFrameworkVersion?: string | null;
    runtimeVersionPin?: string | null;
}): string {
    // Absent is a third state, not a synonym for custom. `runtime_mode` stopped
    // defaulting to `custom` in migration 0040, so a project that has never
    // deployed has no mode at all — and "your own image" about one of those
    // asserts a container that was never built. The first deploy decides.
    if (project.runtimeMode == null || project.runtimeMode.trim() === "") {
        return `not deployed yet ${chalk.gray("· the first deploy decides (`--bundle` keeps it managed)")}`;
    }
    if (project.runtimeMode !== "managed") {
        return `custom ${chalk.gray("· your own image")}`;
    }
    const version = project.runtimeVersion ?? "unknown";
    const framework = project.runtimeFrameworkVersion;
    const pin = project.runtimeVersionPin ? chalk.gray(` · pinned to ${project.runtimeVersionPin}`) : "";
    // "image framework", not "framework". This one is what the IMAGE ships (the
    // server half); `cloud deployments` reports what each BUNDLE installed (the
    // driver half). Two facts about the two sides of the boundary the intake
    // floor exists to police — and while both were printed as "framework
    // version", the only way to read them was as one number contradicting
    // itself, which is exactly how it was reported.
    //
    // Absent rather than guessed: a release whose image tag is not a semver
    // (a `latest`, a branch build) records no framework version, and inventing
    // one here would defeat the point of storing it.
    const frameworkPart = framework ? chalk.gray(` · image framework ${framework}`) : "";
    return `managed ${version}${frameworkPart}${pin}`;
}

export async function statusCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 2,
command: "cloud status",
maxPositionals: 0 });
    const { client, url } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    try {
        const project = (await client.data.table("projects").findById(projectId)) as
            | {
                id: string | number; name?: string; subdomain?: string; host?: string; status?: string;
                gitBranch?: string; runtimeMode?: string | null; runtimeVersion?: string | null;
                runtimeFrameworkVersion?: string | null; runtimeContract?: number | null;
                runtimeRange?: string | null; runtimeVersionPin?: string | null;
                platformRebuiltVersion?: string | null;
            }
            | undefined;
        if (!project) fail(`Project ${displayProjectRef(rawArgs)} not found.`, undefined, "not_found");

        const [db, storage, deploy, baseDomain, maintenanceRead, domains] = await Promise.all([
            firstRow(client, "databases", projectId),
            // A control plane that does not have this route yet, or a lookup
            // that fails, yields `undefined` — which prints as a blank. A blank
            // is a better answer than a wrong one for exactly this field.
            client.functions
                .invoke<StorageState>("storage-provision", undefined, { method: "GET",
path: projectId })
                .catch(() => undefined),
            latestDeployment(client, projectId),
            fetchTenantBaseDomain(client, url),
            // A control plane without the maintenance function leaves the
            // section out and says so; the rest of the page is still the answer.
            readMaintenance(client, projectId),
            // Custom domains with whether HTTPS works on each: verified is the
            // DNS, and the certificate comes minutes later. Undefined when they
            // could not be read, which prints nothing rather than "none".
            projectDomainStates(client, projectId)
        ]);
        const maintenance = maintenanceRead.kind === "ok" ? maintenanceRead.status : undefined;
        const notServed = maintenanceRead.kind === "not_served" ? ["maintenance"] : [];

        const storageLine = describeStorageState(storage);
        const databaseLine = describeDatabaseState(db);
        // An unclaimed project's claim URL, read back from where `init --claim`
        // kept it: the only other copy was that command's output.
        const link = readLink();
        const grant = link?.projectId === projectId ? grantForLink(link) : undefined;
        const appKeyNote = grant && projectDotenvSetsAppKey() ? appKeyExpiryNote(grant.expiresAt) : undefined;
        // A platform upgrade that moved the live app past this checkout: only
        // when the checkout is this project's, since another directory's
        // packages say nothing about it.
        const drift = link?.projectId === projectId
            ? frameworkDrift(project.platformRebuiltVersion, localFrameworkVersion(process.cwd()))
            : undefined;
        const appUrl = projectHost(project, baseDomain);
        const blocked = resolveBlockedState({
            projectStatus: project.status,
            database: db as { connectionStatus?: string | null } | undefined,
            lastDeploy: deploy as { status?: string | null; logs?: string | null } | undefined,
            authConfig: deploy?.status === "success" && appUrl ? await readAuthConfig(appUrl) : undefined
        });

        emit(
            () => {
                console.log("");
                console.log(`  ${chalk.bold(project.name ?? project.subdomain ?? "")} ${chalk.gray(`[${project.subdomain ?? displayProjectRef(rawArgs)}]`)} ${colorStatus(project.status)}`);
                console.log("");
                keyValues([
                    ["URL", projectHost(project, baseDomain)],
                    ["Branch", project.gitBranch],
                    ["Last deploy", deploy ? `${colorStatus(deploy.status)} · ${fmtDate(deploy.createdAt)}` : "never"],
                    ["Runtime", describeRuntime(project)],
                    ["Database", databaseLine],
                    ["Storage", storageLine],
                    // A database change waiting for its window: said here so it
                    // is never a surprise on Sunday morning.
                    ["Maintenance", describePending(maintenance?.open)],
                    ["Domains", domains && domains.length > 0 ? domains.map(describeDomainStatus).join(", ") : undefined],
                    ["Rebuilt on", project.platformRebuiltVersion
                        ? `@rebasepro ${project.platformRebuiltVersion} ${chalk.gray("· by a platform upgrade, from your last deploy")}`
                        : undefined],
                    ["Claim URL", grant ? chalk.bold(grant.claimUrl) : undefined],
                    ["Expires", grant ? `${new Date(grant.expiresAt).toLocaleString()} unless claimed, then deleted` : undefined]
                ]);
                // The same fact the JSON carries, in the place a person reads.
                // Below the rows rather than inside them: it is not another
                // property of the project, it is what to do next.
                if (appKeyNote) {
                    console.log("");
                    console.log(chalk.gray(`  ${appKeyNote}`));
                }
                if (blocked.blockedOn) {
                    console.log("");
                    console.log(`  ${chalk.yellow("Waiting on you")} ${chalk.gray(`— ${blocked.blockedOn}`)}`);
                    console.log(`  ${chalk.bold(blocked.nextAction ?? "")}`);
                }
                if (drift) {
                    const said = driftSentence(drift);
                    console.log("");
                    console.log(`  ${chalk.yellow(`⚠ ${said.message}`)}`);
                    console.log(`  ${chalk.bold(drift.nextAction)} ${chalk.gray("before the next deploy, or it is refused.")}`);
                }
                console.log("");
                if (notServed.length > 0) note(chalk.gray(MAINTENANCE_NOT_SERVED_NOTE));
            },
            {
                projectId: String(project.id),
                name: project.name ?? null,
                subdomain: project.subdomain ?? null,
                status: project.status ?? null,
                // Siblings of `status` on purpose: a caller reading `status`
                // has to read these to know what it means. `blockedOn: null` is
                // the only value under which polling `status` is correct.
                blockedOn: blocked.blockedOn,
                nextAction: blocked.nextAction,
                url: projectHost(project, baseDomain) ?? null,
                branch: project.gitBranch ?? null,
                lastDeploy: deploy ? { id: String(deploy.id),
status: deploy.status ?? null,
createdAt: deploy.createdAt ?? null } : null,
                runtime: {
                    mode: project.runtimeMode ?? "custom",
                    version: project.runtimeVersion ?? null,
                    // `imageFrameworkVersion`, not `frameworkVersion`: this is
                    // the framework the IMAGE ships, while a row from
                    // `cloud deployments` carries `builtAgainst`, the framework
                    // that BUNDLE installed. They are routinely different (the
                    // image supplies the server, the bundle supplies the
                    // driver) and were both called `frameworkVersion`, so the
                    // two commands read as the control plane contradicting
                    // itself about one number.
                    imageFrameworkVersion: project.runtimeFrameworkVersion ?? null,
                    contract: project.runtimeContract ?? null,
                    range: project.runtimeRange ?? null,
                    pin: project.runtimeVersionPin ?? null,
                    // The @rebasepro release a platform upgrade rebuilt the live
                    // bundle on, while that rebuild is what runs; null otherwise.
                    platformRebuiltVersion: project.platformRebuiltVersion ?? null
                },
                // Set when the live app runs a newer @rebasepro than this
                // checkout: `nextAction` is what to run before deploying.
                frameworkDrift: drift ?? null,
                // Each custom domain, and `certificate` — what its HTTPS
                // answered — for the verified ones. Null when unreadable.
                domains: domains ?? null,
                database: db ? { type: db.type ?? null,
connectionStatus: db.connectionStatus ?? null } : null,
                storage: storage ?? null,
                // The database change waiting for its maintenance window, if any.
                maintenance: maintenance ? { window: maintenance.window, pending: maintenance.open } : null,
                // The sections this control plane does not serve yet, which is
                // why they are null above rather than empty.
                notServed,
                // Present while the project is unclaimed: open `claimUrl` and
                // sign in to keep it, before `expiresAt`.
                unclaimed: grant
                    ? { claimUrl: grant.claimUrl, expiresAt: grant.expiresAt, appKeyNote: appKeyNote ?? null }
                    : null
            }
        );
    } catch (e) {
        reportError(e, "Failed to load status");
    }
}

/* ─── metrics: live compute metrics ────────────────────────────── */

/** What `/api/functions/metrics/:projectId` returns. Mirrors saas metrics.ts. */
interface TenantMetrics {
    status?: string;
    cpu?: string;
    memory?: string;
    memoryPercent?: string;
    disk?: string | null;
    /** What the figures are OF — a project is not one machine. */
    subject?: { workload?: string; kind?: string; sampledInstances?: number } | null;
    /** The ceiling the percentages are measured against, per instance. */
    allocation?: {
        cpuLimitMillicores?: number | null;
        memoryLimitBytes?: number | null;
        cpuRequestMillicores?: number | null;
        memoryRequestBytes?: number | null;
    } | null;
    instances?: {
        name?: string;
        phase?: string;
        ready?: boolean;
        restarts?: number;
        cpuMillicores?: number | null;
        memoryBytes?: number | null;
        /** Why the previous container died. The whole story of a crashloop. */
        lastTerminationReason?: string | null;
        lastTerminationExitCode?: number | null;
        /** Why it has not started yet — ImagePullBackOff, CreateContainerError. */
        waitingReason?: string | null;
    }[] | null;
    condition?: { reason?: string; message?: string } | null;
}

/** What `/api/functions/metrics/:projectId/realtime` returns. Mirrors saas metrics.ts. */
interface TenantRealtime {
    /** `null` when the instances could not be listed. */
    instances?: {
        name?: string;
        /** `null` when this instance could not be asked, or its runtime does not report these. */
        realtime?: {
            sockets?: number;
            channels?: number;
            busFramesPublished?: number;
            busFramesSkipped?: number;
        } | null;
    }[] | null;
}

/**
 * One row per instance, under a header, for `cloud metrics`.
 *
 * Per instance because that is the question: where the sockets landed. A group
 * that stays on one instance shows as `skipped` climbing while `to bus` stays
 * flat, and both count from when that instance started.
 */
export function realtimeTable(instances: NonNullable<TenantRealtime["instances"]>): string[] {
    const row = (name: string, cells: (number | string | undefined)[]) =>
        `${name.padEnd(34)} ${cells.map((cell, i) => String(cell ?? "—").padStart(i < 2 ? 8 : 9)).join("  ")}`;
    return [
        row("", ["sockets", "channels", "to bus", "skipped"]),
        ...instances.map(({ name, realtime: r }) =>
            row(name ?? "?", [r?.sockets, r?.channels, r?.busFramesPublished, r?.busFramesSkipped]))
    ];
}

/**
 * CPU with the ceiling it is a percentage of.
 *
 * A bare "0.2%" is unreadable without knowing 0.2% of what, and on a burstable
 * pod the answer is not obvious: these request 250m and may burst to 2 vCPU, so
 * a pod at 40% of its LIMIT is at over three times its guaranteed share and may
 * still be throttled. Naming both is the difference between a number and a
 * number that means something.
 */
function cpuLine(m: TenantMetrics): string | undefined {
    if (!m.cpu) return undefined;
    const limit = m.allocation?.cpuLimitMillicores;
    const request = m.allocation?.cpuRequestMillicores;
    if (limit == null && request == null) return m.cpu;
    const parts = [
        request != null ? `${request}m guaranteed` : null,
        limit != null ? `bursts to ${limit}m` : null
    ].filter(Boolean).join(", ");
    return `${m.cpu} ${chalk.gray(`(${parts}, per instance)`)}`;
}

/** What `rebase cloud metrics` parses. Its page pairs against this. */
export const METRICS_FLAGS = {
    "--runtime": Boolean,
    "--history": Boolean,
    "--series": String,
    "--minutes": String
} as const;

/**
 * The series a runtime records, and so the ones `--history` may name.
 *
 * The runtime's own list (`METRIC_SERIES` in
 * `packages/server/src/metrics/history-store.ts`), which is not exported;
 * `cloud-api-commands.test.ts` holds the two together.
 */
export const HISTORY_SERIES = [
    "cpu_millicores", "memory_bytes", "event_loop_delay_ms",
    // Requests and 5xx answers per minute, per surface.
    "requests_data", "errors_data",
    "requests_auth", "errors_auth",
    "requests_storage", "errors_storage",
    "requests_functions", "errors_functions",
    "requests_app", "errors_app"
] as const;

/** The longest window the runtime keeps: fourteen days, in minutes. */
export const HISTORY_MAX_MINUTES = 20_160;

/** What `/api/functions/metrics/:projectId/runtime` returns. Mirrors saas metrics.ts. */
export interface RuntimeRollup {
    projectId?: string;
    at?: string;
    /** `null` when the app could not be scraped: not deployed, starting, or metrics off. */
    rollup?: {
        uptimeSeconds?: number;
        heapBytes?: number;
        rssBytes?: number;
        totalRequests?: number;
        totalErrors?: number;
        meanLatencyMs?: number;
        surfaces?: { surface?: string; requests?: number; errors?: number; meanLatencyMs?: number }[];
    } | null;
}

/** What `/api/functions/metrics/:projectId/history` returns. Mirrors saas metrics.ts. */
export interface MetricHistory {
    series?: string;
    minutes?: number;
    /** `null` when the history could not be read; `reason` says why. */
    points?: { at: string; value: number; instances?: number }[] | null;
    reason?: string;
    retryable?: boolean;
}

/** The share of requests that failed, as a percentage with one decimal; undefined with no requests. */
export function errorRate(requests: number | undefined, errors: number | undefined): string | undefined {
    if (!requests) return undefined;
    return `${(((errors ?? 0) / requests) * 100).toFixed(1)}%`;
}

/** `--series` and `--minutes`, checked: the series one the runtime records, the window 1 to 14 days in minutes. */
export function resolveHistoryArgs(flags: { "--series"?: string; "--minutes"?: string }): { series: string; minutes: number } {
    const series = flags["--series"] ?? "cpu_millicores";
    if (!(HISTORY_SERIES as readonly string[]).includes(series)) {
        fail(`--series ${series} is not a series the runtime records.`, `Use one of: ${HISTORY_SERIES.join(", ")}.`, "usage");
    }
    const raw = flags["--minutes"] ?? "60";
    const minutes = Number(raw);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > HISTORY_MAX_MINUTES) {
        fail(`--minutes takes a whole number from 1 to ${HISTORY_MAX_MINUTES} (got "${raw}").`, "The runtime keeps fourteen days.", "usage");
    }
    return { series, minutes };
}

/** A history value in the series' own unit, for a person. */
function historyValue(series: string, value: number): string {
    if (series === "memory_bytes") return `${(value / 1024 / 1024).toFixed(0)} MiB`;
    if (series === "cpu_millicores") return `${Math.round(value)}m`;
    if (series.startsWith("requests_")) return `${Math.round(value)} requests`;
    if (series.startsWith("errors_")) return `${Math.round(value)} errors`;
    return `${value.toFixed(1)} ms`;
}

export async function metricsCommand(rawArgs: string[]): Promise<void> {
    const { flags } = parseCloudArgs({ spec: METRICS_FLAGS,
rawArgs,
commandWords: 2,
command: "cloud metrics",
maxPositionals: 0 });
    if (flags["--runtime"] && flags["--history"]) {
        fail("--runtime and --history are two different reports; pass one.", "Run `rebase cloud metrics --help`.", "usage");
    }
    if (!flags["--history"] && (flags["--series"] !== undefined || flags["--minutes"] !== undefined)) {
        fail("--series and --minutes go with --history.", "e.g. `rebase cloud metrics --history --series memory_bytes --minutes 180`.", "usage");
    }
    // Checked before the client is built: a usage error needs no session.
    const history = flags["--history"] ? resolveHistoryArgs(flags) : undefined;
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    if (flags["--runtime"]) return runtimeMetrics(client, projectId, displayProjectRef(rawArgs) || projectId);
    if (history) return historyMetrics(client, projectId, displayProjectRef(rawArgs) || projectId, history);
    try {
        const [m, realtime] = await Promise.all([
            client.functions.invoke<TenantMetrics>("metrics", undefined, { method: "GET", path: projectId }),
            // On its own and not fatal: it asks every instance, and the figures
            // above are still true when one of them, or an older control plane,
            // does not answer.
            client.functions.invoke<TenantRealtime>("metrics", undefined, { method: "GET", path: `${projectId}/realtime` })
                .catch(() => null)
        ]);

        // What the numbers are OF. The endpoint has reported this since it
        // learned to, and this command threw it away — printing bare
        // "CPU / Memory" over figures that only ever cover the backend
        // Deployment. A reader had every reason to think the database was in
        // them; `metrics.ts` says in its own comment that it is not.
        const of = m.subject?.workload
            ? `${m.subject.workload}${m.subject.kind === "deployment" ? " (backend only — not the database)" : ""}`
            : undefined;

        // Sampled, not desired. A pod that has not reported to metrics-server
        // yet is absent from the sum, so "89 MiB" across one instance of two is
        // half a picture and should say so.
        const sampled = m.subject?.sampledInstances;
        const coverage = sampled === undefined
            ? undefined
            : sampled === 0
              ? chalk.yellow("no instances reported yet")
              : `${sampled} instance${sampled === 1 ? "" : "s"}`;

        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  📊 Metrics — project ${displayProjectRef(rawArgs)}`));
                console.log("");
                keyValues([
                    ["Status", m.status ? colorStatus(m.status === "running" ? "active" : m.status) : undefined],
                    ["Measuring", of],
                    ["Sampled", coverage],
                    ["CPU", cpuLine(m)],
                    ["Memory", m.memory ? `${m.memory}${m.memoryPercent ? ` (${m.memoryPercent})` : ""}` : undefined],
                    ["Disk", m.disk]
                ]);

                // Why it is unhealthy, when it is. Straight from the workload's
                // own conditions — the endpoint does not interpret it and
                // neither does this.
                if (m.condition) {
                    console.log("");
                    console.error(chalk.red(`  ✗ ${m.condition.reason ?? "Not healthy"}`));
                    if (m.condition.message) note(`  ${m.condition.message}`);
                }

                // Per instance, because an average hides the pod that is hot.
                if (m.instances?.length) {
                    console.log("");
                    note("  Instances");
                    for (const i of m.instances) {
                        const cpu = i.cpuMillicores != null ? `${Math.round(i.cpuMillicores)}m` : "—";
                        const mem = i.memoryBytes != null ? `${(i.memoryBytes / 1024 / 1024).toFixed(0)} MiB` : "—";
                        const health = i.ready === false ? chalk.yellow(" not ready") : "";
                        // Restarts are the first thing anyone wants when a
                        // tenant is misbehaving, and a silent 0 is noise — so it
                        // only appears when there are any.
                        const restarts = i.restarts ? chalk.yellow(` ${i.restarts}×restarted`) : "";
                        note(`    ${(i.name ?? "?").padEnd(34)} ${cpu.padStart(6)}  ${mem.padStart(9)}${health}${restarts}`);
                        // Why the last one died, when one did. This is the line
                        // that turns "it keeps restarting" into a diagnosis, and
                        // it was being fetched and discarded.
                        if (i.lastTerminationReason) {
                            note(chalk.gray(
                                `      last exit: ${i.lastTerminationReason}` +
                                (i.lastTerminationExitCode != null ? ` (code ${i.lastTerminationExitCode})` : "")
                            ));
                        }
                        if (i.waitingReason) note(chalk.gray(`      waiting: ${i.waitingReason}`));
                    }
                }

                if (realtime?.instances?.length) {
                    console.log("");
                    note("  Realtime, since each instance started");
                    for (const line of realtimeTable(realtime.instances)) note(`    ${line}`);
                }
                console.log("");
            },
            {
                projectId,
                status: m.status ?? null,
                cpu: m.cpu ?? null,
                memory: m.memory ?? null,
                memoryPercent: m.memoryPercent ?? null,
                disk: m.disk ?? null,
                // Passed through rather than reshaped: a script that wants the
                // ceiling to compute its own percentage should get the same
                // numbers the server sent.
                subject: m.subject ?? null,
                allocation: m.allocation ?? null,
                instances: m.instances ?? null,
                condition: m.condition ?? null,
                realtime: realtime?.instances ?? null
            }
        );
    } catch (e) {
        reportError(e, "Failed to fetch metrics");
    }
}

/** `rebase cloud metrics --runtime`: what the app itself counted since it started. */
async function runtimeMetrics(client: CloudClient, projectId: string, label: string): Promise<void> {
    let res: RuntimeRollup;
    try {
        res = await client.functions.invoke<RuntimeRollup>("metrics", undefined, { method: "GET", path: `${projectId}/runtime` });
    } catch (e) {
        reportError(e, "Failed to fetch runtime metrics");
    }
    const r = res.rollup ?? null;
    const rate = r ? errorRate(r.totalRequests, r.totalErrors) : undefined;
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  📈 Runtime — project ${label}`));
            console.log("");
            if (!r) {
                // Not zeroes: an app that could not be read is not an idle one.
                console.log(chalk.gray("  No data yet: the app is not deployed, is still starting, or does not report metrics."));
                console.log("");
                return;
            }
            keyValues([
                ["Requests", r.totalRequests !== undefined ? String(r.totalRequests) : undefined],
                ["Errors (5xx)", r.totalErrors !== undefined ? `${r.totalErrors}${rate ? ` (${rate})` : ""}` : undefined],
                ["Mean latency", r.meanLatencyMs !== undefined ? `${r.meanLatencyMs.toFixed(1)} ms` : undefined],
                ["Up for", r.uptimeSeconds !== undefined ? `${Math.round(r.uptimeSeconds / 60)} min` : undefined],
                ["Memory (RSS)", r.rssBytes !== undefined ? `${(r.rssBytes / 1024 / 1024).toFixed(0)} MiB` : undefined]
            ]);
            if (r.surfaces?.length) {
                console.log("");
                console.log(chalk.gray(`  ${"".padEnd(14)} ${"requests".padStart(9)}  ${"errors".padStart(7)}  ${"latency".padStart(9)}`));
                for (const surface of r.surfaces) {
                    console.log(
                        `  ${(surface.surface ?? "?").padEnd(14)} ${String(surface.requests ?? 0).padStart(9)}  `
                        + `${String(surface.errors ?? 0).padStart(7)}  ${`${(surface.meanLatencyMs ?? 0).toFixed(1)} ms`.padStart(9)}`
                    );
                }
            }
            console.log("");
            note(chalk.gray("Counted by the running instance since it started; a restart begins again at zero."));
            console.log("");
        },
        {
            projectId,
            at: res.at ?? null,
            rollup: r,
            errorRate: r && r.totalRequests ? (r.totalErrors ?? 0) / r.totalRequests : null
        }
    );
}

/** `rebase cloud metrics --history`: one series the runtime recorded, over a window. */
async function historyMetrics(
    client: CloudClient,
    projectId: string,
    label: string,
    args: { series: string; minutes: number }
): Promise<void> {
    let res: MetricHistory;
    try {
        res = await client.functions.invoke<MetricHistory>("metrics", undefined, {
            method: "GET",
            path: `${projectId}/history?series=${encodeURIComponent(args.series)}&minutes=${args.minutes}`
        });
    } catch (e) {
        reportError(e, "Failed to fetch metric history");
    }
    const points = Array.isArray(res.points) ? res.points : null;
    const values = (points ?? []).map(p => p.value).filter(v => typeof v === "number" && Number.isFinite(v));
    const summary = values.length
        ? {
            min: Math.min(...values),
            max: Math.max(...values),
            mean: values.reduce((a, b) => a + b, 0) / values.length,
            latest: values[values.length - 1]
        }
        : null;
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🕘 ${args.series} — project ${label}, last ${args.minutes} min`));
            console.log("");
            if (!points) {
                console.log(chalk.yellow(`  ${res.reason ?? "The control plane returned no history."}`));
                console.log("");
                return;
            }
            if (!summary) {
                console.log(chalk.gray("  Nothing recorded in this window."));
                console.log("");
                return;
            }
            keyValues([
                ["Samples", String(values.length)],
                ["Latest", historyValue(args.series, summary.latest)],
                ["Mean", historyValue(args.series, summary.mean)],
                ["Min", historyValue(args.series, summary.min)],
                ["Max", historyValue(args.series, summary.max)]
            ]);
            console.log("");
            note(chalk.gray("Every sample is in the JSON (`--json`): its time, value and how many instances it covers."));
            console.log("");
        },
        {
            projectId,
            series: res.series ?? args.series,
            minutes: res.minutes ?? args.minutes,
            points,
            summary,
            reason: points ? null : res.reason ?? null,
            retryable: points ? null : res.retryable === true
        }
    );
    // No history is a failed read, not an empty one: scripts branch on the code.
    if (!points) process.exitCode = 1;
}

/* ─── webhooks (retired) ───────────────────────────────────────── */

/**
 * `rebase cloud webhooks` is retired, and says where to go instead.
 *
 * It never worked. It wrote rows to a data collection named `webhooks` on the
 * control plane, whose real slug is `database-webhooks` — and nothing on the
 * control plane ever delivered those rows anyway. What people reached for it
 * to do is now two other things:
 *
 *  - a project's own events (a deploy failed, backups stopped, a payment was
 *    declined, usage passed 80%) to Slack, Discord or any URL:
 *    `rebase cloud notifications`;
 *  - a POST when rows of your app's own tables change: a `WebhookDispatcher`
 *    in your app's code, which your backend delivers itself.
 *
 * Every action answers the same refusal, exit 1, code `command_retired`, with
 * both routes — a retired command that still exits 0 would tell a script its
 * webhook exists.
 */
export const WEBHOOKS_RETIRED_HINT =
    "For a project's events (deploy failed, backups, billing, usage) to Slack, Discord or any URL: "
    + "`rebase cloud notifications add <url>`. For row changes in your app's own tables: a WebhookDispatcher "
    + "in your app's code — https://rebase.pro/docs/recipes/webhooks/";

export async function webhooksCommand(_subcommand: string | undefined, _rawArgs: string[]): Promise<void> {
    fail(
        "`rebase cloud webhooks` is retired: it never delivered anything.",
        WEBHOOKS_RETIRED_HINT,
        "command_retired"
    );
}

/* ─── storage ──────────────────────────────────────────────────── */

/** The action words `rebase cloud storage` dispatches. No word means `list`. */
export const STORAGE_ACTIONS = ["list", "create", "delete", "keys", "usage", "limit", "cors", "import", "attach"] as const;

export async function storageCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    // `rebase cloud storage` used to only ever list. A tenant could therefore
    // reach durable storage only by creating a bucket by hand in a cloud
    // console, minting credentials, and pasting them into the web UI — and
    // until they did, the project simply had no file storage. These make it a
    // thing the platform can do for you.
    //
    // `action` is the positional the dispatcher already resolved, as for every
    // other resource group. Re-deriving it here by index was wrong — the group
    // sits at rawArgs[3], so rawArgs[2] is always the literal "cloud" and no
    // subcommand ever matched.
    if (action === "create") return storageCreateCommand(rawArgs);
    if (action === "attach") return storageAttachCommand(rawArgs);
    // Rebase Storage: the platform's own S3-compatible buckets (rebase-storage.ts).
    if (action === "delete") return storageDeleteBucket(rawArgs);
    if (action === "keys") return storageKeysCommand(rawArgs);
    if (action === "usage") return storageUsageCommand(rawArgs);
    if (action === "limit") return storageLimitCommand(rawArgs);
    if (action === "cors") return storageCorsCommand(rawArgs);
    if (action === "import") return storageImportCommand(rawArgs);
    if (action === "help") return printStorageHelp();
    // Everything that is not one of those, and is not `list` or nothing, is a
    // typo — and used to LIST, exit 0, and read as a bucket that was created.
    requireKnownAction("storage", action, STORAGE_ACTIONS);
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud storage",
maxPositionals: 0 });

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    try {
        // Rebase Storage (buckets, keys, usage) and the project's `storages`
        // rows — what the deployed app is pointed at, including a bucket of
        // its own attached with `attach` — side by side. Neither replaces the
        // other: a project can have both, and only the rows say which bucket
        // the app reads.
        const [found, storesResult] = await Promise.all([
            fetchStorageOverview(client, projectId),
            client.data.table("storages").find({
                where: { project: ["==", projectId] },
                limit: 50
            })
        ]);
        const stores = storesResult.data as Array<{
            id: string | number;
            sourceKey?: string;
            type?: string;
            provider?: string;
            bucketName?: string;
            s3Bucket?: string;
            status?: string;
        }>;
        const overview = "overview" in found ? found.overview : undefined;

        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🪣 Storage — project ${displayProjectRef(rawArgs)}`));
                console.log("");
                if (overview) {
                    printRebaseStorageOverview(overview);
                } else if ("unavailable" in found && found.unavailable === "error") {
                    console.log(chalk.gray(`  Rebase Storage could not be read: ${found.message}`));
                    console.log("");
                }
                if (stores.length === 0) {
                    if (!overview) {
                        console.log(chalk.gray("  No storage buckets attached."));
                        console.log("");
                    }
                    return;
                }
                console.log(chalk.bold("  Attached to the app"));
                for (const s of stores) {
                    // `bucketName` is written by managed provisioning only, so
                    // a bucket attached from the console or by `attach` listed
                    // as "byos" — the type, printed where the name goes. The
                    // name the tenant actually reads is `s3Bucket`.
                    const name = s.bucketName || s.s3Bucket || "(no bucket)";
                    const key = s.sourceKey || DEFAULT_STORAGE_SOURCE_KEY;
                    console.log(`  ${chalk.bold(name)} ${chalk.gray(`[${s.id}]`)} ${colorStatus(s.status)}`);
                    keyValues([["Source", key], ["Provider", s.provider], ["Type", s.type]]);
                }
                console.log("");
            },
            {
                projectId,
                // `null` when this platform has no Rebase Storage, or the
                // control plane predates it; `rebaseStorageUnavailable` says which.
                rebaseStorage: overview ?? null,
                rebaseStorageUnavailable: "unavailable" in found ? found.unavailable : null,
                stores: stores.map((s) => ({
                    id: String(s.id),
                    sourceKey: s.sourceKey || DEFAULT_STORAGE_SOURCE_KEY,
                    bucketName: s.bucketName || s.s3Bucket || null,
                    type: s.type ?? null,
                    provider: s.provider ?? null,
                    status: s.status ?? null
                }))
            }
        );
    } catch (e) {
        reportError(e, "Failed to list storage");
    }
}

/** The Rebase Storage half of `rebase cloud storage`: endpoint, buckets, keys, one usage line. */
function printRebaseStorageOverview(o: StorageOverview): void {
    console.log(chalk.bold("  Rebase Storage"));
    keyValues([["Endpoint", o.endpoint], ["Region", o.region]]);
    console.log("");
    if (o.buckets.length === 0) {
        console.log(chalk.gray("  No buckets yet:  ") + chalk.bold("rebase cloud storage create <bucket>"));
    } else {
        console.log(`  ${chalk.gray(`Buckets (${o.buckets.length})`)}`);
        const width = Math.max(...o.buckets.map(b => b.name.length));
        for (const b of o.buckets) {
            const cors = b.cors?.length ? `CORS: ${b.cors.length} rule${b.cors.length === 1 ? "" : "s"}` : "no CORS";
            console.log(`    ${chalk.bold(b.name.padEnd(width))}  ${chalk.gray(`created ${fmtDate(b.createdAt)} · ${cors}`)}`);
        }
    }
    const readOnly = o.keys.filter(k => k.permission === "read").length;
    console.log(`  ${chalk.gray("Keys:")} ${o.keys.length}${o.keys.length ? chalk.gray(` (${readOnly} read-only) · rebase cloud storage keys`) : chalk.gray(" · rebase cloud storage keys create")}`);
    const u = o.usage;
    const pct = u.capBytes > 0 ? Math.round((u.estimatedBytes / u.capBytes) * 100) : 0;
    console.log(`  ${chalk.gray("Usage:")} ${formatBytes(u.estimatedBytes)} of ${formatBytes(u.capBytes)} cap (${pct}%) · `
        + `${formatEur(monthlyCostEur(u.estimatedBytes, o.pricing))}/month`
        + chalk.gray(" · rebase cloud storage usage"));
    console.log("");
}

export function printStorageHelp(): void {
    printGroupHelp({
        command: "cloud storage",
        title: "The project's object storage",
        actions: [
            { action: "list",
description: "Rebase Storage's endpoint, buckets, keys and usage, and what the app is attached to" },
            { action: "create",
args: "<bucket>",
description: "Create a Rebase Storage bucket. Names are global" },
            { action: "delete",
args: "<bucket>",
description: "Delete a bucket and its files. Confirms" },
            {
                action: "keys",
                args: "[list|create|rotate|revoke]",
                description: "S3 access keys. The secret is shown once, on create and rotate",
                flags: [
                    ["--name <name>", "create: what to call the key"],
                    ["--read-only", "create: read, never write"],
                    ["--bucket <name>", "create: one bucket only. Default: every bucket in the project"]
                ]
            },
            { action: "usage",
description: "Stored bytes against the cap, the month's cost, and egress" },
            { action: "limit",
args: "[<GB>]",
description: "Show or set the storage cap, which bounds the bill" },
            {
                action: "cors",
                args: "<bucket>",
                description: "Show or replace a bucket's CORS rules",
                flags: [
                    ["--allow-origin <o>", "An origin browsers may call from. Repeatable"],
                    ["--allow-method <m>", "GET, HEAD, PUT, POST, DELETE. Repeatable. Default: GET, HEAD"],
                    ["--allow-header <h>", "A request header to allow. Repeatable"],
                    ["--file <rules.json>", "The rules as JSON instead"],
                    ["--clear", "Remove every rule"]
                ]
            },
            {
                action: "import",
                description: "Copy another S3 bucket into Rebase Storage, run by the platform",
                flags: [
                    ["--from s3://<bucket>[/<prefix>]", "The source. Required"],
                    ["--to <bucket>", "The Rebase Storage bucket to fill. Required"],
                    ["--region <region>", "Source region. Required"],
                    ["--access-key-id <id>", "Source key. Required"],
                    ["--secret-access-key <s|->", "Source secret, `-` for stdin, or REBASE_IMPORT_SECRET_ACCESS_KEY"],
                    ["--endpoint <url>", "Source endpoint. Omit for AWS S3"],
                    ["--switch-app", "Point the app at the copy once it is verified"],
                    ["--wait", "Follow it to the end"],
                    ["--status <importId>", "Read an import already started"]
                ]
            },
            {
                action: "attach",
                description: "Attach your own S3-compatible bucket",
                flags: [
                    ["--bucket <name>", "Bucket name. Required"],
                    ["--access-key-id <id>", "Access key ID. Required"],
                    ["--secret-access-key <s>", "Secret access key. Required"],
                    ["--endpoint <url>", "S3 endpoint. Omit for AWS"],
                    ["--region <region>", "Region"],
                    ["--force-path-style", "Required by MinIO and some gateways"],
                    ["--source <key>", "Which declared bucket. Default: the default one"]
                ]
            }
        ],
        notes: [
            "Each action has its own page: `rebase cloud storage keys create --help`.",
            "`storage create` with no bucket name still provisions platform-managed storage for the",
            "app, and is deprecated: create a bucket and a key instead.",
            "Without storage, uploads are refused with 501 STORAGE_NOT_CONFIGURED rather than",
            "written to a container filesystem that is erased on the next restart.",
            "Redeploy after `attach` for the tenant to pick the credentials up."
        ]
    });
}

/* ─── storage create: platform-managed ─────────────────────────── */

async function storageCreateCommand(rawArgs: string[]): Promise<void> {
    // Takes no options of its own, and provisions billable infrastructure: an
    // unrecognised flag here (`storage create --region eu`, borrowed from
    // `attach`) provisioned in the default region and said nothing.
    const { positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud storage create
        command: "cloud storage create",
        maxPositionals: 1
    });
    // `storage create <bucket>` is Rebase Storage. Without a name it is the
    // older platform-managed provisioning, kept working and deprecated.
    if (positionals[0]) return storageCreateBucket(rawArgs, positionals[0]);
    warnDeprecated(
        "cli.cloud-storage-create-managed",
        "`rebase cloud storage create` with no bucket name is deprecated. Create a Rebase Storage bucket and a key "
        + "instead: `rebase cloud storage create <bucket>`, then `rebase cloud storage keys create --bucket <bucket>`."
    );
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    try {
        noteBlank();
        note(chalk.gray("Provisioning managed storage — this creates a bucket and grants your project access to it..."));

        const res = await client.functions.invoke<{
            data: {
                bucketName: string;
                region: string;
                // Absent from a control plane that predates keyless buckets,
                // which only ever answered with a key.
                access?: "s3-key" | "workload-identity";
                endpoint: string | null;
                accessKeyId: string | null;
            };
            // The project id is a SUB-PATH, not part of the function name.
            // `invoke` runs `encodeURIComponent` over the name — correct, since
            // a function name is one path segment — so folding the id into it
            // sent `POST /api/functions/storage-provision%2F<id>`, which matches
            // no route. The control plane answered a bare 404 and
            // `rebase cloud storage create` read as an unimplemented feature for
            // six weeks. `invoke` now refuses a name containing `/` outright.
        }>("storage-provision", undefined, { method: "POST", path: projectId });

        // `res.data`, once. What stood here was
        // `res.data ?? res.data`, the first read through a double cast —
        // both halves read the same property off the same object, so the `??`
        // could never reach its right-hand side. The cast made it look like a
        // fallback between two response shapes by making `data` optional on one
        // of them; `invoke<T>` returns `T`, and `T` here declares `data`.
        const info = res.data;
        // A GCS bucket granted to the project's workload identity has no key
        // at all, so "the secret is stored encrypted" would be untrue there.
        const access = info.access ?? (info.accessKeyId ? "s3-key" : "workload-identity");

        success(`Managed storage provisioned for ${displayProjectRef(rawArgs)}.`);
        emit(
            () => {
                keyValues([
                    ["Bucket", info.bucketName],
                    ["Region", info.region],
                    ["Endpoint", info.endpoint],
                    ["Access key", info.accessKeyId],
                    ["Access", access === "workload-identity" ? "workload identity (no key)" : undefined]
                ]);
                noteBlank();
                // The secret is never returned by the endpoint — it goes to the
                // row and to the tenant's environment. Say so, or the absence
                // reads as a bug.
                note(chalk.gray(access === "workload-identity"
                    ? "The bucket is granted to your project's workload identity; there is no key to store or rotate."
                    : "The secret key is stored encrypted and injected at deploy time; it is not displayed."));
                note(chalk.gray("Redeploy for the tenant to pick it up:  ") + chalk.bold("rebase cloud deploy"));
                noteBlank();
            },
            {
                success: true,
                projectId,
                bucketName: info.bucketName,
                region: info.region,
                access,
                endpoint: info.endpoint,
                accessKeyId: info.accessKeyId,
                // Always null, and stated rather than omitted so a caller does
                // not read its absence as a bug: with a key the secret is
                // stored encrypted and never returned; with workload identity
                // (see `access`) there is none.
                secretAccessKey: null,
                pendingRedeploy: true
            }
        );
    } catch (e) {
        reportError(e, "Failed to provision managed storage");
    }
}

/* ─── storage attach: bring your own ───────────────────────────── */

async function storageAttachCommand(rawArgs: string[]): Promise<void> {
    // Strict: every value here is credentials or the bucket they open, and the
    // permissive parse turned a mistyped `--acces-key-id` into the "missing
    // --access-key-id" refusal below — the right refusal for the wrong reason,
    // and one that says nothing about the flag that was actually wrong.
    const { flags: parsed } = parseCloudArgs({
        spec: {
            "--bucket": String,
            "--access-key-id": String,
            "--secret-access-key": String,
            "--endpoint": String,
            "--region": String,
            "--force-path-style": Boolean,
            // Which declared bucket this configures. A project has one row per
            // source, and without this the command took `limit: 1` off an
            // unordered find and updated whichever row came back — so
            // attaching a bucket to a two-bucket project could overwrite
            // `media`'s credentials while reporting success.
            "--source": String
        },
        rawArgs,
        commandWords: 3, // cloud storage attach
        command: "cloud storage attach",
        maxPositionals: 0
    });

    const bucket = parsed["--bucket"];
    const accessKeyId = parsed["--access-key-id"];
    const secretAccessKey = parsed["--secret-access-key"];

    // All three or none. A bucket carrying no credentials is the state that
    // reads as configured in the console and fails on the first upload.
    const missing = [
        !bucket && "--bucket",
        !accessKeyId && "--access-key-id",
        !secretAccessKey && "--secret-access-key"
    ].filter(Boolean) as string[];
    if (missing.length > 0) {
        fail(
            `Missing ${missing.join(", ")}.`,
            "A bucket without credentials cannot be used, and would be stored as though it could. " +
            "Run `rebase cloud storage --help` for the full list.",
            "usage"
        );
    }

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    const sourceKey = (parsed["--source"] ?? "").trim() || DEFAULT_STORAGE_SOURCE_KEY;

    try {
        const existing = (await client.data.table("storages").find({
            where: { project: ["==", projectId] },
            limit: 50
        })).data.find((r) => {
            const key = (r as { sourceKey?: unknown }).sourceKey;
            return (typeof key === "string" && key ? key : DEFAULT_STORAGE_SOURCE_KEY) === sourceKey;
        }) as { id?: string | number } | undefined;

        const row: Record<string, unknown> = {
            project: projectId,
            // Written, not left to the column default: a row that does not say
            // which source it configures is a row the console and the deploy
            // path both have to guess about.
            sourceKey,
            type: "byos",
            status: "active",
            s3Bucket: bucket,
            s3AccessKeyId: accessKeyId,
            s3SecretAccessKey: secretAccessKey,
            bucketName: bucket
        };
        if (parsed["--endpoint"]) row.s3Endpoint = parsed["--endpoint"];
        if (parsed["--region"]) {
            row.s3Region = parsed["--region"];
            row.region = parsed["--region"];
        }
        // Only when set: AWS rejects path style, so an unconditional false
        // would be noise in every project that does not need it.
        if (parsed["--force-path-style"]) row.s3ForcePathStyle = true;

        const replaced = Boolean(existing?.id);
        if (existing?.id) {
            await client.data.table("storages").update(String(existing.id), row);
        } else {
            await client.data.table("storages").create(row);
        }

        success(`Storage attached to ${displayProjectRef(rawArgs)}.`);
        emit(
            () => {
                keyValues([
                    ["Bucket", bucket],
                    ["Endpoint", parsed["--endpoint"] ?? "AWS S3"],
                    ["Region", parsed["--region"] ?? "(default)"]
                ]);
                noteBlank();
                note(chalk.gray("Redeploy for the tenant to pick it up:  ") + chalk.bold("rebase cloud deploy"));
                noteBlank();
            },
            {
                success: true,
                projectId,
                bucket,
                endpoint: parsed["--endpoint"] ?? null,
                region: parsed["--region"] ?? null,
                forcePathStyle: Boolean(parsed["--force-path-style"]),
                // The one fact the human rendering does not carry: `attach` over
                // an existing row is an overwrite, and a caller re-running it in
                // a script should be able to tell that it replaced something.
                replaced,
                pendingRedeploy: true
            }
        );
    } catch (e) {
        reportError(e, "Failed to attach storage");
    }
}

/* ─── clusters ─────────────────────────────────────────────────── */

/** The action words `rebase cloud clusters` dispatches. No word means `list`. */
export const CLUSTERS_ACTIONS = ["list", "add", "verify", "registry", "baseline", "open", "close"] as const;

/**
 * `rebase cloud clusters` — list, register and verify the clusters tenants run on.
 *
 * Registration is deliberately an operator action: the `clusters` collection is
 * admin-only, and a cluster record carries a credential with enough power to
 * create namespaces and read every secret in them. A self-serve "bring your own
 * cluster" flow is a different feature with a different threat model.
 */
export async function clustersCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    if (action === "verify") return clustersVerifyCommand(rawArgs);
    if (action === "add") return clustersAddCommand(rawArgs);
    if (action === "registry") return clustersRegistryCommand(rawArgs);
    if (action === "baseline") return clustersBaselineCommand(rawArgs);
    if (action === "open" || action === "close") return clustersOpenCommand(action, rawArgs);
    // `clusters verifyy` used to LIST the clusters and exit 0 — the one command
    // whose whole purpose is to answer a yes/no question about a specific one.
    requireKnownAction("clusters", action, CLUSTERS_ACTIONS);
    return clustersListCommand(rawArgs);
}

/**
 * Ask a registered cluster whether it can actually host a tenant.
 *
 * The question this exists to answer early is the one that otherwise gets
 * answered by a customer's first deploy failing halfway through provisioning,
 * with an error they cannot act on and half a tenant already created.
 */
/**
 * Which cluster `clusters verify` was asked about, and whether `--baseline`
 * was given.
 *
 * Resolved against a real spec, not scanned out of `rawArgs` by hand — and this
 * is not a tidy-up. `rawArgs` is the whole `process.argv`, so the old scan
 * ("the first token that is not `--…` and is neither `clusters` nor `verify`")
 * matched `argv[0]`, the **node binary path**. Every `rebase cloud clusters
 * verify <id>` therefore asked the control plane about a cluster called
 * `/usr/local/bin/node`, and came back 404.
 *
 * So the one diagnostic that reports `permissions.allowed` /
 * `permissions.denied` was unreachable, and its 404 read as "this command is
 * not deployed yet" rather than "the id never left this machine intact". It is
 * the command that names a missing `cronjobs.batch` grant in a single call
 * instead of a twenty-minute A/B against a live project.
 *
 * Same failure as `cloud deploy` reading `_[0]` as `"cloud"`, and the same fix:
 * one parser, exported so its test drives the real thing rather than a copy.
 */
export function resolveClusterVerifyArgs(rawArgs: string[]): { id?: string; baseline: boolean } {
    const { flags, positionals } = parseCloudArgs({
        spec: { "--baseline": Boolean },
        rawArgs,
        commandWords: 2, // cloud clusters — `verify` is the action positional
        command: "cloud clusters verify",
        maxPositionals: 2
    });
    return { id: positionals[1],
baseline: flags["--baseline"] === true };
}

async function clustersVerifyCommand(rawArgs: string[]): Promise<void> {
    const { id, baseline: withBaseline } = resolveClusterVerifyArgs(rawArgs);
    if (!id) fail("Usage: rebase cloud clusters verify <cluster-id> [--baseline]", undefined, "bad_request");

    // Parsed before authenticating: a usage error is answerable without a
    // session, and asking for one first turns "you forgot the id" into "log in".
    const { client } = await requireClient(rawArgs);

    let report: {
        reachable: boolean; version?: string; unreachableReason?: string;
        permissions: { allowed: string[]; denied: { permission: string; consequence: string }[];
                       unknown: { permission: string; error: string }[] };
        verdict: "ready" | "degraded" | "unusable"; blockers: string[];
    };
    try {
        report = await client.functions.invoke("cluster-baseline", undefined, {
            method: "GET",
            // Encoded: the id is user input landing in a URL path, and `path`
            // is appended verbatim by the SDK (only the *function name* is
            // encoded for it).
            path: `verify/${encodeURIComponent(id)}${withBaseline ? "?baseline=1" : ""}`
        });
    } catch (error: unknown) {
        reportError(error, "Could not verify the cluster");
        return;
    }

    emit(
        () => {
            console.log("");
            const tone = report.verdict === "ready" ? chalk.green
                : report.verdict === "degraded" ? chalk.yellow : chalk.red;
            console.log(`  ${tone(chalk.bold(report.verdict.toUpperCase()))}  ${chalk.gray(String(id))}`);
            console.log("");
            keyValues([
                ["Reachable", report.reachable ? "yes" : chalk.red("no")],
                ["Permissions", `${report.permissions.allowed.length} allowed, ${report.permissions.denied.length} denied`]
            ]);
            if (report.blockers.length > 0) {
                console.log("");
                // Each blocker already says what breaks, so they are printed
                // whole rather than summarised into a count.
                for (const b of report.blockers) console.log(`  ${chalk.red("✗")} ${b}`);
            }
            console.log("");
            if (!withBaseline && report.verdict !== "unusable") {
                note("Add --baseline to also check ingress-nginx, cert-manager and CloudNativePG.");
                console.log("");
            }
        },
        report
    );

    // Non-zero so this is usable as a gate in a script or a runbook step.
    if (report.verdict === "unusable") process.exitCode = 1;
}

/** What `clusters baseline` parses. */
export const CLUSTER_BASELINE_FLAGS = { "--install": Boolean } as const;

/** What `GET /api/functions/cluster-baseline/:clusterId` answers. Mirrors saas k8s/baseline.ts. */
export interface ClusterBaselineReport {
    ready?: boolean;
    components?: { name?: string; installed?: boolean; ready?: boolean; detail?: string }[];
}

/** Which cluster `clusters baseline` was asked about, and whether to install. */
export function resolveClusterBaselineArgs(rawArgs: string[]): { id?: string; install: boolean; yes: boolean } {
    const { flags, positionals } = parseCloudArgs({
        spec: CLUSTER_BASELINE_FLAGS,
        rawArgs,
        commandWords: 2, // cloud clusters — `baseline` is the action positional
        command: "cloud clusters baseline",
        maxPositionals: 2
    });
    return { id: positionals[1], install: flags["--install"] === true, yes: flags["--yes"] === true };
}

/**
 * The cluster baseline — ingress-nginx, cert-manager, CloudNativePG — on one
 * cluster: what is installed and ready, and with `--install`, install what is
 * missing. Platform-admin only, like the rest of `clusters`: installing
 * operators is a cluster-wide act.
 *
 * The install runs in the background on the control plane; its progress lands
 * on the cluster's row, which a later `clusters baseline <id>` reads back.
 */
async function clustersBaselineCommand(rawArgs: string[]): Promise<void> {
    const { id, install, yes } = resolveClusterBaselineArgs(rawArgs);
    if (!id) fail("Usage: rebase cloud clusters baseline <cluster-id> [--install]", undefined, "bad_request");
    const { client } = await requireClient(rawArgs);
    const path = encodeURIComponent(id);

    if (install) {
        await confirmDestructive({
            yes,
            prompt: `Install the missing baseline components (ingress-nginx, cert-manager, CloudNativePG) on cluster ${id}? They are applied cluster-wide.`
        });
        let started: { started?: boolean; clusterId?: string };
        try {
            started = await client.functions.invoke<{ started?: boolean; clusterId?: string }>("cluster-baseline", {}, { method: "POST", path });
        } catch (error: unknown) {
            reportError(error, "Could not start the baseline install");
        }
        emit(
            () => {
                success(`Installing the baseline on cluster ${id} in the background.`);
                note(`Follow it with ${chalk.cyan(`rebase cloud clusters baseline ${id}`)}.`);
            },
            { clusterId: started.clusterId ?? id, started: started.started === true }
        );
        return;
    }

    let report: ClusterBaselineReport;
    try {
        report = await client.functions.invoke<ClusterBaselineReport>("cluster-baseline", undefined, { method: "GET", path });
    } catch (error: unknown) {
        reportError(error, "Could not read the cluster baseline");
    }
    // Where a background install left off, from the row it writes to. Best
    // effort: the report above is the answer, this is how it got there.
    let progress: { baselineStatus?: string | null; baselineMessage?: string | null } | undefined;
    try {
        const row = await client.data.table("clusters").findById(id);
        if (row) {
            progress = {
                baselineStatus: typeof row.baselineStatus === "string" ? row.baselineStatus : null,
                baselineMessage: typeof row.baselineMessage === "string" ? row.baselineMessage : null
            };
        }
    } catch {
        progress = undefined;
    }
    const components = report.components ?? [];
    emit(
        () => {
            console.log("");
            console.log(`  ${report.ready ? chalk.green(chalk.bold("READY")) : chalk.yellow(chalk.bold("INCOMPLETE"))}  ${chalk.gray(id)}`);
            console.log("");
            for (const c of components) {
                const state = c.ready ? chalk.green("ready") : c.installed ? chalk.yellow("installed, not ready") : chalk.red("missing");
                console.log(`  ${(c.name ?? "?").padEnd(16)} ${state}${c.detail ? chalk.gray(`  ${c.detail}`) : ""}`);
            }
            if (progress?.baselineStatus) {
                console.log("");
                keyValues([["Last install", progress.baselineStatus]]);
            }
            console.log("");
            if (!report.ready) {
                note(`Install what is missing with ${chalk.cyan(`rebase cloud clusters baseline ${id} --install`)}.`);
                console.log("");
            }
        },
        { clusterId: id, ready: report.ready === true, components, install: progress ?? null }
    );
}

/**
 * Register a cluster from a kubeconfig file.
 *
 * Verifies immediately rather than reporting a successful insert: a row that
 * names an unreachable cluster is worse than no row, because a project pointed
 * at it fails at deploy instead of at registration.
 */
/** The columns a `clusters` row is registered with. Exported for its test. */
export interface ClusterAddArgs {
    name: string;
    provider: "gcp" | "aws" | "hetzner";
    region: string;
    kubeconfigPath: string;
    baseDomain?: string;
    ingressAddress?: string;
    /** This is capacity we operate: projects placed in its region deploy here. */
    platformCapacity: boolean;
    /**
     * Offer the region to customers for new projects. Present only when
     * `--open-to-customers` was given: left out, the field is not sent and the
     * row keeps the server's default (NULL, closed).
     */
    openToCustomers?: true;
    backupBucket?: string;
    backupEndpoint?: string;
    backupAccessKeyId?: string;
    backupSecretAccessKey?: string;
    /** `broker`: new managed storage goes to the platform's storage broker, and the baseline installs no in-cluster object store. */
    managedStorage?: "broker";
    /** The fixed outbound IPv4 tenant apps leave from (Hetzner: `terraform output egress_ip`). */
    egressAddress?: string;
    /** The IPv6 address the ingress answers on, for AAAA records. */
    ingressAddressV6?: string;
}

/**
 * What `clusters add` was asked to register.
 *
 * Everything a row needs to serve tenants is settable HERE, at insert, because
 * the control plane installs the cluster baseline on insert and reads the row
 * to do it: the name is what the Hetzner load balancer is adopted by, the
 * address is what the ingress is pinned to. Registering with the four
 * required flags and patching the rest afterwards would install a baseline
 * that knew neither.
 *
 * The backup fields travel together: a bucket with no key, or a key with no
 * bucket, is a row `resolveBackupStore` deliberately treats as "no store" —
 * so it is refused here, where the operator can still fix the command.
 */
/** The flags `clusters add` declares; exported for its help page's test. */
export const CLUSTER_ADD_FLAGS = {
    "--name": String,
    "--provider": String,
    "--region": String,
    "--kubeconfig": String,
    "--base-domain": String,
    "--ingress-address": String,
    "--platform-capacity": Boolean,
    "--open-to-customers": Boolean,
    "--backup-bucket": String,
    "--backup-endpoint": String,
    "--backup-access-key-id": String,
    "--backup-secret-access-key": String,
    "--managed-storage": String,
    "--egress-address": String,
    "--ingress-address-v6": String
};

export function resolveClusterAddArgs(rawArgs: string[]): ClusterAddArgs {
    const { flags } = parseCloudArgs({
        spec: CLUSTER_ADD_FLAGS,
        rawArgs,
        commandWords: 2, // cloud clusters — `add` is the action positional
        command: "cloud clusters add",
        maxPositionals: 1
    });

    const name = flags["--name"];
    const provider = flags["--provider"];
    const region = flags["--region"];
    const kubeconfigPath = flags["--kubeconfig"];
    if (!name || !provider || !region || !kubeconfigPath) {
        fail(
            "Usage: rebase cloud clusters add --name <n> --provider <gcp|aws|hetzner> --region <r> --kubeconfig <path> " +
                "[--base-domain <d>] [--ingress-address <ip>] [--platform-capacity] [--open-to-customers] " +
                "[--backup-bucket <b> --backup-endpoint <url> --backup-access-key-id <k> --backup-secret-access-key <s>] " +
                "[--managed-storage broker] [--egress-address <ipv4>] [--ingress-address-v6 <ipv6>]",
            undefined,
            "bad_request"
        );
    }
    if (provider !== "gcp" && provider !== "aws" && provider !== "hetzner") {
        fail(`--provider must be gcp, aws or hetzner (got "${provider}")`, undefined, "bad_request");
    }

    const backup = {
        backupBucket: flags["--backup-bucket"],
        backupEndpoint: flags["--backup-endpoint"],
        backupAccessKeyId: flags["--backup-access-key-id"],
        backupSecretAccessKey: flags["--backup-secret-access-key"]
    };
    const anyBackup = Boolean(backup.backupBucket || backup.backupAccessKeyId || backup.backupSecretAccessKey);
    if (anyBackup && !(backup.backupBucket && backup.backupAccessKeyId && backup.backupSecretAccessKey)) {
        fail(
            "--backup-bucket, --backup-access-key-id and --backup-secret-access-key go together: a bucket " +
                "without a key, or a key without a bucket, is a cluster with NO backup store.",
            undefined,
            "bad_request"
        );
    }
    if (provider === "hetzner" && flags["--platform-capacity"] && !backup.backupBucket) {
        fail(
            "A Hetzner cluster we operate needs its own backup store (--backup-bucket ... on Hetzner Object " +
                "Storage): without one its databases archive nowhere, or — worse — into the GCP default from " +
                "another provider.",
            undefined,
            "bad_request"
        );
    }

    const managedStorage = flags["--managed-storage"];
    if (managedStorage !== undefined && managedStorage !== "broker") {
        fail(
            `--managed-storage takes one value, broker (got "${managedStorage}"). Leave it out for the object store on the cluster itself.`,
            undefined,
            "bad_request"
        );
    }
    const egressAddress = flags["--egress-address"];
    if (egressAddress !== undefined && !/^(\d{1,3}\.){3}\d{1,3}$/.test(egressAddress)) {
        fail(`--egress-address must be one IPv4 address (got "${egressAddress}")`, undefined, "bad_request");
    }
    const ingressAddressV6 = flags["--ingress-address-v6"];
    if (ingressAddressV6 !== undefined && !ingressAddressV6.includes(":")) {
        fail(`--ingress-address-v6 must be an IPv6 address (got "${ingressAddressV6}")`, undefined, "bad_request");
    }

    return {
        name: name!,
        provider,
        region: region!,
        kubeconfigPath: kubeconfigPath!,
        baseDomain: flags["--base-domain"],
        ingressAddress: flags["--ingress-address"],
        platformCapacity: flags["--platform-capacity"] === true,
        // Only when given, like the backup store: an absent key is not sent, so
        // the column keeps its default (NULL, closed) and a control plane that
        // predates the column is never handed a field it would refuse.
        ...(flags["--open-to-customers"] === true ? { openToCustomers: true as const } : {}),
        ...(anyBackup ? backup : {}),
        ...(managedStorage === "broker" ? { managedStorage: "broker" as const } : {}),
        ...(egressAddress ? { egressAddress } : {}),
        ...(ingressAddressV6 ? { ingressAddressV6 } : {})
    };
}

/** The fields of a `clusters` row the open/close and DNS hints read. */
export interface ClusterRowSummary {
    id: string;
    name: string | null;
    region: string | null;
    baseDomain: string | null;
    platformCapacity: boolean;
    baselineStatus: string | null;
    openToCustomers: boolean | null;
}

/** A `clusters` row as the data API answers it, narrowed to what these commands read. */
export function clusterRowSummary(row: Record<string, unknown> & { id: string | number }): ClusterRowSummary {
    const text = (value: unknown): string | null => (typeof value === "string" && value.trim() !== "" ? value : null);
    return {
        id: String(row.id),
        name: text(row.name),
        region: text(row.region),
        baseDomain: text(row.baseDomain),
        platformCapacity: row.platformCapacity === true,
        baselineStatus: text(row.baselineStatus),
        openToCustomers: typeof row.openToCustomers === "boolean" ? row.openToCustomers : null
    };
}

/**
 * The other clusters serving the same base domain as `target`.
 *
 * Compared case-insensitively, and only between rows that name one: a row with
 * no base domain is served at the platform's, which this CLI does not know.
 */
export function clustersSharingBaseDomain(target: ClusterRowSummary, rows: ClusterRowSummary[]): ClusterRowSummary[] {
    const domain = target.baseDomain?.trim().toLowerCase();
    if (!domain) return [];
    return rows.filter((row) => row.id !== target.id && row.baseDomain?.trim().toLowerCase() === domain);
}

/**
 * The closing hint of `clusters add` for platform capacity: where projects
 * deploy, when customers are offered the region, and which DNS records to add.
 *
 * `shared` is whether another registered cluster already serves the base
 * domain — `undefined` when that is not known (no base domain given, or the
 * cluster list could not be read), and then both DNS sentences are printed.
 */
export function clusterAddHint(
    args: Pick<ClusterAddArgs, "region" | "baseDomain" | "ingressAddress">,
    id: string | number,
    shared: boolean | undefined
): string[] {
    const domain = args.baseDomain ?? "<baseDomain>";
    const address = args.ingressAddress ?? "its ingress address";
    const lines = [
        `Projects placed in ${args.region} deploy here once the baseline is ready; customers are offered the region only after ` +
            `--open-to-customers (or \`rebase cloud clusters open ${id}\`).`
    ];
    if (shared === true) {
        lines.push(
            `Another cluster already serves ${domain}, so add explicit records for ingress.${domain}, s3.${domain} and each project, ` +
                `and leave *.${domain} alone until the last project has moved.`
        );
    } else if (shared === false) {
        lines.push(`Point *.${domain} at ${address}.`);
    } else {
        lines.push(
            `If another cluster already serves ${domain}, add explicit records for ingress.${domain}, s3.${domain} and each project, ` +
                `and leave *.${domain} alone until the last project has moved. Otherwise point *.${domain} at ${address}.`
        );
    }
    return lines;
}

/** Every registered cluster, narrowed. The collection is admin-only and small. */
async function listClusterRows(client: CloudClient): Promise<ClusterRowSummary[]> {
    const page = await client.data.table<Record<string, unknown> & { id: string | number }>("clusters").find({ limit: 100 });
    return page.data.map(clusterRowSummary);
}

async function clustersAddCommand(rawArgs: string[]): Promise<void> {
    const args = resolveClusterAddArgs(rawArgs);
    // Parsed before authenticating: a usage error is answerable without a
    // session, and asking for one first turns "you forgot the id" into "log in".
    const { client } = await requireClient(rawArgs);

    let kubeConfigData: string;
    try {
        kubeConfigData = fs.readFileSync(args.kubeconfigPath, "utf8");
    } catch {
        fail(`Could not read ${args.kubeconfigPath}`, undefined, "bad_request");
        return;
    }

    const { kubeconfigPath: _path, ...columns } = args;
    let created: { id: string | number };
    try {
        created = await client.data.table<Record<string, unknown> & { id: string | number }>("clusters").create({
            ...columns,
            authType: "kubeconfig",
            kubeConfigData
        });
    } catch (error: unknown) {
        reportError(error, "Could not register the cluster");
        return;
    }

    // Whether another cluster already serves this base domain decides which DNS
    // records the operator adds: moving a shared wildcard takes every tenant on
    // the old cluster with it. Best effort — unknown prints both sentences.
    let shared: boolean | undefined;
    if (args.platformCapacity && args.baseDomain) {
        try {
            const rows = await listClusterRows(client);
            const self: ClusterRowSummary = {
                id: String(created.id), name: args.name, region: args.region, baseDomain: args.baseDomain,
                platformCapacity: true, baselineStatus: null, openToCustomers: args.openToCustomers ?? null
            };
            shared = clustersSharingBaseDomain(self, rows).length > 0;
        } catch {
            shared = undefined;
        }
    }

    emit(
        () => {
            success(`Registered ${args.name} (${created.id}).`);
            noteBlank();
            note("The cluster baseline (ingress, certificates, the database operator) is installing in the background.");
            note("Verify it can host tenants:");
            note(chalk.cyan(`  rebase cloud clusters verify ${created.id} --baseline`));
            if (args.platformCapacity) {
                noteBlank();
                for (const line of clusterAddHint(args, created.id, shared)) note(line);
            }
        },
        {
            id: created.id,
            name: args.name,
            provider: args.provider,
            region: args.region,
            platformCapacity: args.platformCapacity,
            openToCustomers: args.openToCustomers === true,
            baseDomainShared: shared ?? null
        }
    );
}

/** Which cluster `clusters open` / `clusters close` was asked about: an id or a name. */
export function resolveClusterOpenArgs(rawArgs: string[], action: "open" | "close"): { ref?: string } {
    const { positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 2, // cloud clusters — `open` / `close` is the action positional
        command: `cloud clusters ${action}`,
        maxPositionals: 2
    });
    return { ref: positionals[1] };
}

/**
 * The row `ref` names: its id, or else its name. A name two rows share is
 * refused rather than guessed, since the write that follows changes what
 * customers are offered.
 */
export function findClusterRow(rows: ClusterRowSummary[], ref: string): ClusterRowSummary {
    const byId = rows.find((row) => row.id === ref);
    if (byId) return byId;
    const byName = rows.filter((row) => row.name === ref);
    if (byName.length === 1) return byName[0];
    if (byName.length > 1) {
        fail(`${byName.length} clusters are named "${ref}" (${byName.map((row) => row.id).join(", ")}).`, "Name one by its id.", "bad_request");
    }
    fail(`No cluster with the id or name "${ref}".`, `List them with ${chalk.cyan("rebase cloud clusters")}.`, "not_found");
}

/**
 * Offer a cluster's region to customers for new projects (`open`), or stop
 * offering it (`close`). Platform-admin only, like the rest of `clusters`.
 *
 * Writes `openToCustomers` as `true` or `null` — NULL is the closed state a
 * newly registered row starts in. Operators can deploy to the cluster either
 * way; this decides only what customers are offered.
 *
 * No confirmation: both are a one-column flip the other action undoes. When
 * the base domain is shared with another cluster, `open` warns first and
 * states what must already be true — the CLI cannot check who a DNS record
 * points at reliably, so it says the requirement instead.
 */
async function clustersOpenCommand(action: "open" | "close", rawArgs: string[]): Promise<void> {
    const { ref } = resolveClusterOpenArgs(rawArgs, action);
    if (!ref) fail(`Usage: rebase cloud clusters ${action} <id-or-name>`, undefined, "bad_request");
    const { client } = await requireClient(rawArgs);

    let rows: ClusterRowSummary[];
    try {
        rows = await listClusterRows(client);
    } catch (error: unknown) {
        reportError(error, "Could not read the clusters");
        return;
    }
    const target = findClusterRow(rows, ref!);
    const label = target.name ?? target.id;
    const sharing = clustersSharingBaseDomain(target, rows);

    if (action === "open" && sharing.length > 0) {
        warn(
            `${target.baseDomain} is also served by ${sharing.map((row) => row.name ?? row.id).join(", ")}: open ${label} only once ` +
                `the wildcard record for ${target.baseDomain} points at this cluster.`
        );
    }

    const openToCustomers = action === "open" ? true : null;
    try {
        await client.data.table("clusters").update(target.id, { openToCustomers });
    } catch (error: unknown) {
        reportError(error, action === "open" ? "Could not open the cluster to customers" : "Could not close the cluster to customers");
        return;
    }

    emit(
        () => {
            const region = target.region ?? "its region";
            if (action === "close") {
                success(`${label} (${target.id}) is closed to customers.`);
                note(`New projects are no longer offered ${region}; projects already there stay, and operators can still deploy to it.`);
                return;
            }
            success(`${label} (${target.id}) is open to customers.`);
            if (!target.platformCapacity) {
                note("It is not platform capacity, so customers are not offered it until it is registered as such.");
            } else if (target.baselineStatus !== "ready") {
                note(`Customers are offered ${region} once its baseline is ready (${chalk.cyan(`rebase cloud clusters baseline ${target.id}`)}).`);
            } else {
                note(`New projects can be placed in ${region}.`);
            }
        },
        {
            id: target.id,
            name: target.name,
            region: target.region,
            openToCustomers,
            baseDomain: target.baseDomain,
            baseDomainShared: sharing.length > 0
        }
    );
}

/** The flags `clusters registry` declares; exported for its help page's test. */
export const CLUSTER_REGISTRY_FLAGS = {
    "--repository": String,
    "--push-service-account": String,
    "--pull-key-file": String,
    "--clear": Boolean
};

/**
 * What `clusters registry` was asked to record: a customer cluster's own image
 * repository, the account its builds push as, and the file holding the key of
 * its read-only account — or `--clear`, to go back to the shared registry.
 */
export type ClusterRegistryArgs =
    | { id: string; clear: true }
    | { id: string; clear: false; repository: string; pushServiceAccount: string; pullKeyFile: string };

/**
 * Parse `rebase cloud clusters registry <id> …`.
 *
 * All three values or `--clear`, never a part: the control plane ignores a
 * partial set (and keeps handing the cluster the shared credentials), so a
 * command that wrote one would look done and change nothing.
 */
export function resolveClusterRegistryArgs(rawArgs: string[]): ClusterRegistryArgs {
    const { flags, positionals } = parseCloudArgs({
        spec: CLUSTER_REGISTRY_FLAGS,
        rawArgs,
        commandWords: 2, // cloud clusters — `registry` is the action positional
        command: "cloud clusters registry",
        maxPositionals: 2
    });
    const usage =
        "Usage: rebase cloud clusters registry <cluster-id> --repository <host/project/repo> " +
        "--push-service-account <email> --pull-key-file <key.json>   (or --clear)";
    const id = positionals[1];
    if (!id) fail(usage, undefined, "bad_request");
    const repository = flags["--repository"]?.trim();
    const pushServiceAccount = flags["--push-service-account"]?.trim();
    const pullKeyFile = flags["--pull-key-file"];
    if (flags["--clear"] === true) {
        if (repository || pushServiceAccount || pullKeyFile) {
            fail("--clear takes no other registry flag.", undefined, "bad_request");
        }
        return { id: id!, clear: true };
    }
    if (!repository || !pushServiceAccount || !pullKeyFile) {
        fail(`${usage}\nAll three go together: the control plane ignores a partial set.`, undefined, "bad_request");
    }
    if (!/^[a-z0-9.-]+(:[0-9]+)?(\/[a-z0-9]+([._-][a-z0-9]+)*){2,}$/.test(repository!.replace(/\/+$/, ""))) {
        fail(`--repository must be <host>/<project>/<repository> (got "${repository}").`, undefined, "bad_request");
    }
    return { id: id!, clear: false, repository: repository!.replace(/\/+$/, ""), pushServiceAccount: pushServiceAccount!, pullKeyFile: pullKeyFile! };
}

/**
 * The reader's key from `--pull-key-file`, checked before it leaves this
 * machine: a service-account key, and not the pusher's — the pull secret sits
 * where the customer's cluster admin can read it, so it must not be able to
 * write. Returns the key text and the account it belongs to.
 */
export function readPullKey(text: string, pushServiceAccount: string): { key: string; account: string } {
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        fail("--pull-key-file is not JSON; it must be the reader service account's key file.", undefined, "bad_request");
    }
    const record = typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {};
    const account = record.client_email;
    if (typeof account !== "string" || typeof record.private_key !== "string") {
        fail("--pull-key-file has no client_email/private_key; it must be a service-account key file.", undefined, "bad_request");
    }
    if ((account as string).toLowerCase() === pushServiceAccount.toLowerCase()) {
        fail("--pull-key-file is the push account's key. Use the cluster's read-only account (rlc-<key>-pull).", undefined, "bad_request");
    }
    return { key: text.trim(), account: account as string };
}

/**
 * Record (or clear) a cluster's own image registry. Platform-admin only, like
 * the rest of `clusters`: the collection is admin-only. The key is sealed by
 * the control plane at write and never read back.
 */
async function clustersRegistryCommand(rawArgs: string[]): Promise<void> {
    const args = resolveClusterRegistryArgs(rawArgs);
    let columns: Record<string, string | null>;
    let pullAccount: string | null = null;
    if (args.clear) {
        columns = { tenantRegistry: null, registryPushServiceAccount: null, registryPullKey: null };
    } else {
        let text: string;
        try {
            text = fs.readFileSync(args.pullKeyFile, "utf8");
        } catch {
            fail(`Could not read ${args.pullKeyFile}`, undefined, "bad_request");
            return;
        }
        const pull = readPullKey(text, args.pushServiceAccount);
        pullAccount = pull.account;
        columns = { tenantRegistry: args.repository, registryPushServiceAccount: args.pushServiceAccount, registryPullKey: pull.key };
    }

    const { client } = await requireClient(rawArgs);
    try {
        await client.data.table("clusters").update(args.id, columns);
    } catch (error: unknown) {
        reportError(error, "Could not record the cluster's registry");
        return;
    }

    emit(
        () => {
            if (args.clear) {
                success(`Cluster ${args.id} uses the shared registry again.`);
                note("Deploys to it warn again if it is not platform capacity.");
                return;
            }
            success(`Cluster ${args.id} now builds into ${args.repository}.`);
            noteBlank();
            note(`Builds push as ${args.pushServiceAccount}; pods pull with ${pullAccount}'s key (sealed, never shown).`);
            note("Takes effect on each project's next deploy to it.");
        },
        args.clear
            ? { id: args.id, tenantRegistry: null, registryPushServiceAccount: null, pullServiceAccount: null }
            : { id: args.id, tenantRegistry: args.repository, registryPushServiceAccount: args.pushServiceAccount, pullServiceAccount: pullAccount }
    );
}

async function clustersListCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud clusters",
maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    try {
        const clusters = (await client.data.table("clusters").find({ limit: 100 })).data as Array<{
            id: string | number;
            name?: string;
            provider?: string;
            region?: string;
            status?: string;
        }>;

        emit(
            () => {
                console.log("");
                console.log(chalk.bold("  ☸  Clusters"));
                console.log("");
                if (clusters.length === 0) {
                    console.log(chalk.gray("  No clusters registered."));
                    console.log("");
                    return;
                }
                for (const c of clusters) {
                    console.log(`  ${chalk.bold(c.name ?? "(unnamed)")} ${chalk.gray(`[${c.id}]`)} ${colorStatus(c.status)}`);
                    keyValues([["Provider", c.provider], ["Region", c.region]]);
                }
                console.log("");
            },
            {
                clusters: clusters.map((c) => ({
                    id: String(c.id),
                    name: c.name ?? null,
                    provider: c.provider ?? null,
                    region: c.region ?? null,
                    status: c.status ?? null
                }))
            }
        );
    } catch (e) {
        reportError(e, "Failed to list clusters");
    }
}

/* ─── billing ──────────────────────────────────────────────────── */

/**
 * The action words `rebase cloud billing` dispatches. No word at all is the
 * account view, which is why it is not in the list.
 *
 * Exported because `action-help.test.ts` holds the page's usage line to it: the
 * page said `cloud billing [portal|usage]` and the dispatch answered `setup` and
 * `checkout`, so both documented words fell through to the default and printed
 * the account — a help page describing a command that does not exist, and a typo
 * exiting 0.
 */
export const BILLING_ACTIONS = ["setup", "checkout", "invoices", "upcoming", "email"] as const;

/** What `billing invoices` says on a control plane that has no invoice route yet. */
const INVOICES_UNSERVED: Unserved = {
    what: "invoices",
    hint: "`rebase cloud billing` shows the billing account and the card on file; Stripe emails each invoice to the billing email."
};

/** What `billing upcoming` says on a control plane that has no preview route yet. */
const UPCOMING_UNSERVED: Unserved = {
    what: "a preview of the next invoice",
    hint: "`rebase cloud compute` prints what a project is quoted per month."
};

/**
 * Turn the relative setup path `POST /stripe-billing/session` returns when
 * checkout was skipped (`/p/<slug>/setup`) into a full console URL.
 */
async function resolveSkippedCheckoutUrl(
    client: CloudClient,
    controlPlaneUrl: string,
    projectId: string,
    rawUrl: string
): Promise<string> {
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    const base = controlPlaneUrl.replace(/\/+$/, "");
    const suffix = rawUrl.startsWith("/") ? rawUrl : `/${rawUrl}`;
    if (suffix.startsWith("/o/")) return `${base}${suffix}`;
    try {
        const proj: unknown = await client.data.table("projects").findById(projectId);
        if (proj && typeof proj === "object") {
            const orgRaw: unknown = Reflect.get(proj, "organization")
                ?? Reflect.get(proj, "organizationId")
                ?? Reflect.get(proj, "organization_id");
            const orgId = typeof orgRaw === "object" && orgRaw !== null
                ? Reflect.get(orgRaw, "id")
                : orgRaw;
            if (typeof orgId === "string" || typeof orgId === "number") {
                const orgRow: unknown = await client.data.table("organizations").findById(String(orgId));
                const slug: unknown = orgRow && typeof orgRow === "object" ? Reflect.get(orgRow, "slug") : undefined;
                if (typeof slug === "string" && slug.trim()) {
                    return `${base}/o/${encodeURIComponent(slug.trim())}${suffix}`;
                }
            }
        }
    } catch {
        // Fall through to the project-by-id console route.
    }
    return `${base}/projects/${encodeURIComponent(projectId)}`;
}

export async function billingCommand(rawArgs: string[]): Promise<void> {
    // Parsed before the client is built: an unusable line should be refused
    // without first spending a login round-trip on it.
    const parsed = parseCloudArgs({
        spec: { "--limit": Number },
        rawArgs,
        commandWords: 2, // cloud billing
        command: "cloud billing",
        maxPositionals: 2
    });
    const action = parsed.positionals[0];
    requireKnownAction("billing", action, BILLING_ACTIONS);
    const limit = parsed.flags["--limit"];
    if (limit !== undefined && action !== "invoices") {
        fail("`--limit` applies to `rebase cloud billing invoices` only.", undefined, "usage");
    }
    const address = parsed.positionals[1];
    if (address !== undefined && action !== "email") {
        fail(`Too many arguments for \`rebase cloud billing${action ? ` ${action}` : ""}\`: ${address}`, "Run `rebase cloud billing --help`.", "usage");
    }
    if (action === "email" && !address?.trim()) {
        fail("Name the address invoices go to.", "`rebase cloud billing email billing@example.com`.", "usage");
    }

    const { client, url } = await requireClient(rawArgs);
    // Every action but `checkout`, which names a project, is about an organization.
    const org = action === "checkout" ? undefined : await requireOrg(client, url);

    // `rebase cloud billing email <address>` — where Stripe sends the invoices.
    // Written to the billing account and to the Stripe customer; owner/admin.
    if (action === "email") {
        if (!org) fail("No organization selected.", NO_ORG_HINT, "no_org");
        let res: { billingEmail?: string | null };
        try {
            res = await client.functions.invoke<{ billingEmail?: string | null }>(
                "stripe-billing",
                { organizationId: org, billingEmail: address!.trim() },
                { path: "billing-email" }
            );
        } catch (e) {
            reportError(e, "Failed to change the billing email");
        }
        const billingEmail = res.billingEmail ?? address!.trim();
        emit(
            () => success(`Invoices for org ${org} now go to ${chalk.bold(billingEmail)}.`),
            { org, billingEmail }
        );
        return;
    }

    // `rebase cloud billing invoices|upcoming` — what Stripe has invoiced the
    // org, and what it will invoice next. Read-only; owner/admin only.
    if (action === "invoices" || action === "upcoming") {
        if (!org) fail("No organization selected.", NO_ORG_HINT, "no_org");
        try {
            if (action === "invoices") await billingInvoices(client, org, limit);
            else await billingUpcoming(client, org);
        } catch (e) {
            if (action === "invoices") reportCallError(e, "Failed to load invoices", INVOICES_UNSERVED);
            reportCallError(e, "Failed to load the next invoice", UPCOMING_UNSERVED);
        }
        return;
    }

    // `rebase cloud billing setup` — attach a card to the org (one-time, opens a
    // browser). Once done, project create/deploy work headlessly (off_session).
    if (action === "setup") {
        if (!org) fail("No organization selected.", NO_ORG_HINT, "no_org");
        try {
            const res = await client.functions.invoke<{ url?: string; simulated?: boolean }>(
                "stripe-billing",
                { organizationId: org },
                { path: "setup-session" }
            );
            if (!res.url) fail("Could not start billing setup.", undefined, "billing_setup_failed");
            openUrl(res.url, "Add a payment method in your browser:");
            emit(
                () => {
                    note(chalk.gray(res.simulated
                        ? "(dev mode — Stripe not configured; complete setup from the console)"
                        : "Once you've added a card, `rebase cloud deploy` runs without further prompts."));
                    noteBlank();
                },
                { url: res.url,
org,
simulated: Boolean(res.simulated) }
            );
        } catch (e) {
            reportError(e, "Failed to start billing setup");
        }
        return;
    }

    // `rebase cloud billing checkout --project <slug>` opens a Stripe session.
    if (action === "checkout") {
        const projectId = await requireProject(rawArgs, client);
        try {
            const res = await client.functions.invoke<{ url?: string; skipped?: string }>(
                "stripe-billing",
                { projectId },
                { path: "session" }
            );
            if (!res.url) fail("Billing session could not be created.", undefined, "checkout_failed");
            if (res.skipped) {
                const resolvedUrl = await resolveSkippedCheckoutUrl(client, url, projectId, res.url);
                const headline = res.skipped === "card_on_file"
                    ? "Billed card on file — checkout skipped and deployment started."
                    : res.skipped === "already_paid"
                        ? "This project is already paid for — checkout skipped and deployment started."
                        : `Billing skipped (${res.skipped}) — deployment started.`;
                emit(
                    () => {
                        success(headline);
                        note(`Project setup: ${chalk.cyan(resolvedUrl)}`);
                        noteBlank();
                    },
                    { url: resolvedUrl, projectId, skipped: res.skipped }
                );
                return;
            }
            emit(
                () => {
                    console.log("");
                    console.log("  Complete checkout in your browser:");
                    console.log(`  ${chalk.cyan(res.url)}`);
                    console.log("");
                },
                { url: res.url,
projectId }
            );
        } catch (e) {
            reportError(e, "Failed to start checkout");
        }
        return;
    }

    // default: show the active org's billing account.
    if (!org) fail("No organization selected.", NO_ORG_HINT, "no_org");
    try {
        const billingId = billingAccountIdOf(await client.data.table("organizations").findById(org));
        if (!billingId) {
            // Not an error — an org simply may not have been billed yet.
            emit(
                () => {
                    console.log("");
                    console.log(chalk.gray(`  Organization ${org} has no billing account yet.`));
                    console.log("");
                },
                { org,
account: null,
monthlyEur: null,
paymentMethod: null }
            );
            return;
        }
        const acct = (await client.data.table("billing-accounts").findById(billingId)) as
            | { id: string | number; billingEmail?: string; status?: string; stripeCustomerId?: string }
            | undefined;

        // Card-on-file lives in Stripe; the control plane reports it for us.
        let card: { hasPaymentMethod?: boolean; brand?: string; last4?: string; expMonth?: number; expYear?: number } = {};
        try {
            card = await client.functions.invoke<typeof card>(
                "stripe-billing",
                undefined,
                { method: "GET",
path: `payment-method/${org}` }
            );
        } catch {
            // status endpoint optional — fall back to the local account record
        }

        // Best-effort: what the linked/`--project` project costs per month.
        //
        // This used to name a plan, and before that a `compute_<provider>_<vmSize>`
        // price — a key for a machine on a price list this platform does not buy
        // from, which stopped resolving when `vmSize` was removed and printed a
        // bare label ever since. A project is priced from its dials now, so the
        // honest thing to show is the number the control plane would invoice.
        let monthly: string | undefined;
        try {
            const parsed = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
            const ref = parsed["--project"] || readLink()?.projectId;
            const projectId = ref ? await lookupProjectId(ref, client) : undefined;
            if (projectId) {
                const proj = (await client.data.table("projects").findById(projectId)) as
                    | Record<string, unknown>
                    | undefined;
                const hasCluster = proj?.cluster_id != null || proj?.cluster != null;
                // `path` rather than a slash in the NAME: the SDK URL-encodes
                // the function name, so "pricing/quote" became "pricing%2Fquote"
                // and the route 404'd — every time, since this shipped. The
                // console's copy of this call carries the same note and gets it
                // right.
                const quote = await client.functions.invoke<ResourceQuote>(
                    "pricing",
                    proj,
                    { method: "POST", path: "quote" }
                );
                monthly = `€${quote.totalEur.toFixed(2)}/mo`;
                if (hasCluster) monthly = `${monthly} — platform fee, your own cluster`;
            }
        } catch (err: unknown) {
            // Say which of the two it was. A bare `catch {}` reporting "a
            // control plane without the quote endpoint" is what made a
            // permanent 404 look like an expected condition for this command's
            // whole life.
            if (wantsRawError()) {
                console.error(`  (no price: ${err instanceof Error ? err.message : String(err)})`);
            }
        }

        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  💳 Billing — org ${org}`));
                console.log("");
                keyValues([
                    ["Account", acct ? String(acct.id) : undefined],
                    ["Email", acct?.billingEmail],
                    ["Status", acct?.status ? colorStatus(acct.status) : undefined],
                    ["Resources", monthly],
                    [
                        "Payment method",
                        card.hasPaymentMethod
                            ? `${card.brand ?? "card"} •••• ${card.last4 ?? "????"}${card.expMonth ? ` (exp ${card.expMonth}/${card.expYear})` : ""}`
                            : chalk.yellow("none — run `rebase cloud billing setup`")
                    ]
                ]);
                console.log("");
            },
            {
                org,
                account: acct
                    ? { id: String(acct.id),
billingEmail: acct.billingEmail ?? null,
status: acct.status ?? null }
                    : null,
                monthlyEur: monthly ?? null,
                paymentMethod: {
                    hasPaymentMethod: Boolean(card.hasPaymentMethod),
                    brand: card.brand ?? null,
                    last4: card.last4 ?? null,
                    expMonth: card.expMonth ?? null,
                    expYear: card.expYear ?? null
                }
            }
        );
    } catch (e) {
        reportError(e, "Failed to load billing");
    }
}

/* ─── compute: what this project reserves ───────────────────────── */

/**
 * The action words `rebase cloud compute` dispatches. No word, or `show`,
 * prints the dials and the quote.
 */
export const COMPUTE_ACTIONS = ["show", "set", "apply", "window"] as const;

/** The dials, and the flag that sets each. */
const DIAL_FLAGS = {
    "--cpu": "cpu",
    "--memory": "memory",
    "--replicas": "replicaCount",
    "--spot": "preemptible",
    // No `--scale-to-zero`: see RETIRED_SCALE_TO_ZERO.
    // No `--db-mode`. The shared tier was retired, so a managed database is a
    // CloudNativePG cluster of the project's own and there is nothing left to
    // choose — a flag whose only legal value is the default is a flag that
    // changes nothing. The database is still dialable, by size and instances.
    "--db-instances": "databaseInstances",
    "--db-cpu": "databaseCpu",
    "--db-memory": "databaseMemory",
    "--storage": "storageMode",
    // Autoscaling is a RANGE, and `--replicas` is its floor rather than a
    // separate concept: with a max set, the floor is what always exists and what
    // the project is billed for at rest, and the max is the ceiling it may reach
    // and the worst case it may be billed. Deliberately not a `--autoscale
    // on|off` boolean — that would admit the incoherent state where autoscaling
    // is enabled and the range is a single point. A max at or below the floor
    // turns it off, which is the one rule `resolveAutoscaling` enforces.
    "--autoscale-max": "autoscaleMaxReplicas",
    "--autoscale-cpu-target": "autoscaleTargetCpuPercent",
    // Database autoscaling, opt-in: the most it may grow to on its own under
    // sustained CPU, memory or connection pressure. `--no-db-autoscale` clears
    // both, which is off.
    "--db-autoscale-max-cpu": "dbAutoscaleMaxCpu",
    "--db-autoscale-max-memory": "dbAutoscaleMaxMemory"
} as const;

/**
 * The flags `resources set` accepts, in the shape a spec is written in.
 *
 * Derived from `DIAL_FLAGS` rather than written out beside it: `action-help.ts`
 * documents this command and `action-help.test.ts` pairs the page against this
 * constant, so a dial added above is a dial the help page has to describe on the
 * same commit. A hand-copied second list is how the page and the parser drift.
 *
 * `buildDialPatch` still scans `rawArgs` itself — it has to, because
 * `--no-autoscale` is value-less and a dial's value may not be consumed as one
 * — so this is a description of that line, not a second parser for it.
 */
export const COMPUTE_SET_FLAGS: Record<string, unknown> = {
    ...Object.fromEntries(Object.keys(DIAL_FLAGS).map((flag) => [flag, String])),
    "--no-autoscale": Boolean,
    "--no-db-autoscale": Boolean
};

/**
 * The flag that used to set `scaleToZero`. Still parsed, so a script that passes
 * it is told what happened rather than failing on an unknown option.
 *
 * The dial never did anything: it resolved to a request-billed substrate no
 * deploy built, and every backend kept running as an always-on pod. The control
 * plane refuses `true` now; this refuses it before the round trip, and lets
 * `false` — what every project already gets — through with a warning.
 */
export const RETIRED_SCALE_TO_ZERO = "--scale-to-zero";

/** Dials whose column is a number, not the text a flag carries. */
const NUMERIC_DIALS = new Set([
    "databaseInstances",
    "replicaCount",
    "autoscaleMaxReplicas",
    "autoscaleTargetCpuPercent"
]);
/** Dials that are a yes/no. `--spot false` has to reach the row as `false`. */
const BOOLEAN_DIALS = new Set(["preemptible"]);

/**
 * `rebase cloud compute` — show what a project reserves, and change it.
 *
 * Named for what it shows — CPU, memory, replicas, the database's shape, and
 * what those cost — because `rebase resources` already means the graph a
 * project declares, and two commands called "resources" that show different
 * things is a support ticket.
 *
 * ## Why nothing is validated here
 *
 * The rules are the *target cluster's*, not the CLI's: GKE Autopilot bills a
 * 250m/512Mi floor and rewrites anything outside a 1:1–6.5:1 memory:CPU band,
 * while a Hetzner or EKS node has neither constraint. A CLI that carried those
 * numbers would be wrong for two of the three providers the moment it shipped,
 * and would drift from the control plane the first time either changed.
 *
 * So the control plane validates and this reports what it said. The same
 * boundary refuses a raw PATCH and a console save, which is the property worth
 * having — a check in a client only covers the clients that run it.
 */
export async function computeCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    // `compute et --cpu 500m` used to SHOW the dials and exit 0, so a caller
    // that meant to change one was told what it currently is and nothing else.
    requireKnownAction("compute", action, COMPUTE_ACTIONS);
    // The database changes a `set` scheduled, and the window they wait for.
    if (action === "apply") return computeApplyCommand(rawArgs);
    if (action === "window") return computeWindowCommand(rawArgs);
    // `set` is described by `COMPUTE_SET_FLAGS`, which is derived from
    // `DIAL_FLAGS`; `buildDialPatch` still reads the values itself, because
    // `--no-autoscale` is value-less. This parse is only the refusal: without
    // it `compute set --cpu-request 500m` set nothing and reported success.
    const { flags: computeFlags } = parseCloudArgs({
        // The retired flag is parsed but not documented: `buildDialPatch` says
        // what became of it.
        spec: (action === "set" ? { ...COMPUTE_SET_FLAGS, [RETIRED_SCALE_TO_ZERO]: String } : {}) as Record<string, never>,
        rawArgs,
        commandWords: 3,
        command: action === "set" ? "cloud compute set" : "cloud compute",
        maxPositionals: 0
    });

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    const project = (await client.data.table("projects").findById(projectId)) as
        | Record<string, unknown>
        | undefined;
    if (!project) fail(`Project ${displayProjectRef(rawArgs)} not found.`, undefined, "not_found");

    if (action !== "set") {
        // What this costs, priced by the control plane. Best-effort: an older
        // control plane has no quote endpoint, and a resources listing that
        // fails because a price could not be fetched would be worse than one
        // without the price.
        let quote: ResourceQuote | undefined;
        const maintenanceRead = await readMaintenance(client, projectId);
        const maintenance = maintenanceRead.kind === "ok" ? maintenanceRead.status : undefined;
        const notServed = maintenanceRead.kind === "not_served" ? ["maintenance"] : [];
        try {
            // See the note at the other call site: the name is "pricing" and the
            // sub-path is an option, because the SDK encodes the name.
            quote = await client.functions.invoke<ResourceQuote>(
                "pricing", project, { method: "POST", path: "quote" });
        } catch (err: unknown) {
            // No quote — the dials below are still the answer to the question
            // asked. Visible under REBASE_DEBUG, so a permanent failure cannot
            // masquerade as a control plane that simply does not price.
            if (wantsRawError()) {
                console.error(`  (no price: ${err instanceof Error ? err.message : String(err)})`);
            }
        }

        emit(
            () => {
                console.log("");
                console.log(`  ${chalk.bold(String(project!.name ?? ""))} ${chalk.gray(`[${String(project!.subdomain ?? "")}]`)}`);
                console.log("");
                keyValues([
                    ["App CPU", dialLine(project!.cpu)],
                    ["App memory", dialLine(project!.memory)],
                    ["App replicas", dialLine(project!.replicaCount)],
                    // No ceiling is no autoscaler: `--no-autoscale` clears it.
                    ["Autoscale ceiling", project!.autoscaleMaxReplicas === null || project!.autoscaleMaxReplicas === undefined
                        ? chalk.gray("off")
                        : dialLine(project!.autoscaleMaxReplicas)],
                    ["Autoscale CPU target", project!.autoscaleTargetCpuPercent === null || project!.autoscaleTargetCpuPercent === undefined
                        ? dialLine(undefined)
                        : `${dialLine(project!.autoscaleTargetCpuPercent)}%`],
                    ["Capacity", dialLine(project!.preemptible, { true: "spot", false: "on demand" })],
                    ["Database instances", dialLine(project!.databaseInstances)],
                    ["Database CPU", dialLine(project!.databaseCpu)],
                    ["Database memory", dialLine(project!.databaseMemory)],
                    ["Database autoscaling", project!.dbAutoscaleMaxCpu || project!.dbAutoscaleMaxMemory
                        ? `up to ${[project!.dbAutoscaleMaxCpu ? `${String(project!.dbAutoscaleMaxCpu)} CPU` : null, project!.dbAutoscaleMaxMemory ? `${String(project!.dbAutoscaleMaxMemory)} memory` : null].filter(Boolean).join(", ")}`
                        : chalk.gray("off")],
                    ["Object storage", dialLine(project!.storageMode)],
                    ["Per month", quote ? `€${quote.totalEur.toFixed(2)}` : undefined],
                    // What a `set` scheduled and has not happened yet: a resize
                    // that restarts the database waits for this window.
                    ["Waiting", describePending(maintenance?.open)],
                    ["Maintenance window", maintenance?.window.label],
                    // A size change that was confirmed and is not running yet.
                    ["Database change", describeDatabaseApplied(databaseAppliedOf(project))]
                ]);
                // Itemised, because a total nobody can decompose is a number
                // someone has to trust rather than check.
                if (quote) {
                    console.log("");
                    for (const line of quote.lines) {
                        const qty = line.unit ? chalk.gray(`${line.quantity} × €${line.unitEur}`) : "";
                        note(`  ${line.label.padEnd(24)} ${qty.padEnd(28)} €${line.amountEur.toFixed(2)}`);
                    }
                }
                console.log("");
                noteBlank();
                if (notServed.length > 0) note(chalk.gray(MAINTENANCE_NOT_SERVED_NOTE));
                note("Empty means the platform default. Change one with:");
                note(chalk.cyan("  rebase cloud compute set --cpu 500m --memory 2Gi"));
                console.log("");
            },
            {
                monthlyEur: quote?.totalEur ?? null,
                lines: quote?.lines ?? null,
                cpu: project!.cpu ?? null,
                memory: project!.memory ?? null,
                replicaCount: project!.replicaCount ?? null,
                autoscaleMaxReplicas: project!.autoscaleMaxReplicas ?? null,
                autoscaleTargetCpuPercent: project!.autoscaleTargetCpuPercent ?? null,
                preemptible: project!.preemptible ?? null,
                // Retired: always null since the control plane cleared the
                // column. Kept so a script reading the field does not break.
                scaleToZero: project!.scaleToZero ?? null,
                databaseInstances: project!.databaseInstances ?? null,
                databaseCpu: project!.databaseCpu ?? null,
                databaseMemory: project!.databaseMemory ?? null,
                dbAutoscaleMaxCpu: project!.dbAutoscaleMaxCpu ?? null,
                dbAutoscaleMaxMemory: project!.dbAutoscaleMaxMemory ?? null,
                storageMode: project!.storageMode ?? null,
                maintenance: maintenance ? { window: maintenance.window, pending: maintenance.open } : null,
                databaseApplied: databaseAppliedOf(project) ?? null,
                notServed
            }
        );
        return;
    }

    const built = buildDialPatch(rawArgs);
    if (built.error) fail(built.error, undefined, "bad_request");
    const patch = built.patch;

    // A change of dials changes the invoice and rolls the app's pods, so it is
    // confirmed, with what the control plane quotes for the new dials beside
    // what it quotes now. Best effort: a control plane that cannot price them
    // still gets the question, without the numbers.
    const [quoteNow, quoteAfter] = await Promise.all([
        quoteDials(client, project),
        quoteDials(client, { ...project, ...patch })
    ]);
    const changes = Object.entries(patch).map(([field, value]) => `${field} → ${String(value)}`).join(", ");
    const price = quoteAfter
        ? ` Quoted €${quoteAfter.totalEur.toFixed(2)}/month${quoteNow ? ` (now €${quoteNow.totalEur.toFixed(2)})` : ""}.`
        : "";
    const ref = displayProjectRef(rawArgs) || projectId;
    const yes = Boolean(computeFlags["--yes"]);
    // A new database size, or fewer instances, restarts the database. The
    // control plane takes that only with consent on the same write, so the
    // question says so and a yes is sent as `acknowledgeDatabaseRestart`.
    let restart = patchRestartsDatabase(project!, patch);
    await confirmDestructive({
        yes,
        prompt: restart
            ? `Change ${changes} on ${ref}?${price} ${DATABASE_RESTART_NOTICE} The app rolls its pods now. ${DATABASE_CHANGE_BILLING}`
            : `Change ${changes} on ${ref}?${price} The app rolls its pods now. ${DATABASE_CHANGE_BILLING}`,
        refusal: restart ? DATABASE_RESTART_REFUSAL : undefined
    });

    const save = (acknowledge: boolean) =>
        client.data.table("projects").update(projectId, acknowledge ? { ...patch, acknowledgeDatabaseRestart: true } : patch);
    try {
        try {
            await save(restart);
        } catch (error: unknown) {
            // The control plane found a restart this CLI did not predict (it
            // judges against what runs), and saved nothing. Ask about the
            // restart itself, then send the same change with the consent.
            if (restart || !isRestartUnconfirmed(error)) throw error;
            await confirmDestructive({
                yes,
                prompt: `${DATABASE_RESTART_NOTICE} Restart ${ref}'s database to apply ${changes}?`,
                refusal: DATABASE_RESTART_REFUSAL
            });
            restart = true;
            await save(true);
        }
    } catch (error: unknown) {
        // The control plane's refusals are written to be read by whoever chose
        // the number — a ratio named, a field named — so they are surfaced
        // verbatim rather than replaced with a generic failure.
        reportError(error, "Could not change resources");
    }

    emit(
        () => {
            success("Resources updated.");
            noteBlank();
            for (const [field, value] of Object.entries(patch)) {
                note(`  ${field} → ${String(value)}`);
            }
            noteBlank();
            note("Applied now: the app rolls its pods and your subscription is prorated from today.");
            if (restart) {
                note(`The database restarts now to apply its new size (${DATABASE_RESTART_IMPACT}).`);
                note("  Billed at the current size until it is running. `rebase cloud compute` shows when it is.");
            }
        },
        // `maintenance` stays in the shape, null, so a script reading it does
        // not break: nothing is held for a window any more.
        { updated: patch, databaseRestart: restart, maintenance: null }
    );
}

/**
 * What the control plane quotes for a project's dials, or undefined when it
 * cannot say. Never throws: a price is context for a question, not its answer.
 */
async function quoteDials(client: CloudClient, dials: Record<string, unknown>): Promise<ResourceQuote | undefined> {
    try {
        // The name is "pricing" and the sub-path an option: the SDK encodes the name.
        const quote = await client.functions.invoke<ResourceQuote>("pricing", dials, { method: "POST", path: "quote" });
        return typeof quote?.totalEur === "number" ? quote : undefined;
    } catch {
        return undefined;
    }
}

/** What the control plane says a set of dials costs, itemised. */
interface ResourceQuote {
    lines: { lookupKey: string; label: string; quantity: number; unit?: string; unitEur: number; amountEur: number }[];
    totalEur: number;
}

/**
 * A dial's value, or a marker that the platform default decides it.
 *
 * The two are different states and the distinction is not cosmetic: an unset
 * dial follows the default and moves if it does, while one pinned to the same
 * number will not. Printing the inherited value would make them identical on
 * screen.
 */
function dialLine(value: unknown, labels?: Record<string, string>): string {
    if (value === null || value === undefined || value === "") return chalk.gray("default");
    const key = String(value);
    return labels?.[key] ?? key;
}

/**
 * Turn `--cpu 500m --db-instances 2` into the patch to send.
 *
 * Pure, and exported, so the flag handling is testable without a control plane —
 * the same shape `buildSettingsPatch` uses. Returns an error string rather than
 * throwing, because the caller owns how a refusal is printed in JSON mode.
 */
export function buildDialPatch(
    rawArgs: string[],
    /**
     * `requireOne: false` for `projects create`, where naming no dial is the
     * ordinary case — a new project takes the platform default. On
     * `compute set` a patch with nothing in it is a typo, and saying so beats
     * a success message for a change nobody made.
     */
    opts?: { requireOne?: boolean }
): { patch: Record<string, unknown>; error?: string } {
    const patch: Record<string, unknown> = {};

    // A value-less flag, and the only way to turn autoscaling off.
    //
    // Setting the ceiling down to the floor would also disable it, but the
    // control plane refuses that now: a row naming a ceiling that resolves to no
    // autoscaler is a state nothing reads back correctly, and it used to happen
    // silently — `--replicas 5` on a project whose ceiling was 5 deleted the
    // HPA, left the ceiling on the row, and said nothing.
    // Read as the parser reads a switch: `=true`/`=1` on, `=false`/`=0` off.
    if (switchOn(rawArgs, "--no-autoscale")) {
        patch.autoscaleMaxReplicas = null;
        patch.autoscaleTargetCpuPercent = null;
    }
    // The database's own autoscaling, off the same way.
    if (switchOn(rawArgs, "--no-db-autoscale")) {
        patch.dbAutoscaleMaxCpu = null;
        patch.dbAutoscaleMaxMemory = null;
    }

    const retired = rawArgs.indexOf(RETIRED_SCALE_TO_ZERO);
    if (retired !== -1) {
        const value = rawArgs[retired + 1];
        if (value === undefined || value.startsWith("--")) {
            return { patch: {}, error: `${RETIRED_SCALE_TO_ZERO} needs a value.` };
        }
        if (!/^(false|0|no|off)$/i.test(value.trim())) {
            return {
                patch: {},
                error: "Scale to zero is not available: every backend runs as an always-on pod. "
                    + "Set the floor with --replicas and a ceiling with --autoscale-max."
            };
        }
        warn(`${RETIRED_SCALE_TO_ZERO} is no longer a setting and was ignored.`,
            "Every backend runs as an always-on pod; drop the flag.");
    }

    for (const [flag, field] of Object.entries(DIAL_FLAGS)) {
        const idx = rawArgs.indexOf(flag);
        if (idx === -1) continue;
        const value = rawArgs[idx + 1];
        // A flag followed by another flag is a missing value, not an empty one.
        // Silently sending "" would clear the dial — the opposite of what
        // someone who fumbled a flag meant.
        if (value === undefined || value.startsWith("--")) {
            return { patch: {}, error: `${flag} needs a value.` };
        }
        if (NUMERIC_DIALS.has(field)) {
            const n = Number(value);
            if (!Number.isInteger(n)) {
                return { patch: {}, error: `${flag} takes a whole number, not "${value}".` };
            }
            // Sent as a number, not a string. The control plane decides whether
            // anything CHANGED by comparing against the stored value — and it
            // re-syncs a Stripe subscription and rolls a tenant's pods when
            // something did. "2" against 2 differs, so a string here would turn
            // every unrelated save into a resize.
            patch[field] = n;
        } else if (BOOLEAN_DIALS.has(field)) {
            if (value !== "true" && value !== "false") {
                return { patch: {}, error: `${flag} takes true or false, not "${value}".` };
            }
            // The string "false" is truthy, and would put a project that asked
            // for on-demand capacity onto preemptible nodes at a third of the
            // price — with restarts it explicitly declined.
            patch[field] = value === "true";
        } else {
            patch[field] = value;
        }
    }

    if (opts?.requireOne !== false && Object.keys(patch).length === 0) {
        return {
            patch: {},
            error: `Nothing to set. Pass one of: ${Object.keys(DIAL_FLAGS).join(", ")}, --no-autoscale, --no-db-autoscale.`
        };
    }
    return { patch };
}
