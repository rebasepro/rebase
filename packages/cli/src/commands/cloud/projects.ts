/**
 * `rebase cloud projects` — list / create / info / delete.
 */
import chalk from "chalk";
import inquirer from "inquirer";
import {
    requireClient,
    parseCloudArgs,
    requireProjectRef,
    resolveProjectRef,
    getContextOrg,
    readLink,
    writeLink,
    colorStatus,
    keyValues,
    fetchTenantBaseDomain,
    fetchDeployTargets,
    type DeployTarget,
    projectHost,
    success,
    fail,
    warn,
    reportError,
    emit,
    note,
    noteBlank,
    confirmDestructive,
    type CloudClient
} from "./context";
import { buildDialPatch } from "./resources";
import { attachDatabaseRow } from "./databases";

interface ProjectRow {
    id: string | number;
    name?: string;
    subdomain?: string;
    /**
     * Where the project is actually served. Computed by the control plane from
     * the project's cluster, which the CLI cannot read itself (admin-only RLS).
     * Absent on control planes older than that hook — `projectHost` falls back.
     */
    host?: string;
    customDomain?: string;
    gitRepoUrl?: string;
    gitBranch?: string;
    provider?: string;
    region?: string;
    status?: string;
    organization?: string | number;
    createdById?: string;
}

/* ─── list ─────────────────────────────────────────────────────── */

export async function listProjects(rawArgs: string[]): Promise<void> {
    const { client, url } = await requireClient(rawArgs);
    const org = getContextOrg(url);
    try {
        const [projects, baseDomain] = await Promise.all([
            client.data.collection("projects").find({
                where: org ? { organization: ["==", org] } : undefined,
                orderBy: ["name", "asc"],
                limit: 100
            }).then((res) => res.data as unknown as ProjectRow[]),
            fetchTenantBaseDomain(client, url)
        ]);

        const linkedId = readLink()?.projectId;
        emit(
            () => {
                console.log("");
                console.log(chalk.bold("  📦 Projects") + (org ? chalk.gray(`  (org ${org})`) : ""));
                console.log("");

                if (projects.length === 0) {
                    console.log(
                        chalk.gray("  No projects yet. Create one with `rebase cloud projects create`.")
                    );
                    console.log("");
                    return;
                }

                for (const p of projects) {
                    const marker = String(p.id) === linkedId ? chalk.green(" ●") : "  ";
                    console.log(`${marker}${chalk.bold(p.name ?? "(unnamed)")} ${chalk.gray(`[${p.subdomain ?? p.id}]`)} ${colorStatus(p.status)}`);
                    console.log(`    ${chalk.gray(projectHost(p, baseDomain) ?? "—")}${p.provider ? chalk.gray(`  ·  ${p.provider}`) : ""}`);
                }
                console.log("");
            },
            {
                org: org ?? null,
                projects: projects.map((p) => ({
                    id: String(p.id),
                    name: p.name ?? null,
                    slug: p.subdomain ?? null,
                    host: projectHost(p, baseDomain) ?? null,
                    status: p.status ?? null,
                    provider: p.provider ?? null,
                    linked: String(p.id) === linkedId
                }))
            }
        );
    } catch (e) {
        reportError(e, "Failed to list projects");
    }
}

/* ─── create ───────────────────────────────────────────────────── */

/**
 * Default region per provider. Required on create; the rest is dialled.
 *
 * There used to be a `vmSize` here too — `e2-small`, `cx21` — naming a machine
 * on a price list this platform does not buy from. The column was dropped on
 * 2026-08-20 and this went on sending it, which a control plane can only ignore
 * or refuse. What a project reserves is a set of dials now, and a project that
 * sets none takes the platform default.
 */
function providerDefaults(provider: string): { region: string } {
    switch (provider) {
        case "gcp":
            return { region: "europe-west1" };
        case "aws":
            return { region: "us-east-1" };
        default:
            return { region: "nbg1" };
    }
}

