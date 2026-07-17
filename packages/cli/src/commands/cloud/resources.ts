/**
 * `rebase cloud` resource subcommands: status, metrics, webhooks, storage,
 * clusters, billing.
 */
import arg from "arg";
import chalk from "chalk";
import {
    requireClient,
    requireProjectId,
    getContextOrg,
    readLink,
    colorStatus,
    keyValues,
    fetchTenantBaseDomain,
    projectHost,
    openUrl,
    success,
    fail,
    reportError
} from "./context";
import { firstRow, latestDeployment, fmtDate } from "./projects";

/* ─── status: quick project dashboard ──────────────────────────── */

export async function statusCommand(rawArgs: string[]): Promise<void> {
    const projectId = requireProjectId(rawArgs);
    const { client, url } = await requireClient(rawArgs);
    try {
        const project = (await client.data.collection("projects").findById(projectId)) as
            | { id: string | number; name?: string; subdomain?: string; host?: string; status?: string; gitBranch?: string }
            | undefined;
        if (!project) fail(`Project ${projectId} not found.`);

        const [db, storage, deploy, baseDomain] = await Promise.all([
            firstRow(client, "databases", projectId),
            firstRow(client, "storages", projectId),
            latestDeployment(client, projectId),
            fetchTenantBaseDomain(client, url)
        ]);

        console.log("");
        console.log(`  ${chalk.bold(project.name ?? projectId)} ${chalk.gray(`[${projectId}]`)} ${colorStatus(project.status)}`);
        console.log("");
        keyValues([
            ["URL", projectHost(project, baseDomain)],
            ["Branch", project.gitBranch],
            ["Last deploy", deploy ? `${colorStatus(deploy.status)} · ${fmtDate(deploy.createdAt)}` : "never"],
            ["Database", db ? `${db.type} (${colorStatus(db.connectionStatus as string)})` : "none"],
            ["Storage", storage ? `${storage.type} (${colorStatus(storage.status as string)})` : "none"]
        ]);
        console.log("");
    } catch (e) {
        reportError(e, "Failed to load status");
    }
}

/* ─── metrics: live compute metrics ────────────────────────────── */

export async function metricsCommand(rawArgs: string[]): Promise<void> {
    const projectId = requireProjectId(rawArgs);
    const { client } = await requireClient(rawArgs);
    try {
        const m = await client.functions.invoke<{
            status?: string;
            cpu?: string;
            memory?: string;
            memoryPercent?: string;
            disk?: string;
        }>("metrics", undefined, { method: "GET",
path: projectId });

        console.log("");
        console.log(chalk.bold(`  📊 Metrics — project ${projectId}`));
        console.log("");
        keyValues([
            ["Status", m.status ? colorStatus(m.status === "running" ? "active" : m.status) : undefined],
            ["CPU", m.cpu],
            ["Memory", m.memory ? `${m.memory}${m.memoryPercent ? ` (${m.memoryPercent})` : ""}` : undefined],
            ["Disk", m.disk]
        ]);
        console.log("");
    } catch (e) {
        reportError(e, "Failed to fetch metrics");
    }
}

/* ─── webhooks ─────────────────────────────────────────────────── */

