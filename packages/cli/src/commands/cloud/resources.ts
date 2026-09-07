import fs from "fs";
/**
 * `rebase cloud` resource subcommands: status, metrics, webhooks, storage,
 * clusters, billing.
 */
import arg from "arg";
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    lookupProjectId,
    displayProjectRef,
    getContextOrg,
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
    noteBlank
} from "./context";
import { firstRow, latestDeployment, fmtDate } from "./projects";

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

export function resolveBlockedState(input: {
    projectStatus?: string | null;
    /** The project's database row, or undefined when none is attached. */
    database?: { connectionStatus?: string | null } | undefined;
    lastDeploy?: { status?: string | null; logs?: string | null } | undefined;
}): BlockedState {
    // First, because it is the state that never resolves itself. A project
    // with no database cannot deploy, and no amount of waiting attaches one.
    if (!input.database) {
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
    if (input.database.connectionStatus === "failed") {
        return { blockedOn: "database_unreachable",
nextAction: "rebase cloud db test" };
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
        const project = (await client.data.collection("projects").findById(projectId)) as
            | {
                id: string | number; name?: string; subdomain?: string; host?: string; status?: string;
                gitBranch?: string; runtimeMode?: string | null; runtimeVersion?: string | null;
                runtimeFrameworkVersion?: string | null; runtimeContract?: number | null;
                runtimeRange?: string | null; runtimeVersionPin?: string | null;
            }
            | undefined;
        if (!project) fail(`Project ${displayProjectRef(rawArgs)} not found.`, undefined, "not_found");

        const [db, storage, deploy, baseDomain] = await Promise.all([
            firstRow(client, "databases", projectId),
            // A control plane that does not have this route yet, or a lookup
            // that fails, yields `undefined` — which prints as a blank. A blank
            // is a better answer than a wrong one for exactly this field.
            client.functions
                .invoke<StorageState>("storage-provision", undefined, { method: "GET",
path: projectId })
                .catch(() => undefined),
            latestDeployment(client, projectId),
            fetchTenantBaseDomain(client, url)
        ]);

        const storageLine = describeStorageState(storage);
        const databaseLine = describeDatabaseState(db);
        const blocked = resolveBlockedState({
            projectStatus: project.status,
            database: db as { connectionStatus?: string | null } | undefined,
            lastDeploy: deploy as { status?: string | null; logs?: string | null } | undefined
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
                    ["Storage", storageLine]
                ]);
                // The same fact the JSON carries, in the place a person reads.
                // Below the rows rather than inside them: it is not another
                // property of the project, it is what to do next.
                if (blocked.blockedOn) {
                    console.log("");
                    console.log(`  ${chalk.yellow("Waiting on you")} ${chalk.gray(`— ${blocked.blockedOn}`)}`);
                    console.log(`  ${chalk.bold(blocked.nextAction ?? "")}`);
                }
                console.log("");
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
                    pin: project.runtimeVersionPin ?? null
                },
                database: db ? { type: db.type ?? null,
connectionStatus: db.connectionStatus ?? null } : null,
                storage: storage ?? null
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

export async function metricsCommand(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 2,
command: "cloud metrics",
maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    try {
        const m = await client.functions.invoke<TenantMetrics>(
            "metrics", undefined, { method: "GET", path: projectId }
        );

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
                condition: m.condition ?? null
            }
        );
    } catch (e) {
        reportError(e, "Failed to fetch metrics");
    }
}

/* ─── webhooks ─────────────────────────────────────────────────── */

/**
 * The webhook `webhooks delete` names.
 *
 * The worst instance of the operand-filter bug in this family, because the
 * argument is consumed by a DELETE and the wrong value looks entirely
 * plausible: `rebase cloud webhooks delete --project acme 42` filtered out
 * `--project` and kept "acme", so the id it deleted was the project slug rather
 * than the 42 the caller wrote. Strict parsing consumes the flag with its
 * value, leaving `["42"]`.
 *
 * Exported so its tests drive the real parser.
 */
export function resolveWebhookIdArg(rawArgs: string[]): string | undefined {
    return parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud webhooks delete
        command: "cloud webhooks delete",
        maxPositionals: 1
    }).positionals[0];
}

/** The action words `rebase cloud webhooks` dispatches. No word means `list`. */
export const WEBHOOKS_ACTIONS = ["list", "create", "delete"] as const;