/**
 * Where this project says it runs.
 *
 * `provider`/`region` are a *request*: no code downstream reads them to pick a
 * deploy target — that comes from the project's cluster record or the ambient
 * in-cluster context (saas/backend/src/k8s/resolve.ts). So a wrong value here is
 * never contradicted by a failure; it just sits in the record. The CLI used to
 * default to `hetzner`/`nbg1` unconditionally, which is how projects running on
 * our GKE cluster came to describe themselves as Hetzner in the console — and
 * `provider` also decides which substrate's rules a project's dials are clamped
 * to — Autopilot's 250m floor and 1:1-6.5:1 band do not apply on Hetzner or EKS
 * — so a wrong value here resizes pods, it is not a cosmetic slip.
 *
 * The control plane already publishes the infrastructure that actually exists,
 * and the console's create wizard reads it. Ask the same question here.
 *
 * Exported for tests: the decision is pure, so it can be pinned without a
 * control plane. The fetching and the exit live in `resolveRequestedTarget`.
 *
 * @param requested `--provider`, if the caller named one. An explicit flag wins:
 *   it is the caller stating intent, and `deploy` corrects the record anyway.
 * @param targets What the control plane says exists, or `undefined` when it
 *   cannot say — an older deployment with no `platform-config`, or a failed
 *   request. That is different from an empty list, which is a control plane
 *   stating it has no infrastructure at all.
 * @returns the target to record, or `null` when the control plane answered that
 *   there is none.
 */
export function chooseRequestedTarget(
    requested: string | undefined,
    targets: DeployTarget[] | undefined
): { provider: string; region?: string } | null {
    if (requested) return { provider: requested,
region: undefined };

    // Keep the historical default against a control plane that cannot answer,
    // rather than refusing to create a project against it.
    if (!targets) return { provider: "hetzner",
region: undefined };

    if (targets.length === 0) return null;

    // The resolver returns targets in its own preference order, and the first is
    // the one a deploy would use.
    const [target] = targets;
    return { provider: target.provider,
region: target.region?.trim() || undefined };
}

async function resolveRequestedTarget(
    client: CloudClient,
    url: string,
    requested: string | undefined
): Promise<{ provider: string; region?: string }> {
    const chosen = chooseRequestedTarget(requested, await fetchDeployTargets(client, url));
    if (!chosen) {
        fail(
            "This control plane has no deploy targets configured.",
            `Register a cluster, or pass ${chalk.bold("--provider")} and ${chalk.bold("--region")} to record one anyway.`,
            "no_deploy_targets"
        );
    }
    return chosen;
}

/** The flags `rebase cloud projects create` takes. */
export const CREATE_PROJECT_FLAGS = {
    "--name": String,
    "--subdomain": String,
    "--repo": String,
    "--branch": String,
    "--provider": String,
    "--region": String,
    "--org": String,
    "--link": Boolean,
    /**
     * Which database the new project gets — `managed` (the default), `byodb`,
     * or `none`.
     *
     * A default rather than a prompt, and `managed` rather than `none`, because
     * the state this removes is not a missing convenience: a project with no
     * database is written `status: "provisioning"` and can never deploy, and
     * nothing in that word says a second command is owed. Attaching one here
     * means the two-command sequence that every project needs is one command,
     * and `--db none` is there for the case that genuinely wants to decide later.
     *
     * Distinct from `--db-mode`/`--db-cpu` next to it, which are resource dials
     * on a database that exists. This is whether there is one.
     */
    "--db": String,
    /** For `--db byodb`. Same spelling as `rebase cloud db create` uses. */
    "--connection-string": String,
    "-n": "--name",
    // The resource dials, same spelling as `rebase cloud resources set`. Every
    // one is optional: a project that names none takes the platform default.
    // `--vm-size` used to sit here and named a machine on a price list this
    // platform does not buy from; the column it wrote was dropped on 2026-08-20.
    "--cpu": String,
    "--memory": String,
    "--replicas": String,
    "--spot": String,
    "--scale-to-zero": String,
    "--db-mode": String,
    "--db-instances": String,
    "--db-cpu": String,
    "--db-memory": String,
    "--storage": String
} as const;

