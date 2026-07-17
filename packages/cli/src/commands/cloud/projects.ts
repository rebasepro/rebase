/**
 * `rebase cloud projects` — list / create / info / delete.
 */
import arg from "arg";
import chalk from "chalk";
import inquirer from "inquirer";
import {
    requireClient,
    getContextOrg,
    readLink,
    writeLink,
    colorStatus,
    keyValues,
    fetchTenantBaseDomain,
    projectHost,
    success,
    fail,
    reportError,
    type CloudClient
} from "./context";

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

        console.log("");
        console.log(chalk.bold("  📦 Projects") + (org ? chalk.gray(`  (org ${org})`) : ""));
        console.log("");

        if (projects.length === 0) {
            console.log(chalk.gray("  No projects yet. Create one with `rebase cloud projects create`."));
            console.log("");
            return;
        }

        const linkedId = readLink()?.projectId;
        for (const p of projects) {
            const marker = String(p.id) === linkedId ? chalk.green(" ●") : "  ";
            console.log(`${marker}${chalk.bold(p.name ?? "(unnamed)")} ${chalk.gray(`[${p.id}]`)} ${colorStatus(p.status)}`);
            console.log(`    ${chalk.gray(projectHost(p, baseDomain) ?? "—")}${p.provider ? chalk.gray(`  ·  ${p.provider}`) : ""}`);
        }
        console.log("");
    } catch (e) {
        reportError(e, "Failed to list projects");
    }
}

/* ─── create ───────────────────────────────────────────────────── */

/** Default region + VM size per provider (both are required on create). */
function providerDefaults(provider: string): { region: string; vmSize: string } {
    switch (provider) {
        case "gcp":
            return { region: "europe-west1",
vmSize: "e2-small" };
        case "aws":
            return { region: "us-east-1",
vmSize: "t3.small" };
        default:
            return { region: "nbg1",
vmSize: "cx21" };
    }
}

export async function createProject(rawArgs: string[]): Promise<void> {
    const args = arg(
        {
            "--name": String,
            "--subdomain": String,
            "--repo": String,
            "--branch": String,
            "--provider": String,
            "--region": String,
            "--vm-size": String,
            "--org": String,
            "--link": Boolean,
            "-n": "--name"
        },
        { argv: rawArgs.slice(4),
permissive: true }
    );

    const { client, url } = await requireClient(rawArgs);
    const org = args["--org"] || getContextOrg(url);
    if (!org) {
        fail(
            "No organization selected.",
            `Pass ${chalk.bold("--org <id>")} or run ${chalk.bold("rebase cloud use")}.`
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
    const provider = (args["--provider"] || a.provider || "hetzner").trim();
    // region + vmSize are required by the control plane; default sensibly per
    // provider so a headless `projects create` needs only name + subdomain.
    const defaults = providerDefaults(provider);
    const region = (args["--region"] || defaults.region).trim();
    const vmSize = (args["--vm-size"] || defaults.vmSize).trim();

    if (!name || !subdomain) {
        fail("Name and subdomain are required.");
    }

    // Validate subdomain availability up front for a clean error.
    try {
        const check = await client.functions.invoke<{ available: boolean; reason?: string }>(
            "check-subdomain",
            { subdomain }
        );
        if (!check.available) {
            fail(
                `Subdomain "${subdomain}" is not available${check.reason ? ` (${check.reason})` : ""}.`
            );
        }
    } catch {
        // If the control plane has no such function, skip the pre-check —
        // the collection hook still enforces uniqueness on create.
    }

    try {
        const user = await client.auth.getUser();
        if (!user) fail("Session is no longer valid.", "Run `rebase cloud login` again.");
        const created = (await client.data.collection("projects").create({
            name,
            subdomain,
            gitRepoUrl,
            gitBranch,
            provider,
            region,
            vmSize,
            organization: org,
            createdById: user.uid,
            status: "provisioning"
        })) as unknown as ProjectRow;

        success(`Created project ${chalk.bold(name)}`);
        keyValues([
            ["ID", String(created.id)],
            ["URL", projectHost(created, await fetchTenantBaseDomain(client, url))],
            ["Provider", provider],
            ["Branch", gitBranch]
        ]);

        if (args["--link"]) {
            writeLink({ url,
projectId: String(created.id),
projectName: name,
orgId: String(org) });
            console.log(chalk.gray("  Linked this directory to the new project."));
        }
        console.log("");
        console.log(chalk.gray(`  Deploy it with:  ${chalk.bold(`rebase cloud deploy --project ${created.id}`)}`));
        console.log("");
    } catch (e) {
        reportError(e, "Failed to create project");
    }
}

/* ─── info ─────────────────────────────────────────────────────── */

export async function projectInfo(rawArgs: string[], projectId: string): Promise<void> {
    const { client, url } = await requireClient(rawArgs);
    try {
        const p = (await client.data.collection("projects").findById(projectId)) as unknown as ProjectRow | undefined;
        if (!p) fail(`Project ${projectId} not found.`);

        const [db, lastDeploy, baseDomain] = await Promise.all([
            firstRow(client, "databases", projectId),
            latestDeployment(client, projectId),
            fetchTenantBaseDomain(client, url)
        ]);

        console.log("");
        console.log(`  ${chalk.bold(p.name ?? "(unnamed)")} ${chalk.gray(`[${p.id}]`)} ${colorStatus(p.status)}`);
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
            ["Last deploy", lastDeploy ? `${colorStatus(lastDeploy.status)} · ${fmtDate(lastDeploy.createdAt)}` : "never"]
        ]);
        console.log("");
    } catch (e) {
        reportError(e, "Failed to load project");
    }
}

/* ─── delete ───────────────────────────────────────────────────── */

export async function deleteProject(rawArgs: string[], projectId: string): Promise<void> {
    const args = arg({ "--yes": Boolean,
"-y": "--yes" }, { argv: rawArgs.slice(2),
permissive: true });
    const { client } = await requireClient(rawArgs);

    const p = (await client.data.collection("projects").findById(projectId).catch(() => undefined)) as
        | ProjectRow
        | undefined;
    if (!p) fail(`Project ${projectId} not found.`);

    if (!args["--yes"]) {
        const { confirmed } = await inquirer.prompt([
            {
                type: "confirm",
                name: "confirmed",
                default: false,
                message: `Permanently delete project "${p.name ?? projectId}" (${projectId})? This tears down its deployment.`
            }
        ] as unknown as Parameters<typeof inquirer.prompt>[0]);
        if (!confirmed) {
            console.log(chalk.gray("  Aborted."));
            return;
        }
    }

    try {
        await client.data.collection("projects").delete(projectId);
        success(`Deleted project ${chalk.bold(p.name ?? projectId)}`);
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
