/**
 * `rebase cloud usage [org] [--month YYYY-MM]`: what a project — or every
 * project of the selected organization — has used this month against its
 * included allowance, the overage so far, and where the month is heading.
 *
 * Reads `GET /usage/:projectId` and `GET /usage/org/:org` on the control plane,
 * the same reads as the console's usage panel. Their overage figures are the
 * overage report's own calculation, so they are what the invoice will carry;
 * the projection to the month's end is the one estimate, and says so. The
 * caveats the control plane sends (object storage not measured, multi-pod
 * projects undercounting requests, partial days) are printed with the numbers,
 * and are in `--json` unchanged. Read-only; any member of the organization.
 */
import chalk from "chalk";
import {
    displayProjectRef,
    emit,
    fail,
    getContextOrg,
    parseCloudArgs,
    reportError,
    requireClient,
    requireKnownAction,
    requireProject,
    type CloudClient
} from "./context";

export const USAGE_FLAGS = { "--month": String } as const;
export const USAGE_ACTIONS = ["org"] as const;

/** A caveat on the figures, as the control plane sends it. */
export interface CliUsageCaveat {
    code: string;
    message: string;
    count?: number;
}

/** One project's month, as `GET /usage/:projectId` answers it. */
export interface CliProjectUsage {
    projectId: string;
    month: string;
    complete: boolean;
    days: { day: string; requests: number; errors: number; missedSamples: number }[];
    totals: { requests: number; errors: number; daysRecorded: number; daysWithGaps: number };
    quotas: { requestsPerMonth: number | null };
    fraction: number;
    warn: boolean;
    overageEur: number;
    billed: boolean;
    projection: { requests: number; fraction: number; overageEur: number } | null;
    enforcement: { kind: string; message: string };
    caveats: CliUsageCaveat[];
}

export interface CliOrgUsage {
    organizationId: string;
    month: string;
    complete: boolean;
    projects: (CliProjectUsage & { name: string | null })[];
    totals: { requests: number; errors: number; overageEur: number; projectedOverageEur: number | null };
    truncated: boolean;
}

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

const count = (n: number) => new Intl.NumberFormat("en").format(Math.round(n));
const eur = (n: number) => new Intl.NumberFormat("en", { style: "currency", currency: "EUR" }).format(n);
const pct = (fraction: number) => {
    if (!(fraction > 0)) return "0%";
    const p = fraction * 100;
    return p < 1 ? "<1%" : `${Math.floor(p)}%`;
};

/** The allowance as a bar of 20 cells, coloured like the console: amber from 80%, red past it. */
export function usageBar(fraction: number): string {
    const cells = 20;
    const filled = Math.max(0, Math.min(cells, Math.round(Math.min(fraction, 1) * cells)));
    const bar = "█".repeat(filled) + "░".repeat(cells - filled);
    if (fraction > 1) return chalk.red(bar);
    if (fraction >= 0.8) return chalk.yellow(bar);
    return chalk.cyan(bar);
}

function printCaveats(caveats: CliUsageCaveat[]): void {
    if (caveats.length === 0) return;
    console.log("");
    for (const c of caveats) console.log(chalk.gray(`  · ${c.message}`));
}

function printProject(u: CliProjectUsage, label: string): void {
    console.log("");
    console.log(chalk.bold(`  📈 Usage — ${label} — ${u.month} (UTC)${u.complete ? "" : ", so far"}`));
    console.log("");
    const included = u.quotas.requestsPerMonth;
    console.log(`  Requests   ${count(u.totals.requests)}${included !== null ? ` of ${count(included)} included` : ""}`);
    if (included !== null) console.log(`             ${usageBar(u.fraction)} ${pct(u.fraction)}`);
    console.log(`  5xx errors ${count(u.totals.errors)}`);
    console.log(`  Overage    ${u.billed ? eur(u.overageEur) : chalk.gray("not charged")}`);
    if (u.projection) {
        console.log(chalk.gray(`  At this pace by month end: ${count(u.projection.requests)} requests, ${eur(u.projection.overageEur)} overage (an estimate)`));
    }
    if (u.days.length === 0) {
        console.log("");
        console.log(chalk.gray("  No usage recorded for this month."));
    }
    printCaveats(u.caveats);
    console.log("");
}