export async function createProject(rawArgs: string[]): Promise<void> {
    // Strict: every value here ends up in the project record, and the permissive
    // parse dropped a mistyped one silently — `--subdomian shop` created a
    // project on a generated subdomain, and a subdomain is not editable in
    // passing afterwards.
    const { flags: args } = parseCloudArgs({
        spec: CREATE_PROJECT_FLAGS,
        rawArgs,
        commandWords: 3, // cloud projects create
        command: "cloud projects create",
        maxPositionals: 0
    });

    const { client, url } = await requireClient(rawArgs);
    const org = args["--org"] || getContextOrg(url);
    if (!org) {
        fail(
            "No organization selected.",
            `Pass ${chalk.bold("--org <id>")} or run ${chalk.bold("rebase cloud use")}.`,
            "no_org"
        );
    }

    // Prompt only for the essentials, and only when attached to a terminal —
    // a headless `projects create --name X --subdomain Y` must never block.
    // repo/branch/provider are optional and default sensibly.
    const prompts: Array<Record<string, unknown>> = [];
    if (!args["--name"]) prompts.push({ type: "input",
name: "name",
message: "Project name:" });
    if (!args["--subdomain"]) prompts.push({ type: "input",
name: "subdomain",
message: "Subdomain:" });
    const answers = prompts.length && process.stdin.isTTY
        ? await inquirer.prompt(prompts as unknown as Parameters<typeof inquirer.prompt>[0])
        : {};
    const a = answers as Record<string, string>;

    const name = (args["--name"] || a.name || "").trim();
    const subdomain = (args["--subdomain"] || a.subdomain || "").trim().toLowerCase();
    const gitRepoUrl = (args["--repo"] || a.repo || "").trim();
    const gitBranch = (args["--branch"] || a.branch || "main").trim();
    const target = await resolveRequestedTarget(
        client,
        url,
        (args["--provider"] || a.provider)?.trim() || undefined
    );
    const provider = target.provider;
    // region is required by the control plane; default sensibly per provider so
    // a headless `projects create` needs only name + subdomain. The target's own
    // region wins where it has one: a per-provider guess is how a GKE project
    // ended up recorded in `nbg1`.
    const defaults = providerDefaults(provider);
    const region = (args["--region"] || target.region || defaults.region).trim();

    // Resources, if the caller named any. The same flags `resources set` takes,
    // parsed by the same function — a second parser here would be the place the
    // two spellings of a dial drift apart. Nothing is required: a project that
    // names no dial takes the platform default and can change it afterwards.
    const dials = buildDialPatch(rawArgs, { requireOne: false });
    if (dials.error) fail(dials.error, undefined, "bad_request");

    // Validated before the project row is written, not after: a typo'd `--db`
    // discovered afterwards leaves a project that exists and cannot deploy —
    // exactly the state this flag is here to remove.
    const dbChoice = (args["--db"] ?? "managed").trim().toLowerCase();
    if (!["managed", "byodb", "none"].includes(dbChoice)) {
        fail(`--db must be managed, byodb or none (got "${args["--db"]}").`, undefined, "bad_request");
    }
    if (dbChoice === "byodb" && !args["--connection-string"]) {
        fail(
            "--db byodb needs the database to point at.",
            `Pass ${chalk.bold("--connection-string <url>")}.`,
            "input_required"
        );
    }

    if (!name || !subdomain) {
        fail(
            "Name and subdomain are required.",
            `Pass ${chalk.bold("--name <name>")} and ${chalk.bold("--subdomain <slug>")}.`,
            "input_required"
        );
    }

    // Validate subdomain availability up front for a clean error.
    try {
        const check = await client.functions.invoke<{ available: boolean; reason?: string }>(
            "check-subdomain",
            { subdomain }
        );
        if (!check.available) {
            fail(
                `Subdomain "${subdomain}" is not available${check.reason ? ` (${check.reason})` : ""}.`,
                undefined,
                "subdomain_unavailable"
            );
        }
    } catch {
        // If the control plane has no such function, skip the pre-check —
        // the collection hook still enforces uniqueness on create.
    }

    try {
        const user = await client.auth.getUser();
        if (!user) {
            fail("Session is no longer valid.", "Run `rebase cloud login` again.", "session_invalid");
        }
        const created = (await client.data.collection("projects").create({
            name,
            subdomain,
            gitRepoUrl,
            gitBranch,
            provider,
            region,
            ...dials.patch,
            organization: org,
            createdById: user.uid,
            status: "provisioning"
        })) as unknown as ProjectRow;

        const host = projectHost(created, await fetchTenantBaseDomain(client, url));
        const linked = Boolean(args["--link"]);
        if (linked) {
            writeLink({ url,
projectId: String(created.id),
slug: created.subdomain,
projectName: name,
orgId: String(org) });
        }

        // Attached in its own try, and reported separately, because the two
        // halves fail independently. A project that exists with no database is
        // the state worth naming loudly — reporting the whole command as failed
        // would hide a project that was in fact created, and reporting it as
        // succeeded would hide that the project cannot deploy.
        const database = await attachRequestedDatabase(client, {
            projectId: String(created.id),
            choice: dbChoice,
            connectionString: args["--connection-string"],
            projectRef: created.subdomain ?? String(created.id)
        });

        if (database.warning) warn(database.warning[0], database.warning[1]);

        success(`Created project ${chalk.bold(name)}`);
        emit(
            () => {
                keyValues([
                    ["Slug", String(created.subdomain ?? "")],
                    ["URL", host],
                    ["Provider", provider],
                    ["Branch", gitBranch],
                    ["Database", database.line]
                ]);
                if (linked) note(chalk.gray("Linked this directory to the new project."));
                noteBlank();
                for (const line of database.notes) note(chalk.gray(line));
                note(chalk.gray(`Deploy it with:  ${chalk.bold(`rebase cloud deploy --project ${created.subdomain ?? created.id}`)}`));
                noteBlank();
            },
            {
                success: true,
                id: String(created.id),
                name,
                slug: created.subdomain ?? null,
                host: host ?? null,
                provider,
                region,
                dials: dials.patch,
                branch: gitBranch,
                org: String(org),
                linked,
                database: database.payload
            }
        );
    } catch (e) {
        reportError(e, "Failed to create project");
    }
}

