/**
 * `rebase cloud domains` — the hostnames a project is served on.
 *
 *   domains list               Every host, its status, and the DNS records it needs
 *   domains add <domain>       Register a host (starts, does not finish, setup)
 *   domains verify [domain]    Check the host's published DNS now; live only if it passes
 *   domains primary <domain>   Make a verified host the canonical one
 *   domains redirect <domain>  Answer a host with a 308 to the primary (`--off` serves it again)
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
 * passes. Adding one the project already has (a deploy registers the hosts
 * `rebase.json` names) answers with that host's records and state.
 *
 * Verified is not yet served over HTTPS: the certificate is issued after
 * verification, and the rows say nothing about it. `list`, `verify` and an
 * `add` of a known host ask the host itself — see `certificate.ts`.
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
import { checkCertificates, verifiedLabel, type CertificateCheck } from "./certificate";

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
    /** Answered with a 308 to the primary instead of served. */
    redirectToPrimary?: boolean;
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
    redirectToPrimary?: boolean;
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
        ...(row.redirectToPrimary === true ? { redirectToPrimary: true } : {}),
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

/** The certificate state of each verified host; a pending one is not on the Ingress, so it is not asked. */
async function certificatesOf(domains: readonly DomainEntry[]): Promise<Map<string, CertificateCheck>> {
    return checkCertificates(domains.filter(d => d.status === "verified").map(d => d.host));
}

/** A host's state as a person reads it: `pending`, `verified`, or `verified, certificate pending`. */
function stateText(d: DomainEntry, certificate: CertificateCheck | undefined): string {
    if (d.status !== "verified") return chalk.yellow(d.status);
    const label = verifiedLabel(certificate);
    return certificate && certificate.state !== "ready" ? chalk.yellow(label) : chalk.green(label);
}

/** The line under a verified host whose HTTPS is not ready, saying why. */
function printCertificateNote(certificate: CertificateCheck | undefined): void {
    if (!certificate || certificate.state === "ready") return;
    console.log(chalk.gray(`    HTTPS: ${certificate.reason ?? "not ready"}. Browsers refuse the site until it is; check again in a few minutes.`));
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
        case "primary":
            await primaryDomain(rawArgs);
            break;
        case "redirect":
            await redirectDomain(rawArgs);
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
        const certificates = await certificatesOf(set.domains);
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
                    const certificate = certificates.get(d.host);
                    const role = d.primary && set.domains.length > 1
                        ? chalk.gray("  primary")
                        : d.redirectToPrimary ? chalk.gray("  redirects to the primary") : "";
                    console.log(`  ${chalk.bold(d.host)}  ${stateText(d, certificate)}${role}`);
                    if (d.verifiedAt) console.log(chalk.gray(`    verified ${d.verifiedAt}`));
                    printCertificateNote(certificate);
                    if (d.status !== "verified") printRecords(d.instructions);
                }
                console.log("");
            },
            { projectId,
tenantHost: set.tenantHost ?? null,
domains: set.domains.map(d => withCertificate(d, certificates)) }
        );
    } catch (e) {
        reportError(e, "Failed to load custom domains");
    }
}

/**
 * A host as `--json` reports it: the row, and `certificate` — what its HTTPS
 * answered (`ready`, `pending`, `unreachable`), or null for a host not verified,
 * which is not served and was not asked.
 */
function withCertificate(d: DomainEntry, certificates: Map<string, CertificateCheck>): DomainEntry & { certificate: CertificateCheck | null } {
    return { ...d, certificate: d.status === "verified" ? certificates.get(d.host) ?? null : null };
}

/** One custom domain as `cloud status` reports it. */
export interface DomainStatus {
    host: string;
    status: "pending" | "verified";
    primary: boolean;
    /** What its HTTPS answered; null for a host not verified, which was not asked. */
    certificate: CertificateCheck | null;
}

/**
 * Every custom domain of a project with its certificate state, for `cloud
 * status`; undefined when they could not be read — status says nothing then
 * rather than "none".
 */
export async function projectDomainStates(client: CloudClient, projectId: string): Promise<DomainStatus[] | undefined> {
    let set: DomainSet;
    try {
        set = await loadDomains(client, projectId);
    } catch {
        return undefined;
    }
    const certificates = await certificatesOf(set.domains);
    return set.domains.map(d => ({
        host: d.host,
        status: d.status,
        primary: d.primary,
        certificate: d.status === "verified" ? certificates.get(d.host) ?? null : null
    }));
}

/** One domain in a sentence: `shop.example.com (verified, certificate pending)`. */
export function describeDomainStatus(d: DomainStatus): string {
    const state = d.status === "verified" ? verifiedLabel(d.certificate ?? undefined) : "pending DNS verification";
    return `${d.host} (${state})`;
}

