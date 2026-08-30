/**
 * Per-action help for `rebase cloud`.
 *
 * `--help` was already answered centrally, but only per *group*: `rebase cloud
 * projects create --help` and `rebase cloud deploy --help` both fell through to
 * the index page, which lists groups and no flags at all. So the flags that
 * decide what those commands do — `--name`, `--subdomain`, `--type`, `--bundle`
 * — had no discoverable spelling anywhere. The way they were found on a real
 * first deploy was by reading `dist/index.es.js.map`. An agent cannot do that,
 * and neither should a person.
 *
 * Two rules hold this file honest:
 *
 *  1. **The spec is the source of truth, not this page.** `action-help.test.ts`
 *     pairs every entry with the `arg` spec its command actually parses and
 *     asserts they agree in both directions. A flag added to a command without
 *     a line here is a failing test, not a page that is quietly a year old.
 *     The pairing lives in the test rather than here on purpose: importing the
 *     command modules to describe them would make `--help` depend on the code
 *     it is meant to be readable without.
 *  2. **It answers in the reader's language.** Like every other page in this
 *     family it goes through `emitHelp`, so a piped `--help` is a structured
 *     description of the command rather than sixty lines of ANSI to scrape.
 */
import chalk from "chalk";
import { emitHelp } from "./context";

export interface ActionHelp {
    /** `cloud projects create` — no leading `rebase`. */
    command: string;
    /** The usage line, minus the `rebase ` prefix. */
    usage: string;
    /** One paragraph: what the command does, and what it does not. */
    summary: string;
    /** `[flag, description]`, in the order a reader needs them. */
    flags: Array<[string, string]>;
    examples: string[];
    /** Anything a caller gets wrong more than once. */
    notes?: string[];
}

/**
 * Flags every cloud command accepts, documented once.
 *
 * Excluded from the spec comparison below — they are merged in by
 * `parseCloudArgs` for every command in the family, so repeating them per entry
 * would be nine copies of the same four lines.
 */
export const GLOBAL_HELP_FLAGS: Array<[string, string]> = [
    ["--project, -p <slug>", "Operate on a project without linking this directory"],
    ["--json", "Machine-readable output (also when piped, or REBASE_JSON=1)"],
    ["--url <origin>", "Target a specific control plane (or REBASE_CLOUD_URL)"],
    ["--yes, -y", "Skip confirmation prompts"],
    ["--debug", "Print the untouched error body after a failure"]
];

/** Flag names that `parseCloudArgs` adds to every command in the family. */
export const GLOBAL_SPEC_KEYS = new Set([
    "--json", "--yes", "--help", "--project", "--url", "-p", "-y", "-h", "--debug"
]);

