/**
 * CLI command: `rebase cloud <group> [action] [options]`
 *
 * A single entry point for everything you do against Rebase Cloud — the hosted
 * control plane. Auth, project link, deploys, databases, and the rest are all
 * dispatched from here. Individual groups live in sibling modules; this file
 * only routes and prints help.
 */
import arg from "arg";
import chalk from "chalk";
import { loginCommand, logoutCommand, whoamiCommand } from "./auth";
import { linkCommand, unlinkCommand, selectOrgCommand, openCommand } from "./link";
import { listProjects, createProject, projectInfo, deleteProject, resolveProjectArg } from "./projects";
import { deployCommand, logsCommand } from "./deploy";
import { orgsCommand, printOrgsHelp } from "./orgs";
import { dbCommand, printDbHelp } from "./databases";
import { envCommand, printEnvHelp } from "./env";
import { domainsCommand, printDomainsHelp } from "./domains";
import { extensionsCommand, printExtensionsHelp } from "./extensions";
import { settingsCommand, printSettingsHelp } from "./settings";
import { deploymentsListCommand, rollbackCommand, cancelCommand } from "./deployments";
import { powerCommand } from "./power";
import { debugCommand, printDebugHelp } from "./debug";
import {
    statusCommand,
    metricsCommand,
    webhooksCommand,
    storageCommand,
    computeCommand,
    clustersCommand,
    billingCommand,
    printStorageHelp
} from "./resources";
import { declaredResourcesCommand } from "./declared-resources";
import {
    requireProjectRef,
    initOutputMode,
    printGroupHelp,
    fail,
    GLOBAL_CLOUD_FLAGS,
    type HelpAction
} from "./context";
import { ACTION_HELP, printActionHelp } from "./action-help";

/**
 * Positional tokens after `rebase cloud` (group, action, …).
 *
 * Two things stop a flag being mistaken for the group. `GLOBAL_CLOUD_FLAGS` is
 * declared so `arg` *consumes* the flags that may precede it — critically
 * together with their values, which is the half that filtering cannot do. The
 * leading-`-` skip then covers a flag nobody declared, so an unrecognised
 * boolean shifts nothing.
 *
 * Only leading tokens are skipped: past the group and action, an undeclared
 * flag and its value are somebody else's positionals and none of our business.
 * A flag this file has never heard of, that takes a value, placed before the
 * group, is the one shape still unresolvable here — there is no way to know
 * whether the token after it is its value or the group, and guessing either way
 * is worse than the handler reporting an unknown group.
 *
 * Exported so its tests can drive the real thing. The dispatch test used to
 * re-implement it locally as `slice(3).filter(a => !a.startsWith("-"))` — which
 * filtered flags, while this function did not — so the test asserted the
 * behaviour we wanted against a copy that had it, and stayed green for as long
 * as the real dispatcher was broken.
 */
export function positionals(rawArgs: string[]): string[] {
    const rest = arg(GLOBAL_CLOUD_FLAGS, { argv: rawArgs.slice(3),
permissive: true })._;
    let i = 0;
    while (i < rest.length && rest[i].startsWith("-")) i++;
    return rest.slice(i);
}

/**
 * The help page for each group, keyed by every alias the dispatch below accepts.
 *
 * Aliases are listed explicitly rather than normalised first, so a group that
 * gains one and forgets it here degrades to the index page — wrong, but a page.
 * `cloud-help.test.ts` asserts the two stay in step.
 *
 * A group absent from this map has no page of its own; the index lists it.
 */
/**
 * The second spelling of a group, mapped to the one the pages are keyed on.
 *
 * The dispatch below accepts both (`case "db": case "database":`), so help has
 * to as well, or half the spellings of a command have no page.
 */
export const GROUP_ALIASES: Record<string, string> = {
    database: "db",
    domain: "domains",
    extension: "extensions",
    org: "orgs",
    project: "projects"
};

export const GROUP_HELP: Record<string, () => void> = {
    env: printEnvHelp,
    domains: printDomainsHelp,
    domain: printDomainsHelp,
    extensions: printExtensionsHelp,
    extension: printExtensionsHelp,
    settings: printSettingsHelp,
    orgs: printOrgsHelp,
    org: printOrgsHelp,
    db: printDbHelp,
    database: printDbHelp,
    debug: printDebugHelp,
    storage: printStorageHelp
};