/** Whether a failed `domains` add is the control plane saying the host is already on this project. */
function alreadyOnProject(e: unknown): boolean {
    return typeof e === "object" && e !== null && "status" in e && e.status === 409;
}

/** The entry for `host` in a set, as `add` compares hosts: case and a trailing dot aside. */
function findHost(set: DomainSet, host: string): DomainEntry | undefined {
    const wanted = host.trim().toLowerCase().replace(/\.$/, "");
    // The column's domain held beside host rows is NOT on the list: adding it
    // is how it joins the rows, which is what the warning below recommends.
    return set.domains.find(d => d.host.toLowerCase() === wanted && (set.model === "column" || d.id !== null));
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
    // Already on the project — typically registered by a deploy, from a host
    // `rebase.json` names. Not an error and not silence: the same answer a
    // fresh add gives, records and state, flagged.
    let alreadyRegistered = false;
    try {
        const set = await loadDomains(client, projectId);
        const existing = findHost(set, domain);
        if (existing) {
            added = existing;
            alreadyRegistered = true;
        } else if (set.model === "column") {
            // No `domains` function: the column is the project's one domain.
            await client.data.table("projects").update(projectId, { customDomain: domain });
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
            try {
                added = rowEntry(await client.functions.invoke<DomainRow>("domains", { host: domain }, { path: projectId })) ?? undefined;
            } catch (e) {
                // Registered between the read above and this write — a deploy
                // in flight registers its hosts. The row is what to report.
                if (!alreadyOnProject(e)) throw e;
                added = findHost(await loadDomains(client, projectId), domain);
                if (!added) throw e;
                alreadyRegistered = true;
            }
        }
    } catch (e) {
        reportError(e, "Failed to register domain");
    }
    if (!added) fail(`The control plane did not return ${domain}, so whether it was registered is unknown.`, "Run `rebase cloud domains list`.");
    const registered = added;
    const certificate = registered.status === "verified"
        ? (await certificatesOf([registered])).get(registered.host)
        : undefined;
    emit(
        () => {
            if (!alreadyRegistered) success(`Registered ${chalk.bold(registered.host)} — not yet verified`);
            else if (registered.status === "verified") {
                success(`${chalk.bold(registered.host)} is already on this project — ${verifiedLabel(certificate)}`);
            } else success(`${chalk.bold(registered.host)} is already on this project — not yet verified`);
            if (registered.status === "verified") {
                printCertificateNote(certificate);
                console.log("");
                return;
            }
            printRecords(registered.instructions);
            console.log(chalk.gray(`  Publish the records above, then run \`rebase cloud domains verify ${registered.host}\`.`));
            console.log("");
        },
        { success: true,
projectId,
...registered,
certificate: certificate ?? null,
alreadyRegistered }
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
        // Verified is the DNS; live is HTTPS answering with a real certificate,
        // which is issued only after verification and takes minutes.
        const certificate = res.verified ? (await certificatesOf([res.entry])).get(res.entry.host) : undefined;
        emit(
            () => {
                console.log("");
                if (res.verified && (!certificate || certificate.state === "ready")) success(`${target.host} is verified and live`);
                else if (res.verified) {
                    success(`${target.host} is ${verifiedLabel(certificate)} — not live until HTTPS works`);
                    printCertificateNote(certificate);
                } else {
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
certificate: certificate ?? null,
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

/**
 * Make one verified host the project's canonical one: the address links and
 * redirects are built from. The control plane keeps one primary per project and
 * mirrors it into the project's single domain column.
 */
async function primaryDomain(rawArgs: string[]): Promise<void> {
    const named = resolveDomainArg(rawArgs, "primary");
    if (!named) fail("Usage: rebase cloud domains primary <domain>", "Name one of the project's verified domains.", "usage");
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    let set: DomainSet;
    try {
        set = await loadDomains(client, projectId);
    } catch (e) {
        reportError(e, "Failed to load custom domains");
    }
    if (set.model === "column") {
        fail(
            "This control plane serves one custom domain per project, so there is no primary to choose.",
            "`rebase cloud domains list` shows the one it serves.",
            "not_served"
        );
    }
    const target = pickDomain(set, named, "primary");
    if (target.id === null) {
        fail(
            `${target.host} is held outside this project's host list, so it cannot be made primary.`,
            `Add it to the list first: \`rebase cloud domains add ${target.host}\`, then \`rebase cloud domains verify ${target.host}\`.`,
            "usage"
        );
    }
    // The control plane refuses this too (an unverified primary would become
    // the address every link is built from); said here with the remedy.
    if (target.status !== "verified") {
        fail(
            `${target.host} is not verified yet, so it cannot be the primary host.`,
            `Verify it first: \`rebase cloud domains verify ${target.host}\`.`,
            "domain_not_verified"
        );
    }

    let res: DomainRow & { unchanged?: boolean };
    try {
        res = await client.functions.invoke<DomainRow & { unchanged?: boolean }>("domains", {}, { path: `${projectId}/${target.id}/primary` });
    } catch (e) {
        reportError(e, "Failed to set the primary domain");
    }
    const unchanged = res.unchanged === true;
    emit(
        () => success(unchanged
            ? `${target.host} already is the primary host of project ${projectRef}`
            : `${target.host} is now the primary host of project ${projectRef}`),
        { success: true, projectId, id: target.id, host: target.host, primary: true, changed: !unchanged }
    );
}

/**
 * Answer one host with a permanent redirect (308) to the primary, path and
 * query kept, instead of serving the project on it — or, with `--off`, serve it
 * again.
 *
 * Per host and off by default, because a project may serve distinct hosts on
 * purpose (an `api.` host beside the site). What it is for is the other case:
 * `www.example.com` and `example.com` serving one site are two origins to a
 * browser, and whatever is keyed on the origin — Google sign-in's authorised
 * origins first — works on one and fails on the other.
 */
async function redirectDomain(rawArgs: string[]): Promise<void> {
    const { flags, positionals } = parseCloudArgs({
        spec: { "--off": Boolean },
        rawArgs,
        commandWords: 3, // cloud domains redirect
        command: "cloud domains redirect",
        maxPositionals: 1
    });
    const named = positionals[0];
    const on = flags["--off"] !== true;
    if (!named) {
        fail(
            "Usage: rebase cloud domains redirect <domain> [--off]",
            "Name the host to send to the primary, e.g. `rebase cloud domains redirect www.example.com`.",
            "usage"
        );
    }
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    let set: DomainSet;
    try {
        set = await loadDomains(client, projectId);
    } catch (e) {
        reportError(e, "Failed to load custom domains");
    }
    if (set.model === "column") {
        fail(
            "This control plane serves one custom domain per project, so there is no other host to redirect.",
            "`rebase cloud domains list` shows the one it serves.",
            "not_served"
        );
    }
    const target = pickDomain(set, named, "redirect");
    if (target.id === null) {
        fail(
            `${target.host} is held outside this project's host list, so it cannot redirect.`,
            `Add it to the list first: \`rebase cloud domains add ${target.host}\`, then \`rebase cloud domains verify ${target.host}\`.`,
            "usage"
        );
    }
    if (on && target.primary) {
        const other = set.domains.find(d => !d.primary && d.status === "verified");
        fail(
            `${target.host} is the primary host: the other hosts redirect to it.`,
            other
                ? `Make another host primary first: \`rebase cloud domains primary ${other.host}\`.`
                : "Add and verify the host it should redirect to, and make that one primary.",
            "domain_is_primary"
        );
    }

    let res: DomainRow & { redirectsTo?: string | null; notInEffect?: string };
    try {
        res = await client.functions.invoke<DomainRow & { redirectsTo?: string | null; notInEffect?: string }>(
            "domains", { redirect: on }, { path: `${projectId}/${target.id}/redirect` }
        );
    } catch (e) {
        reportError(e, on ? "Failed to redirect the domain" : "Failed to stop the redirect");
    }
    const redirectsTo = res.redirectsTo ?? null;
    emit(
        () => {
            if (!on) {
                success(`${target.host} is served by project ${projectRef} again`);
            } else if (redirectsTo) {
                success(`${target.host} now redirects to https://${redirectsTo} (308, path and query kept)`);
            } else {
                success(`${target.host} will redirect to the primary host`);
                if (res.notInEffect) console.log(chalk.yellow(`  Not in effect yet: ${res.notInEffect}`));
            }
        },
        {
            success: true,
            projectId,
            id: target.id,
            host: target.host,
            redirectToPrimary: on,
            redirectsTo,
            ...(res.notInEffect ? { notInEffect: res.notInEffect } : {})
        }
    );
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
            await client.data.table("projects").update(projectId, { customDomain: "" });
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
description: "Register a host. One already on the project prints its records and state" },
            { action: "verify",
args: "[domain]",
description: "Check a host's DNS and put it live" },
            { action: "primary",
args: "<domain>",
description: "Make a verified host the canonical one, the address links are built from" },
            { action: "redirect",
args: "<domain> [--off]",
description: "Answer a host with a 308 to the primary instead of serving it" },
            { action: "remove",
args: "<domain>",
description: "Stop serving a host" }
        ],
        notes: [
            "A project can be served on several hosts; each is verified on its own, and each serves the project unless it redirects.",
            "A CNAME is invalid at a zone apex: use an A record there and a CNAME below it.",
            "`list` prints the exact records to add — copy them rather than deriving them.",
            "A verified host is served once its certificate is issued, a few minutes later: until then `list` and `verify` "
                + "say `verified, certificate pending`."
        ]
    });
}
