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
    requireInteractive,
    cloudRows,
    grantForLink,
    projectRefIfAny,
    hasCredentials,
    canPrompt,
    type CloudClient
} from "./context";
import { createProject } from "./projects";

export interface ProjectRow {
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

/** The picker's value for "make a new project and link it", beside the project rows. */
export const CREATE_NEW_PROJECT = "__create_new_project__";

/**
 * The choices `rebase cloud link` offers, with creating a project first and
 * therefore the default. With only the existing projects listed, one Enter on
 * a fresh scaffold linked it to whichever project came first (a live one), and
 * the next `rebase cloud deploy` would have sent this app there.
 */
export function linkPickerChoices(projects: ProjectRow[]): Array<{ name: string; value: ProjectRow | typeof CREATE_NEW_PROJECT }> {
    return [
        { name: `${chalk.bold("Create a new project")}  ${chalk.gray("for this directory")}`, value: CREATE_NEW_PROJECT },
        ...projects.map((p) => ({
            name: `${p.name ?? "(unnamed)"}  ${chalk.gray(String(p.subdomain ?? ""))}`,
            value: p
        }))
    ];
}

/**
 * The line `projects create --link` is run with from the picker: the same
 * process and the same control plane (`--url`, when it was named).
 */
export function createFromLinkArgs(launcher: readonly string[], url: string | undefined): string[] {
    // Only the interpreter and script words are kept: the rest of the link line
    // was already parsed by `linkCommand`.
    return [launcher[0] ?? "node", launcher[1] ?? "rebase", "cloud", "projects", "create", "--link", ...(url ? ["--url", url] : [])];
}

/**
 * The picker `rebase cloud link` opens, shared with a `rebase cloud deploy`
 * run in a directory that is not linked yet: create a new project (first, and
 * the default), or pick an existing one. Creating runs `projects create --link`
 * with `createArgs`, which writes the link itself; `CREATE_NEW_PROJECT` is
 * returned then, and the picked row otherwise, for the caller to link.
 *
 * Needs a terminal: callers check before calling.
 */
export async function pickProjectOrCreate(
    client: CloudClient,
    url: string,
    createArgs: string[],
    opts: { thenDeploying?: boolean } = {}
): Promise<ProjectRow | typeof CREATE_NEW_PROJECT> {
    const org = getContextOrg(url);
    const projects = cloudRows<ProjectRow>((await client.data.table("projects").find({
        where: org ? { organization: ["==", org] } : undefined,
        limit: 100
    })).data);

    // No projects is not a dead end: there is one thing to do, so do it.
    const { picked } = projects.length === 0
        ? { picked: CREATE_NEW_PROJECT }
        : await inquirer.prompt([
            {
                type: "select",
                name: "picked",
                message: "Link this directory to:",
                choices: linkPickerChoices(projects),
                default: CREATE_NEW_PROJECT
            }
        ] as Parameters<typeof inquirer.prompt>[0]);
    if (picked === CREATE_NEW_PROJECT) {
        if (projects.length === 0) note(chalk.gray("No projects in this organization yet: creating one."));
        await createProject(createArgs, { thenDeploying: opts.thenDeploying });
        return CREATE_NEW_PROJECT;
    }
    return picked as ProjectRow;
}

/**
 * Link this directory to an existing project row: the link file, and the line
 * that says so. Returns the id written.
 */
export function linkToProject(url: string, project: ProjectRow): string {
    const orgId = project.organization !== undefined ? String(project.organization) : undefined;
    writeLink({
        url,
        projectId: String(project.id),
        slug: project.subdomain,
        projectName: project.name,
        orgId
    });
    return String(project.id);
}

/** The first remedy an unlinked, non-interactive `deploy` names. */
export const CREATE_AND_LINK_COMMAND = "rebase cloud projects create --name <n> --subdomain <s> --link";

/**
 * The project `rebase cloud deploy` acts on: `--project`, else the linked one —
 * and, in a directory linked to neither, the choice `rebase cloud link` offers
 * (create a new project first, or pick one), after which the deploy goes on.
 *
 * A scaffold's last step is `pnpm run deploy`, and it used to end there:
 * "No project specified and this directory is not linked", exit 1, on the
 * very first deploy of every new app. Off a terminal (or with `--json`) it
 * still refuses — nobody can answer a picker — and names the one command
 * that creates and links the project. Signed out, it says so first: the
 * picker and the create both need a session.
 */
export async function resolveDeployProjectRef(rawArgs: string[]): Promise<string> {
    const ref = projectRefIfAny(rawArgs);
    if (ref) return ref;

    if (!hasCredentials(rawArgs)) {
        fail(
            `Not logged in to ${chalk.cyan(resolveCloudUrl(rawArgs))}, and this directory is not linked to a project.`,
            `Run ${chalk.bold("rebase cloud login")} first, then deploy again`
                + (canPrompt()
                    ? ": it offers to create the project."
                    : `, after ${chalk.bold(CREATE_AND_LINK_COMMAND)} or with ${chalk.bold("--project <slug>")}.`),
            "not_logged_in"
        );
    }

    if (!canPrompt()) {
        fail(
            "No project specified and this directory is not linked.",
            `Create one for it with ${chalk.bold(CREATE_AND_LINK_COMMAND)}, `
                + `or pass ${chalk.bold("--project <slug>")}, or run ${chalk.bold("rebase cloud link")}.`,
            "no_project"
        );
    }

    const { client, url } = await requireClient(rawArgs);
    const urlFlag = arg({ "--url": String }, { argv: rawArgs.slice(2), permissive: true })["--url"];
    note(chalk.gray("This directory is not linked to a Rebase Cloud project yet."));
    try {
        const picked = await pickProjectOrCreate(
            client,
            url,
            createFromLinkArgs(rawArgs.slice(0, 2), urlFlag),
            { thenDeploying: true }
        );
        if (picked !== CREATE_NEW_PROJECT) {
            linkToProject(url, picked);
            success(`Linked to ${chalk.bold(picked.name ?? picked.subdomain ?? String(picked.id))}`);
        }
    } catch (e) {
        reportError(e, "Failed to link project");
    }
    const linked = readLink()?.projectId;
    if (!linked) {
        fail("No project was linked, so there is nothing to deploy to.", `Run ${chalk.bold("rebase cloud link")}.`, "no_project");
    }
    noteBlank();
    return linked;
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
        maxPositionals: 1 // [url | project]
    });

    // A positional URL means "this exact backend", which needs no login and no
    // control plane. `rebase cloud link https://api.example.com`
    const positional = positionals.find(value => /^https?:\/\//i.test(value));
    if (positional) {
        await linkDirect(positional, rawArgs);
        return;
    }

    // Anything else is a project, as `--project` names one: `rebase cloud link
    // my-app` used to drop the slug and open the picker (or, with no terminal,
    // ask for `--project`).
    const positionalProject = positionals.find(value => !/^https?:\/\//i.test(value));
    const flagProject = args["--project"];
    if (positionalProject && flagProject && positionalProject !== flagProject) {
        fail(
            `Two projects were named: ${positionalProject} and --project ${flagProject}.`,
            "Name the project once.",
            "usage"
        );
    }
    const projectRef = flagProject ?? positionalProject;

    const { client, url } = await requireClient(rawArgs);

    try {
        let project: ProjectRow | undefined;

        if (projectRef) {
            const projectId = await resolveProjectRef(projectRef, client);
            project = (await client.data.table("projects").findById(projectId)) as ProjectRow | undefined;
            if (!project) {
                fail(`Project ${projectRef} not found.`, undefined, "project_not_found");
            }
        } else {
            // The picker needs a terminal. Without this, `rebase cloud link`
            // run by an agent parked on a select prompt forever.
            requireInteractive("a project to link", "--project <slug>");
            const picked = await pickProjectOrCreate(client, url, createFromLinkArgs(rawArgs.slice(0, 2), args["--url"]));
            // Created and linked by `projects create --link`, which said so.
            if (picked === CREATE_NEW_PROJECT) return;
            project = picked;
        }

        if (!project) fail("No project selected.", undefined, "no_project");

        linkToProject(url, project);
        const orgId = project.organization !== undefined ? String(project.organization) : undefined;

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
    // An unclaimed project outlives its link: it keeps running until it
    // expires, and this directory was the only place its claim URL was read
    // back from. Say so, with the URL, before the link goes.
    const grant = grantForLink(link);
    removeLink();
    if (grant) {
        warn(
            `Project ${link.slug ?? link.projectId} is unclaimed. Unlinking does not delete it: it runs until ${new Date(grant.expiresAt).toLocaleString()}, then it is deleted.`,
            `To keep it, open ${grant.claimUrl} and sign in.`
        );
    }
    success("Unlinked from cloud project");
    emit(() => {}, { success: true,
unlinked: true,
linkPath: projectLinkPath(),
unclaimed: grant ? { projectId: link.projectId, claimUrl: grant.claimUrl, expiresAt: grant.expiresAt } : null });
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
        const orgs = (await client.data.table("organizations").find({ limit: 100 })).data as Array<{
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
            ] as Parameters<typeof inquirer.prompt>[0]);
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
