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
    },

    /* ── The leaves that were undiscoverable ───────────────────────────
     *
     * Every entry below existed as a command with its own flag spec and no page
     * of its own, so `--help` fell through to its group's index — a list of
     * sibling actions and not one flag. `storage attach`'s six flags were read
     * out of `dist/index.es.js` by somebody deploying a real project, and the
     * only way to learn that `storage create` takes no flags at all was the
     * same one. The completeness check in `action-help.test.ts` now requires a
     * page for every command that names itself to `parseCloudArgs`.
     */

    "resources prune": {
        command: "cloud resources prune",
        usage: "cloud resources prune database <key> [--yes]",
        summary:
            "Drop a platform-provisioned database that this project's code no longer declares. "
            + "A deploy never removes one — it keeps, binds and bills it — so this is where it goes. "
            + "Only a database: a bucket and its files are removed in the project's storage settings.",
        flags: [["--yes", "Skip the confirmation. Off a terminal it refuses rather than assuming."]],
        examples: ["rebase cloud resources prune database analytics --yes"],
        notes: [
            "Refused while the code still declares the database, and for one the platform never made.",
            "Its connection string leaves the running backend at the next deploy."
        ]
    },

    "projects delete": {
        command: "cloud projects delete",
        usage: "cloud projects delete <slug|id> [--yes]",
        summary:
            "Delete a project: its deployments, its database and its subdomain. The subdomain is "
            + "not reusable afterwards. Takes no options of its own — `--yes` is the global one.",
        flags: [],
        examples: ["rebase cloud projects delete shop --yes"],
        notes: ["Irreversible. Without --yes it prompts, and off a terminal it refuses rather than assuming."]
    },

    "db backup": {
        command: "cloud db backup",
        usage: "cloud db backup <list|create|restore|status|download> [filename] [--yes]",
        summary:
            "Take, list, inspect, download and restore this project's database backups. "
            + "`list` is the default when no action is given.",
        flags: [["--yes", "Skip the confirmation on `restore`, which overwrites the live database"]],
        examples: [
            "rebase cloud db backup",
            "rebase cloud db backup create",
            "rebase cloud db backup status",
            "rebase cloud db backup restore base-20260831 --yes",
            "rebase cloud db backup download base-20260831"
        ],
        notes: [
            "`restore` replaces the live database. Nothing about it is undoable from here.",
            "A managed database on the shared pool is backed up with the pool, not per project."
        ]
    },

    "db pitr": {
        command: "cloud db pitr",
        usage: "cloud db pitr <status|restore|cutover|discard> [--target <timestamp>] [--yes]",
        summary:
            "Point-in-time recovery. `status` reports the recoverable window; `restore` stages a "
            + "recovered copy beside the live database; `cutover` repoints the app at that copy; "
            + "`discard` throws it away. `status` is the default.",
        flags: [
            ["--target <timestamp>", "The instant to recover to, ISO-8601. Defaults to the latest recoverable point"],
            ["--yes", "Skip the confirmation on `restore` and `cutover`"]
        ],
        examples: [
            "rebase cloud db pitr",
            "rebase cloud db pitr restore --target 2026-08-30T14:00:00Z",
            "rebase cloud db pitr cutover --yes",
            "rebase cloud db pitr discard"
        ],
        notes: [
            "`restore` does not touch the live database — `cutover` is the step that does.",
            "Recovery is only possible inside the window `status` reports. Check it first."
        ]
    },

    "deployments list": {
        command: "cloud deployments list",
        usage: "cloud deployments [list] [--limit <n>] [--all]",
        summary: "The project's deployment history, newest first, with the status and image of each.",
        flags: [
            ["--limit <n>", "How many to return. Bounded; a value over the maximum is refused, not clamped"],
            ["--all", "Return the maximum instead of naming a limit"]
        ],
        examples: [
            "rebase cloud deployments",
            "rebase cloud deployments list --limit 5",
            "rebase cloud deployments --all --json"
        ]
    },

    "domains add": {
        command: "cloud domains add",
        usage: "cloud domains add <domain>",
        summary:
            "Register a custom domain on this project and print the DNS records to publish. "
            + "Registering is not verifying — run `domains verify` once the records are live.",
        flags: [],
        examples: ["rebase cloud domains add app.example.com"],
        notes: [
            "At a zone apex use the A record this prints, not a CNAME: a CNAME is invalid at an apex.",
            "Verification is a separate command because DNS propagation is not instant."
        ]
    },

    "domains remove": {
        command: "cloud domains remove",
        usage: "cloud domains remove <domain>",
        summary:
            "Unregister a custom domain. The project keeps serving on its <slug>.rebase.website host. "
            + "Aliases: `rm`, `delete`.",
        flags: [],
        examples: ["rebase cloud domains remove app.example.com"]
    },

    "env set": {
        command: "cloud env set",
        usage: "cloud env set KEY=VALUE | KEY VALUE [--secret] [--force]",
        summary:
            "Set one environment variable on the project. Takes effect on the next deploy — "
            + "a running instance does not pick it up.",
        flags: [
            ["--secret", "Store it encrypted and never return it in a listing"],
            ["--force", "Overwrite a variable that is already set"]
        ],
        examples: [
            "rebase cloud env set STRIPE_KEY=sk_live_… --secret",
            "rebase cloud env set LOG_LEVEL debug",
            "rebase cloud env set FEATURE_X= "
        ],
        notes: [
            "A value starting with `-` must use the KEY=VALUE form; the KEY VALUE form refuses it.",
            "Variables the platform sets for every project cannot be overridden — `env reveal` reads them."
        ]
    },

    "env pull": {
        command: "cloud env pull",
        usage: "cloud env pull [--output <path>]",
        summary:
            "Write the project's variables to a local .env file. Secrets come through, so the file "
            + "this produces is a credential.",
        flags: [["--output, --out <path>", "Where to write. Default: .env"]],
        examples: [
            "rebase cloud env pull",
            "rebase cloud env pull --output .env.production"
        ],
        notes: ["Add the file it writes to .gitignore before running it, not after."]
    },

    "storage create": {
        command: "cloud storage create",
        usage: "cloud storage create",
        summary:
            "Provision platform-managed storage: a bucket and its credentials, written onto the "
            + "project and injected into the tenant at deploy time. Takes no options of its own — "
            + "region and naming come from the platform.",
        flags: [],
        examples: ["rebase cloud storage create"],
        notes: [
            "Creates billable infrastructure, and requires org admin rather than membership.",
            "The secret key is never displayed: it goes to the project record and to the tenant's environment.",
            "Redeploy afterwards — a running instance has no credentials for a bucket created after it started."
        ]
    },

    "storage attach": {
        command: "cloud storage attach",
        usage:
            "cloud storage attach --bucket <name> --access-key-id <id> --secret-access-key <secret> "
            + "[--endpoint <url>] [--region <region>] [--force-path-style]",
        summary:
            "Point the project at storage you already own — S3, R2, MinIO, any S3-compatible bucket. "
            + "The alternative to `storage create`, for a bucket the platform does not manage.",
        flags: [
            ["--bucket <name>", "The bucket name. Required"],
            ["--access-key-id <id>", "Required"],
            ["--secret-access-key <secret>", "Required. Stored encrypted and never returned"],
            ["--endpoint <url>", "For anything that is not AWS S3 — R2, MinIO, Backblaze"],
            ["--region <region>", "Bucket region. Default: the provider's own default"],
            ["--force-path-style", "Address as endpoint/bucket rather than bucket.endpoint. Needed by MinIO"]
        ],
        examples: [
            "rebase cloud storage attach --bucket assets --access-key-id AKIA… --secret-access-key …",
            "rebase cloud storage attach --bucket assets --access-key-id … --secret-access-key … \\\n"
                + "    --endpoint https://<account>.r2.cloudflarestorage.com --region auto"
        ],
        notes: [
            "All three of --bucket, --access-key-id and --secret-access-key, or none: a bucket with no "
                + "credentials reads as configured and fails on the first upload.",
            "Redeploy for the tenant to pick the credentials up."
        ]
    },

    "webhooks create": {
        command: "cloud webhooks create",
        usage:
            "cloud webhooks create --name <name> --table <table> --url <url> [--events <list>]",
        summary: "Register an outbound webhook on a table's row changes.",
        flags: [
            ["--name <name>", "Required. What it is called in listings"],
            ["--table <table>", "Required. The table whose changes fire it"],
            ["--url <url>", "Required. Where the POST goes"],
            ["--events <list>", "Comma-separated: insert, update, delete. Default: all three"]
        ],
        examples: [
            "rebase cloud webhooks create --name notify --table orders --url https://example.com/hook",
            "rebase cloud webhooks create --name audit --table users --url https://example.com/hook --events insert,delete"
        ]
    },

    "webhooks delete": {
        command: "cloud webhooks delete",
        usage: "cloud webhooks delete <id>",
        summary: "Remove one webhook by the id `webhooks list` prints.",
        flags: [],
        examples: ["rebase cloud webhooks delete 42"]
    },

    deployments: {
        command: "cloud deployments",
        usage: "cloud deployments [list] [options]",
        summary: "The project's deployment history. `list` is the only action, and the default.",
        flags: [],
        examples: ["rebase cloud deployments", "rebase cloud deployments list --limit 5"]
    },

    webhooks: {
        command: "cloud webhooks",
        usage: "cloud webhooks <list|create|delete> [options]",
        summary: "Outbound webhooks on a table's row changes.",
        flags: [],
        examples: [
            "rebase cloud webhooks list",
            "rebase cloud webhooks create --help",
            "rebase cloud webhooks delete 42"
        ]
    },

    billing: {
        command: "cloud billing",
        usage: "cloud billing [portal|usage]",
        summary:
            "The selected organization's billing. `usage` reports what is currently running and what "
            + "it costs; `portal` opens the Stripe customer portal. Organization-scoped, not project-scoped.",
        flags: [],
        examples: [
            "rebase cloud billing",
            "rebase cloud billing usage --json",
            "rebase cloud billing portal"
        ]
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
