/**
 * `rebase cloud billing invoices` and `rebase cloud billing upcoming`: what the
 * selected organization has been invoiced, and what it will be invoiced next.
 *
 * Both read Stripe through the control plane (`GET /stripe-billing/invoices/:org`
 * and `/upcoming/:org`) — the same reads as the console's Billing page, behind
 * the same gate: an owner or admin of the organization. Read-only; the hosted
 * invoice URL is where a person views, downloads or pays one.
 *
 * Amounts arrive in the currency's minor unit (cents) and stay that way in
 * `--json`, exactly as Stripe and the control plane send them; the human output
 * formats them.
 */
import chalk from "chalk";
import { emit, note, noteBlank, type CloudClient } from "./context";

/** One issued invoice, as the control plane sends it. */
export interface CliInvoice {
    id: string;
    number: string | null;
    status: string | null;
    created: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    total: number;
    amountDue: number;
    currency: string;
    hostedInvoiceUrl: string | null;
    invoicePdf: string | null;
}

/** What one subscription will invoice next. */
export interface CliUpcomingInvoice {
    subscriptionId: string;
    kind: "project" | "usage";
    projectId: string | null;
    projectName: string | null;
    total: number;
    amountDue: number;
    currency: string;
    expectedAt: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    lines: { description: string | null; amount: number; currency: string; quantity: number | null }[];
    moreLines: boolean;
}

/** The control plane's answer when there is no Stripe behind it. */
interface BillingFlags {
    simulated?: boolean;
    billingUnavailable?: boolean;
}

/** An amount in a currency's minor unit, for a person. The divisor is the currency's own. */
export function formatMinor(amount: number, currency: string): string {
    const code = (currency || "eur").toUpperCase();
    try {
        const format = new Intl.NumberFormat("en", { style: "currency", currency: code });
        const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
        return format.format(amount / 10 ** digits);
    } catch {
        return `${(amount / 100).toFixed(2)} ${code}`;
    }
}

/** A date as YYYY-MM-DD in UTC — Stripe's periods are UTC. */
function day(iso: string | null): string {
    return iso ? iso.slice(0, 10) : "—";
}

const UNAVAILABLE = "Billing is not configured on this control plane, so there are no invoices to read.";

export async function billingInvoices(client: CloudClient, org: string, limit?: number): Promise<void> {
    const query = limit !== undefined ? `?limit=${encodeURIComponent(String(limit))}` : "";
    const res = await client.functions.invoke<{ invoices?: CliInvoice[]; hasMore?: boolean } & BillingFlags>(
        "stripe-billing",
        undefined,
        { method: "GET", path: `invoices/${encodeURIComponent(org)}${query}` }
    );
    const invoices = res.invoices ?? [];
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🧾 Invoices — org ${org}`));
            console.log("");
            if (res.billingUnavailable) {
                note(chalk.yellow(UNAVAILABLE));
            } else if (invoices.length === 0) {
                note(chalk.gray("No invoices yet."));
            } else {
                for (const inv of invoices) {
                    const status = inv.status === "paid"
                        ? chalk.green("paid")
                        : inv.status === "open"
                            ? chalk.yellow("awaiting payment")
                            : chalk.gray(inv.status ?? "unknown");
                    console.log(
                        `  ${day(inv.created)}  ${(inv.number ?? inv.id).padEnd(16)}  `
                        + `${formatMinor(inv.total, inv.currency).padStart(12)}  ${status}`
                    );
                    if (inv.hostedInvoiceUrl) console.log(chalk.gray(`              ${inv.hostedInvoiceUrl}`));
                }
                if (res.hasMore) {
                    noteBlank();
                    note(chalk.gray(`Showing the latest ${invoices.length}; pass --limit (up to 100) for more.`));
                }
            }
            console.log("");
        },
        {
            org,
            invoices,
            hasMore: Boolean(res.hasMore),
            billingUnavailable: Boolean(res.billingUnavailable)
        }
    );
}

export async function billingUpcoming(client: CloudClient, org: string): Promise<void> {
    const res = await client.functions.invoke<{ upcoming?: CliUpcomingInvoice[]; truncated?: boolean } & BillingFlags>(
        "stripe-billing",
        undefined,
        { method: "GET", path: `upcoming/${encodeURIComponent(org)}` }
    );
    const upcoming = res.upcoming ?? [];
    emit(
        () => {
            console.log("");
            console.log(chalk.bold(`  🧾 Next invoice (preview) — org ${org}`));
            console.log("");
            if (res.billingUnavailable) {
                note(chalk.yellow(UNAVAILABLE));
            } else if (upcoming.length === 0) {
                note(chalk.gray("Nothing is due next: no active subscription will invoice."));
            } else {
                for (const u of upcoming) {
                    const name = u.kind === "usage" ? "Usage beyond the allowance" : u.projectName ?? u.projectId ?? "project";
                    console.log(`  ${day(u.expectedAt)}  ${name.padEnd(28)}  ${formatMinor(u.total, u.currency).padStart(12)}`);
                    for (const line of u.lines) {
                        console.log(chalk.gray(`      ${line.description ?? "—"}  ${formatMinor(line.amount, line.currency)}`));
                    }
                }
                noteBlank();
                note(chalk.gray("A preview computed by Stripe, not an invoice: metered usage keeps adding up until the period closes."));
            }
            console.log("");
        },
        {
            org,
            upcoming,
            truncated: Boolean(res.truncated),
            billingUnavailable: Boolean(res.billingUnavailable)
        }
    );
}
