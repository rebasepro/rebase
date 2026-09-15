/**
 * `rebase cloud settings` — a project's editable configuration.
 *
 *   settings                 Show the current settings
 *   settings set [flags]     Update name / branch / repo / subdomain / platform rebuilds
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
    platformRebuilds?: boolean | null;
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
        const p = (await client.data.collection("projects").findById(projectId)) as ProjectSettings | undefined;
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
                    ["Region", p!.region],
                    ["Platform rebuilds", p!.platformRebuilds === false ? "off" : "on"]
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
                region: p!.region ?? null,
                platformRebuilds: p!.platformRebuilds !== false
            }
        );
    } catch (e) {
        reportError(e, "Failed to load settings");
    }
}

/** `on`/`off` (or `true`/`false`) as a boolean, or null for anything else. */
export function parseOnOff(value: string): boolean | null {
    const v = value.trim().toLowerCase();
    if (v === "on" || v === "true") return true;
    if (v === "off" || v === "false") return false;
    return null;
}

/** Build the update patch from the flags actually supplied (pure/testable). */
export function buildSettingsPatch(args: {
    name?: string;
    subdomain?: string;
    repo?: string;
    branch?: string;
    /** Already parsed with {@link parseOnOff}. */
    platformRebuilds?: boolean;
}): Record<string, string | boolean> {
    const patch: Record<string, string | boolean> = {};
    if (args.name !== undefined) patch.name = args.name;
    if (args.subdomain !== undefined) patch.subdomain = args.subdomain.toLowerCase();
    if (args.repo !== undefined) patch.gitRepoUrl = args.repo;
    if (args.branch !== undefined) patch.gitBranch = args.branch;
    if (args.platformRebuilds !== undefined) patch.platformRebuilds = args.platformRebuilds;
    return patch;
}

/** What `rebase cloud settings set` parses. Its page is the group's own. */
export const SET_SETTINGS_FLAGS = {
    "--name": String,
    "--subdomain": String,
    "--repo": String,
    "--branch": String,
    /* Whether fleet upgrades rebuild this app from its source on each new
       framework release (on by default). Off keeps every deploy as built,
       and the platform deletes the copy of the source it holds. */
    "--platform-rebuilds": String
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

    let platformRebuilds: boolean | undefined;
    if (args["--platform-rebuilds"] !== undefined) {
        const parsed = parseOnOff(args["--platform-rebuilds"]);
        if (parsed === null) {
            fail(`--platform-rebuilds takes on or off (got "${args["--platform-rebuilds"]}").`, undefined, "usage");
        }
        platformRebuilds = parsed;
    }

    const patch = buildSettingsPatch({
        name: args["--name"],
        subdomain: args["--subdomain"],
        repo: args["--repo"],
        branch: args["--branch"],
        platformRebuilds
    });
    if (Object.keys(patch).length === 0) {
        fail("Nothing to update.", "Pass --name, --subdomain, --repo, --branch, or --platform-rebuilds.", "usage");
    }

    try {
        if (typeof patch.subdomain === "string" && patch.subdomain) {
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
description: "Name, subdomain, repository, branch and platform rebuilds as recorded" },
            {
                action: "set",
                description: "Change one or more of them",
                flags: [
                    ["--name <name>", "Display name"],
                    ["--subdomain <sub>", "The <slug>.rebase.website host"],
                    ["--repo <git url>", "Repository to build from"],
                    ["--branch <branch>", "Branch to build"],
                    ["--platform-rebuilds <on|off>", "Rebuild this app on new framework releases (default on)"]
                ]
            }
        ]
    });
}