export const ACTION_HELP: Record<string, ActionHelp> = {
    projects: {
        command: "cloud projects",
        usage: "cloud projects <list|create|info|delete> [options]",
        summary: "List, create, inspect and delete projects in the selected organization.",
        flags: [],
        examples: [
            "rebase cloud projects list",
            "rebase cloud projects create --help",
            "rebase cloud projects info shop",
            "rebase cloud projects delete shop --yes"
        ]
    },

    clusters: {
        command: "cloud clusters",
        usage: "cloud clusters [list|add|verify] [options]",
        summary: "The compute clusters tenants run on. Platform-admin only.",
        flags: [],
        examples: [
            "rebase cloud clusters",
            "rebase cloud clusters verify <cluster-id> --baseline",
            "rebase cloud clusters add --name gke-eu --provider gcp --region europe-west1 --kubeconfig ./kubeconfig"
        ]
    },

    "projects create": {
        command: "cloud projects create",
        usage: "cloud projects create --name <name> --subdomain <slug> [options]",
        summary:
            "Create a project. Unless --db says otherwise a managed database is attached in the "
            + "same call, because a project without one can never deploy — it sits at "
            + "status \"provisioning\" indefinitely, and that word does not mean work is underway.",
        flags: [
            ["--name, -n <name>", "Display name. Required (prompted only on a terminal)"],
            ["--subdomain <slug>", "The <slug>.rebase.website host. Required, and not editable afterwards"],
            ["--db <managed|byodb|none>", "Which database to attach. Default: managed"],
            ["--connection-string <url>", "The PostgreSQL URL, for --db byodb"],
            ["--org <id>", "Organization to create it in (default: the selected one)"],
            ["--link", "Link this directory to the new project"],
            ["--repo <url>", "Git repository to build from"],
            ["--branch <name>", "Git branch. Default: main"],
            ["--provider <gcp|hetzner|…>", "Where to run it (default: the platform's target)"],
            ["--region <region>", "Region within the provider"],
            ["--cpu <n>", "vCPU per instance"],
            ["--memory <size>", "Memory per instance, e.g. 512Mi"],
            ["--replicas <n>", "Instance count"],
            ["--spot <true|false>", "Run on preemptible capacity"],
            ["--scale-to-zero <true|false>", "Stop the instances when idle"],
            ["--db-mode <mode>", "Database topology dial"],
            ["--db-instances <n>", "Database instance count"],
            ["--db-cpu <n>", "vCPU per database instance"],
            ["--db-memory <size>", "Memory per database instance"],
            ["--storage <size>", "Database volume size"]
        ],
        examples: [
            "rebase cloud projects create --name \"Shop\" --subdomain shop --link",
            "rebase cloud projects create --name Shop --subdomain shop --db none",
            "rebase cloud projects create --name Shop --subdomain shop --db byodb --connection-string \"$DATABASE_URL\""
        ],
        notes: [
            "The subdomain cannot be changed in passing later — a typo here is a new project.",
            "A managed database is created at the project's FIRST DEPLOY, not here."
        ]
    },

    "db create": {
        command: "cloud db create",
        usage: "cloud db create --type <managed|byodb> [options]",
        summary:
            "Attach a database to the project. Required before the first deploy: a project with no "
            + "database stays at status \"provisioning\" forever, waiting for this command. "
            + "`rebase cloud projects create` now does it for you unless you passed --db none.",
        flags: [
            ["--type <managed|byodb>", "Platform-provisioned Postgres, or your own"],
            ["--connection-string <url>", "The PostgreSQL URL, for --type byodb"],
            ["--wait", "Wait for the database to answer (byodb only — see below)"],
            ["--timeout <seconds>", "Ceiling on --wait. Default: 300"]
        ],
        examples: [
            "rebase cloud db create --type managed",
            "rebase cloud db create --type byodb --connection-string \"$DATABASE_URL\" --wait"
        ],
        notes: [
            "A managed database is CloudNativePG in a shared in-cluster pool, and it is created at "
            + "the project's first deploy. There is nothing to poll before then, so --wait says so "
            + "and returns rather than looping.",
            "`rebase cloud db test` legitimately fails before the first deploy.",
            "A project has exactly one database — attaching a second is refused, because the "
            + "platform reads one row and it becomes undefined which it deploys against."
        ]
    },

    deploy: {
        command: "cloud deploy",
        usage: "cloud deploy [app] [options]",
        summary:
            "Deploy an app of the linked project and follow the build to a terminal state, exiting "
            + "non-zero if it failed. With no app named, the repository's backend is deployed.",
        flags: [
            ["--wait", "Follow to a terminal state. Already the default; here to be explicit"],
            ["--timeout <seconds>", "Ceiling on the follow. Default: 900"],
            ["--no-follow", "Return as soon as the build is triggered"],
            ["--message, -m <text>", "Label the release"],
            ["--bundle", "Force a managed-bundle deploy (the default for runtime: managed)"],
            ["--bundle-dir <path>", "Deploy a bundle that is already built"],
            ["--source <path>", "Upload this directory and build a container image from it"],
            ["--skip-type-check", "Compile without type checking, as `rebase build` does"],
            ["--force", "Leave the managed runtime on purpose (ejects to a container image)"]
        ],
        examples: [
            "rebase cloud deploy",
            "rebase cloud deploy web --message \"add search\"",
            "rebase cloud deploy --timeout 300 --json"
        ],
        notes: [
            "A project whose rebase.json declares runtime: managed deploys a bundle without --bundle.",
            "--source on a managed project is refused: it would swap the project onto a container image."
        ]
    },

    logs: {
        command: "cloud logs",
        usage: "cloud logs [--runtime] [--follow]",
        summary: "The latest build log, or the running container's log with --runtime.",
        flags: [
            ["--runtime", "The running app's log instead of the build log"],
            ["--follow, -f", "Tail a build that is still running"]
        ],
        examples: ["rebase cloud logs", "rebase cloud logs --runtime", "rebase cloud logs -f"]
    },

    status: {
        command: "cloud status",
        usage: "cloud status",
        summary:
            "One-glance project status: URL, last deploy, runtime, database, storage — and "
            + "blockedOn/nextAction, which say whether the platform is working or waiting for you.",
        flags: [],
        examples: ["rebase cloud status", "rebase cloud status --project shop --json"],
        notes: [
            "Poll `status` only while blockedOn is null. Any other value names a command, and the "
            + "state will not change until you run it."
        ]
    },

    "clusters verify": {
        command: "cloud clusters verify",
        usage: "cloud clusters verify <cluster-id> [--baseline]",
        summary:
            "Ask a registered cluster whether it can host tenants. Reports permissions.allowed and "
            + "permissions.denied, which is what names a missing RBAC grant.",
        flags: [["--baseline", "Also check ingress-nginx, cert-manager and CloudNativePG"]],
        examples: ["rebase cloud clusters verify gke-europe-west1 --baseline"],
        notes: ["Exits non-zero when the verdict is `unusable`, so it works as a gate."]
    }
};

/** Print one action's page — human, or its JSON description when piped. */
export function printActionHelp(entry: ActionHelp): void {
    emitHelp(
        entry.command,
        [],
        () => {
            console.log("");
            console.log(`${chalk.bold(`rebase ${entry.command}`)}`);
            console.log("");
            console.log(`  ${entry.summary}`);
            console.log("");
            console.log(chalk.green.bold("Usage"));
            console.log(`  rebase ${chalk.blue(entry.usage.replace(/^cloud /, "cloud "))}`);
            if (entry.flags.length > 0) {
                console.log("");
                console.log(chalk.green.bold("Options"));
                for (const [flag, description] of entry.flags) {
                    console.log(`  ${chalk.blue(flag.padEnd(30))} ${description}`);
                }
            }
            console.log("");
            console.log(chalk.green.bold("Global options"));
            for (const [flag, description] of GLOBAL_HELP_FLAGS) {
                console.log(`  ${chalk.blue(flag.padEnd(30))} ${chalk.gray(description)}`);
            }
            if (entry.notes?.length) {
                console.log("");
                console.log(chalk.green.bold("Notes"));
                for (const note of entry.notes) console.log(`  ${chalk.gray(`• ${note}`)}`);
            }
            console.log("");
            console.log(chalk.green.bold("Examples"));
            for (const example of entry.examples) console.log(`  ${chalk.gray(example)}`);
            console.log("");
        },
        {
            usage: `rebase ${entry.usage}`,
            summary: entry.summary,
            flags: [...entry.flags, ...GLOBAL_HELP_FLAGS].map(([flag, description]) => ({ flag,
description })),
            notes: entry.notes ?? [],
            examples: entry.examples
        }
    );
}
