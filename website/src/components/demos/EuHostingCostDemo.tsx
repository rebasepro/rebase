import React, { useMemo, useState } from "react";

/**
 * The bill, modelled instead of asserted.
 *
 * Three rules keep this honest, and the third one was learned the hard way:
 *
 * 1. Every managed unit price is Supabase's own published number, not an
 *    estimate. They are in PRICING below with the date they were checked.
 * 2. We do not assert what a VPS costs to a decimal place. Provider list prices
 *    moved twice in 2026, so the tiers below carry an indicative figure and the
 *    reader is told to check their own provider.
 * 3. **The box has to be able to run the workload.** An earlier version let the
 *    right-hand column sit at €12 while the sliders described 5M users and 10 TB
 *    of files, and reported it as "1538× cheaper". That is a lie of exactly the
 *    kind this page attacks: 512 GB of database does not fit on a 40 GB disk.
 *    The box is now *sized from the sliders* — pick something too small and it
 *    is bumped up, and the sliders stop where one machine stops being the right
 *    shape at all.
 *
 * Firebase is deliberately absent. Firestore bills per document read, and no
 * slider can honestly predict how many reads an app you have not written yet
 * will do — which is itself worth saying out loud, so the copy says it.
 */

const PRICING = {
    /** ISO so it can be rendered in the reader's language; one home for the date. */
    checked: "2026-07-28",
    source: "https://supabase.com/pricing",
    base: 25,
    /** Pro bundles $10/month of compute credit, which covers one Micro. */
    computeCredit: 10,
    included: { mau: 100_000, dbGb: 8, storageGb: 100, egressGb: 250 },
    rate: { mau: 0.00325, dbGb: 0.125, storageGb: 0.0213, egressGb: 0.09 }
};

/**
 * Supabase's published compute add-ons.
 *
 * These exist here because leaving them out quietly rigged the figure the other
 * way: the managed column was running a 128 GB database on the included Micro
 * instance — one gigabyte of RAM — for free, while our column was made to buy a
 * machine that could actually hold it. Both columns are now sized by the same
 * `requirementFor` rule, which is what makes the comparison a comparison.
 */
const SUPABASE_COMPUTE = [
    { name: "Micro", vcpu: 2, ram: 1, price: 10 },
    { name: "Small", vcpu: 2, ram: 2, price: 15 },
    { name: "Medium", vcpu: 2, ram: 4, price: 60 },
    { name: "Large", vcpu: 2, ram: 8, price: 110 },
    { name: "XL", vcpu: 4, ram: 16, price: 210 },
    { name: "2XL", vcpu: 8, ram: 32, price: 410 },
    { name: "4XL", vcpu: 16, ram: 64, price: 960 },
    { name: "8XL", vcpu: 32, ram: 128, price: 1_870 }
];

// Ceilings chosen so that the largest workload here still genuinely fits on one
// machine. Past these the answer is object storage, replicas and a second box —
// a real architecture, but not one a two-column figure can compare honestly.
const MAU_STEPS = [10_000, 25_000, 50_000, 100_000, 250_000, 500_000, 1_000_000];
const DB_STEPS = [1, 4, 8, 16, 32, 64, 128];
const STORAGE_STEPS = [10, 50, 100, 250, 512];
const EGRESS_STEPS = [50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000, 20_000];

/**
 * Indicative shapes, not a price list. vCPU/RAM/disk are what the money buys at
 * European providers in the general case; the euro figure is a starting point
 * the reader is explicitly told to replace with their provider's real one.
 * Traffic: 20 TB is the allowance the EU VPS market has settled on.
 */
interface Tier {
    price: number;
    vcpu: number;
    ram: number;
    disk: number;
}

const TIERS: Tier[] = [
    { price: 5, vcpu: 2, ram: 4, disk: 40 },
    { price: 12, vcpu: 4, ram: 8, disk: 80 },
    { price: 30, vcpu: 8, ram: 16, disk: 240 },
    { price: 80, vcpu: 16, ram: 32, disk: 480 },
    { price: 200, vcpu: 32, ram: 64, disk: 1_000 }
];

const INCLUDED_TRAFFIC_GB = 20_000;