export async function cloudCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    // Latch the output mode FIRST — before anything can print or `fail` — so the
    // whole command family agrees on human vs. machine-readable output.
    initOutputMode(rawArgs);

    const pos = positionals(rawArgs);
    // The positionals win over the `subcommand` the top-level parser handed us.
    // Both describe the same token, but only this one is resolved against a
    // flag spec: `cli.ts` is generic across every command and cannot know which
    // flags `cloud` takes, so with `cloud --json storage create` it reported the
    // subcommand as `"--json"`. Falling back to it keeps the parameter useful
    // when a caller passes a group that is not in `rawArgs` at all.
    const group = pos[0] ?? (subcommand !== "--help" ? subcommand : undefined);

    // `--help` has to be recovered from `rawArgs` rather than read off `pos`.
    // `positionals()` resolves against `GLOBAL_CLOUD_FLAGS`, which declares
    // `--help`, so `arg` *consumes* it — correct for `--project` and `--json`,
    // which modify a command, but wrong for `--help`, which replaces it.
    const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
    const action = pos[1];

    // The index help is for `rebase cloud` and `rebase cloud --help` — that is,
    // when no group was named. It used to also fire whenever `subcommand` was
    // the literal `"--help"`, which `cli.ts` set for *any* `--help` anywhere in
    // the line, so `rebase cloud env --help` printed this page instead of env's
    // and the per-group help in seven modules was unreachable. Keyed on the
    // group now, which is the thing that actually decides whose help this is.
    if (!group) {
        printCloudHelp();
        return;
    }

    // `--help` is answered here, before dispatch, and never by the command.
    //
    // Routing it as an action instead only worked for the groups that happened
    // to have a `case "--help"`. The others took `rawArgs` and ignored the
    // action entirely, so the flag did nothing and the command ran: `rebase
    // cloud env --help` tried to list variables and failed on "No project
    // specified", `rebase cloud deploy --help` started resolving a project, and
    // `rebase cloud link --help` opened an *interactive project picker* — a
    // prompt, from a flag whose entire job is to print text and exit.
    //
    // Answering centrally makes that structurally impossible: `--help` cannot
    // reach a handler, so it cannot prompt, call the API, or need a linked
    // project. A group without its own page falls back to the index rather than
    // to running something.
    //
    // Resolved most-specific-first. Group-level was all there was, so `rebase
    // cloud projects create --help` and `rebase cloud deploy --help` printed the
    // index — a list of groups, no flags — and `--name`, `--subdomain` and
    // `--type` had no discoverable spelling anywhere in the CLI. They were found
    // on a real first deploy by reading `dist/index.es.js.map`.
    if (wantsHelp) {
        // Through the alias, because the dispatch accepts both spellings and a
        // page keyed on one of them is not a page for the other: `rebase cloud
        // database create --help` reached the group index while
        // `rebase cloud db create --help` printed the flags.
        const canonical = GROUP_ALIASES[group] ?? group;
        const forAction = action ? ACTION_HELP[`${canonical} ${action}`] : undefined;
        const page = forAction ?? ACTION_HELP[canonical];
        if (page) {
            printActionHelp(page);
            return;
        }
        (GROUP_HELP[group] ?? printCloudHelp)();
        return;
    }

    switch (group) {
        /* auth */
        case "login":
            await loginCommand(rawArgs);
            break;
        case "logout":
            await logoutCommand(rawArgs);
            break;
        case "whoami":
            await whoamiCommand(rawArgs);
            break;

        /* context / link */
        case "link":
            await linkCommand(rawArgs);
            break;
        case "unlink":
            unlinkCommand();
            break;
        case "use":
            await selectOrgCommand(rawArgs);
            break;
        case "open":
            openCommand(rawArgs);
            break;

        /* projects */
        case "projects":
        case "project":
            await projectsGroup(action, rawArgs);
            break;

        /* deploy + logs (operate on linked/--project) */
        case "deploy":
            await deployCommand(rawArgs, requireProjectRef(rawArgs));
            break;
        case "logs":
            await logsCommand(rawArgs, requireProjectRef(rawArgs));
            break;
        case "deployments":
        case "releases":
            await deploymentsGroup(action, rawArgs);
            break;
        case "rollback":
            await rollbackCommand(rawArgs);
            break;
        case "cancel":
            await cancelCommand(rawArgs);
            break;
        case "start":
        case "stop":
        case "restart":
            await powerCommand(group, rawArgs);
            break;
        case "status":
            await statusCommand(rawArgs);
            break;
        case "metrics":
            await metricsCommand(rawArgs);
            break;
        case "debug":
            await debugCommand(action, rawArgs);
            break;

        /* env / domains / extensions / settings */
        case "env":
            await envCommand(action, rawArgs);
            break;
        case "domains":
        case "domain":
            await domainsCommand(action, rawArgs);
            break;
        case "extensions":
        case "extension":
            await extensionsCommand(action, rawArgs);
            break;
        case "settings":
            await settingsCommand(action, rawArgs);
            break;

        /* orgs */
        case "orgs":
        case "org":
            await orgsCommand(action, rawArgs);
            break;

        /* databases */
        case "db":
        case "database":
            await dbCommand(action, rawArgs);
            break;

        /* other resources */
        case "webhooks":
            await webhooksCommand(action, rawArgs);
            break;
        case "storage":
            await storageCommand(action, rawArgs);
            break;
        case "compute":
            await computeCommand(action, rawArgs);
            break;
        case "resources":
            // The word means the graph now, on both sides of the wire: what the
            // code declares against what the platform holds. What it used to
            // show — CPU, memory, cost — is `compute`, and a dial flag arriving
            // here is the one thing worth a pointed refusal.
            if (action === "set") {
                fail(
                    "`rebase cloud resources set` is now `rebase cloud compute set` — CPU, memory, replicas and cost.",
                    "`rebase cloud resources` lists what this project declares against what the platform provisioned.",
                    "renamed"
                );
            }
            await declaredResourcesCommand(action, rawArgs);
            break;
        case "clusters":
            await clustersCommand(action, rawArgs);
            break;
        case "billing":
            await billingCommand(rawArgs);
            break;

        default:
            // Through `fail`, like every other refusal in the family — and like
            // the two group dispatchers below, which now match.
            //
            // It used to print a red line to stderr and then the ENTIRE help
            // page to stdout before exiting 1. Two things wrong with that: a
            // piped `rebase cloud typo` handed its caller ~60 lines of
            // ANSI-coloured help where the contract promises one JSON value,
            // and even on a terminal it put the remedy on the RESULTS stream of
            // a command that produced no result. The hint names `--help`, which
            // is the one command whose result the page actually is.
            fail(`Unknown cloud command: ${group}`, "Run `rebase cloud --help`.", "unknown_command");
    }
}