export async function webhooksCommand(subcommand: string | undefined, rawArgs: string[]): Promise<void> {
    const projectId = requireProjectId(rawArgs);
    const { client } = await requireClient(rawArgs);

    try {
        if (subcommand === "create") {
            const args = arg(
                { "--name": String,
"--table": String,
"--url": String,
"--events": String },
                { argv: rawArgs.slice(4),
permissive: true }
            );
            const name = args["--name"] || fail("--name is required.");
            const table = args["--table"] || fail("--table is required.");
            const url = args["--url"] || fail("--url (endpoint) is required.");
            const events = (args["--events"] || "insert,update,delete").split(",").map((s) => s.trim());

            const created = (await client.data.collection("webhooks").create({
                project: projectId,
                name,
                table,
                url,
                events,
                enabled: true
            })) as unknown as { id: string | number };
            success(`Created webhook ${chalk.bold(name)} [${created.id}]`);
            return;
        }

        if (subcommand === "delete") {
            const id = rawArgs.slice(3).filter((a) => !a.startsWith("-"))[2];
            if (!id) fail("Usage: rebase cloud webhooks delete <id>");
            await client.data.collection("webhooks").delete(id);
            success(`Deleted webhook ${id}`);
            return;
        }

        // list
        const hooks = (await client.data.collection("webhooks").find({
            where: { project: ["==", projectId] },
            limit: 100
        })).data as unknown as Array<{ id: string | number; name?: string; table?: string; url?: string; enabled?: boolean; events?: string[] }>;

        console.log("");
        console.log(chalk.bold(`  🔗 Webhooks — project ${projectId}`));
        console.log("");
        if (hooks.length === 0) {
            console.log(chalk.gray("  No webhooks. Add one with `rebase cloud webhooks create`."));
            console.log("");
            return;
        }
        for (const h of hooks) {
            const state = h.enabled ? chalk.green("enabled") : chalk.gray("disabled");
            console.log(`  ${chalk.bold(h.name ?? "(unnamed)")} ${chalk.gray(`[${h.id}]`)} ${state}`);
            console.log(`    ${chalk.gray(`${h.table ?? "?"} → ${h.url ?? "?"}  (${(h.events ?? []).join(", ")})`)}`);
        }
        console.log("");
    } catch (e) {
        reportError(e, "Webhook operation failed");
    }
}

/* ─── storage ──────────────────────────────────────────────────── */

export async function storageCommand(rawArgs: string[]): Promise<void> {
    const projectId = requireProjectId(rawArgs);
    const { client } = await requireClient(rawArgs);
    try {
        const stores = (await client.data.collection("storages").find({
            where: { project: ["==", projectId] },
            limit: 50
        })).data as unknown as Array<{ id: string | number; type?: string; provider?: string; bucketName?: string; status?: string }>;

        console.log("");
        console.log(chalk.bold(`  🪣 Storage — project ${projectId}`));
        console.log("");
        if (stores.length === 0) {
            console.log(chalk.gray("  No storage buckets attached."));
            console.log("");
            return;
        }
        for (const s of stores) {
            console.log(`  ${chalk.bold(s.bucketName ?? s.type ?? "bucket")} ${chalk.gray(`[${s.id}]`)} ${colorStatus(s.status)}`);
            keyValues([["Provider", s.provider], ["Type", s.type]]);
        }
        console.log("");
    } catch (e) {
        reportError(e, "Failed to list storage");
    }
}

/* ─── clusters ─────────────────────────────────────────────────── */

export async function clustersCommand(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    try {
        const clusters = (await client.data.collection("clusters").find({ limit: 100 })).data as unknown as Array<{
            id: string | number;
            name?: string;
            provider?: string;
            region?: string;
            status?: string;
        }>;

        console.log("");
        console.log(chalk.bold("  ☸  Clusters"));
        console.log("");
        if (clusters.length === 0) {
            console.log(chalk.gray("  No clusters registered."));
            console.log("");
            return;
        }
        for (const c of clusters) {
            console.log(`  ${chalk.bold(c.name ?? "(unnamed)")} ${chalk.gray(`[${c.id}]`)} ${colorStatus(c.status)}`);
            keyValues([["Provider", c.provider], ["Region", c.region]]);
        }
        console.log("");
    } catch (e) {
        reportError(e, "Failed to list clusters");
    }
}

/* ─── billing ──────────────────────────────────────────────────── */