/**
 * User files go in an S3-compatible bucket, not on the server's NVMe — which is
 * how Rebase's storage layer is actually deployed, and how anyone self-hosting
 * 100 GB of uploads would really do it.
 *
 * An earlier version put files on the VPS disk. It looked conservative and was
 * in fact just wrong: 100 GB of files dragged the box from €5 to €30 and made
 * the managed plan cheaper across the most-used part of the sliders, because
 * Supabase bundles 100 GB of file storage into its base plan. Modelling a real
 * architecture badly is not the same as being cautious.
 *
 * €0.01/GB is the rough going rate for EU object storage. Indicative, like the
 * box shapes — providers vary and several include a first allowance free.
 */
const OBJECT_STORAGE_EUR_PER_GB = 0.01;

/**
 * What the workload needs from one machine.
 *
 * Deliberately rough: 30% headroom on the database for WAL and indexes, 20 GB
 * for the OS, the bundle and room to take a dump before restoring it; RAM to
 * cache a quarter of the database; a vCPU per 50k monthly actives. Nobody
 * should size production from this — it exists so the figure cannot claim a
 * workload runs on hardware that could not hold it.
 *
 * Applied to *both* columns, which is the point. Arguing about whether a 128 GB
 * database wants 32 GB or 64 GB of RAM changes both bills in the same
 * direction, so the constant stops deciding who wins.
 */
const requirementFor = (mau: number, dbGb: number) => ({
    disk: Math.ceil(dbGb * 1.3) + 20,
    // Floor of 1 GB, not 4: a 1 GB database on a Micro instance is a thing
    // Supabase genuinely sells, and a 4 GB floor forced every toy app onto a
    // $60 Medium — flattering to us and not true.
    ram: Math.max(1, Math.ceil(dbGb / 4)),
    vcpu: Math.max(2, Math.ceil(mau / 50_000))
});

const fmtCount = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1_000 ? `${n / 1_000}k` : `${n}`);
// "GB" is a word in some of the languages this page is read in — French bills
// in Go, not GB — so the unit comes from the string table like everything else.
const fmtGbIn = (n: number, gb: string, tb: string) =>
    (n >= 1_000 ? `${(n / 1_000).toLocaleString("en-US")} ${tb}` : `${n} ${gb}`);
