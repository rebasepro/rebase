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
import { emitHelp, GLOBAL_HELP_FLAGS } from "./context";

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

/*
 * `GLOBAL_HELP_FLAGS` and `GLOBAL_SPEC_KEYS` moved to `context.ts`, next to the
 * `GLOBAL_CLOUD_FLAGS` they describe — the group pages print them too, and
 * `context` cannot import this module (this one imports it). `GLOBAL_SPEC_KEYS`
 * is derived from the spec now rather than listed a second time.
 */

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
            // Not a region picker. See the note below — the flags record where
            // the project is placed, and the beta has one place to put it.
            ["--provider <gcp|hetzner|…>", "Which deploy target to record. Default: the one this control plane would use"],
            ["--region <region>", "Region recorded on the project. Default: that target's own region"],
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
            "A managed database is created at the project's FIRST DEPLOY, not here.",
            "--provider and --region are not a region picker. They record which of the control plane's "
                + "registered deploy targets this project belongs to; the private beta has one, so both "
                + "default to it and neither moves a project anywhere else."
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

    "clusters add": {
        command: "cloud clusters add",
        usage: "cloud clusters add --name <n> --provider <gcp|aws|hetzner> --region <r> --kubeconfig <path> [options]",
        summary:
            "Register a cluster. Everything the row needs to serve tenants is set here, at insert, "
            + "because the control plane installs the cluster baseline on insert and reads the row to do it: "
            + "the name is what a Hetzner load balancer is adopted by, the address is what the ingress is pinned to.",
        flags: [
            ["--name <n>", "The cluster's name. On Hetzner, its load balancer is `<name>-ingress`"],
            ["--provider <gcp|aws|hetzner>", "Where it runs"],
            ["--region <r>", "Its region id (europe-west1, fsn1, hel1). Projects placed here deploy to it"],
            ["--kubeconfig <path>", "A kubeconfig for the control plane's identity on it"],
            ["--base-domain <d>", "Tenants on it are served at <subdomain>.<d>. Convention: <region>.rebase.website"],
            ["--ingress-address <ip>", "Its pinned ingress address — what the wildcard DNS record points at"],
            ["--platform-capacity", "This is capacity Rebase operates: projects placed in its region deploy here. Leave off for a customer's own cluster"],
            ["--backup-bucket <b>", "Its own object-storage bucket for database backups (with the three below)"],
            ["--backup-endpoint <url>", "S3 endpoint of that bucket, e.g. https://fsn1.your-objectstorage.com"],
            ["--backup-access-key-id <k>", "Key for the bucket"],
            ["--backup-secret-access-key <s>", "Secret for the bucket. Encrypted at rest"]
        ],
        examples: [
            "rebase cloud clusters add --name gke-eu --provider gcp --region europe-west1 --kubeconfig ./kubeconfig",
            "rebase cloud clusters add --name rebase-fsn1 --provider hetzner --region fsn1 --kubeconfig ./control-plane.kubeconfig "
            + "--base-domain fsn1.rebase.website --ingress-address 49.13.1.1 --platform-capacity "
            + "--backup-bucket rebase-fsn1-db-backups --backup-endpoint https://fsn1.your-objectstorage.com "
            + "--backup-access-key-id … --backup-secret-access-key …"
        ],
        notes: [
            "The backup flags go together; a bucket without a key is a cluster with no backup store.",
            "A Hetzner cluster registered with --platform-capacity must bring its own backup store."
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
            "cloud webhooks create --name <name> --table <table> --endpoint <url> [--events <list>]",
        summary: "Register an outbound webhook on a table's row changes.",
        flags: [
            ["--name <name>", "Required. What it is called in listings"],
            ["--table <table>", "Required. The table whose changes fire it"],
            ["--endpoint <url>", "Required. Where the POST goes"],
            ["--events <list>", "Comma-separated: insert, update, delete. Default: all three"]
        ],
        examples: [
            "rebase cloud webhooks create --name notify --table orders --endpoint https://example.com/hook",
            "rebase cloud webhooks create --name audit --table users --endpoint https://example.com/hook --events insert,delete"
        ],
        notes: [
            "`--endpoint`, not `--url`: every cloud command's `--url` names the control plane, and one written here would be authenticated against instead of called."
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
        usage: "cloud billing [setup|checkout]",
        summary:
            "The selected organization's billing. Bare, it prints the billing account, the card on "
            + "file and what the linked project costs per month; `setup` attaches a card (one-time, "
            + "opens a browser); `checkout` opens a Stripe session for one project. "
            + "Organization-scoped, not project-scoped.",
        flags: [],
        examples: [
            "rebase cloud billing",
            "rebase cloud billing setup",
            "rebase cloud billing checkout --project shop"
        ],
        notes: [
            "`setup` comes before the first deploy: without a card the control plane answers 402, and `deploy` refuses before it builds."
        ]
    },

    /* ── The resource dials ─────────────────────────────────────────────
     *
     * Two pages rather than one, because they answer different questions:
     * `resources` is "what does this project have, and what does it cost",
     * `resources set` is "what may I change it to". The prices are not
     * repeated here — the control plane quotes them and both pages say so,
     * which is the only version of this that cannot go stale. */

    resources: {
        command: "cloud resources",
        usage: "cloud resources [set] [options]",
        summary:
            "What this project reserves, and what the control plane would invoice for it. Bare, it "
            + "prints every dial and an itemised €/month; `set` changes one. An empty dial means the "
            + "platform default, which moves when the default moves — a dial pinned to the same "
            + "number does not.",
        flags: [],
        examples: [
            "rebase cloud resources",
            "rebase cloud resources --json",
            "rebase cloud resources set --help"
        ],
        notes: [
            "The price is the control plane's own quote for these dials, itemised line by line — not a tier, and not a number this CLI computes."
        ]
    },

    "resources set": {
        command: "cloud resources set",
        usage: "cloud resources set [--cpu <n>] [--memory <size>] [--replicas <n>] [...]",
        summary:
            "Change one or more of a project's dials. At least one is required: a patch with nothing "
            + "in it is a typo, and reporting success for a change nobody made is worse than refusing.",
        flags: [
            ["--cpu <n>", "App CPU request per instance, e.g. 500m or 2. Default: 250m"],
            ["--memory <size>", "App memory request per instance, e.g. 512Mi or 2Gi. Default: 512Mi"],
            ["--replicas <n>", "Instances that always exist — the autoscaler's floor, and what is billed at rest"],
            ["--spot <true|false>", "Preemptible capacity: cheaper, and restarted without notice"],
            ["--scale-to-zero <true|false>", "Request-billed compute that stops when idle, at the cost of a cold start"],
            ["--db-mode <shared|dedicated>", "Pooled cluster, or one of this project's own"],
            ["--db-instances <n>", "1–3. 1 is a single instance with no failover; 2 adds an automatic standby"],
            ["--db-cpu <n>", "Database CPU request per instance. Default: 500m"],
            ["--db-memory <size>", "Database memory request per instance. Default: 2Gi"],
            ["--storage <size>", "Database volume size"],
            ["--autoscale-max <n>", "1–16. The ceiling the app may reach, and the worst case it may be billed"],
            ["--autoscale-cpu-target <pct>", "10–95. CPU utilisation the autoscaler holds, against the request. Default: 70"],
            ["--no-autoscale", "Turn autoscaling off. The only way to: a ceiling at or below --replicas is refused"]
        ],
        examples: [
            "rebase cloud resources set --cpu 500m --memory 2Gi",
            "rebase cloud resources set --replicas 2 --autoscale-max 6",
            "rebase cloud resources set --db-mode dedicated --db-instances 2"
        ],
        notes: [
            "Run `rebase cloud resources` first — it prints the current dials and the €/month this project is quoted.",
            "Applied immediately: the app rolls its pods and the subscription is prorated from today. A change that restarts the database waits for a maintenance window.",
            "The valid ranges are the target cluster's, not this CLI's — GKE Autopilot bills a 250m/512Mi floor and rewrites a memory:CPU ratio outside 1:1–6.5:1, a Hetzner node has neither constraint. The control plane refuses what it cannot honour and names the field."
        ]
    },

    /* ── Session, link, and the operations with no flags of their own ────
     *
     * Every one of these fell through to the index page, which lists groups
     * and not one flag — so `login --password`, `link`'s positional URL and
     * the `-y` that `stop` requires had no discoverable spelling. They take
     * few options, and that is exactly what a reader needs told. */

    login: {
        command: "cloud login",
        usage: "cloud login [--email <address>] [--password <password>]",
        summary:
            "Sign in to the control plane and write the session to ~/.rebase/credentials.json. "
            + "Prompts for whatever is missing when attached to a terminal, and refuses rather than "
            + "hangs when it is not.",
        flags: [
            ["--email, -e <address>", "The account's email. Prompted when omitted, or REBASE_CLOUD_EMAIL"],
            ["--password <password>", "Discouraged: a password written here is recorded in your shell history and visible in the process table. Prefer the prompt, or REBASE_CLOUD_PASSWORD"]
        ],
        examples: [
            "rebase cloud login",
            "rebase cloud login --email me@example.com",
            "rebase cloud login --url https://cloud.example.com"
        ],
        notes: [
            "--password warns, once, before the request: by the time a login succeeds the password is already in the history file.",
            "There is no machine token yet, so CI genuinely needs a human's credentials. REBASE_CLOUD_EMAIL and "
                + "REBASE_CLOUD_PASSWORD are how a secret store hands them over without them appearing on a command line."
        ]
    },

    logout: {
        command: "cloud logout",
        usage: "cloud logout [--url <origin>]",
        summary:
            "Forget the session for a control plane. Idempotent — logging out when you are not "
            + "logged in is a success, and `wasLoggedIn` in the JSON is how a script tells the two apart.",
        flags: [],
        examples: ["rebase cloud logout"]
    },

    whoami: {
        command: "cloud whoami",
        usage: "cloud whoami",
        summary: "Who this session is, which control plane it is against, and what this directory is linked to.",
        flags: [],
        examples: ["rebase cloud whoami", "rebase cloud whoami --json"]
    },

    link: {
        command: "cloud link",
        usage: "cloud link [<url>] [--project <slug>]",
        summary:
            "Bind this directory to a backend, by writing .rebase/cloud.json. With a cloud project "
            + "(picked interactively, or named with --project) the rest of the family needs no flags. "
            + "With a positional URL it links straight at a running Rebase API — no control plane, no "
            + "login — which is what makes the multi-repo workflow available to self-hosters.",
        flags: [],
        examples: [
            "rebase cloud link",
            "rebase cloud link --project shop",
            "rebase cloud link https://api.example.com"
        ],
        notes: [
            "A positional URL is verified before it is written: an address that does not answer is still linked, but you are told.",
            ".rebase/cloud.json is not a secret and is not your credentials — those live in ~/.rebase/credentials.json."
        ]
    },

    unlink: {
        command: "cloud unlink",
        usage: "cloud unlink",
        summary:
            "Remove this directory's link. Idempotent, like logout: `unlinked: false` says there was "
            + "nothing to remove.",
        flags: [],
        examples: ["rebase cloud unlink"]
    },

    use: {
        command: "cloud use",
        usage: "cloud use [<org>]",
        summary:
            "Select the active organization — the one `projects create`, `billing` and `orgs` act on. "
            + "Named, it is set; omitted, you pick from the ones this account belongs to.",
        flags: [],
        examples: ["rebase cloud use", "rebase cloud use acme"]
    },

    open: {
        command: "cloud open",
        usage: "cloud open",
        summary:
            "Open the console in a browser — the linked project's page when this directory is linked, "
            + "the dashboard otherwise. The URL is the result, so a piped run prints it instead.",
        flags: [],
        examples: ["rebase cloud open"]
    },

    rollback: {
        command: "cloud rollback",
        usage: "cloud rollback [<deploymentId>] [--yes]",
        summary:
            "Put a previous successful deployment back into service. Without an id, the most recent "
            + "rollbackable deployment that is not the live one. History is appended, never rewound: "
            + "a rollback is a new deployment row pointing back at the old one.",
        flags: [],
        examples: [
            "rebase cloud rollback",
            "rebase cloud deployments list",
            "rebase cloud rollback 214 --yes"
        ],
        notes: [
            "`rebase cloud deployments list` marks which rows are rollbackable. One that is not is refused here rather than by a 409 from the control plane."
        ]
    },

    cancel: {
        command: "cloud cancel",
        usage: "cloud cancel [<deploymentId>] [--yes]",
        summary:
            "Stop the build in flight for this project. Without an id, whichever one is deploying. "
            + "Also the way out of a project whose status claims a deploy that no deployment row backs.",
        flags: [],
        examples: ["rebase cloud cancel", "rebase cloud cancel 214 --yes"]
    },

    start: {
        command: "cloud start",
        usage: "cloud start",
        summary: "Bring a stopped project back into service.",
        flags: [],
        examples: ["rebase cloud start"]
    },

    stop: {
        command: "cloud stop",
        usage: "cloud stop [--yes]",
        summary:
            "Stop the project. This is downtime, so it is confirmed — pass --yes to skip the prompt, "
            + "which a non-interactive run must.",
        flags: [],
        examples: ["rebase cloud stop", "rebase cloud stop --yes"]
    },

    restart: {
        command: "cloud restart",
        usage: "cloud restart [--yes]",
        summary:
            "Stop the project and start it again. A real stop and start, with genuine downtime in "
            + "between, so it is confirmed like `stop`.",
        flags: [],
        examples: ["rebase cloud restart --yes"]
    },

    metrics: {
        command: "cloud metrics",
        usage: "cloud metrics",
        summary: "Live CPU, memory and disk for the project's running units, as the control plane reports them.",
        flags: [],
        examples: ["rebase cloud metrics", "rebase cloud metrics --json"]
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