async function projectsGroup(action: string | undefined, rawArgs: string[]): Promise<void> {
    switch (action) {
        case "list":
        case undefined:
            await listProjects(rawArgs);
            break;
        case "create":
            await createProject(rawArgs);
            break;
        // The id is resolved by the handlers' own module, against their own flag
        // spec. `positionals()` cannot do it: it declares only the global cloud
        // flags and skips only LEADING `-` tokens, so any other flag written
        // after the action became the id — `projects delete --force` looked up
        // a project named "--force".
        case "info":
            await projectInfo(rawArgs, resolveProjectArg(rawArgs, "info"));
            break;
        case "delete":
            await deleteProject(rawArgs, resolveProjectArg(rawArgs, "delete"));
            break;
        case "--help":
            printCloudHelp();
            break;
        default:
            fail(`Unknown projects command: ${action}`, "Run `rebase cloud --help`.", "unknown_command");
    }
}

async function deploymentsGroup(action: string | undefined, rawArgs: string[]): Promise<void> {
    switch (action) {
        case "list":
        case undefined:
            await deploymentsListCommand(rawArgs);
            break;
        case "--help":
            printCloudHelp();
            break;
        default:
            fail(`Unknown deployments command: ${action}`, "Run `rebase cloud --help`.", "unknown_command");
    }
}