/**
 * Attach the database `--db` asked for, and describe what happened.
 *
 * Never throws. The project already exists by the time this runs, so a failure
 * here is a *partial* success and has to be reported as one — with the exact
 * command that finishes the job. Turning it into an exception would report the
 * whole `projects create` as failed and leave a real project behind, which is
 * the worst of both readings.
 */
async function attachRequestedDatabase(
    client: CloudClient,
    input: { projectId: string; choice: string; connectionString?: string; projectRef: string }
): Promise<{
    line: string;
    notes: string[];
    /** `[message, hint]` — raised through `warn`, so it survives JSON mode. */
    warning?: [string, string];
    payload: Record<string, unknown>;
}> {
    if (input.choice === "none") {
        return {
            line: chalk.yellow("none"),
            // A note, not a warning: the caller asked for this, and the only
            // thing owed is the command that undoes it.
            notes: [
                "No database attached (--db none). This project cannot deploy until one is:",
                "  rebase cloud db create --type managed"
            ],
            payload: { attached: false,
type: null,
reason: "requested_none" }
        };
    }

    try {
        const row = await attachDatabaseRow(client, {
            projectId: input.projectId,
            type: input.choice,
            connectionString: input.connectionString
        });
        return {
            line: input.choice === "managed"
                ? `managed ${chalk.gray("· created at the first deploy")}`
                : `byodb ${chalk.gray("· not tested (`rebase cloud db test`)")}`,
            notes: [],
            payload: { attached: true,
id: String(row.id),
type: input.choice,
materializedAt: input.choice === "managed" ? "first_deploy" : "now" }
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            line: chalk.red("not attached"),
            notes: [],
            // A warning, because the caller did NOT ask for this: they now hold
            // a project that exists and cannot deploy. `warn` writes to stderr
            // in every output mode, so a piped run still sees it beside the
            // `database.attached: false` in the payload.
            warning: [
                `The project was created, but attaching its ${input.choice} database failed: ${message}`,
                `Finish it with:  rebase cloud db create --type ${input.choice} --project ${input.projectRef}`
            ],
            payload: { attached: false,
type: input.choice,
reason: "attach_failed",
error: message }
        };
    }
}

