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
import { requireProjectRef, initOutputMode, emitHelp, fail, GLOBAL_CLOUD_FLAGS } from "./context";
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
const GROUP_ALIASES: Record<string, string> = {
    database: "db",
    domain: "domains",
    extension: "extensions",
    org: "orgs",
    project: "projects"
};

const GROUP_HELP: Record<string, () => void> = {
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
 * Every group `cloudCommand` dispatches, canonical name first.
 *
 * This is the index page's JSON form, and the list an agent discovers the
 * family from. `cloud-help.test.ts` holds it to the dispatch switch, so a group
 * added there without being added here is a test failure rather than a
 * command that exists but cannot be found.
 */
const CLOUD_GROUPS = [
    "login", "logout", "whoami",
    "link", "unlink", "use", "open",
    "projects",
    "deploy", "logs", "deployments", "rollback", "cancel",
    "start", "stop", "restart", "status", "metrics", "debug",
    "env", "domains", "extensions", "settings",
    "orgs",
    "db",
    "webhooks", "storage", "clusters", "billing"
];

function printCloudHelp(): void {
    emitHelp("cloud", CLOUD_GROUPS, () => {
        console.log(`
${chalk.bold("rebase cloud")} — Manage your apps on Rebase Cloud

${chalk.green.bold("Usage")}
  rebase cloud ${chalk.blue("<command>")} [options]

${chalk.green.bold("Auth")}
  ${chalk.blue.bold("login")}                   Sign in to the control plane
  ${chalk.blue.bold("logout")}                  Sign out
  ${chalk.blue.bold("whoami")}                  Show the current session

${chalk.green.bold("Project link")}
  ${chalk.blue.bold("link")}                    Link this directory to a cloud project
  ${chalk.blue.bold("unlink")}                  Remove the link
  ${chalk.blue.bold("use")} ${chalk.gray("[org]")}               Select the active organization
  ${chalk.blue.bold("open")}                    Open the dashboard in a browser

${chalk.green.bold("Projects")}
  ${chalk.blue.bold("projects list")}           List projects
  ${chalk.blue.bold("projects create")}         Create a project ${chalk.gray("(--link to link it)")}
  ${chalk.blue.bold("projects info")} ${chalk.gray("[id]")}      Show project details
  ${chalk.blue.bold("projects delete")} ${chalk.gray("[id]")}    Delete a project

${chalk.green.bold("Deploy & observe")}
  ${chalk.blue.bold("deploy")} ${chalk.gray("[app] [--source .]")}    Deploy an app + stream build logs ${chalk.gray("(default: the backend)")}
  ${chalk.blue.bold("logs")} ${chalk.gray("[--runtime] [-f]")}   Show build (or runtime) logs
  ${chalk.blue.bold("deployments list")} ${chalk.gray("[--limit N|--all]")}  Deployment history ${chalk.gray("(status, duration, trigger)")}
  ${chalk.blue.bold("rollback")} ${chalk.gray("[id] [-y]")}       Roll back to a successful deploy
  ${chalk.blue.bold("cancel")} ${chalk.gray("[-y]")}             Cancel the in-flight build
  ${chalk.blue.bold("start|stop|restart")} ${chalk.gray("[-y]")}  Power ops ${chalk.gray("(stop/restart need -y)")}
  ${chalk.blue.bold("status")}                  One-glance project status
  ${chalk.blue.bold("metrics")}                 Live CPU / memory / disk
  ${chalk.blue.bold("debug")} ${chalk.gray("[health|logs|…]")}    Diagnose a misbehaving deployment ${chalk.gray("(read-only)")}

${chalk.green.bold("Config")}
  ${chalk.blue.bold("env list|set|unset|reveal|pull")}
  ${chalk.blue.bold("domains list|add|verify|remove")}
  ${chalk.blue.bold("extensions list|enable|disable")}
  ${chalk.blue.bold("settings show|set")}       Name / branch / repo / subdomain

${chalk.green.bold("Organizations")}
  ${chalk.blue.bold("orgs list|create|members")}

${chalk.green.bold("Databases")}
  ${chalk.blue.bold("db list|create|info|test")}
  ${chalk.blue.bold("db backup list|create|restore|status|download")}
  ${chalk.blue.bold("db pitr status|restore|cutover|discard")}

${chalk.green.bold("Other resources")}
  ${chalk.blue.bold("webhooks list|create|delete")}
  ${chalk.blue.bold("clusters")}                List the clusters tenants run on
  ${chalk.blue.bold("clusters add")}            Register a cluster from a kubeconfig
  ${chalk.blue.bold("clusters verify")}         Ask a cluster whether it can host tenants
  ${chalk.blue.bold("resources")}               What the code declares against what the platform provisioned
  ${chalk.blue.bold("resources prune")}         Remove a provisioned database the code no longer declares
  ${chalk.blue.bold("compute")}                 Show what this project reserves, and what it costs per month
  ${chalk.blue.bold("compute set")}             Change it (--cpu, --memory, --replicas, --spot, --scale-to-zero,
                          --db-mode, --db-instances, --db-cpu, --db-memory, --storage,
                          --autoscale-max, --autoscale-cpu-target, --no-autoscale)
  ${chalk.blue.bold("storage")}                 List storage buckets
  ${chalk.blue.bold("storage create")}          Provision platform-managed storage
  ${chalk.blue.bold("storage attach")}          Attach your own S3-compatible bucket
  ${chalk.blue.bold("clusters")}                List compute clusters
  ${chalk.blue.bold("billing setup")}           Attach a card to the org ${chalk.gray("(one-time, opens browser)")}
  ${chalk.blue.bold("billing")}                 Show billing account + card on file

${chalk.green.bold("Global options")}
  ${chalk.blue("--json")}                  Machine-readable output ${chalk.gray("(also when piped, or REBASE_JSON=1)")}
  ${chalk.blue("--url <origin>")}          Target a specific control plane ${chalk.gray("(or REBASE_CLOUD_URL)")}
  ${chalk.blue("--project, -p <id>")}      Operate on a project without linking

${chalk.gray("Most commands act on the linked project (.rebase/cloud.json) unless --project is given.")}
${chalk.gray("Docs: https://rebase.pro/docs")}
`);
    });
}
