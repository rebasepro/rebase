/**
 * `rebase cloud domains` — the hostnames a project is served on.
 *
 *   domains list               Every host, its status, and the DNS records it needs
 *   domains add <domain>       Register a host (starts, does not finish, setup)
 *   domains verify [domain]    Check the host's published DNS now; live only if it passes
 *   domains remove <domain>    Stop serving a host
 *
 * A project's hosts are rows of the control plane's `project_domains` table,
 * managed through its `domains` function — the same one the console uses. The
 * Ingress is built from those rows, one verified host at a time, so every
 * action here addresses a row. The single `projects.customDomain` column is a
 * projection the control plane keeps in step with them; writing it directly
 * changes nothing that is served.
 *
 * Two cases still go through that column, because the control plane still
 * serves them from it: a project with no rows at all, whose one domain lives
 * only in the column, and a control plane that has no `domains` function.
 *
 * The DNS record set comes from the server, never composed here: whether to
 * publish an A or a CNAME depends on apex-vs-subdomain and on the ingress
 * address behind the tenant host, which the CLI cannot know. Adding a host only
 * registers it — it is unverified until the records are published and `verify`
 * passes.
 */
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    parseCloudArgs,
    emit,
    printGroupHelp,
    confirmDestructive,
    keyValues,
    success,
    fail,
    warn,
    reportError,
    type CloudClient
} from "./context";

interface DomainRecord {
    type: "A" | "CNAME" | "TXT";
    name: string;
    values: string[];
}

interface DomainInstructions {
    pointing?: DomainRecord;
    ownership: DomainRecord;
}

/**
 * One host, as the `domains` function describes a row.
 *
 * `id` is null for the domain a project holds only in its single column: it
 * has no row, and is verified and removed through that column instead.
 */
interface DomainEntry {
    id: string | null;
    host: string;
    primary: boolean;
    status: "pending" | "verified";
    verifiedAt: string | null;
    isApex?: boolean;
    tenantHost?: string;
    instructions?: DomainInstructions;
}

/** What `verify-domain` answers about the single column. */
interface ColumnSetup {
    domain: string | null;
    status: "none" | "pending" | "verified";
    isApex?: boolean;
    tenantHost?: string;
    verifiedAt?: string | null;
    instructions?: DomainInstructions;
}

/** A row as the `domains` function sends it. */
interface DomainRow {
    id?: string;
    host?: string;
    primary?: boolean;
    status?: string;
    verifiedAt?: string | null;
    isApex?: boolean;
    tenantHost?: string;
    instructions?: DomainInstructions;
}

interface DomainCheck {
    ok: boolean;
    expected: string[];
    observed: string[];
    error?: string;
}

interface DomainChecks {
    ownership: DomainCheck;
    pointing: DomainCheck;
}

/** What either door answers a verification with: the host as it is now, and the checks. */
interface VerifyAnswer {
    verified?: boolean;
    checks?: DomainChecks;
    status?: string;
    verifiedAt?: string | null;
    instructions?: DomainInstructions;
}

/** A project's hosts, and which door changes them. */
interface DomainSet {
    /**
     * `rows` — the `domains` function answers, and each host with an id is a row.
     * `column` — the control plane has no `domains` function; everything goes
     * through the single column.
     */
    model: "rows" | "column";
    tenantHost?: string;
    domains: DomainEntry[];
}

/** The column's one domain as an entry, or none. */
function columnEntry(setup: ColumnSetup): DomainEntry[] {
    if (!setup.domain) return [];
    return [{
        id: null,
        host: setup.domain,
        primary: true,
        status: setup.status === "verified" ? "verified" : "pending",
        verifiedAt: setup.verifiedAt ?? null,
        isApex: setup.isApex,
        tenantHost: setup.tenantHost,
        instructions: setup.instructions
    }];
}

/**
 * A row, or null for one with no id or host — it cannot be verified or removed,
 * so it is not offered as a domain. Anything but `verified` is pending: an
 * unreadable status must not read as live.
 */
function rowEntry(row: DomainRow | null | undefined): DomainEntry | null {
    if (typeof row?.id !== "string" || typeof row.host !== "string") return null;
    return {
        id: row.id,
        host: row.host,
        primary: row.primary === true,
        status: row.status === "verified" ? "verified" : "pending",
        verifiedAt: row.verifiedAt ?? null,
        isApex: row.isApex,
        tenantHost: row.tenantHost,
        instructions: row.instructions
    };
}

