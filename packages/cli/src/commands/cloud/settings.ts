/**
 * `rebase cloud settings` — a project's editable configuration.
 *
 *   settings                 Show the current settings
 *   settings set [flags]     Update name / branch / repo / subdomain
 *
 * These are plain `projects` updates. A subdomain change is validated against
 * `check-subdomain` up front so the CLI fails with the real reason rather than a
 * generic collection error.
 */
import chalk from "chalk";
import { requireClient, requireProject, displayProjectRef, parseCloudArgs, emit, printGroupHelp, keyValues, success, fail, reportError } from "./context";

interface ProjectSettings {
    id: string | number;
    name?: string;
    subdomain?: string;
    gitRepoUrl?: string;
    gitBranch?: string;
    customDomain?: string;
    provider?: string;
    region?: string;
}

export async function settingsCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    switch (action) {
        case "set":
            await setSettings(rawArgs);
            break;
        case undefined:
        case "show":
        case "list":
            await showSettings(rawArgs);
            break;
        case "--help":
            printSettingsHelp();
            break;
        default:
            fail(`Unknown settings command: ${action}`, "Run `rebase cloud settings --help`.", "unknown_command");
    }
}

async function showSettings(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud settings",
maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const p = (await client.data.collection("projects").findById(projectId)) as unknown as ProjectSettings | undefined;
        if (!p) fail(`Project ${projectRef} not found.`, undefined, "not_found");
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  ⚙️  Settings — project ${projectRef}`));
                console.log("");
                keyValues([
                    ["Name", p!.name],
                    ["Subdomain", p!.subdomain],
                    ["Repository", p!.gitRepoUrl],
                    ["Branch", p!.gitBranch],
                    ["Custom domain", p!.customDomain],
                    ["Provider", p!.provider],
                    ["Region", p!.region]
                ]);
                console.log("");
            },
            {
                projectId: String(p!.id),
                name: p!.name ?? null,
                subdomain: p!.subdomain ?? null,
                gitRepoUrl: p!.gitRepoUrl ?? null,
                gitBranch: p!.gitBranch ?? null,
                customDomain: p!.customDomain ?? null,
                provider: p!.provider ?? null,
                region: p!.region ?? null
            }
        );
    } catch (e) {
        reportError(e, "Failed to load settings");
    }
}

/** Build the update patch from the flags actually supplied (pure/testable). */
export function buildSettingsPatch(args: {
    name?: string;
    subdomain?: string;
    repo?: string;
    branch?: string;
}): Record<string, string> {
    const patch: Record<string, string> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.subdomain !== undefined) patch.subdomain = args.subdomain.toLowerCase();
    if (args.repo !== undefined) patch.gitRepoUrl = args.repo;
    if (args.branch !== undefined) patch.gitBranch = args.branch;
    return patch;
}

/** What `rebase cloud settings set` parses. Its page is the group's own. */
export const SET_SETTINGS_FLAGS = {
    "--name": String,
    "--subdomain": String,
    "--repo": String,
    "--branch": String
} as const;

async function setSettings(rawArgs: string[]): Promise<void> {
    // `--project`/`-p` are globals and are not redeclared here; the rest is this
    // command's own. Strict rather than permissive: `--brnach main` used to be
    // dropped, and the command then reported "nothing to change".
    const { flags: args } = parseCloudArgs({
        spec: SET_SETTINGS_FLAGS,
        rawArgs,
        commandWords: 3, // cloud settings set
        command: "cloud settings",
        maxPositionals: 0
    });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    const patch = buildSettingsPatch({
        name: args["--name"],
        subdomain: args["--subdomain"],
        repo: args["--repo"],
        branch: args["--branch"]
    });
    if (Object.keys(patch).length === 0) {
        fail("Nothing to update.", "Pass --name, --subdomain, --repo, or --branch.", "usage");
    }

    try {
        if (patch.subdomain) {
            const check = await client.functions
                .invoke<{ available: boolean; reason?: string }>("check-subdomain", { subdomain: patch.subdomain })
                .catch(() => undefined);
            if (check && !check.available) {
                fail(`Subdomain "${patch.subdomain}" is not available${check.reason ? ` (${check.reason})` : ""}.`, undefined, "subdomain_taken");
            }
        }

        await client.data.collection("projects").update(projectId, patch);
        emit(
            () => success(`Updated ${Object.keys(patch).join(", ")} for project ${projectRef}`),
            { success: true,
projectId,
updated: patch }
        );
    } catch (e) {
        reportError(e, "Failed to update settings");
    }
}

export function printSettingsHelp(): void {
    printGroupHelp({
        command: "cloud settings",
        title: "Project configuration",
        actions: [
            { action: "show",
description: "Name, subdomain, repository and branch as recorded" },
            {
                action: "set",
                description: "Change one or more of them",
                flags: [
                    ["--name <name>", "Display name"],
                    ["--subdomain <sub>", "The <slug>.rebase.website host"],
                    ["--repo <git url>", "Repository to build from"],
                    ["--branch <branch>", "Branch to build"]
                ]
            }
        ]
    });
}