/* ─── info ─────────────────────────────────────────────────────── */

/**
 * Which project `projects info` / `projects delete` acts on.
 *
 * The id is optional — omitted, it falls back to `--project` or the link file —
 * and the dispatcher used to read it off `positionals()`, which skips only
 * LEADING `-` tokens and declares only the global cloud flags. So an undeclared
 * flag written after the action became the id: `rebase cloud projects delete
 * --force` looked up a project named "--force" and reported it missing, rather
 * than saying there is no such flag. Benign next to the deletes and writes the
 * rest of this family aimed at the wrong resource, but the same mistake, and
 * `positionals()` has no spec with which to do better — the handler's own
 * module does.
 *
 * Exported so its tests drive the real parser rather than a copy of it.
 */
export function resolveProjectArg(rawArgs: string[], action: "info" | "delete"): string {
    const { positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud projects <action>
        command: `cloud projects ${action}`,
        maxPositionals: 1
    });
    return positionals[0] || requireProjectRef(rawArgs);
}

/** What `capacity` reports for a project's database, when it reports anything. */
interface DatabaseCapacity {
    usedMb: number;
    limitMb: number;
    usedFraction: number | null;
    locked: boolean;
    state: "locked" | "warning" | "ok";
    detail: string;
}

/**
 * A project's database capacity, or null.
 *
 * Swallows every failure on purpose. This decorates `status`; a control plane
 * that predates the `capacity` function 404s here, and an older CLI talking to a
 * newer one must still print the project. Losing the capacity line is a missing
 * nicety — failing the whole command over it would be the bug.
 */
async function fetchCapacity(client: CloudClient, projectId: string): Promise<DatabaseCapacity | null> {
    try {
        const res = await client.functions.invoke<{ database?: DatabaseCapacity | null }>(
            "capacity",
            undefined,
            { method: "GET", path: projectId }
        );
        return res?.database ?? null;
    } catch {
        return null;
    }
}

export async function projectInfo(rawArgs: string[], projectRef: string): Promise<void> {
    const { client, url } = await requireClient(rawArgs);
    try {
        const projectId = await resolveProjectRef(projectRef, client);
        const p = (await client.data.collection("projects").findById(projectId)) as unknown as ProjectRow | undefined;
        if (!p) fail(`Project ${projectRef} not found.`, undefined, "project_not_found");

        const [db, lastDeploy, baseDomain, capacity] = await Promise.all([
            firstRow(client, "databases", projectId),
            latestDeployment(client, projectId),
            fetchTenantBaseDomain(client, url),
            fetchCapacity(client, projectId)
        ]);

        emit(
            () => {
                console.log("");
                console.log(`  ${chalk.bold(p.name ?? "(unnamed)")} ${chalk.gray(`[${p.subdomain ?? p.id}]`)} ${colorStatus(p.status)}`);
                console.log("");
                keyValues([
                    ["Subdomain", projectHost(p, baseDomain)],
                    ["Custom domain", p.customDomain],
                    ["Repository", p.gitRepoUrl],
                    ["Branch", p.gitBranch],
                    ["Provider", p.provider],
                    ["Region", p.region],
                    ["Organization", p.organization !== undefined ? String(p.organization) : undefined],
                    ["Database", db ? `${db.type} (${colorStatus(db.connectionStatus as string)})` : "none"],
                    // Only when there is a ceiling to report against. A project
                    // on a dedicated database has none, and printing "0 MB / 0 MB"
                    // for it would read as full.
                    ["Storage", capacity && capacity.limitMb > 0
                        ? `${capacity.usedMb} MB / ${capacity.limitMb} MB${
                            capacity.usedFraction !== null ? ` (${(capacity.usedFraction * 100).toFixed(0)}%)` : ""
                        }`
                        : undefined],
                    ["Last deploy", lastDeploy ? `${colorStatus(lastDeploy.status)} · ${fmtDate(lastDeploy.createdAt)}` : "never"]
                ]);
                // The whole point of the feature: a tenant hitting the ceiling
                // used to find out because their app stopped answering. Say it
                // here, where they already look, and say what happens next.
                if (capacity && capacity.state !== "ok") {
                    console.log("");
                    console.log(
                        capacity.state === "locked"
                            ? `  ${chalk.red.bold("✗ Database locked — over its storage limit")}`
                            : `  ${chalk.yellow.bold("⚠ Database approaching its storage limit")}`
                    );
                    console.log(`  ${chalk.gray(capacity.detail)}`);
                }
                console.log("");
            },
            {
                id: String(p.id),
                name: p.name ?? null,
                slug: p.subdomain ?? null,
                host: projectHost(p, baseDomain) ?? null,
                customDomain: p.customDomain ?? null,
                repository: p.gitRepoUrl ?? null,
                branch: p.gitBranch ?? null,
                provider: p.provider ?? null,
                region: p.region ?? null,
                status: p.status ?? null,
                org: p.organization !== undefined ? String(p.organization) : null,
                database: db ? { type: db.type ?? null,
connectionStatus: db.connectionStatus ?? null,
capacity: capacity ?? null } : null,
                lastDeploy: lastDeploy
                    ? { id: String(lastDeploy.id),
status: lastDeploy.status ?? null,
createdAt: lastDeploy.createdAt ?? null }
                    : null
            }
        );
    } catch (e) {
        reportError(e, "Failed to load project");
    }
}

