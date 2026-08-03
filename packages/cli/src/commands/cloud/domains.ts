/**
 * `rebase cloud domains` — a project's custom domain.
 *
 *   domains list             Current domain + the DNS records it needs
 *   domains add <domain>     Register a domain (starts, does not finish, setup)
 *   domains verify           Check the published DNS now; live only if it passes
 *   domains remove           Detach the custom domain
 *
 * The DNS record set comes from the server (`verify-domain`), never composed
 * here: whether to publish an A or a CNAME depends on apex-vs-subdomain and on
 * the ingress address behind the tenant host, which the CLI cannot know. Adding
 * a domain only registers it — it is unverified until the records are published
 * and `verify` passes.
 */
import arg from "arg";
import chalk from "chalk";
import {
    requireClient,
    requireProject,
    displayProjectRef,
    cloudPositionals,
    emit,
    confirmDestructive,
    keyValues,
    success,
    fail,
    reportError,
    type CloudClient
} from "./context";

interface DomainRecord {
    type: "A" | "CNAME" | "TXT";
    name: string;
    values: string[];
}

interface DomainSetup {
    domain: string | null;
    status: "none" | "pending" | "verified";
    isApex?: boolean;
    tenantHost?: string;
    verifiedAt?: string | null;
    instructions?: {
        pointing?: DomainRecord;
        ownership: DomainRecord;
    };
}

interface DomainCheck {
    ok: boolean;
    expected: string[];
    observed: string[];
    error?: string;
}

interface VerifyResult extends DomainSetup {
    verified: boolean;
    checks: { ownership: DomainCheck; pointing: DomainCheck };
}

async function fetchDomainSetup(client: CloudClient, projectId: string): Promise<DomainSetup> {
    return client.functions.invoke<DomainSetup>("verify-domain", undefined, { method: "GET",
path: projectId });
}

function printRecords(setup: DomainSetup): void {
    const recs = [setup.instructions?.pointing, setup.instructions?.ownership].filter(Boolean) as DomainRecord[];
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
            await verifyDomains(rawArgs);
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
            fail(`Unknown domains command: ${action}`, "Try `rebase cloud domains --help`.");
    }
}

async function listDomains(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const setup = await fetchDomainSetup(client, projectId);
        emit(
            () => {
                console.log("");
                console.log(chalk.bold(`  🌐 Custom domain — project ${projectRef}`));
                console.log("");
                if (!setup.domain) {
                    console.log(chalk.gray("  No custom domain. Add one with `rebase cloud domains add <domain>`."));
                    console.log("");
                    return;
                }
                keyValues([
                    ["Domain", setup.domain],
                    ["Status", setup.status === "verified" ? chalk.green(setup.status) : chalk.yellow(setup.status)],
                    ["Apex", setup.isApex === undefined ? undefined : setup.isApex ? "yes" : "no"],
                    ["Tenant host", setup.tenantHost],
                    ["Verified at", setup.verifiedAt ?? undefined]
                ]);
                console.log("");
                if (setup.status !== "verified") printRecords(setup);
            },
            { projectId,
...setup }
        );
    } catch (e) {
        reportError(e, "Failed to load custom domain");
    }
}

async function addDomain(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    const domain = cloudPositionals(rawArgs).slice(2)[0];
    if (!domain) fail("Usage: rebase cloud domains add <domain>", undefined, "usage");

    try {
        // Registering the domain is a project update; the DNS records to publish
        // then come from the server's setup endpoint.
        await client.data.collection("projects").update(projectId, { customDomain: domain });
        const setup = await fetchDomainSetup(client, projectId);
        emit(
            () => {
                success(`Registered ${chalk.bold(domain!)} — not yet verified`);
                printRecords(setup);
                console.log(chalk.gray("  Publish the records above, then run `rebase cloud domains verify`."));
                console.log("");
            },
            { success: true,
projectId,
...setup }
        );
    } catch (e) {
        reportError(e, "Failed to register domain");
    }
}

async function verifyDomains(rawArgs: string[]): Promise<void> {
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);
    try {
        const res = await client.functions.invoke<VerifyResult>("verify-domain", {}, { path: projectId });
        emit(
            () => {
                console.log("");
                if (res.verified) success(`${res.domain} is verified and live`);
                else {
                    console.log(chalk.yellow(`  ⚠ ${res.domain ?? "domain"} is not verified yet`));
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
                    printRecords(res);
                }
            },
            { projectId,
verified: res.verified,
status: res.status,
domain: res.domain,
checks: res.checks,
instructions: res.instructions }
        );
        if (!res.verified) process.exit(1);
    } catch (e) {
        reportError(e, "Failed to verify domain");
    }
}

async function removeDomain(rawArgs: string[]): Promise<void> {
    const args = arg({ "--yes": Boolean,
"-y": "--yes",
"--project": String,
"-p": "--project" }, { argv: rawArgs.slice(2),
permissive: true });
    const { client } = await requireClient(rawArgs);
    const projectId = await requireProject(rawArgs, client);
    const projectRef = displayProjectRef(rawArgs);

    await confirmDestructive({
        yes: Boolean(args["--yes"]),
        prompt: `Remove the custom domain from project ${projectRef}?`
    });

    try {
        await client.data.collection("projects").update(projectId, { customDomain: "" });
        emit(
            () => success(`Removed the custom domain from project ${projectRef}`),
            { success: true,
projectId }
        );
    } catch (e) {
        reportError(e, "Failed to remove domain");
    }
}

function printDomainsHelp(): void {
    console.log(`
${chalk.bold("rebase cloud domains")} — Custom domain

${chalk.green.bold("Commands")}
  ${chalk.blue.bold("list")}                      Show the domain + DNS records
  ${chalk.blue.bold("add")} ${chalk.gray("<domain>")}              Register a custom domain
  ${chalk.blue.bold("verify")}                    Check DNS and go live
  ${chalk.blue.bold("remove")} ${chalk.gray("[-y]")}               Detach the custom domain

${chalk.green.bold("Options")}
  ${chalk.blue("--json")}                    Machine-readable output
  ${chalk.blue("--project, -p")}             Project slug ${chalk.gray("(defaults to the linked project)")}
`);
}
