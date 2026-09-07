/**
 * `rebase cloud` context subcommands: link, unlink, use, open.
 *
 * `link` associates the current directory with a cloud project by writing
 * `.rebase/cloud.json`; deploy/logs/status then operate on it with no flags.
 */
import chalk from "chalk";
import inquirer from "inquirer";
import {
    requireClient,
    resolveProjectRef,
    resolveCloudUrl,
    parseCloudArgs,
    writeLink,
    removeLink,
    readLink,
    projectLinkPath,
    setContextOrg,
    getContextOrg,
    openUrl,
    success,
    fail,
    reportError,
    emit,
    note,
    noteBlank,
    warn,
    requireInteractive
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
        fail(`"${target}" is not a valid URL.`, undefined, "invalid_url");
        return;
    }

    if (base.protocol !== "http:" && base.protocol !== "https:") {
        fail("A project URL must be http or https.", undefined, "invalid_url");
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
        // A real warning, not narration: the link is being written against an
        // address that did not answer, and that is as worth saying when piped as
        // when watched. It used to be `console.log(chalk.yellow(…))` — a caution
        // rendered in warning colours on the results stream, which put it inside
        // whatever a caller was parsing.
        warn(
            `Could not reach ${probe}${detail ? ` (${detail})` : ""}.`,
            "Linking anyway — the server may not be running yet. It must be a Rebase backend of version 0.11 or newer."
        );
    }

    writeLink({
        url: apiUrl,
        projectId: "",
        apiUrl,
        mode: "direct",
        projectName: base.host
    });

    success(`Linked to ${apiUrl}`);
    emit(
        () => {
            note(chalk.dim(`Written to ${projectLinkPath()}`));
            noteBlank();
            note(`Next: ${chalk.cyan("rebase generate-sdk --from link")}`, "");
        },
        {
            success: true,
            mode: "direct",
            apiUrl,
            reachable,
            projectName: base.host,
            linkPath: projectLinkPath()
        }
    );
    void rawArgs;
}

export async function linkCommand(rawArgs: string[]): Promise<void> {
    // `--project` is a global, so the spec is empty: declaring it here would
    // replace the global in the merge while the global's other readers went on
    // reading the raw line. Strict rather than permissive — a mistyped flag
    // used to be dropped, and `link` then opened the interactive picker as
    // though nothing had been asked for.
    const { flags: args, positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 2, // cloud link
        command: "cloud link",
        maxPositionals: 1 // [url]
    });

    // A positional URL means "this exact backend", which needs no login and no
    // control plane. `rebase cloud link https://api.example.com`
    const positional = positionals.find(value => /^https?:\/\//i.test(value));
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
            if (!project) {
                fail(`Project ${args["--project"]} not found.`, undefined, "project_not_found");
            }
        } else {
            // The picker needs a terminal. Without this, `rebase cloud link`
            // run by an agent parked on a select prompt forever.
            requireInteractive("a project to link", "--project <slug>");
            const org = getContextOrg(url);
            const projects = (await client.data.collection("projects").find({
                where: org ? { organization: ["==", org] } : undefined,
                limit: 100
            })).data as unknown as ProjectRow[];

            if (projects.length === 0) {
                fail(
                    "No projects found for your account.",
                    `Create one with ${chalk.bold("rebase cloud projects create")}.`,
                    "no_projects"
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

        if (!project) fail("No project selected.", undefined, "no_project");

        const orgId = project.organization !== undefined ? String(project.organization) : undefined;
        writeLink({
            url,
            projectId: String(project.id),
            slug: project.subdomain,
            projectName: project.name,
            orgId
        });

        success(`Linked to ${chalk.bold(project.name ?? project.subdomain ?? "")}`);
        emit(
            () => {
                note(chalk.gray(`Wrote ${projectLinkPath()}`));
                noteBlank();
            },
            {
                success: true,
                mode: "cloud",
                host: url,
                projectId: String(project.id),
                slug: project.subdomain ?? null,
                projectName: project.name ?? null,
                org: orgId ?? null,
                linkPath: projectLinkPath()
            }
        );
    } catch (e) {
        reportError(e, "Failed to link project");
    }
}

export function unlinkCommand(rawArgs: string[]): void {
    // It took no arguments at all, so `rebase cloud unlink --frobnicate`
    // removed the link and exited 0.
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 2,
command: "cloud unlink",
maxPositionals: 0 });
    const link = readLink();
    if (!link) {
        // Idempotent, like `logout`: `unlinked: false` is how a caller tells
        // "there was nothing to remove" from "removed it".
        emit(
            () => {
                console.log("");
                console.log(chalk.gray("  This directory is not linked to a cloud project."));
                console.log("");
            },
            { success: true,
unlinked: false,
linkPath: projectLinkPath() }
        );
        return;
    }
    removeLink();
    success("Unlinked from cloud project");
    emit(() => {}, { success: true,
unlinked: true,
linkPath: projectLinkPath() });
}

export async function selectOrgCommand(rawArgs: string[]): Promise<void> {
    // Was `rawArgs.slice(3).filter(a => !a.startsWith("-"))[1]` — a hand-rolled
    // positional scan that skipped flag-shaped tokens and therefore accepted
    // any flag at all, including the value of one it did not declare.
    const { positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 2, // cloud use
        command: "cloud use",
        maxPositionals: 1 // [org]
    });
    const target = positionals[0];
    const { client, url } = await requireClient(rawArgs);

    try {
        const orgs = (await client.data.collection("organizations").find({ limit: 100 })).data as unknown as Array<{
            id: string | number;
            name?: string;
            slug?: string;
        }>;

        if (orgs.length === 0) {
            fail("You are not a member of any organization.", undefined, "no_orgs");
        }

        let chosen = target
            ? orgs.find((o) => String(o.id) === target || o.slug === target)
            : undefined;

        if (!chosen && !target) {
            requireInteractive("an organization", "rebase cloud use <org-id|slug>");
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

        if (!chosen) fail(`Organization "${target}" not found.`, undefined, "org_not_found");

        setContextOrg(url, String(chosen.id));
        success(`Active organization set to ${chalk.bold(chosen.name ?? chosen.id)}`);
        emit(() => {}, {
            success: true,
            host: url,
            org: { id: String(chosen.id),
name: chosen.name ?? null,
slug: chosen.slug ?? null }
        });
    } catch (e) {
        reportError(e, "Failed to set organization");
    }
}

/** Open the Rebase Cloud dashboard (or the linked project) in a browser. */
export function openCommand(rawArgs: string[]): void {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 2,
command: "cloud open",
maxPositionals: 0 });
    const url = resolveCloudUrl(rawArgs);
    const link = readLink();
    const target = link ? `${url}/projects/${link.projectId}` : url;
    openUrl(target);
    // The URL is the result. `openUrl` only narrates it (on stderr, and not at
    // all in JSON mode), so it has to be emitted here or a piped `cloud open`
    // produces nothing at all to act on.
    emit(() => {}, { url: target,
projectId: link?.projectId ?? null });
}
