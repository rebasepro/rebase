/**
 * Rebase Cloud's public offer: the prices, the switches that say which parts
 * of it are live, and the facts about where projects run.
 *
 * ── Two files, two owners ─────────────────────────────────────────────────────
 * `cloud-prices.json` is GENERATED in the control-plane repository from the
 * rate card that bills (`backend/scripts/export-public-prices.ts`) and copied
 * here unedited; `scripts/check_cloud_prices.mjs` fails on a hand edit. Never
 * type a price into a page or a translation: read it from here.
 *
 * `CLOUD_FLAGS` below is hand-written, and is the ONE place that says what a
 * customer can buy today. Every surface that depends on it — the pricing page,
 * the security page, the jurisdiction demo, the closing CTA lanes, the footer —
 * reads these flags, so one flip updates all of them together. With today's
 * values the site states only what is true today; flip a flag on the day the
 * thing it names ships, and not before.
 *
 * ── How to update the prices ─────────────────────────────────────────────────
 *   1. In the saas repository, from backend/:
 *        NODE_ENV=test node --import tsx --import ./src/test-env.ts scripts/export-public-prices.ts > <this repo>/website/src/data/cloud-prices.json
 *        NODE_ENV=test node --import tsx --import ./src/test-env.ts scripts/export-public-prices.ts --hash > scripts/public-prices.sha256
 *   2. Here: `node scripts/check_cloud_prices.mjs`, then commit both repositories.
 * The saas test `public-prices.test.ts` fails until step 1 is done after any
 * change to the rate card.
 */
import prices from "./cloud-prices.json";
import { en } from "../i18n/en";

/** A key of the English dictionary — the one every language falls back to. */
export type CopyKey = keyof typeof en;

function isCopyKey(key: string): key is CopyKey {
    return key in en;
}

export { CLOUD_FLAGS, REGION_FACTS, FILE_SECOND_COPY_PLACE, type RegionId } from "./cloud-flags";
import { CLOUD_FLAGS, REGION_FACTS, type RegionId } from "./cloud-flags";

/** The console: sign-up, then straight into the create-project form. */
export const CLOUD_SIGNUP_URL = "https://app.rebase.pro/projects/new";

export type CloudPrices = typeof prices;
export type RegionPrices = CloudPrices["regions"]["europe-west1"];

export function regionPrices(region: RegionId = CLOUD_FLAGS.region): RegionPrices {
    const r = (prices.regions as Record<string, RegionPrices>)[region];
    if (!r) throw new Error(`cloud-prices.json has no prices for ${region}; re-export it from the control plane`);
    return r;
}

export const CLOUD_PRICES: CloudPrices = prices;

/** `33.03` → "€33.03"; whole euros keep their cents so a column of prices lines up. */
export function eur(amount: number, digits = 2): string {
    return `€${amount.toFixed(digits)}`;
}

/** "From €X a month": the cheapest thing a customer can buy today, by the flags. */
export function fromPrice(): { amount: number; sleeping: boolean } {
    const r = regionPrices();
    if (CLOUD_FLAGS.sleep) return { amount: r.examples.sleeping.asleepMonthlyEur, sleeping: true };
    return { amount: r.examples.smallest.monthlyEur, sleeping: false };
}

/** `"100m"` → "0.1 vCPU", `"1"` → "1 vCPU". */
export function cpuLabel(cpu: string): string {
    const m = cpu.endsWith("m") ? Number(cpu.slice(0, -1)) : Number(cpu) * 1000;
    return `${Number((m / 1000).toFixed(2))} vCPU`;
}

/** `"384Mi"` → "384 MB", `"2Gi"` → "2 GB". */
export function memoryLabel(memory: string): string {
    const mib = memory.endsWith("Gi") ? Number(memory.slice(0, -2)) * 1024 : Number(memory.slice(0, -2));
    return mib >= 1024 ? `${Number((mib / 1024).toFixed(1))} GB` : `${mib} MB`;
}

/**
 * The claims the pricing hero makes, with their sources: a PostgreSQL database
 * of the project's own (backend/src/utils/rate-card.ts — database lines exist
 * only as `dedicated`; OFFERING.md §1) and daily backups with restore to any
 * minute of the last 30 days (backend/src/k8s/orchestrator.ts
 * `retentionPolicy: "30d"`; docs deployment/cloud.md "Restore the database to
 * a point in time"). They are said there, so the list below does not repeat
 * them.
 */
export const HERO_CLAIM_SOURCES = ["rate-card.ts dedicated database lines", "orchestrator.ts retentionPolicy 30d"] as const;

/**
 * What every project includes beyond the hero, each claim once, each with the place in the
 * code that makes it true (paths in the control-plane repository unless they
 * start with `website/`). Check the source before changing a line; add a line
 * only with its source.
 */
export function includedItems(): { key: CopyKey; values?: Record<string, string>; source: string }[] {
    const facts = REGION_FACTS[CLOUD_FLAGS.region];
    const items: { key: CopyKey; values?: Record<string, string>; source: string }[] = [
        { key: "pricing.included.domains", source: "no domain line in backend/src/utils/rate-card.ts; website docs deployment/cloud.md" },
        { key: "pricing.included.members", source: "no seat or member limit in backend/src or frontend/src (grep)" },
        { key: "pricing.included.users", source: "nothing in backend/src/metering/quota.ts or rate-card.ts meters users" },
        { key: "pricing.included.traffic", source: "no egress line in backend/src/utils/rate-card.ts or metering/quota.ts" },
        {
            key: "pricing.included.files",
            values: { gb: String(prices.included.filesGb) },
            source: "rate-card.ts INCLUDED_STORAGE_GB, OVERAGE_PER_STORAGE_GB_EUR, via cloud-prices.json"
        },
        {
            key: "pricing.included.requests",
            values: { requests: (prices.included.requestsPerMonth / 1_000_000).toLocaleString("en") + " million" },
            source: "rate-card.ts INCLUDED_REQUESTS_PER_MONTH, OVERAGE_PER_MILLION_REQUESTS_EUR, via cloud-prices.json"
        }
    ];
    if (facts.outboundIp) {
        items.push({ key: "pricing.included.outboundIp", values: { ip: facts.outboundIp }, source: "website docs deployment/managed-runtime.md \"Outbound traffic\"; backend/src/k8s/egress-gateway.ts" });
    }
    return items;
}

/** Fill `{name}` placeholders in a translated string. */
export function fill(template: string, values: Record<string, string> = {}): string {
    return template.replace(/\{(\w+)\}/g, (_, k: string) => values[k] ?? `{${k}}`);
}

/**
 * The variant of a translation key for the current flags, where one exists:
 * `<key>.fsn1` while projects are created in Falkenstein, `<key>.open` once
 * self-serve is on. Surfaces call this instead of naming the key, so a flip
 * changes every page that states the fact. A variant missing from a language
 * falls back to English there until the translator runs.
 */
export function offerKey(key: CopyKey): CopyKey {
    const regional = `${key}.${CLOUD_FLAGS.region}`;
    if (CLOUD_FLAGS.region !== "europe-west1" && isCopyKey(regional)) return regional;
    const open = `${key}.open`;
    if (CLOUD_FLAGS.selfServe && isCopyKey(open)) return open;
    return key;
}
