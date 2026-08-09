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
    emitHelp,
    keyValues,
    fetchTenantBaseDomain,
    projectHost,
    openUrl,
    parseCloudArgs,
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
    // Absent rather than guessed: a release whose image tag is not a semver
    // (a `latest`, a branch build) records no framework version, and inventing
    // one here would defeat the point of storing it.
    const frameworkPart = framework ? chalk.gray(` · framework ${framework}`) : "";
    return `managed ${version}${frameworkPart}${pin}`;
}

export async function statusCommand(rawArgs: string[]): Promise<void> {
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
                console.log("");
            },
            {
                projectId: String(project.id),
                name: project.name ?? null,
                subdomain: project.subdomain ?? null,
                status: project.status ?? null,
                url: projectHost(project, baseDomain) ?? null,
                branch: project.gitBranch ?? null,
                lastDeploy: deploy ? { id: String(deploy.id),
status: deploy.status ?? null,
createdAt: deploy.createdAt ?? null } : null,
                runtime: {
                    mode: project.runtimeMode ?? "custom",
                    version: project.runtimeVersion ?? null,
                    frameworkVersion: project.runtimeFrameworkVersion ?? null,
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

export async function metricsCommand(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    try {
        const m = await client.functions.invoke<{
            status?: string;
            cpu?: string;
            memory?: string;
            memoryPercent?: string;
            disk?: string;
        }>("metrics", undefined, { method: "GET",
path: projectId });

        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  📊 Metrics — project ${displayProjectRef(rawArgs)}`));
                console.log("");
                keyValues([
                    ["Status", m.status ? colorStatus(m.status === "running" ? "active" : m.status) : undefined],
                    ["CPU", m.cpu],
                    ["Memory", m.memory ? `${m.memory}${m.memoryPercent ? ` (${m.memoryPercent})` : ""}` : undefined],
                    ["Disk", m.disk]
                ]);
                console.log("");
            },
            {
                projectId,
                status: m.status ?? null,
                cpu: m.cpu ?? null,
                memory: m.memory ?? null,
                memoryPercent: m.memoryPercent ?? null,
                disk: m.disk ?? null
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

export async function webhooksCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    // Both lines are parsed BEFORE the client is built. A line the parser will
    // refuse is refused without first spending a login round-trip on it — and
    // for `delete`, without the ambiguity of a refusal that arrives after the
    // command has already started talking to the control plane.
    const create = subcommand === "create"
        ? parseCloudArgs({
            spec: { "--name": String,
"--table": String,
"--url": String,
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

    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    try {
        if (subcommand === "create") {
            const args = create!;
            const name = args["--name"] || fail("--name is required.", undefined, "usage");
            const table = args["--table"] || fail("--table is required.", undefined, "usage");
            const url = args["--url"] || fail("--url (endpoint) is required.", undefined, "usage");
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
    emitHelp("storage", ["list", "create", "attach"], () => {
        console.log("");
        console.log(chalk.bold("  rebase cloud storage"));
        console.log("");
        console.log("  " + chalk.blue.bold("storage") + "                   List this project's storage");
        console.log("  " + chalk.blue.bold("storage create") + "            Provision platform-managed storage");
        console.log("  " + chalk.blue.bold("storage attach") + "            Attach your own S3-compatible bucket");
        console.log("");
        console.log(chalk.gray("  attach options:"));
        console.log(chalk.gray("    --bucket <name>          Bucket name (required)"));
        console.log(chalk.gray("    --access-key-id <id>     Access key ID (required)"));
        console.log(chalk.gray("    --secret-access-key <s>  Secret access key (required)"));
        console.log(chalk.gray("    --endpoint <url>         S3 endpoint; omit for AWS"));
        console.log(chalk.gray("    --region <region>        Region"));
        console.log(chalk.gray("    --force-path-style       Required by MinIO and some gateways"));
        console.log("");
        console.log(chalk.gray("  Without either, file storage stays off: uploads are refused with"));
        console.log(chalk.gray("  501 STORAGE_NOT_CONFIGURED rather than written to a container"));
        console.log(chalk.gray("  filesystem that is erased on the next restart."));
        console.log("");
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
        }>(`storage-provision/${encodeURIComponent(projectId)}`, undefined, { method: "POST" });

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

export async function clustersCommand(rawArgs: string[]): Promise<void> {
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
plan: null,
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

        // Best-effort: show which plan the linked/`--project` project is on.
        // BYO-cluster projects pay a flat platform fee; the rest pay managed compute.
        let plan: string | undefined;
        try {
            const parsed = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
            const ref = parsed["--project"] || readLink()?.projectId;
            const projectId = ref ? await lookupProjectId(ref, client) : undefined;
            if (projectId) {
                const proj = (await client.data.collection("projects").findById(projectId)) as
                    | { cluster_id?: string | number; cluster?: unknown; provider?: string; vmSize?: string }
                    | undefined;
                const hasCluster = proj?.cluster_id != null || proj?.cluster != null;
                plan = hasCluster ? "platform fee (own cluster)" : "managed compute";

                // Best-effort: append the resolved monthly amount from Stripe (via
                // the control plane's /api/functions/pricing). Keep working if the
                // endpoint is unreachable — the label alone is still useful.
                try {
                    const pricing = await client.functions.invoke<{
                        items: Array<{ lookupKey: string; amountEur: number }>;
                    }>("pricing", undefined, { method: "GET" });
                    const key = hasCluster
                        ? "platform_byo"
                        : `compute_${proj?.provider || "hetzner"}_${proj?.vmSize || "cx21"}`;
                    const item = pricing.items?.find((i) => i.lookupKey === key);
                    if (item) plan = `${plan} — €${item.amountEur.toFixed(2)}/mo`;
                } catch {
                    // pricing endpoint unreachable — keep the plan label without an amount
                }
            }
        } catch {
            // no linked/resolvable project — skip the Plan line
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
                    ["Plan", plan],
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
                plan: plan ?? null,
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