// Cents everywhere on the invoice: mixing "$25.00" with "$1,300" in one column
// reads like a typo, and rounding $202.50 up to $203 in a figure whose whole
// argument is arithmetic is worse than ugly.
const money = (n: number, symbol: string) =>
    `${symbol}${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Prose, not a line item — nobody wants "$18,186.24" mid-sentence. */
const roundMoney = (n: number, symbol: string) =>
    `${symbol}${Math.round(n).toLocaleString("en-US")}`;

/**
 * Every sentence in this figure is a key. `EuropeContent.astro` passes the
 * resolved strings in as `s`; the English below is the fallback, so the demo
 * still renders standalone. Numbers and units stay in the code — `%1`, `%2`
 * are filled at render time, because word order moves between languages.
 */
const EN: Record<string, string> = {
    "ehc.sliders.title": "Describe the app you are actually building",
    "ehc.slider.mau": "Monthly active users",
    "ehc.slider.db": "Database size",
    "ehc.slider.files": "Files stored",
    "ehc.slider.egress": "Egress per month",
    "ehc.managed.title": "Managed, on someone else's account",
    "ehc.item.plan": "Pro plan",
    "ehc.item.plan.detail": "includes $%1 of compute credit",
    "ehc.item.compute": "Compute",
    "ehc.item.compute.detail": "%1 — %2 vCPU, %3 GB — $%4 less the credit",
    "ehc.item.mau": "Monthly active users",
    "ehc.item.db": "Database disk",
    "ehc.item.storage": "File storage",
    "ehc.item.egress": "Egress",
    "ehc.over": "%1 over %2 × $%3",
    "ehc.unit.gb": "GB",
    "ehc.unit.tb": "TB",
    "ehc.permonth": "per month",
    "ehc.managed.note": "Every figure is a price Supabase publishes, checked %1 — including the compute add-on, which is sized by the same rule as the box opposite rather than left on the included Micro instance. Still conservative: it counts no read replicas, no PITR and no support plan.",
    "ehc.box.title": "Self-hosted, on a box you rent",
    "ehc.box.pick": "Pick a box — it has to fit the workload",
    "ehc.box.toosmall": "Too small: this workload needs %1 GB of disk",
    "ehc.box.spec": "%1 vCPU · %2 GB RAM · %3 GB disk",
    "ehc.box.sizedup": "Sized up — the database alone needs about %1 GB of disk, %2 GB of RAM and %3 vCPU, and the box you picked has less.",
    "ehc.box.indicative": "Indicative shapes at European providers. Yours will differ — put your own number on it.",
    "ehc.box.vps": "One VPS",
    "ehc.box.vps.spec": "%1 vCPU · %2 GB RAM · %3 GB NVMe",
    "ehc.box.object": "Object storage",
    "ehc.box.object.detail": "%1 in an S3-compatible bucket, ~€%2/GB",
    "ehc.box.free.mau": "no per-user pricing exists",
    "ehc.box.free.db": "%1 GB of the %2 GB you already rented",
    "ehc.box.free.egress": "%1 of the %2 the plan includes",
    "ehc.box.note": "One machine, so no failover: this is the price of a box that <i>can hold</i> the workload, not of a highly available cluster. And the line no invoice shows — <b class=\"text-surface-400\">you patch it, back it up and get paged for it.</b> If nobody on the team wants that job, the managed bill is buying something real and you should pay it.",
    "ehc.read.included": "<b class=\"text-white\">At this size, this is not an argument.</b> You are inside the included tier, the managed bill is %1, and paying it is the right call. Drag the sliders to where you are going, not where you are.",
    "ehc.read.wins": "<b class=\"text-white\">Here the managed bill wins.</b> A workload this small does not need much of a plan, but %1 of files still needs a disk to sit on, and one box big enough costs €%2 against %3 managed. Self-hosting is not a discount at every size, and this is one of the sizes where it is not.",
    "ehc.read.multiple": "the price, for the same application — and <b class=\"text-white\">%1</b> a year of the difference.",
    "ehc.read.dominant": "Almost all of that is <b class=\"text-surface-200\">%1</b> — %2 of a %3 bill. Egress and per-user pricing are where managed platforms and European VPS plans genuinely diverge; the rest is close enough not to matter.",
    "ehc.bar.managed": "Managed",
    "ehc.bar.box": "Your box",
    "ehc.ceiling": "<b class=\"text-surface-200\">The sliders stop here on purpose.</b> Past roughly this size you are no longer choosing between a box and a plan — you want object storage for the files, a replica so a single machine is not the whole company, and someone whose job that is. That is a real architecture and Rebase runs on it, but a two-column figure could not compare it to anything honestly, so it does not pretend to.",
    "ehc.footnote": "The right-hand column is sized from the sliders — disk for the database plus 30% headroom and 20 GB for the system, RAM to cache a quarter of the database, a vCPU per 50k monthly actives — and the <b class=\"text-surface-400\">same rule sizes the compute add-on on the left</b>, so neither column gets to run this workload on hardware that could not hold it. Files sit in an S3-compatible bucket rather than on that disk, which is how Rebase's storage layer is deployed in practice. Those shapes and rates are indicative, not a quote. Dollars and euros are shown as they are billed and not converted — we are not going to track FX on a marketing page, and at present rates it does not change the shape. <a href=\"%1\" target=\"_blank\" rel=\"noopener noreferrer\" class=\"text-surface-400 underline decoration-surface-700 underline-offset-2 hover:text-primary\">Supabase's published prices</a> are the source for the left column; check your own provider for the right one. <b class=\"text-surface-400\">Firebase is not modelled here on purpose:</b> Firestore bills per document read, and nobody can tell you how many reads an app you have not written yet will do. That unpredictability is a cost too, it just does not fit in a slider."
};

export const EU_HOSTING_COST_STRINGS = Object.keys(EN);

export function EuHostingCostDemo({ s = {}, lang = "en" }: { s?: Record<string, string>; lang?: string }) {
    /** Resolve a key and fill `%1`… placeholders left for the numbers. */
    const T = (k: string, ...v: (string | number)[]) =>
        v.reduce<string>((out, x, i) => out.split(`%${i + 1}`).join(String(x)), s[k] ?? EN[k] ?? k);
    const fmtGb = (n: number) => fmtGbIn(n, T("ehc.unit.gb"), T("ehc.unit.tb"));
    // "28 July 2026" in English, "28. Juli 2026" in German — from the one ISO date.
    // en-GB, not en: a page arguing for European hosting does not date itself
    // month-first.
    const checked = new Date(`${PRICING.checked}T00:00:00Z`).toLocaleDateString(lang === "en" ? "en-GB" : lang, {
        day: "numeric", month: "long", year: "numeric", timeZone: "UTC"
    });

    const [mauIdx, setMauIdx] = useState(3);       // 100k — exactly the included tier
    const [dbIdx, setDbIdx] = useState(2);         // 8 GB
    const [storageIdx, setStorageIdx] = useState(2); // 100 GB
    const [egressIdx, setEgressIdx] = useState(2);   // 250 GB
    const [pickedTierIdx, setPickedTierIdx] = useState(1); // €12

    const mau = MAU_STEPS[mauIdx];
    const dbGb = DB_STEPS[dbIdx];
    const storageGb = STORAGE_STEPS[storageIdx];
    const egressGb = EGRESS_STEPS[egressIdx];

    const need = useMemo(() => requirementFor(mau, dbGb), [mau, dbGb]);

    const bill = useMemo(() => {
        const over = (used: number, inc: number, rate: number) => Math.max(0, used - inc) * rate;
        const instance = SUPABASE_COMPUTE.find((c) => c.ram >= need.ram && c.vcpu >= need.vcpu)
            ?? SUPABASE_COMPUTE[SUPABASE_COMPUTE.length - 1];
        const items = [
            { label: T("ehc.item.plan"), detail: T("ehc.item.plan.detail", PRICING.computeCredit), amount: PRICING.base, always: true },
            {
                label: T("ehc.item.compute"),
                detail: T("ehc.item.compute.detail", instance.name, instance.vcpu, instance.ram, instance.price),
                amount: Math.max(0, instance.price - PRICING.computeCredit),
                always: false
            },
            {
                label: T("ehc.item.mau"),
                detail: T("ehc.over", fmtCount(Math.max(0, mau - PRICING.included.mau)), fmtCount(PRICING.included.mau), PRICING.rate.mau),
                amount: over(mau, PRICING.included.mau, PRICING.rate.mau),
                always: false
            },
            {
                label: T("ehc.item.db"),
                detail: T("ehc.over", fmtGb(Math.max(0, dbGb - PRICING.included.dbGb)), fmtGb(PRICING.included.dbGb), PRICING.rate.dbGb),
                amount: over(dbGb, PRICING.included.dbGb, PRICING.rate.dbGb),
                always: false
            },
            {
                label: T("ehc.item.storage"),
                detail: T("ehc.over", fmtGb(Math.max(0, storageGb - PRICING.included.storageGb)), fmtGb(PRICING.included.storageGb), PRICING.rate.storageGb),
                amount: over(storageGb, PRICING.included.storageGb, PRICING.rate.storageGb),
                always: false
            },
            {
                label: T("ehc.item.egress"),
                detail: T("ehc.over", fmtGb(Math.max(0, egressGb - PRICING.included.egressGb)), fmtGb(PRICING.included.egressGb), PRICING.rate.egressGb),
                amount: over(egressGb, PRICING.included.egressGb, PRICING.rate.egressGb),
                always: false
            }
        ];
        const total = items.reduce((sum, i) => sum + i.amount, 0);
        return { items, total, overage: total - PRICING.base, instance };
    }, [mau, dbGb, storageGb, egressGb, need]);

    // ── Size the box from the workload, not from wishful thinking ──────────
    const requiredTierIdx = useMemo(() => {
        const i = TIERS.findIndex((t) => t.disk >= need.disk && t.ram >= need.ram && t.vcpu >= need.vcpu);
        return i === -1 ? TIERS.length - 1 : i;
    }, [need]);

    // The reader's pick is a floor, never a way to under-buy. Drag the sliders
    // past what a €5 box can hold and the €5 box stops being on offer.
    const effectiveTierIdx = Math.max(pickedTierIdx, requiredTierIdx);
    const tier = TIERS[effectiveTierIdx];
    const sizedUp = effectiveTierIdx > pickedTierIdx;
    const objectStorage = storageGb * OBJECT_STORAGE_EUR_PER_GB;
    const box = tier.price + objectStorage;

    const insideIncluded = bill.overage < 0.005;
    const atCeiling = mauIdx === MAU_STEPS.length - 1 || storageIdx === STORAGE_STEPS.length - 1
        || egressIdx === EGRESS_STEPS.length - 1 || dbIdx === DB_STEPS.length - 1;
    const multiple = bill.total / box;

    /** The single overage line responsible for most of the gap, if there is one. */
    const dominant = useMemo(() => {
        const overages = bill.items.filter((i) => !i.always && i.amount > 0);
        const top = overages.sort((a, b) => b.amount - a.amount)[0];
        return top && top.amount / bill.total > 0.7 ? top : null;
    }, [bill]);
    // The bar is capped so a large ratio does not collapse the short bar to nothing.
    const managedWidth = Math.min(100, Math.max(8, (bill.total / Math.max(bill.total, box)) * 100));
    const boxWidth = Math.min(100, Math.max(4, (box / Math.max(bill.total, box)) * 100));

    return (
        <div className="frame overflow-hidden">

            {/* ── Sliders ───────────────────────────────────────────── */}
            <div className="border-b border-surface-800/60 bg-surface-950/40 px-5 py-6 sm:px-7">
                <p className="mb-5 text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-500">
                    {T("ehc.sliders.title")}
                </p>
                <div className="grid grid-cols-1 gap-x-10 gap-y-5 sm:grid-cols-2">
                    <Slider label={T("ehc.slider.mau")} value={fmtCount(mau)} idx={mauIdx} max={MAU_STEPS.length - 1}
                            included={mau <= PRICING.included.mau} onChange={setMauIdx}/>
                    <Slider label={T("ehc.slider.db")} value={fmtGb(dbGb)} idx={dbIdx} max={DB_STEPS.length - 1}
                            included={dbGb <= PRICING.included.dbGb} onChange={setDbIdx}/>
                    <Slider label={T("ehc.slider.files")} value={fmtGb(storageGb)} idx={storageIdx} max={STORAGE_STEPS.length - 1}
                            included={storageGb <= PRICING.included.storageGb} onChange={setStorageIdx}/>
                    <Slider label={T("ehc.slider.egress")} value={fmtGb(egressGb)} idx={egressIdx} max={EGRESS_STEPS.length - 1}
                            included={egressGb <= PRICING.included.egressGb} onChange={setEgressIdx}/>
                </div>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2">

                {/* ── The managed invoice ───────────────────────────── */}
                <div className="border-b border-surface-800/60 p-6 sm:p-7 lg:border-b-0 lg:border-r">
                    <div className="mb-5 flex items-baseline justify-between gap-3">
                        <span className="text-sm font-semibold text-surface-200">{T("ehc.managed.title")}</span>
                        <span className="rounded-md bg-white/[0.04] px-2 py-0.5 text-[11px] text-surface-500 ring-1 ring-inset ring-white/5">
                            Supabase Pro
                        </span>
                    </div>

                    <ul className="space-y-2.5">
                        {bill.items.map((item) => {
                            const shown = item.always || item.amount > 0;
                            return (
                                <li key={item.label}
                                    className={`flex items-baseline justify-between gap-4 transition-all duration-300 ${
                                        shown ? "opacity-100" : "opacity-30"
                                    }`}>
                                    <span className="min-w-0">
                                        <span className={`text-sm ${shown ? "text-surface-200" : "text-surface-600"}`}>
                                            {item.label}
                                        </span>
                                        {shown && !item.always && (
                                            <span className="block font-mono text-[11px] text-surface-500">{item.detail}</span>
                                        )}
                                        {item.always && (
                                            <span className="block text-[11px] text-surface-500">{item.detail}</span>
                                        )}
                                    </span>
                                    <span className={`flex-none font-mono text-sm tabular-nums ${
                                        item.amount > 0 && !item.always ? "text-amber-300" : shown ? "text-surface-300" : "text-surface-700"
                                    }`}>
                                        {shown ? money(item.amount, "$") : "—"}
                                    </span>
                                </li>
                            );
                        })}
                    </ul>

                    <div className="mt-5 flex items-end justify-between gap-4 border-t border-surface-800/60 pt-5">
                        <span className="text-sm text-surface-400">{T("ehc.permonth")}</span>
                        <span className="font-mono text-3xl font-semibold tabular-nums text-white">
                            {money(bill.total, "$")}
                        </span>
                    </div>

                    <p className="mt-4 text-[11px] leading-relaxed text-surface-500"
                       dangerouslySetInnerHTML={{ __html: T("ehc.managed.note", checked) }}/>
                </div>

                {/* ── Your box ──────────────────────────────────────── */}
                <div className="relative p-6 sm:p-7">
                    <div
                        className="pointer-events-none absolute inset-0 opacity-80"
                        aria-hidden="true"
                        style={{ background: "radial-gradient(320px 240px at 75% 0%, rgba(0,112,244,0.12), transparent 75%)" }}
                    />
                    <div className="relative">
                        <div className="mb-5 flex items-baseline justify-between gap-3">
                            <span className="text-sm font-semibold text-surface-200">{T("ehc.box.title")}</span>
                            <span className="rounded-md bg-primary/10 px-2 py-0.5 text-[11px] text-primary ring-1 ring-inset ring-primary/20">
                                Rebase
                            </span>
                        </div>

                        <p className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-500">
                            {T("ehc.box.pick")}
                        </p>
                        <div className="mb-2 flex flex-wrap gap-2">
                            {TIERS.map((t, i) => {
                                const tooSmall = i < requiredTierIdx;
                                const selected = i === effectiveTierIdx;
                                return (
                                    <button
                                        key={t.price}
                                        type="button"
                                        onClick={() => setPickedTierIdx(i)}
                                        aria-pressed={selected}
                                        title={tooSmall
                                            ? T("ehc.box.toosmall", need.disk)
                                            : T("ehc.box.spec", t.vcpu, t.ram, t.disk)}
                                        className={`rounded-lg px-3 py-1.5 font-mono text-sm transition-all duration-200 ${
                                            selected
                                                ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                                                : tooSmall
                                                    ? "text-surface-700 line-through decoration-surface-700 ring-1 ring-inset ring-surface-800/60"
                                                    : "text-surface-400 ring-1 ring-inset ring-surface-800 hover:text-surface-200 hover:ring-surface-700"
                                        }`}>
                                        €{t.price}
                                    </button>
                                );
                            })}
                        </div>

                        <p className="mb-5 text-[11px] leading-relaxed text-surface-500">
                            {sizedUp ? (
                                <span className="text-amber-300/90">
                                    {T("ehc.box.sizedup", need.disk, need.ram, need.vcpu)}
                                </span>
                            ) : (
                                <>{T("ehc.box.indicative")}</>
                            )}
                        </p>

                        <ul className="space-y-2.5">
                            <li className="flex items-baseline justify-between gap-4">
                                <span className="text-sm text-surface-200">
                                    {T("ehc.box.vps")}
                                    <span className="block font-mono text-[11px] text-surface-500">
                                        {T("ehc.box.vps.spec", tier.vcpu, tier.ram, tier.disk)}
                                    </span>
                                </span>
                                {/* The machine alone — `box` also carries the bucket, which is its own line. */}
                                <span className="flex-none font-mono text-sm tabular-nums text-surface-300">€{tier.price.toFixed(2)}</span>
                            </li>
                            <li className="flex items-baseline justify-between gap-4">
                                <span className="min-w-0 text-sm text-surface-200">
                                    {T("ehc.box.object")}
                                    <span className="block text-[11px] text-surface-500">
                                        {T("ehc.box.object.detail", fmtGb(storageGb), OBJECT_STORAGE_EUR_PER_GB.toFixed(2))}
                                    </span>
                                </span>
                                <span className={`flex-none font-mono text-sm tabular-nums ${
                                    objectStorage > 0 ? "text-surface-300" : "text-primary"
                                }`}>
                                    €{objectStorage.toFixed(2)}
                                </span>
                            </li>
                            {[
                                [T("ehc.item.mau"), T("ehc.box.free.mau")],
                                [T("ehc.item.db"), T("ehc.box.free.db", dbGb, tier.disk)],
                                [T("ehc.item.egress"), T("ehc.box.free.egress", fmtGb(egressGb), fmtGb(INCLUDED_TRAFFIC_GB))]
                            ].map(([label, detail]) => (
                                <li key={label} className="flex items-baseline justify-between gap-4">
                                    <span className="min-w-0 text-sm text-surface-200">
                                        {label}
                                        <span className="block text-[11px] text-surface-500">{detail}</span>
                                    </span>
                                    <span className="flex-none font-mono text-sm tabular-nums text-primary">€0.00</span>
                                </li>
                            ))}
                        </ul>

                        <div className="mt-5 flex items-end justify-between gap-4 border-t border-surface-800/60 pt-5">
                            <span className="text-sm text-surface-400">{T("ehc.permonth")}</span>
                            <span className="font-mono text-3xl font-semibold tabular-nums text-white">
                                €{box.toFixed(2)}
                            </span>
                        </div>

                        <p className="mt-4 text-[11px] leading-relaxed text-surface-500"
                           dangerouslySetInnerHTML={{ __html: T("ehc.box.note") }}/>
                    </div>
                </div>
            </div>

            {/* ── The read-out ──────────────────────────────────────── */}
            <div className="border-t border-surface-800/60 bg-surface-950/50 px-5 py-6 sm:px-7">
                {insideIncluded ? (
                    <p className="text-[15px] leading-relaxed text-surface-300"
                       dangerouslySetInnerHTML={{ __html: T("ehc.read.included", money(PRICING.base, "$")) }}/>
                ) : multiple < 1 ? (
                    /* A guard, not a branch anyone reaches today: with both columns sized by
                       the same rule, a sweep of every slider combination finds no case where
                       the managed bill is lower. It stays so that a future change to the
                       constants surfaces as an admission rather than a silent overclaim. */
                    <p className="text-[15px] leading-relaxed text-surface-300"
                       dangerouslySetInnerHTML={{ __html: T("ehc.read.wins", fmtGb(storageGb), box.toFixed(2), money(bill.total, "$")) }}/>
                ) : (
                    <>
                        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                            <span className="font-mono text-4xl font-semibold tabular-nums text-white">
                                {multiple >= 10 ? Math.round(multiple) : multiple.toFixed(1)}×
                            </span>
                            <span className="text-[15px] text-surface-300"
                                  dangerouslySetInnerHTML={{ __html: T("ehc.read.multiple", roundMoney(bill.total * 12 - box * 12, "$")) }}/>
                        </div>

                        {/* A big multiple with no explanation reads as a marketing lie. When one
                            line item is doing all the work, name it — the reader can then check
                            it against the invoice above instead of trusting the headline. */}
                        {dominant && (
                            <p className="mt-3 text-[13px] leading-relaxed text-surface-400"
                               dangerouslySetInnerHTML={{ __html: T("ehc.read.dominant", dominant.label.toLowerCase(), money(dominant.amount, "$"), money(bill.total, "$")) }}/>
                        )}

                        <div className="mt-5 space-y-2.5">
                            <Bar label={T("ehc.bar.managed")} width={managedWidth} value={money(bill.total, "$")} tone="amber"/>
                            <Bar label={T("ehc.bar.box")} width={boxWidth} value={`€${box.toFixed(2)}`} tone="primary"/>
                        </div>
                    </>
                )}

                {atCeiling && (
                    <p className="frame mt-5 p-4 text-[13px] leading-relaxed text-surface-400"
                       dangerouslySetInnerHTML={{ __html: T("ehc.ceiling") }}/>
                )}

                <p className="mt-6 text-[11px] leading-relaxed text-surface-500"
                   dangerouslySetInnerHTML={{ __html: T("ehc.footnote", PRICING.source) }}/>
            </div>
        </div>
    );
}

function Slider({ label, value, idx, max, included, onChange }: {
    label: string;
    value: string;
    idx: number;
    max: number;
    included: boolean;
    onChange: (n: number) => void;
}) {
    return (
        <label className="block">
            <span className="flex items-baseline justify-between gap-3">
                <span className="text-sm text-surface-300">{label}</span>
                <span className={`font-mono text-sm tabular-nums transition-colors duration-200 ${
                    included ? "text-surface-400" : "text-primary"
                }`}>
                    {value}
                </span>
            </span>
            <input
                type="range"
                min={0}
                max={max}
                step={1}
                value={idx}
                aria-label={label}
                onChange={(e) => onChange(Number(e.target.value))}
                className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-surface-800 accent-primary
                           [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none
                           [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-primary
                           [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(0,112,244,0.18)]
                           [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:border-0
                           [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-primary"
            />
        </label>
    );
}

function Bar({ label, width, value, tone }: { label: string; width: number; value: string; tone: "amber" | "primary" }) {
    return (
        <div className="flex items-center gap-3">
            <span className="w-20 flex-none text-xs text-surface-500">{label}</span>
            <span className="relative h-7 flex-1 overflow-hidden rounded-lg bg-surface-900/60">
                <span
                    className={`absolute inset-y-0 left-0 rounded-lg transition-all duration-500 ease-out ${
                        tone === "amber" ? "bg-amber-500/30" : "bg-primary/40"
                    }`}
                    style={{ width: `${width}%` }}
                />
            </span>
            <span className={`w-24 flex-none text-right font-mono text-sm tabular-nums ${
                tone === "amber" ? "text-amber-300" : "text-primary"
            }`}>
                {value}
            </span>
        </div>
    );
}

export default EuHostingCostDemo;
