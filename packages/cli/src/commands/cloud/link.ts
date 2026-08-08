/**
 * `rebase cloud` context subcommands: link, unlink, use, open.
 *
 * `link` associates the current directory with a cloud project by writing
 * `.rebase/cloud.json`; deploy/logs/status then operate on it with no flags.
 */
import arg from "arg";
import chalk from "chalk";
import inquirer from "inquirer";
import {
    requireClient,
    resolveProjectRef,
    resolveCloudUrl,
    writeLink,
    removeLink,
    readLink,
    projectLinkPath,
    setContextOrg,
    getContextOrg,
    openUrl,
    success,
    fail,
    reportError
} from "./context";

interface ProjectRow {
    id: string | number;
    name?: string;
    subdomain?: string;
    organization?: string | number;
    status?: string;
}

/**
 * Link this checkout straight at a running backend.
 *
 * No control plane, no authentication, no project id — just the URL of a Rebase
 * API. This is what makes the multi-repo workflow available to self-hosters: a
 * frontend repository links to `https://api.example.com` and then generates its
 * typed SDK from that project exactly as a cloud-linked repository would.
 *
 * The URL is verified before it is written. Recording an unreachable address and
 * failing later, in a different command, would be a worse experience than
 * failing here where the user can see what they typed.
 */
async function linkDirect(target: string, rawArgs: string[]): Promise<void> {
    let base: URL;
    try {
        base = new URL(target);
    } catch {
        fail(`"${target}" is not a valid URL.`);
        return;
    }

    if (base.protocol !== "http:" && base.protocol !== "https:") {
        fail("A project URL must be http or https.");
    }

    const apiUrl = base.toString().replace(/\/+$/, "");
    const probe = `${apiUrl}/api/meta/schema-version`;

    let reachable = false;
    let detail = "";
    try {
        const response = await fetch(probe, { headers: { accept: "application/json" } });
        reachable = response.ok;
        if (!response.ok) detail = `responded ${response.status}`;
    } catch (err) {
        detail = err instanceof Error ? err.message : String(err);
    }

    if (!reachable) {
        console.log(chalk.yellow(`⚠ Could not reach ${probe}${detail ? ` (${detail})` : ""}.`));
        console.log(chalk.dim("  Linking anyway — the server may not be running yet."));
        console.log(chalk.dim("  It must be a Rebase backend of version 0.11 or newer."));
    }

    writeLink({
        url: apiUrl,
        projectId: "",
        apiUrl,
        mode: "direct",
        projectName: base.host
    });

    success(`Linked to ${apiUrl}`);
    console.log(chalk.dim(`  Written to ${projectLinkPath()}`));
    console.log("");
    console.log(`Next: ${chalk.cyan("rebase generate-sdk --from link")}`);
    void rawArgs;
}

export async function linkCommand(rawArgs: string[]): Promise<void> {
    const args = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(3),
permissive: true });

    // A positional URL means "this exact backend", which needs no login and no
    // control plane. `rebase cloud link https://api.example.com`
    const positional = args._.find(value => /^https?:\/\//i.test(value));
    if (positional) {
        await linkDirect(positional, rawArgs);
        return;
    }

    const { client, url } = await requireClient(rawArgs);

    try {
        let project: ProjectRow | undefined;

        if (args["--project"]) {
            const projectId = await resolveProjectRef(args["--project"], client);
            project = (await client.data.collection("projects").findById(projectId)) as unknown as ProjectRow | undefined;
            if (!project) fail(`Project ${args["--project"]} not found.`);
        } else {
            const org = getContextOrg(url);
            const projects = (await client.data.collection("projects").find({
                where: org ? { organization: ["==", org] } : undefined,
                limit: 100
            })).data as unknown as ProjectRow[];

            if (projects.length === 0) {
                fail(
                    "No projects found for your account.",
                    `Create one with ${chalk.bold("rebase cloud projects create")}.`
                );
            }

            const { picked } = await inquirer.prompt([
                {
                    type: "select",
                    name: "picked",
                    message: "Select a project to link:",
                    choices: projects.map((p) => ({
                        name: `${p.name ?? "(unnamed)"}  ${chalk.gray(String(p.subdomain ?? ""))}`,
                        value: p
                    }))
                }
            ] as unknown as Parameters<typeof inquirer.prompt>[0]);
            project = picked as ProjectRow;
        }

        if (!project) fail("No project selected.");

        writeLink({
            url,
            projectId: String(project.id),
            slug: project.subdomain,
            projectName: project.name,
            orgId: project.organization !== undefined ? String(project.organization) : undefined
        });

        success(`Linked to ${chalk.bold(project.name ?? project.subdomain ?? "")}`);
        console.log(chalk.gray(`  Wrote ${projectLinkPath()}`));
        console.log("");
    } catch (e) {
        reportError(e, "Failed to link project");
    }
}

export function unlinkCommand(): void {
    const link = readLink();
    if (!link) {
        console.log("");
        console.log(chalk.gray("  This directory is not linked to a cloud project."));
        console.log("");
        return;
    }
    removeLink();
    success("Unlinked from cloud project");
}

export async function selectOrgCommand(rawArgs: string[]): Promise<void> {
    // positionals after "cloud" are [use, <org>]; take the token after "use".
    const target = rawArgs.slice(3).filter((a) => !a.startsWith("-"))[1];
    const { client, url } = await requireClient(rawArgs);

    try {
        const orgs = (await client.data.collection("organizations").find({ limit: 100 })).data as unknown as Array<{
            id: string | number;
            name?: string;
            slug?: string;
        }>;

        if (orgs.length === 0) fail("You are not a member of any organization.");

        let chosen = target
            ? orgs.find((o) => String(o.id) === target || o.slug === target)
            : undefined;

        if (!chosen && !target) {
            const { picked } = await inquirer.prompt([
                {
                    type: "select",
                    name: "picked",
                    message: "Select the active organization:",
                    choices: orgs.map((o) => ({
                        name: `${o.name ?? "(unnamed)"}  ${chalk.gray(`${o.slug ?? ""} · ${o.id}`)}`,
                        value: o
                    }))
                }
            ] as unknown as Parameters<typeof inquirer.prompt>[0]);
            chosen = picked;
        }

        if (!chosen) fail(`Organization "${target}" not found.`);

        setContextOrg(url, String(chosen.id));
        success(`Active organization set to ${chalk.bold(chosen.name ?? chosen.id)}`);
    } catch (e) {
        reportError(e, "Failed to set organization");
    }
}

/** Open the Rebase Cloud dashboard (or the linked project) in a browser. */
export function openCommand(rawArgs: string[]): void {
    const url = resolveCloudUrl(rawArgs);
    const link = readLink();
    const target = link ? `${url}/projects/${link.projectId}` : url;
    openUrl(target);
}