/**
 * Whether a failed `domains` call means the control plane has no such function
 * — as opposed to refusing this project, which the function answers `not_found`.
 */
function noDomainsFunction(e: unknown): boolean {
    if (typeof e !== "object" || e === null) return false;
    const status = "status" in e ? e.status : undefined;
    const code = "code" in e ? e.code : undefined;
    return status === 404 && code !== "not_found";
}

async function fetchColumnSetup(client: CloudClient, projectId: string): Promise<ColumnSetup> {
    return client.functions.invoke<ColumnSetup>("verify-domain", undefined, { method: "GET",
path: projectId });
}

/** Every host this project is served on, or may be once verified. */
async function loadDomains(client: CloudClient, projectId: string): Promise<DomainSet> {
    let listed: { tenantHost?: string; domains?: DomainRow[] };
    try {
        listed = await client.functions.invoke<{ tenantHost?: string; domains?: DomainRow[] }>(
            "domains",
            undefined,
            { method: "GET",
path: projectId }
        );
    } catch (e) {
        if (!noDomainsFunction(e)) throw e;
        const setup = await fetchColumnSetup(client, projectId);
        return { model: "column",
tenantHost: setup.tenantHost,
domains: columnEntry(setup) };
    }

    const domains = (listed.domains ?? []).map(rowEntry).filter((d): d is DomainEntry => d !== null);
    if (domains.length > 0) return { model: "rows",
tenantHost: listed.tenantHost,
domains };

    // No rows: the control plane serves the column's domain, if it holds one.
    const setup = await fetchColumnSetup(client, projectId);
    return { model: "rows",
tenantHost: listed.tenantHost ?? setup.tenantHost,
domains: columnEntry(setup) };
}

/**
 * The host an action names, or the only one there is to name.
 *
 * Refuses to guess among several: removing or verifying the wrong host of a
 * live site is not a mistake worth saving a word over.
 */
function pickDomain(set: DomainSet, named: string | undefined, action: string): DomainEntry {
    if (named) {
        const wanted = named.trim().toLowerCase().replace(/\.$/, "");
        const found = set.domains.find(d => d.host.toLowerCase() === wanted);
        if (!found) {
            fail(
                `This project has no domain ${named}.`,
                set.domains.length
                    ? `Its domains: ${set.domains.map(d => d.host).join(", ")}.`
                    : "It has no custom domains. Add one with `rebase cloud domains add <domain>`.",
                "not_found"
            );
        }
        return found;
    }
    if (set.domains.length === 1) return set.domains[0];
    if (set.domains.length === 0) {
        fail("This project has no custom domains.", "Add one with `rebase cloud domains add <domain>`.", "not_found");
    }
    // `verify` with no host means the one waiting to be verified, when only one is.
    const pending = set.domains.filter(d => d.status !== "verified");
    if (action === "verify" && pending.length === 1) return pending[0];
    fail(
        `This project has ${set.domains.length} domains; name the one to ${action}.`,
        `Run \`rebase cloud domains ${action} <domain>\` with one of: ${set.domains.map(d => d.host).join(", ")}.`,
        "usage"
    );
}

function printRecords(instructions: DomainInstructions | undefined): void {
    const recs = [instructions?.pointing, instructions?.ownership].filter(Boolean) as DomainRecord[];
    if (!recs.length) return;
    console.log(chalk.bold("  DNS records to publish:"));
    for (const r of recs) {
        console.log(`    ${chalk.cyan(r.type)}  ${r.name}  →  ${r.values.join(", ")}`);
    }
    console.log("");
}

export async function domainsCommand(action: string | undefined, rawArgs: string[]): Promise<void> {
    switch (action) {
        case "list":
        case "status":
        case undefined:
            await listDomains(rawArgs);
            break;
        case "add":
        case "set":
            await addDomain(rawArgs);
            break;
        case "verify":
            await verifyDomain(rawArgs);
            break;
        case "remove":
        case "rm":
        case "delete":
            await removeDomain(rawArgs);
            break;
        case "--help":
            printDomainsHelp();
            break;
        default:
            fail(`Unknown domains command: ${action}`, "Run `rebase cloud domains --help`.", "unknown_command");
    }
}

