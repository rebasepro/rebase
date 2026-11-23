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
import { ORG_CAPABILITIES, ORG_CAPABILITY_NAMES, TOKEN_CAPABILITIES, TOKEN_CAPABILITY_NAMES } from "./token-capabilities";

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
    init: {
        command: "cloud init",
        usage: "cloud init --claim [--name <name>] [--no-deploy]",
        summary:
            "Provision a project on Rebase Cloud with no account, push this project's tables to it, and print "
            + "its live URL and a claim link. Whoever opens the link and signs in owns the project; unclaimed, it is "
            + "deleted after 72 hours. Sets REBASE_BASE_URL in .env and links this directory to the project; after "
            + "the deploy, also REBASE_API_TOKEN, a key the app accepts for reading and writing data.",
        flags: [
            ["--claim", "Required: provision an unclaimed project and print the link that claims it"],
            ["--name, -n <name>", "What to call the app. Default: a generated name"],
            ["--no-deploy", "Provision and link only; push the tables later with `rebase cloud deploy`"]
        ],
        examples: [
            "rebase cloud init --claim",
            "rebase cloud init --claim --name \"Todo app\" --json"
        ],
        notes: [
            "The project's token is kept in ~/.rebase/credentials.json, never in the repository, and `rebase cloud` "
                + "commands in this directory use it until the project is claimed or expires.",
            "Claiming takes a signed-in browser session and a payment method on the claiming organization.",
            "With an account already: `rebase cloud projects create --link`."
        ]
    },

    claim: {
        command: "cloud claim",
        usage: "cloud claim [--open]",
        summary:
            "Print the claim link of the project `rebase cloud init --claim` provisioned in this directory, and how long "
            + "is left before it is deleted unclaimed. Asks the control plane first, and refuses once the project has "
            + "been claimed.",
        flags: [["--open", "Also open the link in a browser"]],
        examples: ["rebase cloud claim", "rebase cloud claim --open", "rebase cloud claim --json"],
        notes: [
            "The link exists only on the machine that ran `init --claim` (in ~/.rebase/credentials.json); the control "
                + "plane keeps a hash of it and cannot print it again.",
            "`rebase cloud status` and `rebase cloud whoami` show the same link while the project is unclaimed."
        ]
    },

    projects: {
        command: "cloud projects",
        usage: "cloud projects <list|create|info|transfer|delete> [options]",
        summary: "List, create, inspect, transfer and delete projects in the selected organization.",
        flags: [["--all-orgs", "list: every organization you belong to, not only the selected one"]],
        examples: [
            "rebase cloud projects list",
            "rebase cloud projects list --all-orgs --json",
            "rebase cloud projects create --help",
            "rebase cloud projects info shop",
            "rebase cloud projects transfer shop --to-org acme",
            "rebase cloud projects delete shop --yes"
        ]
    },

    clusters: {
        command: "cloud clusters",
        usage: "cloud clusters [list|add|verify|registry|baseline|open|close] [options]",
        summary: "The compute clusters tenants run on. Platform-admin only.",
        flags: [],
        examples: [
            "rebase cloud clusters",
            "rebase cloud clusters verify <cluster-id> --baseline",
            "rebase cloud clusters baseline <cluster-id> --install",
            "rebase cloud clusters open <cluster-id>",
            "rebase cloud clusters add --name gke-eu --provider gcp --region europe-west1 --kubeconfig ./kubeconfig",
            "rebase cloud clusters registry <cluster-id> --repository europe-west1-docker.pkg.dev/p/rlc-acme --push-service-account rlc-acme-push@p.iam.gserviceaccount.com --pull-key-file ./rlc-acme-pull.json"
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
            ["--org <id>", "Organization to create it in (default: the selected one, else the linked project's)"],
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
            // Still parsed so an old script is told what happened. Documented
            // here because the parse is: a page silent about a flag the
            // command accepts is how the two drift.
            ["--scale-to-zero <false>", "Retired: every backend is always on. `false` is ignored with a warning, `true` refused"],
            ["--db-instances <n>", "Database instance count"],
            ["--db-cpu <n>", "vCPU per database instance"],
            ["--db-memory <size>", "Memory per database instance"],
            ["--storage <mode>", "Object storage: shared-prefix or dedicated-bucket"]
        ],
        examples: [
            "rebase cloud projects create --name \"Shop\" --subdomain shop --link",
            "rebase cloud projects create --name Shop --subdomain shop --db none --yes",
            "rebase cloud projects create --name Shop --subdomain shop --db byodb --connection-string \"$DATABASE_URL\" --yes"
        ],
        notes: [
            "The subdomain cannot be changed in passing later — a typo here is a new project.",
            "A managed database is created at the project's FIRST DEPLOY, not here.",
            "--provider and --region are not a region picker. They record which of the control plane's "
                + "registered deploy targets this project belongs to; the private beta has one, so both "
                + "default to it and neither moves a project anywhere else.",
            "It asks before creating, because a project is billed once it runs. `--yes`, the global flag listed below, "
                + "skips the question, and a script or agent must pass it: off a terminal the command refuses rather than assume."
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
            "A managed database is a CloudNativePG cluster of the project's own, in the project's "
            + "own namespace and backed up on its own schedule. It is created at the project's first "
            + "deploy: there is nothing to poll before then, so --wait says so and returns rather "
            + "than looping.",
            "`rebase cloud db test` legitimately fails before the first deploy.",
            "A project has exactly one database — attaching a second is refused, because the "
            + "platform reads one row and it becomes undefined which it deploys against."
        ]
    },

    "db query": {
        command: "cloud db query",
        usage: "cloud db query [sql] [--file <path>]",
        summary:
            "Run SQL on the project's managed database and print what it answered. It opens the tunnel "
            + "`db connect` opens, for the length of one query, and connects with the CLI's own Postgres "
            + "driver, so nothing else needs to be installed. A file of several statements (functions, "
            + "triggers, DO blocks) runs as one script and stops at the first error.",
        flags: [
            ["--file <path>", "Run the statements in a file instead of the argument"]
        ],
        examples: [
            "rebase cloud db query \"select count(*) from rebase.users\"",
            "rebase cloud db query --file sql/extras.sql --project shop",
            "rebase cloud db query \"select * from orders limit 5\" --json"
        ],
        notes: [
            "Requires the organization's owner or admin role, as `db connect --reveal` does.",
            "No transaction is added: wrap the file in BEGIN/COMMIT to make it all-or-nothing.",
            "`COPY … FROM STDIN` (psql's \\copy) is refused; it needs a client-side stream.",
            "With --json it prints `{ projectId, results: [{ command, rowCount, rows }] }`, one entry per statement."
        ]
    },

    "db connect": {
        command: "cloud db connect",
        usage: "cloud db connect [--port <n>] [--reveal]",
        summary:
            "Open a local port that is the project's managed database, and hold it open until Ctrl-C. "
            + "A managed database lives inside the platform's cluster, so the host `db info` reports is "
            + "your backend's address for it and resolves to nothing on your machine; this is what makes "
            + "it reachable from here. Point psql, TablePlus, Drizzle Studio or pg_dump at the URL it "
            + "prints. The database still asks for its password — the tunnel is a network path, not a "
            + "credential.",
        flags: [
            ["--port <n>", "Local port to listen on. Default: 5432"],
            ["--reveal", "Print the password inside the connection URL"]
        ],
        examples: [
            "rebase cloud db connect",
            "rebase cloud db connect --port 6543",
            "rebase cloud db connect --reveal --project shop"
        ],
        notes: [
            "Requires the organization's owner or admin role — the same gate as the console's SQL "
            + "console, because it is the same capability.",
            "Piped or with --json it prints one object — host, port, database, username, "
            + "connectionString — and keeps serving, so a script can read the URL and connect.",
            "Connections go through the control plane, so they count against the project's own "
            + "database connection limit like any other client.",
            "Bring-your-own databases are refused: that host is already yours to reach, and there is "
            + "nothing for the platform to tunnel."
        ]
    },

    deploy: {
        command: "cloud deploy",
        usage: "cloud deploy [app] [options]",
        summary:
            "Deploy an app of the linked project and follow the build to a terminal state, exiting "
            + "non-zero if it failed. With no app named, the repository's backend is deployed. It ends "
            + "on a summary: each app shipped and its URL, the deployment id, how long it took, and whether "
            + "the new version answers on those URLs.",
        flags: [
            ["--wait", "Follow to a terminal state. Already the default; here to be explicit"],
            ["--timeout <seconds>", "Ceiling on the follow. Default: 900"],
            ["--live-timeout <seconds>", "How long to wait for the new version to answer on its URLs. 0 skips the check. Default: 60"],
            ["--no-follow", "Return as soon as the build is triggered"],
            ["--message, -m <text>", "Label the release"],
            ["--bundle", "Force a managed-bundle deploy (the default for runtime: managed)"],
            ["--bundle-dir <path>", "Deploy a bundle that is already built"],
            ["--source <path>", "Upload this directory and build a container image from it"],
            ["--skip-type-check", "Compile without type checking, as `rebase build` does"],
            ["--skip-schema", "Keep the committed database schema instead of regenerating it"],
            ["--no-static", "Deploy the backend without folding the static apps into its bundle"],
            ["--no-source", "Do not upload the project's source beside a backend bundle"],
            ["--no-verify", "Skip the syntax check of the static apps' JavaScript"],
            ["--allow-downgrade", "Deploy a bundle built on an older framework release than the project runs"],
            ["--preview", "Serve this build on an address of its own and leave production untouched"],
            ["--preview-name <name>", "Name the preview, so deploying the same name again updates the same address. Implies --preview"],
            ["--eject", "Leave the managed runtime on purpose (ejects to a container image)"],
            ["--git", "Have the control plane build the project's connected repository instead of this directory. The positional is then the branch"]
        ],
        examples: [
            "rebase cloud deploy",
            "rebase cloud deploy web --message \"add search\"",
            "rebase cloud deploy --git",
            "rebase cloud deploy --git release-2026-11",
            "rebase cloud deploy --preview",
            "rebase cloud deploy --preview-name new-quiz",
            "rebase cloud deploy --timeout 300 --json"
        ],
        notes: [
            "The summary is printed even when stdout is piped. Pass --json (or set REBASE_JSON=1) for one "
                + "JSON object instead: apps, hosts, live, liveChecks, durationMs and the deployment id.",
            "A failed deploy ends on one line naming the app and the reason, and exits non-zero. A deploy "
                + "that succeeded but could not be confirmed live within --live-timeout exits zero and says so.",
            "A project whose rebase.json declares runtime: managed deploys a bundle without --bundle.",
            "--source on a managed project is refused: it would swap the project onto a container image.",
            "A backend bundle deploy also uploads the project's source (what git tracks, never a .env), so a "
                + "platform upgrade can rebuild it on a newer release. If it is over 100 MB or the upload fails, "
                + "the deploy goes on without it and says so.",
            "A bundle older than the release the project runs is refused as FRAMEWORK_DOWNGRADE. Run "
                + "`rebase upgrade` and deploy again, or pass --allow-downgrade.",
            "Before uploading, every .js/.mjs/.cjs file and inline <script> in each static app's output is "
                + "parsed. A syntax error stops the deploy with its file:line:column (code syntax_error); "
                + "--no-verify skips the check.",
            "Undo a bad deploy with `rebase cloud rollback`: it restores the previous successful backend "
                + "deployment, static apps folded into it included. A static app deployed on its own "
                + "(`cloud deploy <app>`) cannot be rolled back yet; deploy its last good version again.",
            "--preview prints the preview's own address, https://<project>--<name>.rebase.website. A preview of the "
                + "backend runs its own, on an empty database of its own, with its static apps folded in. It uploads "
                + "no source and registers no apps or hostnames. `rebase cloud previews` lists and deletes previews.",
            "A backend preview is billed while it exists; the deploy prints what it costs per month, as the control "
                + "plane quotes it (`cost` under --json).",
            "A static app previewed on its own (`cloud deploy <app> --preview`) needs a control plane that serves "
                + "static sites by themselves. Rebase Cloud does not yet, and refuses it with PREVIEW_STATIC_UNSERVED; "
                + "nothing is published.",
            "A control plane without previews refuses --preview with previews_unavailable, and nothing is deployed.",
            "--git uploads nothing: the control plane clones the repository connected in `rebase cloud settings`, at the branch "
                + "named or the project's own, and the deploy is followed like any other. It is refused with no_git_repository "
                + "when none is connected, beside any flag that describes a local build, and, on a project the managed runtime "
                + "runs, without --eject (a source build leaves the managed runtime)."
        ]
    },

    previews: {
        command: "cloud previews",
        usage: "cloud previews [list|delete] [options]",
        summary:
            "The project's preview deployments: builds made with `rebase cloud deploy --preview`, each served on "
            + "its own address while production keeps serving what it served before. `list` is the default.",
        flags: [],
        examples: [
            "rebase cloud previews",
            "rebase cloud previews delete new-quiz --yes"
        ],
        notes: [
            "A preview expires on its own when it has not been deployed to for a while; `list` says when.",
            "Deleting a preview stops its address answering and, for a backend preview, drops its database. "
                + "Production is never touched."
        ]
    },

    "previews list": {
        command: "cloud previews list",
        usage: "cloud previews list",
        summary: "Every preview of the project: its name, its address, the app it serves, which backend it calls, and when it expires.",
        flags: [],
        examples: ["rebase cloud previews list", "rebase cloud previews list --json"]
    },

    "previews delete": {
        command: "cloud previews delete",
        usage: "cloud previews delete <name> [--yes]",
        summary: "Delete one preview: its address stops answering, and a backend preview's database is dropped. Alias: `rm`.",
        flags: [],
        examples: ["rebase cloud previews delete new-quiz --yes"]
    },

    logs: {
        command: "cloud logs",
        usage: "cloud logs [--runtime] [--follow] [--preview [<name>]] [--since <t>] [--tail <n>] [--grep <text>] [--level <l>] [--previous]",
        summary: "The latest build log, or what the running app prints with --runtime — from every pod, followed live with -f.",
        flags: [
            ["--runtime", "The running app's log instead of the build log"],
            ["--follow, -f", "Keep printing new lines until Ctrl-C (exits 0); with no --runtime, tail a build still running"],
            ["--preview [<name>]", "A preview's log instead of production's: its name, or the deployment id a preview deploy printed; alone, the project's only preview"],
            ["--since <t>", "With --runtime: start from 30s / 5m / 1h ago, or from an RFC3339 time"],
            ["--tail <n>", "With --runtime: at most this many lines per pod to start with (the control plane caps it at 2000); with --grep or --level, this many matching lines per pod, searched across the whole window"],
            ["--grep <text>", "With --runtime: only lines containing the text (any case); `/re/flags` for a regular expression"],
            ["--level <l>", "With --runtime: only lines at this severity or worse — error, warn, info or debug"],
            ["--previous", "With --runtime: the last instance of a container that restarted, where a crash's reason usually is"]
        ],
        examples: [
            "rebase cloud logs",
            "rebase cloud logs -f",
            "rebase cloud logs --runtime -f",
            "rebase cloud logs --runtime -f --level error",
            "rebase cloud logs --runtime --since 15m --grep timeout",
            "rebase cloud logs --runtime --previous",
            "rebase cloud logs --preview new-quiz -f",
            "rebase cloud logs --runtime --json -f | jq -r 'select(.type == \"line\") | .text'"
        ],
        notes: [
            "Under --json a followed runtime log is NDJSON: one `{\"type\":\"line\",\"ts\",\"pod\",\"text\"}` per log line, "
                + "and `{\"type\":\"event\",\"event\":…}` when a pod starts, restarts or goes, or the connection drops and comes back.",
            "A container that restarts while you follow has its previous instance's last lines printed — usually the crash's reason."
        ]
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
            + "state will not change until you run it.",
            "A section the control plane does not serve yet (the maintenance window) is left out and noted; "
            + "`notServed` in the JSON lists it."
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
            ["--base-domain <d>", "Tenants on it are served at <subdomain>.<d>. Empty = the platform's base domain"],
            ["--ingress-address <ip>", "Its pinned ingress address — what this cluster's DNS records point at"],
            ["--platform-capacity", "This is capacity Rebase operates: projects placed in its region deploy here. Leave off for a customer's own cluster"],
            ["--open-to-customers", "Offer this region to customers for new projects. Leave off while its hostnames are reachable only through explicit DNS records (a base domain shared with another cluster); operators can deploy there either way"],
            ["--backup-bucket <b>", "Its own object-storage bucket for database backups (with the three below)"],
            ["--backup-endpoint <url>", "S3 endpoint of that bucket, e.g. https://fsn1.your-objectstorage.com"],
            ["--backup-access-key-id <k>", "Key for the bucket"],
            ["--backup-secret-access-key <s>", "Secret for the bucket. Encrypted at rest"],
            ["--managed-storage broker", "New managed storage in its region goes to the platform's storage broker, and the baseline installs no in-cluster object store"],
            ["--egress-address <ipv4>", "The fixed outbound address tenant apps leave from (Hetzner: `terraform output egress_ip`); the baseline writes the egress policy"],
            ["--ingress-address-v6 <ipv6>", "The IPv6 address its ingress answers on, for AAAA records"]
        ],
        examples: [
            "rebase cloud clusters add --name gke-eu --provider gcp --region europe-west1 --kubeconfig ./kubeconfig",
            "rebase cloud clusters add --name rebase-fsn1 --provider hetzner --region fsn1 --kubeconfig ./control-plane.kubeconfig "
            + "--base-domain rebase.website --ingress-address 49.13.1.1 --platform-capacity "
            + "--backup-bucket rebase-fsn1-db-backups --backup-endpoint https://fsn1.your-objectstorage.com "
            + "--backup-access-key-id … --backup-secret-access-key …"
        ],
        notes: [
            "The backup flags go together; a bucket without a key is a cluster with no backup store.",
            "A Hetzner cluster registered with --platform-capacity must bring its own backup store.",
            "`--platform-capacity` does not open the region to customers; `--open-to-customers` does."
        ]
    },

    "clusters open": {
        command: "cloud clusters open",
        usage: "cloud clusters open <id-or-name>",
        summary:
            "Offer a platform cluster's region to customers for new projects. A newly registered cluster stays closed "
            + "until this (or `clusters add --open-to-customers`); operators can deploy there either way. Platform-admin only.",
        flags: [],
        examples: ["rebase cloud clusters open rebase-fsn1"],
        notes: [
            "When another cluster serves the same base domain it warns first: open only once the wildcard record for that "
            + "domain points at this cluster. The CLI cannot check DNS, so it states the requirement and does not ask.",
            "Customers are offered the region once the cluster's baseline is ready."
        ]
    },

    "clusters close": {
        command: "cloud clusters close",
        usage: "cloud clusters close <id-or-name>",
        summary:
            "Stop offering a cluster's region to customers for new projects. Projects already there stay, and operators "
            + "can still deploy to it. Platform-admin only.",
        flags: [],
        examples: ["rebase cloud clusters close rebase-fsn1"],
        notes: ["Closed is the state a newly registered cluster starts in (`openToCustomers` NULL)."]
    },

    "clusters registry": {
        command: "cloud clusters registry",
        usage: "cloud clusters registry <cluster-id> --repository <host/project/repo> --push-service-account <email> --pull-key-file <key.json>",
        summary:
            "Give a customer's own cluster an image registry of its own. Its admin can read every Secret there, so "
            + "without one it is handed the platform's shared registry credentials, and every deploy to it says so. "
            + "With one, its builds push to this repository as this account, and its pods pull with this key only.",
        flags: [
            ["--repository <host/project/repo>", "The cluster's own Artifact Registry repository (Terraform output tenant_registry)"],
            ["--push-service-account <email>", "Writer on that repository only; the control plane impersonates it (push_service_account)"],
            ["--pull-key-file <key.json>", "The JSON key of the cluster's read-only account (pull_service_account). Sealed at write, never shown again"],
            ["--clear", "Forget the cluster's registry and go back to the shared one"]
        ],
        examples: [
            "rebase cloud clusters registry <cluster-id> --repository europe-west1-docker.pkg.dev/p/rlc-acme --push-service-account rlc-acme-push@p.iam.gserviceaccount.com --pull-key-file ./rlc-acme-pull.json",
            "rebase cloud clusters registry <cluster-id> --clear"
        ],
        notes: [
            "All three values go together: the control plane ignores a partial set and keeps the shared credentials.",
            "The repository and both accounts come from saas/infra/gcp/registry-linked-clusters.tf. Takes effect on each project's next deploy."
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

    "clusters baseline": {
        command: "cloud clusters baseline",
        usage: "cloud clusters baseline <cluster-id> [--install] [--yes]",
        summary:
            "The cluster baseline — ingress-nginx, cert-manager and CloudNativePG — on one cluster: which components "
            + "are installed and ready, and where the last install left off. With --install, install whatever is missing. "
            + "Platform-admin only.",
        flags: [["--install", "Install the missing components, in the background. Asks first"]],
        examples: [
            "rebase cloud clusters baseline gke-europe-west1",
            "rebase cloud clusters baseline gke-europe-west1 --install --yes"
        ],
        notes: [
            "The install runs on the control plane; run the command again without --install to follow it.",
            "`clusters verify <id> --baseline` asks the different question of whether a deploy would work there."
        ]
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
        flags: [],
        examples: ["rebase cloud resources prune database analytics --yes"],
        notes: [
            "`--yes` is the global flag, listed below. Off a terminal this command refuses rather than assuming it.",
            "Refused while the code still declares the database, and for one the platform never made.",
            "Its connection string leaves the running backend at the next deploy."
        ]
    },

    "projects transfer": {
        command: "cloud projects transfer",
        usage: "cloud projects transfer <slug|id> --to-org <id|slug> [--yes]",
        summary:
            "Move a project into another organization, unchanged: same id, address, custom domains, database, "
            + "storage, variables and deployments. Only who owns it, who can see it and who pays for it change.",
        flags: [["--to-org <id|slug>", "the organization to move it to; you must be its owner or admin"]],
        examples: ["rebase cloud projects transfer shop --to-org acme", "rebase cloud projects transfer shop --to-org 2f1c…  --yes"],
        notes: [
            "You must be owner or admin of both organizations, and signed in with `rebase cloud login`: an access token cannot move a project.",
            "The destination is billed from now on. One with no card on file (and not billed internally) refuses the move, and nothing changes.",
            "Without --yes it prompts, and off a terminal it refuses rather than assuming."
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
        flags: [],
        examples: [
            "rebase cloud db backup",
            "rebase cloud db backup create",
            "rebase cloud db backup status",
            "rebase cloud db backup restore base-20260831 --yes",
            "rebase cloud db backup download base-20260831"
        ],
        notes: [
            "`restore` replaces the live database. Nothing about it is undoable from here — `--yes`, the global flag listed below, is what skips that confirmation.",
            "Backups are the project's own: a base backup on a schedule, plus continuous WAL archiving for point-in-time recovery."
        ]
    },

    "db access": {
        command: "cloud db access",
        usage: "cloud db access [status|enable|disable|reveal] [--allow <ip|cidr>]... [--schemas <name>]... [--tables <schema.table>]... [--ca-out <file>] [--yes]",
        summary:
            "Let a tool that cannot run a tunnel — a hosted BI dashboard, a notebook, a warehouse loader — "
            + "read the managed database from its own address. `enable` creates a read-only role, a load "
            + "balancer that admits only the addresses you name, and requires TLS; the role reads the "
            + "schemas and tables you choose and nothing else. `enable` takes the whole desired state, so "
            + "running it again with other addresses replaces them. `reveal` prints the role's password "
            + "and a connection URL. `status` is the default.",
        flags: [
            ["--allow <ip|cidr>", "An IPv4 address or range the database may be reached from (at most a /16). Repeatable, or comma-separated"],
            ["--schemas <name>", "Schemas the role reads whole, tables created later included. Default: public"],
            ["--tables <schema.table>", "Single tables the role reads as well, e.g. rebase.cron_logs. Repeatable"],
            ["--ca-out <file>", "Write the cluster's CA certificate here, to verify the server with sslmode=verify-ca"]
        ],
        examples: [
            "rebase cloud db access enable --allow 34.89.253.13",
            "rebase cloud db access enable --allow 34.89.253.13 --tables rebase.metric_samples,rebase.cron_logs --yes",
            "rebase cloud db access reveal --ca-out db-ca.pem",
            "rebase cloud db access disable --yes"
        ],
        notes: [
            "Owner or admin only, as for the database password. Every change and every reveal is in `rebase cloud activity`.",
            "The `rebase` schema holds users, password hashes and session tokens: it is never granted whole, and its credential tables never at all.",
            "Managed databases on GCP capacity only for now. Each project with access on has its own network load balancer, which is billed.",
            "The role holds up to 25 connections at once — enough for a dashboard that loads its widgets in parallel, one connection per query — and the app keeps the rest. A tool that opens more is refused the extra ones.",
            "`enable` opens the database to the network and `disable` closes the address, drops the role and deletes its password: "
                + "both ask first. `--yes`, the global flag listed below, skips the question, and is required off a terminal."
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
            ["--target <timestamp>", "The instant to recover to, ISO-8601. Defaults to the latest recoverable point"]
        ],
        examples: [
            "rebase cloud db pitr",
            "rebase cloud db pitr restore --target 2026-08-30T14:00:00Z",
            "rebase cloud db pitr cutover --yes",
            "rebase cloud db pitr discard"
        ],
        notes: [
            "`restore` does not touch the live database — `cutover` is the step that does. `--yes`, the global flag listed below, skips the confirmation on both.",
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
            "Register a custom domain on this project, beside any it already has, and print the DNS records to publish. "
            + "Registering is not verifying — run `domains verify <domain>` once the records are live.",
        flags: [],
        examples: ["rebase cloud domains add app.example.com"],
        notes: [
            "At a zone apex use the A record this prints, not a CNAME: a CNAME is invalid at an apex.",
            "Verification is a separate command because DNS propagation is not instant."
        ]
    },

    "domains primary": {
        command: "cloud domains primary",
        usage: "cloud domains primary <domain>",
        summary:
            "Make one of the project's verified domains its canonical host: the address links are built from, and the "
            + "one `domains redirect` sends the others to. The project keeps serving its other domains as themselves "
            + "unless each is told to redirect.",
        flags: [],
        examples: ["rebase cloud domains primary app.example.com"],
        notes: [
            "Only a verified domain can be primary: run `domains verify <domain>` first.",
            "Refused with not_served by a control plane that keeps a single domain per project."
        ]
    },

    "domains redirect": {
        command: "cloud domains redirect",
        usage: "cloud domains redirect <domain> [--off]",
        summary:
            "Answer one of the project's domains with a permanent redirect (308) to the primary domain, keeping the path "
            + "and the query, instead of serving the project on it. Use it for `www.` beside an apex: two hosts serving "
            + "one site are two origins, and Google sign-in, cookies and passkeys each work on one and fail on the other.",
        flags: [["--off", "Serve the domain again instead of redirecting it"]],
        examples: [
            "rebase cloud domains primary example.com",
            "rebase cloud domains redirect www.example.com",
            "rebase cloud domains redirect www.example.com --off"
        ],
        notes: [
            "Off by default, per domain: a project serving an `api.` host beside its site keeps both.",
            "In effect while the domain is verified and another domain is primary; until then it is stored and says so.",
            "Never applies to the primary itself, to the project's <slug>.rebase.website host, or to a domain an app is "
            + "served on (an app `path` with a hostname in rebase.json)."
        ]
    },

    "domains remove": {
        command: "cloud domains remove",
        usage: "cloud domains remove <domain>",
        summary:
            "Stop serving one custom domain. The project keeps its other domains and its <slug>.rebase.website host. "
            + "The domain may be left out when the project has only one. Aliases: `rm`, `delete`.",
        flags: [],
        examples: ["rebase cloud domains remove app.example.com"]
    },

    "env set": {
        command: "cloud env set",
        usage: "cloud env set KEY=VALUE | KEY VALUE | KEY --stdin | KEY --prompt [--secret] [--force] [--preview]",
        summary:
            "Set one environment variable on the project. Takes effect on the next deploy — "
            + "a running instance does not pick it up.",
        flags: [
            ["--secret", "Store it encrypted and never return it in a listing"],
            ["--force", "Set a build-time key (VITE_*, NEXT_PUBLIC_*, …) anyway, for a build that reads it at run time"],
            ["--stdin", "Read the value from standard input, so it never appears in `ps` or your shell history. Give only KEY"],
            ["--prompt", "Type the value at a hidden prompt on this terminal (nothing is echoed). Give only KEY. Stored as a secret"],
            ["--preview", "Set it for the project's previews only; production keeps its value"]
        ],
        examples: [
            "rebase cloud env set STRIPE_KEY=sk_live_… --secret",
            "rebase cloud env set STRIPE_KEY=sk_test_… --secret --preview",
            "rebase cloud env set LOG_LEVEL debug",
            "rebase cloud env set FEATURE_X= "
        ],
        notes: [
            "A value starting with `-` must use the KEY=VALUE form; the KEY VALUE form refuses it.",
            "`printf %s \"$STRIPE_KEY\" | rebase cloud env set STRIPE_KEY --stdin --secret` sets a value without putting it on the command line.",
            "`rebase cloud env set STRIPE_KEY --prompt` asks for it instead: an agent can hand you the command, and the value never reaches the chat. "
                + "Without a terminal it refuses and points at --stdin.",
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
        usage: "cloud storage create [<bucket>]",
        summary:
            "Create a Rebase Storage bucket: S3-compatible object storage on the platform, billed per GB-month over "
            + "the included allowance. Prints the endpoint and the next step, a key to reach the bucket. "
            + "Without a bucket name, the older platform-managed provisioning for the app runs instead, with a "
            + "deprecation notice.",
        flags: [],
        examples: [
            "rebase cloud storage create shop-assets",
            "rebase cloud storage create shop-assets --json"
        ],
        notes: [
            "Bucket names are global across Rebase Storage, like S3's: a name somebody else has answers `conflict`.",
            "Then: `rebase cloud storage keys create --bucket <bucket>` for credentials.",
            "Deprecated form: with no name it provisions platform-managed storage, writes its credentials onto the "
                + "project and needs a redeploy. Create a bucket and a key instead."
        ]
    },

    "storage delete": {
        command: "cloud storage delete",
        usage: "cloud storage delete <bucket> [--yes]",
        summary:
            "Delete a Rebase Storage bucket and every file in it. Confirms first; off a terminal it needs --yes.",
        flags: [],
        examples: ["rebase cloud storage delete old-assets --yes"],
        notes: ["Its files are deleted within the hour; support can restore them for 30 days."]
    },

    "storage keys": {
        command: "cloud storage keys",
        usage: "cloud storage keys [list|create|rotate|revoke]",
        summary:
            "The project's Rebase Storage access keys: their access key id, permission, the bucket each is "
            + "scoped to and when it was last used. Never the secrets, which are shown once, on create and rotate.",
        flags: [],
        examples: [
            "rebase cloud storage keys",
            "rebase cloud storage keys create --read-only --bucket shop-assets",
            "rebase cloud storage keys rotate ci-uploader --yes",
            "rebase cloud storage keys revoke ci-uploader --yes"
        ]
    },

    "storage keys create": {
        command: "cloud storage keys create",
        usage: "cloud storage keys create [--name <name>] [--read-only] [--bucket <bucket>]",
        summary:
            "Issue an S3 access key for Rebase Storage. The secret is printed ONCE, with the lines to paste into "
            + "a .env (S3_ENDPOINT, S3_REGION, S3_BUCKET when scoped, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, "
            + "S3_FORCE_PATH_STYLE) and an aws-cli line to try it.",
        flags: [
            ["--name <name>", "What to call it. Default: key-<date>"],
            ["--read-only", "Read, never write. Default: read-write"],
            ["--bucket <bucket>", "Only this bucket. Default: every bucket in the project"]
        ],
        examples: [
            "rebase cloud storage keys create --name app --bucket shop-assets",
            "rebase cloud storage keys create --read-only --json"
        ],
        notes: [
            "Requires org admin. The secret cannot be displayed again: lost, it is rotated.",
            "In --json the secret is in `secretAccessKey`, and the .env lines in `env`."
        ]
    },

    "storage keys rotate": {
        command: "cloud storage keys rotate",
        usage: "cloud storage keys rotate <key> [--yes]",
        summary:
            "Replace a key's secret. The old one stops working at once, so confirms first; the new one is printed "
            + "once, with the .env lines.",
        flags: [],
        examples: ["rebase cloud storage keys rotate app --yes"],
        notes: ["<key> is the key's name or id, as `rebase cloud storage keys` lists them."]
    },

    "storage keys revoke": {
        command: "cloud storage keys revoke",
        usage: "cloud storage keys revoke <key> [--yes]",
        summary: "Revoke a key: anything using it loses access at once. Confirms first.",
        flags: [],
        examples: ["rebase cloud storage keys revoke ci-uploader --yes"]
    },

    "storage usage": {
        command: "cloud storage usage",
        usage: "cloud storage usage",
        summary:
            "What the project stores against its cap, as a percentage, when it was last measured, the included "
            + "allowance, what a month costs at current usage and at the cap, and this month's egress, which is "
            + "not billed within fair use.",
        flags: [],
        examples: ["rebase cloud storage usage", "rebase cloud storage usage --json"],
        notes: [
            "Between measurements the figure is an estimate from uploads and deletes.",
            "Only current versions are billed; deleted files are kept for recovery and not charged."
        ]
    },

    "storage limit": {
        command: "cloud storage limit",
        usage: "cloud storage limit [<GB>]",
        summary:
            "Show the storage cap, or set it. The cap bounds the bill: the most a month can cost is shown "
            + "with it. Uploads past the cap are refused.",
        flags: [],
        examples: ["rebase cloud storage limit", "rebase cloud storage limit 50"],
        notes: ["Requires org admin. A cap below what is already stored is accepted, with a warning."]
    },

    "storage cors": {
        command: "cloud storage cors",
        usage: "cloud storage cors <bucket> [--allow-origin <origin>]... [--allow-method <m>]... [--file <rules.json>] [--clear]",
        summary:
            "Show a bucket's CORS rules, or replace them: from flags (one rule), from a JSON file (any number), "
            + "or with none. Browsers need a rule to upload to or read from a bucket directly.",
        flags: [
            ["--allow-origin <origin>", "An origin the rule allows. Repeatable"],
            ["--allow-method <method>", "GET, HEAD, PUT, POST or DELETE. Repeatable. Default: GET and HEAD"],
            ["--allow-header <header>", "A request header the rule allows. Repeatable"],
            ["--file <rules.json>", "A list of rules, or { \"rules\": [...] }, in the wire's shape"],
            ["--clear", "Remove every rule"]
        ],
        examples: [
            "rebase cloud storage cors shop-assets",
            "rebase cloud storage cors shop-assets --allow-origin https://shop.example --allow-method GET --allow-method PUT",
            "rebase cloud storage cors shop-assets --file cors.json",
            "rebase cloud storage cors shop-assets --clear"
        ],
        notes: [
            "Each form replaces the bucket's whole rule set.",
            "A rule in the file: { \"allowedOrigins\": [...], \"allowedMethods\": [...], \"allowedHeaders\"?: [...], "
                + "\"exposeHeaders\"?: [...], \"maxAgeSeconds\"?: 3600 }."
        ]
    },

    "storage import": {
        command: "cloud storage import",
        usage:
            "cloud storage import --from s3://<bucket>[/<prefix>] --region <region> --access-key-id <id> --to <bucket> "
            + "[--endpoint <url>] [--secret-access-key <secret|->] [--switch-app] [--wait]",
        summary:
            "Copy a bucket from another S3-compatible provider into a Rebase Storage bucket. The platform runs "
            + "the copy, so the terminal can close; --wait follows it, and --status reads one already started. "
            + "With --switch-app the app is pointed at the copy once it is verified.",
        flags: [
            ["--from s3://<bucket>[/<prefix>]", "The source bucket, and optionally a prefix in it"],
            ["--to <bucket>", "The Rebase Storage bucket to copy into"],
            ["--region <region>", "The source's region (`auto` for R2)"],
            ["--endpoint <url>", "The source's S3 endpoint. Omit for AWS S3"],
            ["--access-key-id <id>", "A key that can list and read the source"],
            ["--secret-access-key <secret|->", "Its secret; `-` reads it from stdin. Default: REBASE_IMPORT_SECRET_ACCESS_KEY, or a prompt"],
            ["--switch-app", "Point the app at the copy when it is verified"],
            ["--from-app-storage", "Copy the app's current bucket with the key the platform already holds (no --from or credentials)"],
            ["--from-import <importId>", "Copy again from an earlier import's source, with the key it was given: what reached the old bucket after a switch"],
            ["--wait", "Follow the import to the end, printing progress"],
            ["--status <importId>", "Read an import already started (with --wait, follow it)"]
        ],
        examples: [
            "rebase cloud storage import --from s3://old-assets --region eu-west-1 --access-key-id AKIA… --to shop-assets --wait",
            "rebase cloud storage import --from s3://media/uploads --endpoint https://<account>.r2.cloudflarestorage.com "
                + "--region auto --access-key-id … --secret-access-key - --to shop-media --switch-app",
            "rebase cloud storage import --status imp_123 --wait"
        ],
        notes: [
            "The source secret is never printed, and a secret on the command line lands in shell history: prefer "
                + "the variable or `-`.",
            "Off a terminal with no secret given, it refuses rather than prompt.",
            "A failed import exits 1 with code `import_failed`; nothing is switched over."
        ]
    },

    "storage attach": {
        command: "cloud storage attach",
        usage:
            "cloud storage attach --bucket <name> --access-key-id <id> --secret-access-key <secret> "
            + "[--endpoint <url>] [--region <region>] [--force-path-style] [--source <key>]",
        summary:
            "Point the project at storage you already own — S3, R2, MinIO, any S3-compatible bucket. "
            + "The alternative to `storage create`, for a bucket the platform does not manage.",
        flags: [
            ["--bucket <name>", "The bucket name. Required"],
            ["--access-key-id <id>", "Required"],
            ["--secret-access-key <secret>", "Required. Stored encrypted and never returned"],
            ["--endpoint <url>", "For anything that is not AWS S3 — R2, MinIO, Backblaze"],
            ["--region <region>", "Bucket region. Default: the provider's own default"],
            ["--force-path-style", "Address as endpoint/bucket rather than bucket.endpoint. Needed by MinIO"],
            ["--source <key>", "Which declared bucket to configure. Default: the project's default bucket"]
        ],
        examples: [
            "rebase cloud storage attach --bucket assets --access-key-id … --secret-access-key …",
            "rebase cloud storage attach --source media --bucket media-eu --access-key-id … --secret-access-key …",
            "rebase cloud storage attach --bucket assets --access-key-id … --secret-access-key … \\\n"
                + "    --endpoint https://<account>.r2.cloudflarestorage.com --region auto"
        ],
        notes: [
            "All three of --bucket, --access-key-id and --secret-access-key, or none: a bucket with no "
                + "credentials reads as configured and fails on the first upload.",
            "Redeploy for the tenant to pick the credentials up."
        ]
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
        usage: "cloud webhooks",
        summary:
            "Retired: it never delivered anything, and every action now exits 1 with code `command_retired`. "
            + "A project's events (deploy failed, backups, billing, usage) go to Slack, Discord or any URL with "
            + "`rebase cloud notifications`; a POST when rows of your app's own tables change is a WebhookDispatcher "
            + "in your app's code.",
        flags: [],
        examples: ["rebase cloud notifications add https://hooks.slack.com/services/…"]
    },

    notifications: {
        command: "cloud notifications",
        usage: "cloud notifications [list|add|test|remove] [options]",
        summary:
            "Where the linked project's events are POSTed: a Slack or Discord incoming webhook, or any https URL. "
            + "`list` (the default) shows each destination, masked, with the outcome of its last delivery; any "
            + "member of the organization may read it. `add`, `test` and `remove` take the owner or admin role. "
            + "Which emails you get is set in the console, under Account → Notifications. A token manages them with "
            + "the `notifications` capability on the organization (`rebase cloud tokens create --can notifications`).",
        flags: [],
        examples: [
            "rebase cloud notifications",
            "rebase cloud notifications add https://hooks.slack.com/services/T000/B000/XXXX",
            "rebase cloud notifications test 6f1c…",
            "rebase cloud notifications remove 6f1c… --yes"
        ]
    },

    "notifications add": {
        command: "cloud notifications add",
        usage: "cloud notifications add <url> [--events <list>] [--format json|slack] [--name <name>]",
        summary:
            "Send the project's events to a URL. The control plane refuses a URL that is not https, or that "
            + "resolves to a private, loopback, link-local or metadata address, now and at every delivery. "
            + "Prints the signing secret once.",
        flags: [
            ["--events <list>", "Comma-separated: deploy.failed, deploy.succeeded, deploy.rolled_back, backup.unhealthy, billing.payment_failed, usage.threshold, preview.paused. Default: deploy.failed"],
            ["--format <json|slack>", "json (default): the event's facts plus a `text` line Slack reads as-is. slack: `{ text }` only"],
            ["--name <name>", "What it is called in listings"]
        ],
        examples: [
            "rebase cloud notifications add https://hooks.slack.com/services/T000/B000/XXXX",
            "rebase cloud notifications add https://discord.com/api/webhooks/1/abc/slack --events deploy.failed,backup.unhealthy",
            "rebase cloud notifications add https://ops.example.com/rebase --events deploy.failed,deploy.succeeded --name pager"
        ],
        notes: [
            "The URL is a positional argument: `--url` names the control plane in every cloud command.",
            "Each POST carries `X-Webhook-Signature: sha256=<hex HMAC-SHA256 of the raw body>` with the secret, "
                + "`X-Webhook-Event`, and an `X-Webhook-Delivery` id that is the same on every retry of one delivery.",
            "Discord takes Slack's format at its webhook URL with `/slack` appended."
        ]
    },

    "notifications test": {
        command: "cloud notifications test",
        usage: "cloud notifications test <id>",
        summary:
            "POST a `notification.test` event now and report what the receiver answered. Exits 1, code "
            + "`delivery_failed`, when it was not delivered.",
        flags: [],
        examples: ["rebase cloud notifications test 6f1c…"]
    },

    "notifications remove": {
        command: "cloud notifications remove",
        usage: "cloud notifications remove <id> [--yes]",
        summary: "Stop sending events to a destination. Adding it again mints a new signing secret.",
        flags: [],
        examples: ["rebase cloud notifications remove 6f1c… --yes"]
    },

    billing: {
        command: "cloud billing",
        usage: "cloud billing [setup|checkout|invoices|upcoming|email] [<address>]",
        summary:
            "The selected organization's billing. Bare, it prints the billing account, the card on "
            + "file and what the linked project costs per month; `setup` attaches a card (one-time, "
            + "opens a browser); `checkout` opens a Stripe session for one project; `invoices` lists "
            + "the issued invoices with Stripe's hosted page for each; `upcoming` previews the next "
            + "invoice of every subscription; `email <address>` sets where Stripe sends the invoices. "
            + "Organization-scoped, not project-scoped.",
        flags: [
            ["--limit <n>", "`invoices` only: how many to list, newest first. Default 24, at most 100"]
        ],
        examples: [
            "rebase cloud billing",
            "rebase cloud billing setup",
            "rebase cloud billing checkout --project shop",
            "rebase cloud billing invoices --json",
            "rebase cloud billing upcoming",
            "rebase cloud billing email billing@example.com"
        ],
        notes: [
            "`setup` comes before the first deploy: without a card the control plane answers 402, and `deploy` refuses before it builds.",
            "`email` changes the billing account and the Stripe customer together; owners and admins of the organization.",
            "A control plane that does not serve invoices, or the preview of the next one, refuses `invoices` or `upcoming` with not_served.",
            "A token reaches billing with the `billing` capability on the organization (`rebase cloud tokens create --can billing --org <id>`). "
            + "A token made before that capability existed still works for one release, and each answer warns that it will stop."
        ]
    },

    "app-key": {
        command: "cloud app-key",
        usage: "cloud app-key [rotate]",
        summary:
            "The key `rebase cloud init --claim` minted on the project's app and wrote into .env as REBASE_API_TOKEN. "
            + "Claiming the project hands it over: it stops expiring. Without an action, lists the app's agent keys "
            + "(never their value). `rotate` mints a new key, revokes every earlier agent key at once, and writes the "
            + "new one into a .env that already sets REBASE_API_TOKEN, or prints it once. Owners and admins, signed in.",
        flags: [],
        examples: [
            "rebase cloud app-key",
            "rebase cloud app-key rotate",
            "rebase cloud app-key rotate --yes --json"
        ],
        notes: [
            "Anything still using the old key (a hosted frontend, CI) is refused until it is given the new one.",
            "Keys made in the app's own admin panel are not touched.",
            "It runs with your login: no access-token capability grants it, so REBASE_TOKEN is refused."
        ]
    },
    "service-key": {
        command: "cloud service-key",
        usage: "cloud service-key [rotate] [--preview <name>]",
        summary:
            "The project's REBASE_SERVICE_KEY, admin on the app's own API. Without an action, prints its generation, "
            + "when it was last rotated and whether the app is still restarting onto the newest one (never the key: "
            + "that is `rebase cloud env reveal REBASE_SERVICE_KEY`). `rotate` issues a new key and restarts the app "
            + "onto it; the old key works until the restart has finished and nothing after. Refused while a deploy is "
            + "running. Owners and admins, signed in. With `--preview <name>`, the same for one backend preview's own "
            + "key: without an action it prints that key, and `rotate` restarts only the preview's pod.",
        flags: [
            ["--preview <name>", "A backend preview's own key instead of production's: printed, or with `rotate` replaced"]
        ],
        examples: [
            "rebase cloud service-key",
            "rebase cloud service-key rotate",
            "rebase cloud service-key rotate --yes --json",
            "rebase cloud service-key --preview new-quiz",
            "rebase cloud service-key rotate --preview new-quiz --yes"
        ],
        notes: [
            "Anything that copied the old key (a script, a CI job) is refused once the restart has finished.",
            "Claiming a project rotates its service key too.",
            "It runs with your login: no access-token capability grants it, so REBASE_TOKEN is refused.",
            "A backend preview's key is its own: minted at its first deploy, kept across redeploys, and production's key "
                + "answers 401 there. `--preview` asks what `env reveal` asks — the owner or admin role, and a token "
                + "with the env capability on a claimed project — and never touches production's key or pod."
        ]
    },
    guests: {
        command: "cloud guests",
        usage: "cloud guests [delete|prune] [<id>] [--older-than <age>] [--limit <n>]",
        summary:
            "The guest users anonymous sign-in left behind on the project. Without an action, counts them and lists "
            + "the ones last seen longest ago. `delete` removes one. `prune` removes the ones not seen for an age: "
            + "a dry run that prints how many would go, deleting only with --yes. Only guests can go: an account, "
            + "or a guest that has become one, is refused by the app itself. Owners and admins, on a project whose Studio "
            + "access is on: the request goes through the console's Studio proxy, which holds the app's key so this machine never does. "
            + "`rebase users guests --project <slug>` is the same command in the project family.",
        flags: [
            ["--older-than <age>", "With `prune`, or to count the list: not seen for this long, as 30d, 12h, 2w or 45m"],
            ["--limit <n>", "How many the list shows. Default: 25"]
        ],
        examples: [
            "rebase cloud guests",
            "rebase cloud guests --older-than 30d --json",
            "rebase cloud guests delete 3f0c9a7e-1f3b-4c55-9d1e-7a2f4d6b8c10 --yes",
            "rebase cloud guests prune --older-than 30d",
            "rebase cloud guests prune --older-than 30d --yes --json"
        ],
        notes: [
            "Last seen is when the guest's session was last issued or refreshed, so a guest who keeps coming back is not old.",
            "A row of the project's own that references a guest follows its foreign key: `ON DELETE CASCADE` deletes "
            + "it, `SET NULL` empties it, and a required link (`RESTRICT`) keeps both the row and the guest, reported as skipped. "
            + "A column without a foreign key keeps the id it holds.",
            "It reads REBASE_SERVICE_KEY the way `cloud env reveal` does, for this command only. A project on an older "
            + "runtime is told it needs a newer one."
        ]
    },
    usage: {
        command: "cloud usage",
        usage: "cloud usage [org] [--month YYYY-MM]",
        summary:
            "Requests the linked project has used this month (UTC) against its included allowance, the 5xx errors, "
            + "the overage so far and where the month is heading at this pace. `org` lists every project of the "
            + "selected organization with the organization's total. The overage is counted exactly as the invoice "
            + "counts it; the month-end figure is an estimate. Read-only; any member of the organization.",
        flags: [
            ["--month <YYYY-MM>", "A past month instead of the current one"]
        ],
        examples: [
            "rebase cloud usage",
            "rebase cloud usage --month 2026-09 --json",
            "rebase cloud usage org"
        ],
        notes: [
            "The figures carry their limits as `caveats`: object storage is not measured yet, a project that can run "
            + "two or more app pods undercounts requests, and days with missed samples are partial.",
            "A month's overage is billed on the following month's invoice.",
            "A token reads it with the `logs` capability on the project (`rebase cloud tokens create --can logs`); "
            + "`usage org` lists the projects the token holds it on."
        ]
    },

    activity: {
        command: "cloud activity",
        usage: "cloud activity [--project <id|slug>] [--action <area|action>] [--actor <email>] [--limit <n>]",
        summary:
            "The selected organization's audit log, newest first: who deployed, rolled back, set or deleted an "
            + "environment variable (by name, never by value), added or removed a domain, created, restored or "
            + "downloaded a backup, changed compute, stopped or deleted a project, added a member or changed a role, "
            + "and created or revoked an access token. Owners and admins of the organization.",
        flags: [
            ["--action <area|action>", "An area (deploy, deploy_hook, env, domain, backup, pitr, database, extension, storage, project, org, member, token) or a full action such as env.set"],
            ["--actor <email>", "Only what this person did, their tokens included"],
            ["--limit <n>", "Events per page, 1 to 100 (default 50)"],
            ["--before <cursor>", "The next page: the cursor the previous page printed"],
            ["--org <id>", "Another organization than the selected one"]
        ],
        examples: [
            "rebase cloud activity",
            "rebase cloud activity --action env --json",
            "rebase cloud activity --project shop --actor ana@example.com"
        ],
        notes: [
            "--project narrows to one project's events; a deleted project's id still works.",
            "Times are UTC. A project that was deleted still shows by the name it had.",
            "A token reads it only with the `audit` capability on the organization "
            + "(`rebase cloud tokens create --can audit --org <id>`), and only while you are its owner or admin.",
            "The same log is the Activity page in the console."
        ]
    },

    /* ── The graph, and the dials ───────────────────────────────────────
     *
     * `resources` is what the project declares against what the platform
     * holds; `compute` is CPU, memory, replicas and what they cost. They were
     * one word once, which is how `rebase cloud resources` came to mean the
     * dials and `rebase resources` the graph — the same word for two things,
     * one letter of context apart.
     *
     * `compute` is two pages rather than one, because they answer different
     * questions: bare is "what does this project have, and what does it cost",
     * `set` is "what may I change it to". The prices are not repeated here —
     * the control plane quotes them and both pages say so, which is the only
     * version of this that cannot go stale. */

    resources: {
        command: "cloud resources",
        usage: "cloud resources [list|prune] [options]",
        summary:
            "Each database and bucket this project's deploys recorded: whether the last deploy's "
            + "code still declares it, and whether the platform made it. A deploy never removes a "
            + "provisioned database when its declaration goes — that would be data deleted by a "
            + "push — so it keeps, binds and bills it until `prune` names it.",
        flags: [],
        examples: [
            "rebase cloud resources",
            "rebase cloud resources --json",
            "rebase cloud resources prune database analytics"
        ],
        notes: [
            "`rebase resources` reads the code; this reads the platform. The two disagreeing is the point of the page.",
            "For CPU, memory, replicas and cost, that is `rebase cloud compute`."
        ]
    },

    compute: {
        command: "cloud compute",
        usage: "cloud compute [set|apply|window] [options]",
        summary:
            "What this project reserves, and what the control plane would invoice for it. Bare, it "
            + "prints every dial and an itemised €/month; `set` changes one. An empty dial means the "
            + "platform default, which moves when the default moves — a dial pinned to the same "
            + "number does not.",
        flags: [],
        examples: [
            "rebase cloud compute",
            "rebase cloud compute --json",
            "rebase cloud compute set --help",
            "rebase cloud compute apply",
            "rebase cloud compute window --day sun --hour 3"
        ],
        notes: [
            "The price is the control plane's own quote for these dials, itemised line by line — not a tier, and not a number this CLI computes.",
            "`Database change` is a size change that was confirmed and is not running yet: its restart is under way, or it failed and `rebase cloud compute apply` tries again. The project is billed at the size the database runs until the new one is running.",
            "A control plane without maintenance windows leaves those lines out and says so; `notServed` in the JSON lists what it left out."
        ]
    },

    "compute apply": {
        command: "cloud compute apply",
        usage: "cloud compute apply [--yes]",
        summary:
            "Apply again a database size change that was confirmed and has not finished: one whose restart failed "
            + "or never started. It sends the consent alone (`acknowledgeDatabaseRestart`), and the control plane "
            + "applies the size the dials already ask for. The database restarts (about a minute, 3 minutes at worst, "
            + "and the app answers with an error until it is back), then the app.",
        flags: [],
        examples: ["rebase cloud compute apply", "rebase cloud compute apply --yes --json"],
        notes: [
            "Asks before restarting anything; `--yes` skips the question, and is required off a terminal.",
            "Needs the organization's owner or admin role.",
            "Nothing waiting is not an error: it says so and exits 0.",
            "`rebase cloud compute` shows when the database runs at its new size."
        ]
    },

    "compute window": {
        command: "cloud compute window",
        usage: "cloud compute window [--day <day> --hour <0-23>]",
        summary:
            "The weekly hour in which changes that restart the database are applied, in UTC. Bare, it prints "
            + "the window and what is waiting for it; with both flags it moves the window, and anything waiting moves with it.",
        flags: [
            ["--day <day>", "sun, mon, … sat, or 0 (Sunday) to 6"],
            ["--hour <0-23>", "The hour it opens, in UTC"]
        ],
        examples: ["rebase cloud compute window", "rebase cloud compute window --day sat --hour 2"],
        notes: [
            "The default is Sunday at 03:00 UTC. You are emailed 24 hours before anything is applied in it.",
            "A control plane without maintenance windows answers `not_served`: there, a database change applies when you confirm it on `rebase cloud compute set`."
        ]
    },

    events: {
        command: "cloud events",
        usage: "cloud events [--limit <n>]",
        summary:
            "What happened to this project's backend, newest first: the app scaling, database changes scheduled and "
            + "applied, a standby taking over, the disk growing. Problems are alerts; this is the record.",
        flags: [["--limit <n>", "How many, 1–200. Default: 20"]],
        examples: ["rebase cloud events", "rebase cloud events --limit 100 --json"],
        notes: ["Lines that were also emailed to the organization say so."]
    },

    "compute set": {
        command: "cloud compute set",
        usage: "cloud compute set [--cpu <n>] [--memory <size>] [--replicas <n>] [...]",
        summary:
            "Change one or more of a project's dials. At least one is required: a patch with nothing "
            + "in it is a typo, and reporting success for a change nobody made is worse than refusing.",
        flags: [
            ["--cpu <n>", "App CPU request per instance, e.g. 500m or 2. The default, and how far it bursts, depend on the region: see the notes"],
            ["--memory <size>", "App memory request per instance, e.g. 512Mi or 2Gi. The default, and how far it stretches, depend on the region: see the notes"],
            ["--replicas <n>", "Instances that always exist — the autoscaler's floor, and what is billed at rest"],
            ["--spot <true|false>", "Preemptible capacity: cheaper, and restarted without notice"],
            ["--db-instances <n>", "1–3. 1 is a single instance with no failover; 2 adds an automatic standby"],
            ["--db-cpu <n>", "Database CPU request per instance. Default: 160m"],
            ["--db-memory <size>", "Database memory request per instance. Default: 1Gi"],
            ["--storage <mode>", "Object storage: shared-prefix or dedicated-bucket"],
            ["--autoscale-max <n>", "1–16. The ceiling the app may reach, and the worst case it may be billed"],
            ["--autoscale-cpu-target <pct>", "10–95. CPU utilisation the autoscaler holds, against the request. Default: 70"],
            ["--no-autoscale", "Turn autoscaling off. The only way to: a ceiling at or below --replicas is refused"],
            ["--db-autoscale-max-cpu <n>", "Let the database grow its CPU on its own under sustained load, up to this, e.g. 2. Unset: off"],
            ["--db-autoscale-max-memory <size>", "Let it grow its memory under load or connection pressure, up to this, e.g. 8Gi. Unset: off"],
            ["--no-db-autoscale", "Turn database autoscaling off"]
        ],
        examples: [
            "rebase cloud compute set --cpu 500m --memory 2Gi",
            "rebase cloud compute set --replicas 2 --autoscale-max 6 --yes",
            "rebase cloud compute set --db-instances 2 --db-memory 4Gi",
            "rebase cloud compute set --db-autoscale-max-cpu 2 --db-autoscale-max-memory 8Gi"
        ],
        notes: [
            "Run `rebase cloud compute` first — it prints the current dials and the €/month this project is quoted.",
            "It asks before changing anything, with the €/month the control plane quotes for the new dials beside what it quotes now. "
                + "`--yes`, the global flag listed below, skips the question, and is required off a terminal.",
            "Applied immediately: the app rolls its pods and the subscription is prorated from today. A database change applies now; billed at the current size until it is running.",
            "A new database CPU or memory, or fewer database instances, restarts the database (about a minute, 3 minutes at worst; the app answers with an error until it is back). "
                + "The question says so, and a yes is sent as `acknowledgeDatabaseRestart` on the same change; off a terminal `--yes` is that consent. "
                + "Without it the control plane saves nothing (409 `database_restart_unconfirmed`).",
            "On Belgium (europe-west1) the default reserves 100m CPU and 384Mi and can burst to 2 CPU and 2 GiB; in Falkenstein and Helsinki memory may stretch to 1.4× the request and CPU to 10× (at most 1.7 vCPU). `rebase cloud compute` shows your project's numbers.",
            "The valid ranges are the target cluster's, not this CLI's — GKE Autopilot bills a 250m/512Mi floor and rewrites a memory:CPU ratio outside 1:1–6.5:1, a Hetzner node has neither constraint. The control plane refuses what it cannot honour and names the field."
        ]
    },

    /* ── Sleep when idle ─────────────────────────────────────────────────
     *
     * Two columns of the project row (`sleepWhenIdle`, `sleepAfterMinutes`)
     * and the control plane's `sleep` function for waking and credits. */

    sleep: {
        command: "cloud sleep",
        usage: "cloud sleep [status|on|off|wake] [options]",
        summary:
            "Put the project to sleep after a period with no requests, and wake it on the next one. Asleep, it holds "
            + "no CPU or memory; its database, backups and files are kept. Bare, or `status`, it says whether sleep is on, "
            + "after how long, and whether the project sleeps now.",
        flags: [],
        examples: [
            "rebase cloud sleep",
            "rebase cloud sleep on --after 1h",
            "rebase cloud sleep off",
            "rebase cloud sleep wake",
            "rebase cloud sleep status --json"
        ],
        notes: [
            "While asleep, scheduled jobs and background work do not run, uptime monitors see 503, and the first request wakes it (up to about a minute).",
            "Where a project cannot sleep (no backend, reserved capacity, a customer cluster, its own database, or a region without it) the control plane refuses and says why; the sentence is printed as it came."
        ]
    },

    "sleep status": {
        command: "cloud sleep status",
        usage: "cloud sleep status",
        summary: "Whether sleep when idle is on, after how long, whether the project sleeps now and since when, and its last request.",
        flags: [],
        examples: ["rebase cloud sleep status", "rebase cloud sleep status --json"]
    },

    "sleep on": {
        command: "cloud sleep on",
        usage: "cloud sleep on [--after 15m|30m|1h|4h]",
        summary: "Turn sleep when idle on. Without `--after`, the project keeps the period it has (30 minutes when none was set).",
        flags: [["--after <period>", "How long without requests before it sleeps: 15m, 30m, 1h or 4h"]],
        examples: ["rebase cloud sleep on", "rebase cloud sleep on --after 4h --json"],
        notes: ["The control plane refuses it where the project cannot sleep, and says why."]
    },

    "sleep off": {
        command: "cloud sleep off",
        usage: "cloud sleep off",
        summary: "Turn sleep when idle off. A project asleep now stays asleep until its next request or `rebase cloud sleep wake`.",
        flags: [],
        examples: ["rebase cloud sleep off"]
    },

    "sleep wake": {
        command: "cloud sleep wake",
        usage: "cloud sleep wake",
        summary: "Wake a sleeping project now, instead of on its next request. The database starts first, then the app; it serves again in about a minute.",
        flags: [],
        examples: ["rebase cloud sleep wake", "rebase cloud sleep wake --json"],
        notes: ["A project its owner stopped is not woken: start it with `rebase cloud start`."]
    },

    /* ── Session, link, and the operations with no flags of their own ────
     *
     * Every one of these fell through to the index page, which lists groups
     * and not one flag — so `login --password`, `link`'s positional URL and
     * the `-y` that `stop` requires had no discoverable spelling. They take
     * few options, and that is exactly what a reader needs told. */

    login: {
        command: "cloud login",
        usage: "cloud login [--web] [--no-browser] | [--email <address>] [--password <password> | --code]",
        summary:
            "Sign in to the control plane and write the session to ~/.rebase/credentials.json. "
            + "With no flags, signs in through the browser: prints a link and a short code, opens the browser, "
            + "and waits while you approve the sign-in in the console, where you are signed in already or sign in "
            + "with any method it offers (password, Google, GitHub, LinkedIn). Nothing is typed into the terminal.",
        flags: [
            ["--web", "Sign in through the browser. The default when the control plane offers it and no --email, --password or --code is given"],
            ["--no-browser", "Print the link instead of opening the browser, for a terminal on another machine (over SSH)"],
            ["--email, -e <address>", "Sign in with this account's email instead of the browser: its password, or an emailed code. Or REBASE_CLOUD_EMAIL with REBASE_CLOUD_PASSWORD"],
            ["--password <password>", "Discouraged: a password written here is recorded in your shell history and visible in the process table. Prefer the prompt, or REBASE_CLOUD_PASSWORD"],
            ["--code", "Sign in with a 6-digit code emailed to you instead of a password: the way in for accounts made with Google, GitHub or LinkedIn. Needs a terminal"]
        ],
        examples: [
            "rebase cloud login",
            "rebase cloud login --no-browser",
            "rebase cloud login --email me@example.com",
            "rebase cloud login --code --email me@example.com",
            "rebase cloud login --url https://cloud.example.com"
        ],
        notes: [
            "Check that the code the browser shows is the one the terminal printed before you approve: approving gives this terminal a session for the account signed in to that browser.",
            "The link expires after 10 minutes and works once. Denying it in the browser ends the login here.",
            "Without a terminal, or with --json, the link and code are printed on stderr and login keeps waiting for the approval, so an agent or script can hand the link to a person.",
            "With two-factor authentication on, approve from a console session that used it. With --email, login asks for the code from your authenticator app (or a recovery code) instead.",
            "A control plane that does not offer browser sign-in gets the email prompts, as before: at a terminal with no password given, login asks whether to use your password or an emailed code, when the control plane sends codes.",
            "Without a terminal, an email code or a second factor cannot be typed: create an access token in the console (Settings → Access tokens) and set REBASE_TOKEN instead.",
            "--password warns, once, before the request: by the time a login succeeds the password is already in the history file.",
            "CI should not log in at all: `rebase cloud tokens create` mints a token for REBASE_TOKEN. Where a login is "
                + "still wanted, REBASE_CLOUD_EMAIL and REBASE_CLOUD_PASSWORD are how a secret store hands the "
                + "credentials over without them appearing on a command line.",
            "In a directory whose .rebase/cloud.json names a control plane you have not signed in to before, login "
                + "names it and asks first, and refuses without a terminal: a cloned repository does not choose where "
                + "your password goes. Pass --url <that host> to sign in there on purpose."
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
        summary:
            "Who this session is, which control plane it is against, and what this directory is linked to. "
            + "With REBASE_TOKEN set, what the token may do instead.",
        flags: [],
        examples: ["rebase cloud whoami", "rebase cloud whoami --json"]
    },

    "access-token": {
        command: "cloud access-token",
        usage: "cloud access-token",
        summary:
            "Print the bearer this CLI would send right now — REBASE_TOKEN, a linked project's claim token, "
            + "or the login, refreshed first when it is close to expiry. Bare on stdout, so "
            + "`$(rebase cloud access-token)` works; `--json` adds the host and when it expires.",
        flags: [],
        examples: ["rebase cloud access-token", "rebase cloud access-token --json"],
        notes: [
            "It is a credential: whoever holds it acts as you until it expires (about an hour for a login).",
            "The Rebase MCP server uses it to read any of your projects' data through the console's Studio proxy."
        ]
    },

    tokens: {
        command: "cloud tokens",
        usage: "cloud tokens <list|create|revoke> [options]",
        summary:
            "API tokens for CI and agents. A token acts as your account, narrowed to what it was created "
            + "for on one project; with REBASE_TOKEN set, every `rebase cloud` command uses it instead of "
            + "your login. `list` is the default.",
        flags: [],
        examples: [
            "rebase cloud tokens",
            "rebase cloud tokens create --project shop --can deploy,logs",
            "rebase cloud tokens revoke 3f2a9c1e --yes"
        ],
        notes: [
            "Managing tokens takes your `rebase cloud login` session: a token cannot list, create or revoke tokens."
        ]
    },

    "tokens list": {
        command: "cloud tokens list",
        usage: "cloud tokens list",
        summary: "Your tokens: what each may do and on which project, when it expires, and when it was last used.",
        flags: [],
        examples: ["rebase cloud tokens list", "rebase cloud tokens list --json"]
    },

    "tokens create": {
        command: "cloud tokens create",
        usage: "cloud tokens create --can <capabilities> [--project <slug>] [--org <id>] [--name <name>] [--expires-in <days>]",
        summary:
            "Create a token for one project — the linked one unless --project names another — holding only "
            + "the capabilities --can names. `billing`, `audit` and `notifications` act on an organization instead: "
            + "--org, else the project's own, else the selected one; a token may hold only those. The token is "
            + "printed once, as the `export REBASE_TOKEN=…` line to hand to CI.",
        flags: [
            ["--can <capabilities>", `Comma-separated or repeated: ${[...TOKEN_CAPABILITY_NAMES, ...ORG_CAPABILITY_NAMES].join(", ")}`],
            ["--org <id>", "The organization billing, audit and notifications are for"],
            ["--name <name>", "What to call it. Defaults to the project and its capabilities"],
            ["--expires-in <days>", "Days until it stops working. Default: it does not expire"]
        ],
        examples: [
            "rebase cloud tokens create --can deploy",
            "rebase cloud tokens create --project shop --can deploy,logs --name \"GitHub Actions\" --expires-in 90",
            "rebase cloud tokens create --project shop --can env,database",
            "rebase cloud tokens create --can billing,audit --org 3f2a9c1e --name invoices"
        ],
        notes: [
            ...TOKEN_CAPABILITY_NAMES.map(name => `${name}: ${TOKEN_CAPABILITIES[name].label}.`),
            ...ORG_CAPABILITY_NAMES.map(name => `${name}: ${ORG_CAPABILITIES[name].label}.`),
            "A token never holds more than your account does when it is used, and cannot create tokens."
        ]
    },

    "tokens revoke": {
        command: "cloud tokens revoke",
        usage: "cloud tokens revoke <id> [--yes]",
        summary: "Revoke a token. Anything still using it is refused from then on.",
        flags: [],
        examples: ["rebase cloud tokens revoke 3f2a9c1e", "rebase cloud tokens revoke 3f2a9c1e --yes"]
    },

    link: {
        command: "cloud link",
        usage: "cloud link [<slug> | <url>] [--project <slug>]",
        summary:
            "Bind this directory to a backend, by writing .rebase/cloud.json. With a cloud project "
            + "(picked interactively, or named as the argument or with --project) the rest of the family needs no flags. "
            + "With a positional URL it links straight at a running Rebase API — no control plane, no "
            + "login — which is what makes the multi-repo workflow available to self-hosters.",
        flags: [],
        examples: [
            "rebase cloud link",
            "rebase cloud link shop",
            "rebase cloud link --project shop",
            "rebase cloud link https://api.example.com"
        ],
        notes: [
            "A positional URL is verified before it is written: an address that does not answer is still linked, but you are told.",
            "A direct link is one backend, not a control plane. The rest of the `cloud` family refuses in a directory linked that way — unlink first, or pass `--project` — so that `login` can never send your control-plane password to the linked host.",
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
            + "Named, it is set; omitted, you pick from the ones this account belongs to. With none selected, those "
            + "commands act on the linked project's organization, and say so.",
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

    connect: {
        command: "cloud connect",
        usage: "cloud connect <url> [--name <name>] [--org <id>] [--no-wait] | --list | --remove <url-or-id>",
        summary:
            "Add a self-hosted Rebase instance to your Rebase account, so the Rebase connector in Claude "
            + "(https://app.rebase.pro/mcp) reaches it as it reaches your Cloud projects. Prints the two variables "
            + "the instance needs, offers to write them into ./.env, then waits for the instance to accept the "
            + "connector once you restart it. Run it once per instance; rerunning it is safe and checks the connection.",
        flags: [
            ["--name <name>", "What to call the instance. Default: its hostname"],
            ["--org <id>", "The organization it belongs to. Default: the active one (`rebase cloud use`)"],
            ["--no-wait", "Print the variables and return, without waiting for the instance to accept the connector"],
            ["--list", "List the self-hosted instances in your account"],
            ["--remove <url-or-id>", "Remove one from your account. Confirms first unless --yes"]
        ],
        examples: [
            "rebase cloud connect your-app.com",
            "rebase cloud connect https://api.example.com --name \"Shop (EU)\" --org 3f2a9c1e",
            "rebase cloud connect your-app.com --no-wait --json",
            "rebase cloud connect --list",
            "rebase cloud connect --remove your-app.com --yes"
        ],
        notes: [
            "An address without a scheme is https; only the origin is kept, so a path or query is dropped.",
            "The two variables are REBASE_PLATFORM_TOKEN_KEY and REBASE_PLATFORM_TOKEN_AUDIENCE: what the instance "
                + "needs to accept the connector's short-lived tokens.",
            "Adding an instance takes an owner or admin of the organization.",
            "With --json it prints what the control plane answered and one check of the connection, and never prompts or waits.",
            "Not `rebase cloud link`, which binds a directory to a project."
        ]
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
            "A static app deployed on its own (`rebase cloud deploy <app>`) records no bundle, so its "
                + "deployments are not rollbackable yet: deploy its last good version again. Static apps "
                + "folded into the backend's bundle (a plain `rebase cloud deploy`) roll back with it.",
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

    cron: {
        command: "cloud cron",
        usage: "cloud cron [list|logs] [options]",
        summary:
            "The deployed app's cron jobs and their recorded runs, read from the app itself with your "
            + "`rebase cloud` login. Read-only: the login is exchanged for a token that reads cron and "
            + "nothing else, is bound to this project and expires within minutes. `list` is the default.",
        flags: [],
        examples: [
            "rebase cloud cron",
            "rebase cloud cron logs nightly-digest",
            "rebase cloud cron logs nightly-digest --limit 5 --json"
        ],
        notes: [
            "To change, disable or trigger a job, use the app's own admin panel.",
            "`rebase cloud debug logs` shows what jobs printed to the pod's output; this shows every recorded run."
        ]
    },

    "cron list": {
        command: "cloud cron list",
        usage: "cloud cron list [--host <hostname>]",
        summary:
            "Every job the app schedules: its schedule, its state, when it last ran and how long it took, "
            + "when it runs next, and the last error of a job that failed.",
        flags: [["--host <hostname>", "Read this address instead of the project's own"]],
        examples: ["rebase cloud cron list", "rebase cloud cron list --json"]
    },

    "cron logs": {
        command: "cloud cron logs",
        usage: "cloud cron logs <job> [--limit <n>] [--host <hostname>]",
        summary:
            "One job's recorded runs, newest first: when each started, how long it took, whether it failed "
            + "and why, and every line it logged with `ctx.log`.",
        flags: [
            ["--limit <n>", "How many runs. Default: 50"],
            ["--host <hostname>", "Read this address instead of the project's own"]
        ],
        examples: ["rebase cloud cron logs nightly-digest", "rebase cloud cron logs nightly-digest --limit 5 --json"]
    },

    metrics: {
        command: "cloud metrics",
        usage: "cloud metrics [--runtime | --history [--series <name>] [--minutes <n>]]",
        summary:
            "Live CPU, memory and disk for the project's running units, and each instance's realtime counts, as the control "
            + "plane reports them. --runtime is what the app itself counted: requests, the 5xx error rate, mean latency, "
            + "per surface. --history is one series the runtime recorded over a window.",
        flags: [
            ["--runtime", "Requests, errors, error rate and mean latency, from the app's own counters"],
            ["--history", "A recorded series over a window instead of the live figures"],
            ["--series <name>", "With --history: cpu_millicores (default), memory_bytes, event_loop_delay_ms, or requests_<surface> / errors_<surface> for data, auth, storage, functions, app"],
            ["--minutes <n>", "With --history: how far back, 1 to 20160 (fourteen days). Default: 60"]
        ],
        examples: [
            "rebase cloud metrics",
            "rebase cloud metrics --runtime",
            "rebase cloud metrics --history --series memory_bytes --minutes 1440 --json"
        ],
        notes: [
            "--runtime counts from when the running instance started, so a restart begins again at zero. "
                + "\"No data yet\" means the app is not deployed, still starting, or not reporting metrics, never an idle app.",
            "--history exits 1, with the reason, when the history cannot be read: a runtime that keeps none, one too old to, or one not answering (`retryable`)."
        ]
    },

    "deploy-hooks": {
        command: "cloud deploy-hooks",
        usage: "cloud deploy-hooks [list|create|revoke] [options]",
        summary:
            "URLs that build and ship the project's connected repository when something POSTs to them: a git host's "
            + "webhook, a CMS's publish button, a CI step. `list` (the default) shows each hook's name, branch and when it "
            + "was last used, never its URL.",
        flags: [
            ["--name <name>", "create: what to call it. Default: Deploy hook"],
            ["--branch <branch>", "create: the branch it builds. Default: the project's configured branch"]
        ],
        examples: [
            "rebase cloud deploy-hooks",
            "rebase cloud deploy-hooks create --name github --branch main",
            "rebase cloud deploy-hooks revoke 7 --yes"
        ],
        notes: [
            "The URL is printed once, at `create`: it is the credential, and the control plane keeps only its hash.",
            "A GitHub or GitLab push to another branch, a tag, or any other event is acknowledged and ignored.",
            "Creating and revoking take the owner or admin role; any member may list. A project holds at most 20."
        ]
    },

    "deploy-hooks create": {
        command: "cloud deploy-hooks create",
        usage: "cloud deploy-hooks create [--name <name>] [--branch <branch>]",
        summary: "Mint a deploy hook and print its URL, once. POSTing to the URL builds and ships the connected repository.",
        flags: [
            ["--name <name>", "What to call it. Default: Deploy hook"],
            ["--branch <branch>", "The branch it builds. Default: the project's configured branch"]
        ],
        examples: ["rebase cloud deploy-hooks create --name github --branch main --json"],
        notes: ["`url` and `token` in the JSON are the only copy: store them where the caller of the hook reads secrets."]
    },

    "deploy-hooks revoke": {
        command: "cloud deploy-hooks revoke",
        usage: "cloud deploy-hooks revoke <id> [--yes]",
        summary: "Delete a deploy hook: anything POSTing to its URL is refused from then on. Asks first.",
        flags: [],
        examples: ["rebase cloud deploy-hooks revoke 7 --yes"]
    },

    alerts: {
        command: "cloud alerts",
        usage: "cloud alerts [list|ack|snooze] [<incidentId>] [options]",
        summary:
            "What the platform has seen go wrong with the project — a disk filling, an app restarting, a deploy failing — "
            + "newest first. `list` (the default) shows the open ones; `ack` stops the reminders for everyone; `snooze` "
            + "stops the emails for a while.",
        flags: [
            ["--all", "list: the resolved ones as well as the open ones"],
            ["--hours <1-168>", "snooze: how long. Required"]
        ],
        examples: [
            "rebase cloud alerts",
            "rebase cloud alerts list --all --json",
            "rebase cloud alerts ack 6f1c2a0e-…",
            "rebase cloud alerts snooze 6f1c2a0e-… --hours 24"
        ],
        notes: [
            "Any member of the organization may read, acknowledge and snooze. Only an open alert can be acknowledged or snoozed.",
            "An organization-wide problem (a failed payment) belongs to no project, and is not listed here; the console shows it.",
            "You still hear about an acknowledged or snoozed alert if it gets worse or is resolved."
        ]
    },

    "alerts ack": {
        command: "cloud alerts ack",
        usage: "cloud alerts ack <incidentId>",
        summary: "Acknowledge an open alert: reminders stop for everyone in the organization.",
        flags: [],
        examples: ["rebase cloud alerts ack 6f1c2a0e-…"]
    },

    "alerts snooze": {
        command: "cloud alerts snooze",
        usage: "cloud alerts snooze <incidentId> --hours <1-168>",
        summary: "Snooze an open alert: nobody in the organization is emailed about it until the time is up, unless it is resolved.",
        flags: [["--hours <1-168>", "How long, in hours. Required; at most a week"]],
        examples: ["rebase cloud alerts snooze 6f1c2a0e-… --hours 24"]
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