/**
 * Every group `cloudCommand` dispatches, canonical name first, with the line the
 * index page prints for it.
 *
 * One list, rendered twice. It used to be two: a bare array of words for the
 * JSON form and a hand-formatted template literal for the terminal — which is
 * how `clusters` came to be listed on the page twice, under two different
 * descriptions, in the same section. The page is generated from this now, so a
 * group appears exactly as often as it appears here, and `cloud-help.test.ts`
 * holds the list to the dispatch switch and to the pages.
 *
 * Sub-actions are deliberately not here. Every group answers `--help` with its
 * own page now, listing its actions, their arguments and their flags; repeating
 * a subset of that on the index is the duplication this replaced.
 */
export const CLOUD_GROUPS: HelpAction[] = [
    { action: "login", section: "Auth", description: "Sign in to the control plane" },
    { action: "logout", section: "Auth", description: "Sign out" },
    { action: "whoami", section: "Auth", description: "Show the current session" },

    { action: "link", section: "Project link", args: "[url]", description: "Bind this directory to a cloud project, or straight to a backend URL" },
    { action: "unlink", section: "Project link", description: "Remove the link" },
    { action: "use", section: "Project link", args: "[org]", description: "Select the active organization" },
    { action: "open", section: "Project link", description: "Open the console in a browser" },

    { action: "projects", section: "Projects", description: "Create, list, inspect and delete projects" },

    { action: "deploy", section: "Deploy & observe", args: "[app]", description: "Build, upload and ship an app, following it to a terminal state" },
    { action: "logs", section: "Deploy & observe", description: "Build logs, or the runtime's with --runtime" },
    { action: "deployments", section: "Deploy & observe", description: "Deployment history: status, duration, trigger" },
    { action: "rollback", section: "Deploy & observe", args: "[id]", description: "Put a previous successful deployment back into service" },
    { action: "cancel", section: "Deploy & observe", description: "Stop the build in flight" },
    { action: "start", section: "Deploy & observe", description: "Bring a stopped project back" },
    { action: "stop", section: "Deploy & observe", description: "Stop the project. Downtime, so it confirms" },
    { action: "restart", section: "Deploy & observe", description: "Stop and start it again" },
    { action: "status", section: "Deploy & observe", description: "One glance: URL, last deploy, and what it is waiting on" },
    { action: "metrics", section: "Deploy & observe", description: "Live CPU, memory and disk" },
    { action: "debug", section: "Deploy & observe", description: "Diagnose a misbehaving deployment. Read-only" },

    { action: "env", section: "Config", description: "Environment variables" },
    { action: "domains", section: "Config", description: "Custom domain, its DNS records, and verification" },
    { action: "extensions", section: "Config", description: "The Postgres extension allowlist" },
    { action: "settings", section: "Config", description: "Name, subdomain, repository, branch" },

    { action: "orgs", section: "Organizations", description: "Organizations you belong to, and their members" },

    { action: "db", section: "Data", description: "Attach a database, back it up, restore, point-in-time recovery" },
    { action: "storage", section: "Data", description: "The project's object storage" },

    { action: "webhooks", section: "Other resources", description: "Outbound webhooks on a table's row changes" },
    // Both of these dispatch and have a page, and both were absent from this
    // list — so the command that names what a project costs, and the one that
    // names what it declares, were undiscoverable from `rebase cloud --help`,
    // which is where an agent finds the family.
    { action: "resources", section: "Other resources", description: "What the code declares against what the platform provisioned" },
    { action: "compute", section: "Other resources", description: "What this project reserves, what it costs, and how to change it" },
    { action: "clusters", section: "Other resources", description: "The clusters tenants run on. Platform-admin only" },
    { action: "billing", section: "Other resources", description: "The organization's billing account and card on file" }
];

/** The dispatch words alone — what `--help` routing and the tests iterate. */
export const CLOUD_GROUP_NAMES = CLOUD_GROUPS.map(g => g.action);

function printCloudHelp(): void {
    printGroupHelp({
        command: "cloud",
        title: "Manage your apps on Rebase Cloud",
        actions: CLOUD_GROUPS,
        notes: [
            "Most commands act on the linked project (.rebase/cloud.json) unless --project is given.",
            "Every group answers `--help` with its own page: actions, arguments and flags.",
            "Docs: https://rebase.pro/docs"
        ]
    });
}