/* ─── delete ───────────────────────────────────────────────────── */

export async function deleteProject(rawArgs: string[], projectRef: string): Promise<void> {
    const { flags: args } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud projects delete
        command: "cloud projects delete",
        maxPositionals: 1 // [id]
    });
    const { client } = await requireClient(rawArgs);
    const projectId = await resolveProjectRef(projectRef, client);

    const p = (await client.data.collection("projects").findById(projectId).catch(() => undefined)) as
        | ProjectRow
        | undefined;
    if (!p) fail(`Project ${projectRef} not found.`, undefined, "project_not_found");

    // Through the shared guard, not a bare `inquirer.prompt`. This was the one
    // destructive command in the family that rolled its own confirm, and it was
    // the only one that could HANG: piped or agent-run, the other nine refuse
    // with `confirmation_required` while this one sat on a prompt reading a
    // stdin that would never answer — on the single command whose whole job is
    // to tear a project down.
    await confirmDestructive({
        yes: Boolean(args["--yes"]),
        prompt: `Permanently delete project "${p.name ?? projectRef}" (${p.subdomain ?? projectRef})? This tears down its deployment.`
    });

    try {
        await client.data.collection("projects").delete(projectId);
        success(`Deleted project ${chalk.bold(p.name ?? projectId)}`);
        emit(() => {}, {
            success: true,
            id: projectId,
            name: p.name ?? null,
            slug: p.subdomain ?? null
        });
    } catch (e) {
        reportError(e, "Failed to delete project");
    }
}

/* ─── shared helpers (used by other subcommands too) ───────────── */

export async function firstRow(
    client: CloudClient,
    collection: string,
    projectId: string
): Promise<Record<string, unknown> | undefined> {
    const res = await client.data.collection(collection).find({
        where: { project: ["==", projectId] },
        limit: 1
    });
    return res.data[0];
}

export async function latestDeployment(
    client: CloudClient,
    projectId: string
): Promise<{ id: string | number; status?: string; createdAt?: string; logs?: string } | undefined> {
    const res = await client.data.collection("deployments").find({
        where: { project: ["==", projectId] },
        orderBy: ["createdAt", "desc"],
        limit: 1
    });
    return res.data[0] as { id: string | number; status?: string; createdAt?: string; logs?: string } | undefined;
}

export function fmtDate(value: string | undefined): string {
    if (!value) return "—";
    const d = new Date(value);
    return isNaN(d.getTime()) ? value : d.toLocaleString();
}