async function listDomains(rawArgs: string[]): Promise<void> {
    parseCloudArgs({ spec: {},
rawArgs,
commandWords: 3,
command: "cloud domains",
maxPositionals: 0 });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const set = await loadDomains(client, projectId);
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🌐 Custom domains — project ${projectRef}`));
                console.log("");
                if (!set.domains.length) {
                    console.log(chalk.gray("  No custom domains. Add one with `rebase cloud domains add <domain>`."));
                    console.log("");
                    return;
                }
                if (set.tenantHost) {
                    keyValues([["Tenant host", set.tenantHost]]);
                    console.log("");
                }
                for (const d of set.domains) {
                    const status = d.status === "verified" ? chalk.green(d.status) : chalk.yellow(d.status);
                    console.log(`  ${chalk.bold(d.host)}  ${status}${d.primary && set.domains.length > 1 ? chalk.gray("  primary") : ""}`);
                    if (d.verifiedAt) console.log(chalk.gray(`    verified ${d.verifiedAt}`));
                    if (d.status !== "verified") printRecords(d.instructions);
                }
                console.log("");
            },
            { projectId,
tenantHost: set.tenantHost ?? null,
domains: set.domains }
        );
    } catch (e) {
        reportError(e, "Failed to load custom domains");
    }
}

/**
 * The domain an action was given, or undefined.
 *
 * Exported so its tests drive the real parser. Under the old operand filter
 * `rebase cloud domains add -p acme` registered a domain called "acme" — the
 * project slug, read out of `--project`'s own value — and a registered domain
 * is a project-record write, not a no-op.
 */
export function resolveDomainArg(rawArgs: string[], action = "add"): string | undefined {
    return parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud domains <action>
        command: `cloud domains ${action}`,
        maxPositionals: 1
    }).positionals[0];
}

async function addDomain(rawArgs: string[]): Promise<void> {
    const domain = resolveDomainArg(rawArgs);
    if (!domain) fail("Usage: rebase cloud domains add <domain>", undefined, "usage");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);

    let added: DomainEntry | undefined;
    try {
        const set = await loadDomains(client, projectId);
        if (set.model === "column") {
            // No `domains` function: the column is the project's one domain.
            await client.data.collection("projects").update(projectId, { customDomain: domain });
            added = columnEntry(await fetchColumnSetup(client, projectId))[0];
        } else {
            const legacy = set.domains.find(d => d.id === null);
            if (legacy && legacy.host.toLowerCase() !== domain.trim().toLowerCase()) {
                // The column's domain is served only while the project has no
                // host rows; this adds the first, and once a row is verified
                // the Ingress carries the rows alone.
                warn(
                    `${legacy.host} is held outside this project's host list, and stops being served once another host is verified.`,
                    `Keep it by adding it too: \`rebase cloud domains add ${legacy.host}\`, then \`rebase cloud domains verify ${legacy.host}\`.`
                );
            }
            added = rowEntry(await client.functions.invoke<DomainRow>("domains", { host: domain }, { path: projectId })) ?? undefined;
        }
    } catch (e) {
        reportError(e, "Failed to register domain");
    }
    if (!added) fail(`The control plane did not return ${domain}, so whether it was registered is unknown.`, "Run `rebase cloud domains list`.");
    const registered = added;
    emit(
        () => {
            success(`Registered ${chalk.bold(registered.host)} — not yet verified`);
            printRecords(registered.instructions);
            console.log(chalk.gray(`  Publish the records above, then run \`rebase cloud domains verify ${registered.host}\`.`));
            console.log("");
        },
        { success: true,
projectId,
...registered }
    );
}

