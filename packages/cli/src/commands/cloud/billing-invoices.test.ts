/**
 * `rebase cloud billing invoices` / `upcoming`: the organization's invoices and
 * the next one, read from the control plane — what the console's Billing page
 * shows, for a terminal or an agent.
 *
 * Pinned: each reads the selected org's route (and only reads it), `--json` is
 * exactly one JSON value carrying the control plane's fields unchanged, the
 * human output carries the hosted-invoice link, and `--limit` is refused on any
 * other billing action rather than silently ignored.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { setJsonModeForTest } from "./context";

vi.mock("./context", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./context")>();
    return {
        ...actual,
        requireClient: vi.fn(),
        getContextOrg: vi.fn(() => "org-1")
    };
});

import * as context from "./context";
import { billingCommand } from "./resources";
import { formatMinor } from "./billing-invoices";

const INVOICE = {
    id: "in_1",
    number: "ACME-0001",
    status: "paid",
    created: "2025-10-09T08:53:20.000Z",
    periodStart: "2025-09-09T08:53:20.000Z",
    periodEnd: "2025-10-09T08:53:20.000Z",
    total: 1234,
    amountDue: 1234,
    currency: "eur",
    hostedInvoiceUrl: "https://invoice.stripe.com/i/acct/in_1",
    invoicePdf: "https://pay.stripe.com/invoice/acct/in_1/pdf"
};

const UPCOMING = {
    subscriptionId: "sub_p1",
    kind: "project",
    projectId: "p1",
    projectName: "Storefront",
    total: 2400,
    amountDue: 2400,
    currency: "eur",
    expectedAt: "2025-11-08T08:53:20.000Z",
    periodStart: null,
    periodEnd: null,
    lines: [{ description: "1 × Compute", amount: 2400, currency: "eur", quantity: 1 }],
    moreLines: false
};

function argv(...words: string[]): string[] {
    return ["/usr/bin/node", "/x/y/rebase.js", "cloud", ...words];
}

const invoke = vi.fn(async (_name: string, _body: unknown, opts?: { method?: string; path?: string }) => {
    if (opts?.path?.startsWith("invoices/")) return { invoices: [INVOICE], hasMore: false };
    if (opts?.path?.startsWith("upcoming/")) return { upcoming: [UPCOMING], truncated: false };
    throw new Error(`unexpected call ${opts?.path}`);
});

function useClient(): void {
    (context.requireClient as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
        client: { functions: { invoke }, data: { collection: () => ({ findById: async () => undefined }) } },
        url: "https://cp.example"
    });
}

/** Everything written to stdout while `run` runs; `process.exit` becomes a throw. */
async function stdoutOf(run: () => Promise<unknown>): Promise<{ out: string; exited: boolean }> {
    const chunks: string[] = [];
    const orig = process.stdout.write.bind(process.stdout);
    process.stdout.write = (s: string) => {
        chunks.push(typeof s === "string" ? s : String(s));
        return true;
    };
    const exit = vi.spyOn(process, "exit").mockImplementation(((): never => {
        throw new Error("__exit__");
    }) as never);
    let exited = false;
    try {
        await run();
    } catch (e) {
        if (!(e instanceof Error && e.message === "__exit__")) throw e;
        exited = true;
    } finally {
        process.stdout.write = orig;
        exit.mockRestore();
    }
    return { out: chunks.join(""), exited };
}

beforeEach(() => {
    setJsonModeForTest(true);
    useClient();
});
afterEach(() => {
    setJsonModeForTest(false);
    vi.clearAllMocks();
});

describe("rebase cloud billing invoices", () => {
    it("--json is one JSON value with the control plane's invoices, read from the org's route", async () => {
        const { out, exited } = await stdoutOf(() => billingCommand(argv("billing", "invoices", "--json")));
        expect(exited).toBe(false);
        const parsed = JSON.parse(out);
        expect(parsed).toEqual({ org: "org-1", invoices: [INVOICE], hasMore: false, billingUnavailable: false });
        expect(invoke).toHaveBeenCalledTimes(1);
        expect(invoke).toHaveBeenCalledWith("stripe-billing", undefined, { method: "GET", path: "invoices/org-1" });
    });

    it("passes --limit to the control plane", async () => {
        await stdoutOf(() => billingCommand(argv("billing", "invoices", "--limit", "5")));
        expect(invoke).toHaveBeenCalledWith("stripe-billing", undefined, { method: "GET", path: "invoices/org-1?limit=5" });
    });

    it("refuses --limit on any other billing action instead of ignoring it", async () => {
        const { out, exited } = await stdoutOf(() => billingCommand(argv("billing", "upcoming", "--limit", "5")));
        expect(exited).toBe(true);
        expect(JSON.parse(out).error.code).toBe("usage");
        expect(invoke).not.toHaveBeenCalled();
    });

    it("prints each invoice with its amount and Stripe's hosted page for a person", async () => {
        setJsonModeForTest(false);
        const lines: string[] = [];
        const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { lines.push(args.map(String).join(" ")); });
        try {
            await billingCommand(argv("billing", "invoices"));
        } finally {
            spy.mockRestore();
        }
        // eslint-disable-next-line no-control-regex
        const text = lines.join("\n").replace(/\u001b\[[0-9;]*m/g, "");
        expect(text).toContain("ACME-0001");
        expect(text).toContain("€12.34");
        expect(text).toContain("https://invoice.stripe.com/i/acct/in_1");
    });
});

describe("rebase cloud billing upcoming", () => {
    it("--json carries each subscription's preview unchanged", async () => {
        const { out } = await stdoutOf(() => billingCommand(argv("billing", "upcoming", "--json")));
        expect(JSON.parse(out)).toEqual({ org: "org-1", upcoming: [UPCOMING], truncated: false, billingUnavailable: false });
        expect(invoke).toHaveBeenCalledWith("stripe-billing", undefined, { method: "GET", path: "upcoming/org-1" });
    });
});

describe("formatMinor", () => {
    it("divides by the currency's own minor unit", () => {
        expect(formatMinor(1234, "eur")).toBe("€12.34");
        expect(formatMinor(1234, "jpy")).toBe("¥1,234");
        expect(formatMinor(1234, "zz-not-a-code")).toBe("12.34 ZZ-NOT-A-CODE");
    });
});