export async function webhooksCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    // Before the parse and before the client: `webhooks creat` used to fall past
    // both `if`s and LIST the webhooks, exit 0, and leave the caller believing
    // one had been created.
    requireKnownAction("webhooks", subcommand, WEBHOOKS_ACTIONS);

    // Both lines are parsed BEFORE the client is built. A line the parser will
    // refuse is refused without first spending a login round-trip on it — and
    // for `delete`, without the ambiguity of a refusal that arrives after the
    // command has already started talking to the control plane.
    const create = subcommand === "create"
        ? parseCloudArgs({
            // `--endpoint`, not `--url`.
            //
            // Every command in this family inherits a global `--url`, which
            // names the CONTROL PLANE — `resolveCloudUrl` reads it straight off
            // the raw line, before any per-command spec exists. A second
            // `--url` here did not shadow it, because the two parses are
            // independent: `webhooks create --url https://example.com/hook`
            // sent the customer's webhook endpoint to `requireClient` as the
            // control plane to authenticate against, so the documented example
            // could not create a webhook. Renaming is the fix; a per-command
            // flag cannot be a global's spelling, and `action-help.test.ts`
            // now sweeps for the class.
            spec: { "--name": String,
"--table": String,
"--endpoint": String,
"--events": String },
            rawArgs,
            commandWords: 3, // cloud webhooks create
            command: "cloud webhooks create",
            maxPositionals: 0
        }).flags
        : undefined;
    const deleteId = subcommand === "delete" ? resolveWebhookIdArg(rawArgs) : undefined;
    if (subcommand === "delete" && !deleteId) {
        fail("Usage: rebase cloud webhooks delete <id>", undefined, "usage");
    }
    // The listing takes only the globals, and took them permissively: `webhooks
    // list --tabel orders` listed every webhook and exited 0.
    if (!create && !deleteId) {
        parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud webhooks",
maxPositionals: 0 });
    }

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    try {
        if (subcommand === "create") {
            const args = create!;
            const name = args["--name"] || fail("--name is required.", undefined, "usage");
            const table = args["--table"] || fail("--table is required.", undefined, "usage");
            const url = args["--endpoint"] || fail("--endpoint is required.", "Where the POST goes.", "usage");
            const events = (args["--events"] || "insert,update,delete").split(",").map((s) => s.trim());

            const created = (await client.data.collection("webhooks").create({
                project: projectId,
                name,
                table,
                url,
                events,
                enabled: true
            })) as unknown as { id: string | number };
            success(`Created webhook ${chalk.bold(name)} [${created.id}]`);
            emit(() => {}, {
                success: true,
                id: String(created.id),
                projectId,
                name,
                table,
                url,
                events,
                enabled: true
            });
            return;
        }

        if (subcommand === "delete") {
            await client.data.collection("webhooks").delete(deleteId!);
            success(`Deleted webhook ${deleteId}`);
            emit(() => {}, { success: true,
id: deleteId!,
projectId });
            return;
        }

        // list
        const hooks = (await client.data.collection("webhooks").find({
            where: { project: ["==", projectId] },
            limit: 100
        })).data as unknown as Array<{ id: string | number; name?: string; table?: string; url?: string; enabled?: boolean; events?: string[] }>;

        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🔗 Webhooks — project ${displayProjectRef(rawArgs)}`));
                console.log("");
                if (hooks.length === 0) {
                    console.log(chalk.gray("  No webhooks. Add one with `rebase cloud webhooks create`."));
                    console.log("");
                    return;
                }
                for (const h of hooks) {
                    const state = h.enabled ? chalk.green("enabled") : chalk.gray("disabled");
                    console.log(`  ${chalk.bold(h.name ?? "(unnamed)")} ${chalk.gray(`[${h.id}]`)} ${state}`);
                    console.log(`    ${chalk.gray(`${h.table ?? "?"} → ${h.url ?? "?"}  (${(h.events ?? []).join(", ")})`)}`);
                }
                console.log("");
            },
            {
                projectId,
                webhooks: hooks.map((h) => ({
                    id: String(h.id),
                    name: h.name ?? null,
                    table: h.table ?? null,
                    url: h.url ?? null,
                    events: h.events ?? [],
                    enabled: h.enabled ?? null
                }))
            }
        );
    } catch (e) {
        reportError(e, "Webhook operation failed");
    }
}

/* ─── storage ──────────────────────────────────────────────────── */

/** The action words `rebase cloud storage` dispatches. No word means `list`. */
export const STORAGE_ACTIONS = ["list", "create", "attach"] as const;

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
        const stores = (await client.data.collection("storages").find({
            where: { project: ["==", projectId] },
            limit: 50
        })).data as unknown as Array<{ id: string | number; type?: string; provider?: string; bucketName?: string; status?: string }>;

        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🪣 Storage — project ${displayProjectRef(rawArgs)}`));
                console.log("");
                if (stores.length === 0) {
                    console.log(chalk.gray("  No storage buckets attached."));
                    console.log("");
                    return;
                }
                for (const s of stores) {
                    console.log(`  ${chalk.bold(s.bucketName ?? s.type ?? "bucket")} ${chalk.gray(`[${s.id}]`)} ${colorStatus(s.status)}`);
                    keyValues([["Provider", s.provider], ["Type", s.type]]);
                }
                console.log("");
            },
            {
                projectId,
                stores: stores.map((s) => ({
                    id: String(s.id),
                    bucketName: s.bucketName ?? null,
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

export function printStorageHelp(): void {
    printGroupHelp({
        command: "cloud storage",
        title: "The project's object storage",
        actions: [
            { action: "list",
description: "The buckets this project has, and their state" },
            { action: "create",
description: "Provision platform-managed storage. Takes no options" },
            {
                action: "attach",
                description: "Attach your own S3-compatible bucket",
                flags: [
                    ["--bucket <name>", "Bucket name. Required"],
                    ["--access-key-id <id>", "Access key ID. Required"],
                    ["--secret-access-key <s>", "Secret access key. Required"],
                    ["--endpoint <url>", "S3 endpoint. Omit for AWS"],
                    ["--region <region>", "Region"],
                    ["--force-path-style", "Required by MinIO and some gateways"]
                ]
            }
        ],
        notes: [
            "Without either, file storage stays off: uploads are refused with 501",
            "STORAGE_NOT_CONFIGURED rather than written to a container filesystem that is",
            "erased on the next restart.",
            "Redeploy after `attach` for the tenant to pick the credentials up."
        ]
    });
}

/* ─── storage create: platform-managed ─────────────────────────── */

async function storageCreateCommand(rawArgs: string[]): Promise<void> {
    // Takes no options of its own, and provisions billable infrastructure: an
    // unrecognised flag here (`storage create --region eu`, borrowed from
    // `attach`) provisioned in the default region and said nothing.
    parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud storage create
        command: "cloud storage create",
        maxPositionals: 0
    });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    try {
        noteBlank();
        note(chalk.gray("Provisioning managed storage — this creates a bucket and its credentials..."));

        const res = await client.functions.invoke<{
            data: { bucketName: string; region: string; endpoint: string; accessKeyId: string };
            // The project id is a SUB-PATH, not part of the function name.
            // `invoke` runs `encodeURIComponent` over the name — correct, since
            // a function name is one path segment — so folding the id into it
            // sent `POST /api/functions/storage-provision%2F<id>`, which matches
            // no route. The control plane answered a bare 404 and
            // `rebase cloud storage create` read as an unimplemented feature for
            // six weeks. `invoke` now refuses a name containing `/` outright.
        }>("storage-provision", undefined, { method: "POST", path: projectId });

        const info = (res as unknown as { data?: typeof res.data }).data ?? res.data;

        success(`Managed storage provisioned for ${displayProjectRef(rawArgs)}.`);
        emit(
            () => {
                keyValues([
                    ["Bucket", info.bucketName],
                    ["Region", info.region],
                    ["Endpoint", info.endpoint],
                    ["Access key", info.accessKeyId]
                ]);
                noteBlank();
                // The secret is never returned by the endpoint — it goes to the
                // row and to the tenant's environment. Say so, or the absence
                // reads as a bug.
                note(chalk.gray("The secret key is stored encrypted and injected at deploy time; it is not displayed."));
                note(chalk.gray("Redeploy for the tenant to pick it up:  ") + chalk.bold("rebase cloud deploy"));
                noteBlank();
            },
            {
                success: true,
                projectId,
                bucketName: info.bucketName,
                region: info.region,
                endpoint: info.endpoint,
                accessKeyId: info.accessKeyId,
                // Stated, not omitted: a caller that finds no secret in the
                // payload should know it was withheld, not lost.
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
            "--force-path-style": Boolean
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

    try {
        const existing = (await client.data.collection("storages").find({
            where: { project: ["==", projectId] },
            limit: 1
        })).data[0] as { id?: string | number } | undefined;

        const row: Record<string, unknown> = {
            project: projectId,
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
            await client.data.collection("storages").update(String(existing.id), row);
        } else {
            await client.data.collection("storages").create(row);
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
export const CLUSTERS_ACTIONS = ["list", "add", "verify"] as const;

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
        }) as never;
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
    backupBucket?: string;
    backupEndpoint?: string;
    backupAccessKeyId?: string;
    backupSecretAccessKey?: string;
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
export function resolveClusterAddArgs(rawArgs: string[]): ClusterAddArgs {
    const { flags } = parseCloudArgs({
        spec: {
            "--name": String,
            "--provider": String,
            "--region": String,
            "--kubeconfig": String,
            "--base-domain": String,
            "--ingress-address": String,
            "--platform-capacity": Boolean,
            "--backup-bucket": String,
            "--backup-endpoint": String,
            "--backup-access-key-id": String,
            "--backup-secret-access-key": String
        },
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
                "[--base-domain <d>] [--ingress-address <ip>] [--platform-capacity] " +
                "[--backup-bucket <b> --backup-endpoint <url> --backup-access-key-id <k> --backup-secret-access-key <s>]",
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

    return {
        name: name!,
        provider,
        region: region!,
        kubeconfigPath: kubeconfigPath!,
        baseDomain: flags["--base-domain"],
        ingressAddress: flags["--ingress-address"],
        platformCapacity: flags["--platform-capacity"] === true,
        ...(anyBackup ? backup : {})
    };
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
        created = await client.data.collection("clusters").create({
            ...columns,
            authType: "kubeconfig",
            kubeConfigData
        }) as never;
    } catch (error: unknown) {
        reportError(error, "Could not register the cluster");
        return;
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
                note(`Projects placed in ${args.region} now deploy here. Point *.${args.baseDomain ?? "<baseDomain>"} at ${args.ingressAddress ?? "its ingress address"} first.`);
            }
        },
        { id: created.id, name: args.name, provider: args.provider, region: args.region, platformCapacity: args.platformCapacity }
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
        const clusters = (await client.data.collection("clusters").find({ limit: 100 })).data as unknown as Array<{
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
export const BILLING_ACTIONS = ["setup", "checkout"] as const;

export async function billingCommand(rawArgs: string[]): Promise<void> {
    // Parsed before the client is built: an unusable line should be refused
    // without first spending a login round-trip on it.
    const action = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 2, // cloud billing
        command: "cloud billing",
        maxPositionals: 1
    }).positionals[0];
    requireKnownAction("billing", action, BILLING_ACTIONS);

    const { client, url } = await requireClient(rawArgs);
    const org = getContextOrg(url);

    // `rebase cloud billing setup` — attach a card to the org (one-time, opens a
    // browser). Once done, project create/deploy work headlessly (off_session).
    if (action === "setup") {
        if (!org) fail("No active organization.", "Run `rebase cloud use` first.", "no_org");
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
            const res = await client.functions.invoke<{ url?: string }>(
                "stripe-billing",
                { projectId },
                { path: "session" }
            );
            if (!res.url) fail("Billing session could not be created.", undefined, "checkout_failed");
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
    if (!org) fail("No active organization.", "Run `rebase cloud use` first.", "no_org");
    try {
        const orgRow = (await client.data.collection("organizations").findById(org)) as
            | { billing_account_id?: string | number; billingAccount?: string | number }
            | undefined;
        const billingId = orgRow?.billing_account_id ?? orgRow?.billingAccount;
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
        const acct = (await client.data.collection("billing-accounts").findById(billingId)) as
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
                const proj = (await client.data.collection("projects").findById(projectId)) as
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
            if (process.env.REBASE_DEBUG) {
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
export const COMPUTE_ACTIONS = ["show", "set"] as const;

/** The dials, and the flag that sets each. */
const DIAL_FLAGS = {
    "--cpu": "cpu",
    "--memory": "memory",
    "--replicas": "replicaCount",
    "--spot": "preemptible",
    "--scale-to-zero": "scaleToZero",
    "--db-mode": "databaseMode",
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
    "--autoscale-cpu-target": "autoscaleTargetCpuPercent"
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
    "--no-autoscale": Boolean
};

/** Dials whose column is a number, not the text a flag carries. */
const NUMERIC_DIALS = new Set([
    "databaseInstances",
    "replicaCount",
    "autoscaleMaxReplicas",
    "autoscaleTargetCpuPercent"
]);
/** Dials that are a yes/no. `--spot false` has to reach the row as `false`. */
const BOOLEAN_DIALS = new Set(["preemptible", "scaleToZero"]);

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
    // `set` is described by `COMPUTE_SET_FLAGS`, which is derived from
    // `DIAL_FLAGS`; `buildDialPatch` still reads the values itself, because
    // `--no-autoscale` is value-less. This parse is only the refusal: without
    // it `compute set --cpu-request 500m` set nothing and reported success.
    parseCloudArgs({
        spec: (action === "set" ? COMPUTE_SET_FLAGS : {}) as Record<string, never>,
        rawArgs,
        commandWords: 3,
        command: action === "set" ? "cloud compute set" : "cloud compute",
        maxPositionals: 0
    });

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    const project = (await client.data.collection("projects").findById(projectId)) as
        | Record<string, unknown>
        | undefined;
    if (!project) fail(`Project ${displayProjectRef(rawArgs)} not found.`, undefined, "not_found");

    if (action !== "set") {
        // What this costs, priced by the control plane. Best-effort: an older
        // control plane has no quote endpoint, and a resources listing that
        // fails because a price could not be fetched would be worse than one
        // without the price.
        let quote: ResourceQuote | undefined;
        try {
            // See the note at the other call site: the name is "pricing" and the
            // sub-path is an option, because the SDK encodes the name.
            quote = await client.functions.invoke<ResourceQuote>(
                "pricing", project, { method: "POST", path: "quote" });
        } catch (err: unknown) {
            // No quote — the dials below are still the answer to the question
            // asked. Visible under REBASE_DEBUG, so a permanent failure cannot
            // masquerade as a control plane that simply does not price.
            if (process.env.REBASE_DEBUG) {
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
                    ["Capacity", dialLine(project!.preemptible, { true: "spot", false: "on demand" })],
                    ["When idle", dialLine(project!.scaleToZero, { true: "scale to zero", false: "stay warm" })],
                    ["Database", dialLine(project!.databaseMode)],
                    ["Database instances", dialLine(project!.databaseInstances)],
                    ["Database CPU", dialLine(project!.databaseCpu)],
                    ["Database memory", dialLine(project!.databaseMemory)],
                    ["Object storage", dialLine(project!.storageMode)],
                    ["Per month", quote ? `€${quote.totalEur.toFixed(2)}` : undefined]
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
                preemptible: project!.preemptible ?? null,
                scaleToZero: project!.scaleToZero ?? null,
                databaseMode: project!.databaseMode ?? null,
                databaseInstances: project!.databaseInstances ?? null,
                databaseCpu: project!.databaseCpu ?? null,
                databaseMemory: project!.databaseMemory ?? null,
                storageMode: project!.storageMode ?? null
            }
        );
        return;
    }

    const built = buildDialPatch(rawArgs);
    if (built.error) fail(built.error, undefined, "bad_request");
    const patch = built.patch;

    try {
        await client.data.collection("projects").update(projectId, patch);
    } catch (error: unknown) {
        // The control plane's refusals are written to be read by whoever chose
        // the number — a ratio named, a field named — so they are surfaced
        // verbatim rather than replaced with a generic failure.
        reportError(error, "Could not change resources");
        return;
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
            note("A change that restarts the database waits for a maintenance window.");
        },
        { updated: patch }
    );
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
    if (rawArgs.includes("--no-autoscale")) {
        patch.autoscaleMaxReplicas = null;
        patch.autoscaleTargetCpuPercent = null;
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
            error: `Nothing to set. Pass one of: ${Object.keys(DIAL_FLAGS).join(", ")}, --no-autoscale.`
        };
    }
    return { patch };
}