async function verifyDomain(rawArgs: string[]): Promise<void> {
    const named = resolveDomainArg(rawArgs, "verify");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    let set: DomainSet;
    try {
        set = await loadDomains(client, projectId);
    } catch (e) {
        reportError(e, "Failed to load custom domains");
    }
    const target = pickDomain(set, named, "verify");
    try {
        const res = verifyOutcome(
            target.id === null
                ? await client.functions.invoke<VerifyAnswer>("verify-domain", {}, { path: projectId })
                : await client.functions.invoke<VerifyAnswer>("domains", {}, { path: `${projectId}/${target.id}/verify` }),
            target
        );
        emit(
            () => {
                console.log("");
                if (res.verified) success(`${target.host} is verified and live`);
                else {
                    console.log(chalk.yellow(`  ⚠ ${target.host} is not verified yet`));
                    console.log("");
                    const rows: Array<[string, DomainCheck]> = [
                        ["Ownership", res.checks.ownership],
                        ["Pointing", res.checks.pointing]
                    ];
                    for (const [label, check] of rows) {
                        const mark = check.ok ? chalk.green("ok") : chalk.red("missing");
                        console.log(`  ${label}: ${mark}`);
                        console.log(chalk.gray(`    expected: ${check.expected.join(", ") || "—"}`));
                        console.log(chalk.gray(`    observed: ${check.observed.join(", ") || "—"}`));
                        if (check.error) console.log(chalk.gray(`    error: ${check.error}`));
                    }
                    console.log("");
                    printRecords(res.entry.instructions);
                }
            },
            { projectId,
id: res.entry.id,
host: res.entry.host,
verified: res.verified,
status: res.entry.status,
checks: res.checks,
instructions: res.entry.instructions ?? null }
        );
        if (!res.verified) process.exit(1);
    } catch (e) {
        reportError(e, "Failed to verify domain");
    }
}

/** A verify answer from either door, as one shape. */
function verifyOutcome(
    res: VerifyAnswer,
    target: DomainEntry
): { verified: boolean; checks: DomainChecks; entry: DomainEntry } {
    const verified = res.verified === true;
    const unchecked: DomainCheck = { ok: false, expected: [], observed: [] };
    return {
        verified,
        checks: res.checks ?? { ownership: unchecked, pointing: unchecked },
        entry: {
            ...target,
            status: verified || res.status === "verified" ? "verified" : "pending",
            verifiedAt: res.verifiedAt ?? target.verifiedAt,
            instructions: res.instructions ?? target.instructions
        }
    };
}

async function removeDomain(rawArgs: string[]): Promise<void> {
    // Strict: detaching a host is destructive, and the permissive parse
    // accepted `domains remove --dry-run` by ignoring the flag and detaching
    // anyway.
    const { flags: args, positionals } = parseCloudArgs({
        spec: {},
        rawArgs,
        commandWords: 3, // cloud domains remove
        command: "cloud domains remove",
        maxPositionals: 1
    });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    let set: DomainSet;
    try {
        set = await loadDomains(client, projectId);
    } catch (e) {
        reportError(e, "Failed to load custom domains");
    }
    const target = pickDomain(set, positionals[0], "remove");

    await confirmDestructive({
        yes: Boolean(args["--yes"]),
        prompt: `Stop serving ${target.host} on project ${projectRef}?`
    });

    try {
        let removed = true;
        if (target.id === null) {
            await client.data.collection("projects").update(projectId, { customDomain: "" });
        } else {
            const res = await client.functions.invoke<{ removed?: boolean }>(
                "domains",
                undefined,
                { method: "DELETE",
path: `${projectId}/${target.id}` }
            );
            // `removed: false` is the server saying it was already gone — the
            // outcome asked for, and reported as it is.
            removed = res?.removed !== false;
        }
        emit(
            () => success(removed
                ? `${target.host} is no longer served by project ${projectRef}`
                : `${target.host} was already gone from project ${projectRef}`),
            { success: true,
projectId,
host: target.host,
removed }
        );
    } catch (e) {
        reportError(e, "Failed to remove domain");
    }
}

export function printDomainsHelp(): void {
    printGroupHelp({
        command: "cloud domains",
        title: "Custom domains",
        actions: [
            { action: "list",
description: "Every host, its status, and the DNS records it needs" },
            { action: "add",
args: "<domain>",
description: "Register a host" },
            { action: "verify",
args: "[domain]",
description: "Check a host's DNS and put it live" },
            { action: "remove",
args: "<domain>",
description: "Stop serving a host" }
        ],
        notes: [
            "A project can be served on several hosts; each is verified on its own.",
            "A CNAME is invalid at a zone apex: use an A record there and a CNAME below it.",
            "`list` prints the exact records to add — copy them rather than deriving them."
        ]
    });
}