function printOrg(u: CliOrgUsage): void {
    console.log("");
    console.log(chalk.bold(`  📈 Usage — org ${u.organizationId} — ${u.month} (UTC)${u.complete ? "" : ", so far"}`));
    console.log("");
    if (u.projects.length === 0) {
        console.log(chalk.gray("  This organization has no projects."));
        console.log("");
        return;
    }
    const nameWidth = Math.max(7, ...u.projects.map((p) => (p.name ?? p.projectId).length));
    console.log(chalk.gray(`  ${"Project".padEnd(nameWidth)}  ${"Requests".padStart(12)}  ${"Allowance".padStart(9)}  ${"Overage".padStart(10)}`));
    for (const p of u.projects) {
        console.log(
            `  ${(p.name ?? p.projectId).padEnd(nameWidth)}  ${count(p.totals.requests).padStart(12)}  `
            + `${(p.quotas.requestsPerMonth !== null ? pct(p.fraction) : "—").padStart(9)}  `
            + `${(p.billed ? eur(p.overageEur) : "not charged").padStart(10)}`
        );
    }
    console.log(
        chalk.bold(`  ${"Total".padEnd(nameWidth)}  ${count(u.totals.requests).padStart(12)}  ${"".padStart(9)}  ${eur(u.totals.overageEur).padStart(10)}`)
    );
    if (u.totals.projectedOverageEur !== null) {
        console.log(chalk.gray(`  At this pace by month end: ${eur(u.totals.projectedOverageEur)} overage (an estimate)`));
    }
    if (u.truncated) console.log(chalk.gray("  Only the first 200 projects are shown."));
    // Each caveat once, as the first project carrying it phrased it.
    const seen = new Set<string>();
    const caveats: CliUsageCaveat[] = [];
    for (const p of u.projects) {
        for (const c of p.caveats) {
            if (c.code === "partial_days" || c.code === "multi_pod_undercount" || c.code === "not_billed") {
                caveats.push({ ...c, message: `${p.name ?? p.projectId}: ${c.message}` });
            } else if (!seen.has(c.code)) {
                seen.add(c.code);
                caveats.push(c);
            }
        }
    }
    printCaveats(caveats);
    console.log("");
}

async function readProjectUsage(client: CloudClient, projectId: string, month?: string): Promise<CliProjectUsage> {
    return client.functions.invoke<CliProjectUsage>("usage", undefined, {
        method: "GET",
        path: `${encodeURIComponent(projectId)}${month ? `?month=${encodeURIComponent(month)}` : ""}`
    });
}

async function readOrgUsage(client: CloudClient, org: string, month?: string): Promise<CliOrgUsage> {
    return client.functions.invoke<CliOrgUsage>("usage", undefined, {
        method: "GET",
        path: `org/${encodeURIComponent(org)}${month ? `?month=${encodeURIComponent(month)}` : ""}`
    });
}

export async function usageCommand(rawArgs: string[]): Promise<void> {
    // Refused before the client is built: an unusable line costs no login round-trip.
    const parsed = parseCloudArgs({
        spec: USAGE_FLAGS,
        rawArgs,
        commandWords: 2, // cloud usage
        command: "cloud usage",
        maxPositionals: 1
    });
    const action = parsed.positionals[0];
    requireKnownAction("usage", action, USAGE_ACTIONS);
    const month = parsed.flags["--month"];
    if (month !== undefined && !MONTH_RE.test(month)) {
        fail(`"${month}" is not a month.`, "Pass --month as YYYY-MM, e.g. --month 2026-09.", "usage");
    }

    const { client, url } = await requireClient(rawArgs);

    if (action === "org") {
        const org = getContextOrg(url);
        if (!org) fail("No active organization.", "Run `rebase cloud use` first.", "no_org");
        let usage: CliOrgUsage;
        try {
            usage = await readOrgUsage(client, org, month);
        } catch (e) {
            reportError(e, "Failed to load usage");
        }
        emit(() => printOrg(usage), usage);
        return;
    }

    const projectId = await requireProject(rawArgs, client);
    let usage: CliProjectUsage;
    try {
        usage = await readProjectUsage(client, projectId, month);
    } catch (e) {
        reportError(e, "Failed to load usage");
    }
    emit(() => printProject(usage, `project ${displayProjectRef(rawArgs) || projectId}`), usage);
}