export async function billingCommand(rawArgs: string[]): Promise<void> {
    const { client, url } = await requireClient(rawArgs);
    const org = getContextOrg(url);

    const action = rawArgs.slice(3).filter((a) => !a.startsWith("-"))[1];

    // `rebase cloud billing setup` — attach a card to the org (one-time, opens a
    // browser). Once done, project create/deploy work headlessly (off_session).
    if (action === "setup") {
        if (!org) fail("No active organization.", "Run `rebase cloud use` first.");
        try {
            const res = await client.functions.invoke<{ url?: string; simulated?: boolean }>(
                "stripe-billing",
                { organizationId: org },
                { path: "setup-session" }
            );
            if (!res.url) fail("Could not start billing setup.");
            openUrl(res.url, "Add a payment method in your browser:");
            if (res.simulated) {
                console.log(chalk.gray("  (dev mode — Stripe not configured; complete setup from the console)"));
                console.log("");
            } else {
                console.log(chalk.gray("  Once you've added a card, `rebase cloud deploy` runs without further prompts."));
                console.log("");
            }
        } catch (e) {
            reportError(e, "Failed to start billing setup");
        }
        return;
    }

    // `rebase cloud billing checkout --project <id>` opens a Stripe session.
    if (action === "checkout") {
        const projectId = requireProjectId(rawArgs);
        try {
            const res = await client.functions.invoke<{ url?: string }>(
                "stripe-billing",
                { projectId },
                { path: "session" }
            );
            if (!res.url) fail("Billing session could not be created.");
            console.log("");
            console.log("  Complete checkout in your browser:");
            console.log(`  ${chalk.cyan(res.url)}`);
            console.log("");
        } catch (e) {
            reportError(e, "Failed to start checkout");
        }
        return;
    }

    // default: show the active org's billing account.
    if (!org) fail("No active organization.", "Run `rebase cloud use` first.");
    try {
        const orgRow = (await client.data.collection("organizations").findById(org)) as
            | { billing_account_id?: string | number; billingAccount?: string | number }
            | undefined;
        const billingId = orgRow?.billing_account_id ?? orgRow?.billingAccount;
        if (!billingId) {
            console.log("");
            console.log(chalk.gray(`  Organization ${org} has no billing account yet.`));
            console.log("");
            return;
        }
        const acct = (await client.data.collection("billing-accounts").findById(billingId)) as
            | { id: string | number; billingEmail?: string; status?: string; stripeCustomerId?: string }
            | undefined;

        // Card-on-file lives in Stripe; the control plane reports it for us.
        let card: { hasPaymentMethod?: boolean; brand?: string; last4?: string; expMonth?: number; expYear?: number } = {};
        try {
            card = await client.functions.invoke<typeof card>(
                "stripe-billing",
                undefined,
                { method: "GET",
path: `payment-method/${org}` }
            );
        } catch {
            // status endpoint optional — fall back to the local account record
        }

        // Best-effort: show which plan the linked/`--project` project is on.
        // BYO-cluster projects pay a flat platform fee; the rest pay managed compute.
        let plan: string | undefined;
        try {
            const parsed = arg({ "--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
            const projectId = parsed["--project"] || readLink()?.projectId;
            if (projectId) {
                const proj = (await client.data.collection("projects").findById(projectId)) as
                    | { cluster_id?: string | number; cluster?: unknown; provider?: string; vmSize?: string }
                    | undefined;
                const hasCluster = proj?.cluster_id != null || proj?.cluster != null;
                plan = hasCluster ? "platform fee (own cluster)" : "managed compute";

                // Best-effort: append the resolved monthly amount from Stripe (via
                // the control plane's /api/functions/pricing). Keep working if the
                // endpoint is unreachable — the label alone is still useful.
                try {
                    const pricing = await client.functions.invoke<{
                        items: Array<{ lookupKey: string; amountEur: number }>;
                    }>("pricing", undefined, { method: "GET" });
                    const key = hasCluster
                        ? "platform_byo"
                        : `compute_${proj?.provider || "hetzner"}_${proj?.vmSize || "cx21"}`;
                    const item = pricing.items?.find((i) => i.lookupKey === key);
                    if (item) plan = `${plan} — €${item.amountEur.toFixed(2)}/mo`;
                } catch {
                    // pricing endpoint unreachable — keep the plan label without an amount
                }
            }
        } catch {
            // no linked/resolvable project — skip the Plan line
        }

        console.log("");
        console.log(chalk.bold(`  💳 Billing — org ${org}`));
        console.log("");
        keyValues([
            ["Account", acct ? String(acct.id) : undefined],
            ["Email", acct?.billingEmail],
            ["Status", acct?.status ? colorStatus(acct.status) : undefined],
            ["Plan", plan],
            [
                "Payment method",
                card.hasPaymentMethod
                    ? `${card.brand ?? "card"} •••• ${card.last4 ?? "????"}${card.expMonth ? ` (exp ${card.expMonth}/${card.expYear})` : ""}`
                    : chalk.yellow("none — run `rebase cloud billing setup`")
            ]
        ]);
        console.log("");
    } catch (e) {
        reportError(e, "Failed to load billing");
    }
}
