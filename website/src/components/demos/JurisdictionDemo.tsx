import React, { useState } from "react";

/**
 * Every sentence this figure says, keyed. The page passes a resolved
 * dictionary in as `s`; without one the English below renders, so the demo
 * still works standalone (in /dev/demos, or in a story).
 *
 * The vendor NAMES, regions and company names are deliberately absent: they
 * are proper nouns and legal entities, and translating "FireCMS S.L." or
 * "eu-central-1 · Frankfurt" would make the figure wrong.
 */
const EN: Record<string, string> = {
    "jd.strip": "Same app, four backends",
    "jd.row.region": "Where the bytes sit",
    "jd.row.region.hint": "all four can answer Europe",
    "jd.row.operator": "Who operates it",
    "jd.row.operator.hint": "this is the row that moves",
    "jd.row.keyholders": "Who can read the rows",
    "jd.row.keyholders.hint": "without asking you first",
    "jd.row.exit": "What leaving costs",
    "jd.seat.us": "seated in the United States",
    "jd.seat.usde": "seated in the United States (Delaware)",
    "jd.seat.es": "seated in Spain (European Union)",
    "jd.constant": "Europe, if you ask for it",
    "jd.unchanged": "unchanged",
    "jd.verdict.none": "One party to the data",
    "jd.verdict.eu": "Two parties, one jurisdiction",
    "jd.verdict.us": "Two parties, two jurisdictions",
    "jd.you": "You",
    "jd.subprocessor": "(sub-processor)",
    "jd.firebase.exit": "Rewrite every query — Firestore is not SQL and does not dump to it",
    "jd.firebase.note": "Firestore will keep your documents in eur3. Google still runs the service, holds the credentials, and is a US company.",
    "jd.supabase.exit": "pg_dump works — the schema is portable, the platform around it is not",
    "jd.supabase.note": "It is Postgres in Frankfurt, which is genuinely good. The company operating it is incorporated in Delaware, and that is a separate fact from where the disk is.",
    "jd.cloud.exit": "pg_dump, and the same image runs on your own box the same day",
    "jd.cloud.note": "We run it, so there is a second party, and it is us. FireCMS S.L. is a Spanish company with no US parent — that is the row that moves. Today the machines underneath are Google Cloud's in Belgium, which makes Google a sub-processor; moving Cloud onto a European host is work we have committed to, and until it is done this row says so.",
    "jd.self.label": "Rebase, self-hosted",
    "jd.self.region": "Wherever you rented the box",
    "jd.self.seat": "seated in your own jurisdiction",
    "jd.self.exit": "There is no exit — you already have the database and the source",
    "jd.self.note": "The software is MIT-licensed and runs as a container against your Postgres. We never see the data, hold no credentials, and have nothing to be served with.",
    "jd.struct.none.lead": "Nobody can be served with a request for your data except you",
    "jd.struct.none.rest": ", because nobody else has it. That is not a policy we promise to keep — it is an absence of anything to promise about.",
    "jd.struct.eu.a": "There is a second party, and a second party can be asked. The question this page keeps returning to is",
    "jd.struct.eu.b": "which court gets to ask",
    "jd.struct.eu.c": ". A Spanish company answers to Spanish and EU law, and has no US parent that could be ordered separately — so the request arrives through a process you can see. Fewer parties is still stronger, and that option is one command away.",
    "jd.struct.us.a": "A US-seated provider can be ordered to produce data in its",
    "jd.struct.us.b": "possession, custody or control",
    "jd.struct.us.c": ", including data held on European disks. Whether that ever happens to you is a legal question. Whether there is a second party who",
    "jd.struct.us.could": "could",
    "jd.struct.us.d": "be asked is a structural one.",
    "jd.footnote": "Regions above are the European options each vendor publishes, not defaults — all four keep data in Europe if you ask. Nothing here is legal advice; if you have a specific obligation, take it to counsel with the architecture in hand."
};

/** The keys the page must resolve and pass in. */
export const JURISDICTION_STRINGS = Object.keys(EN);

/**
 * The sovereignty argument, made honestly.
 *
 * The tempting figure here is a map with packets flying to Virginia. It would
 * also be a lie: Supabase will provision in eu-central-1, and Firestore has
 * eur3. Location is not where these products differ.
 *
 * So the figure asks two questions instead of one, and the top row — where the
 * bytes physically sit — deliberately never changes as you switch vendors. It
 * is the same trick AdoptionStackDemo plays with the API strip: hold one row
 * constant so the reader's eye lands on the row that actually moves.
 */

type VendorId = "firebase" | "supabase" | "rebase-cloud" | "rebase";

interface Vendor {
    id: VendorId;
    label: string;
    /**
     * The named European option each vendor publishes. The *answer* to "can this
     * be in Europe" is constant — all three are yes — so the row renders a fixed
     * sentence and keeps this string as the supporting detail. An earlier draft
     * put this string in the headline slot while badging the row "unchanged",
     * which was a figure arguing against its own label.
     */
    region: string;
    /** The legal person who operates the service and holds the keys. */
    operator: string;
    operatorSeat: string;
    /**
     * The three outcomes this table exists to separate. "none" is nobody but
     * the reader; "eu" is a second party seated inside EU jurisdiction; "us"
     * is a second party a US court can reach. A boolean collapsed the last two
     * into one, which is the whole argument of this page.
     */
    posture: "none" | "eu" | "us";
    /** Who can technically read the rows without asking you. */
    keyholders: string[];
    /** What "delete my account" costs you. */
    exit: string;
    note: string;
}

const VENDORS: Vendor[] = [
    {
        id: "firebase",
        label: "Firebase",
        region: "eur3 · Belgium + Netherlands",
        operator: "Google LLC",
        operatorSeat: "jd.seat.us",
        posture: "us",
        keyholders: ["jd.you", "Google LLC"],
        exit: "jd.firebase.exit",
        note: "jd.firebase.note"
    },
    {
        id: "supabase",
        label: "Supabase",
        region: "eu-central-1 · Frankfurt",
        operator: "Supabase, Inc.",
        operatorSeat: "jd.seat.usde",
        posture: "us",
        keyholders: ["jd.you", "Supabase, Inc.", "AWS jd.subprocessor"],
        exit: "jd.supabase.exit",
        note: "jd.supabase.note"
    },
    {
        id: "rebase-cloud",
        label: "Rebase Cloud",
        region: "europe-west1 · Belgium",
        operator: "FireCMS S.L.",
        operatorSeat: "jd.seat.es",
        posture: "eu",
        keyholders: ["jd.you", "FireCMS S.L.", "Google Cloud jd.subprocessor"],
        exit: "jd.cloud.exit",
        note: "jd.cloud.note"
    },
    {
        id: "rebase",
        label: "jd.self.label",
        region: "jd.self.region",
        operator: "jd.you",
        operatorSeat: "jd.self.seat",
        posture: "none",
        keyholders: ["jd.you"],
        exit: "jd.self.exit",
        note: "jd.self.note"
    }
];

const ROWS = [
    { key: "region", label: "jd.row.region", hint: "jd.row.region.hint" },
    { key: "operator", label: "jd.row.operator", hint: "jd.row.operator.hint" },
    { key: "keyholders", label: "jd.row.keyholders", hint: "jd.row.keyholders.hint" },
    { key: "exit", label: "jd.row.exit", hint: "" }
] as const;

/**
 * Tailwind needs whole class names, so each posture carries its own strings
 * rather than interpolating a colour. Blue = nobody but you, emerald = a second
 * party under EU law, amber = a second party a US court can reach.
 */
const TONES = {
    none: {
        button: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30",
        panel: "bg-primary/[0.04]",
        glow: "radial-gradient(340px 260px at 70% 0%, rgba(0,112,244,0.13), transparent 75%)",
        badge: "bg-primary/10 text-primary ring-primary/25",
        operator: "text-white",
        chip: "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25",
        verdict: "jd.verdict.none"
    },
    eu: {
        button: "bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/30",
        panel: "bg-emerald-500/[0.03]",
        glow: "radial-gradient(340px 260px at 70% 0%, rgba(16,185,129,0.10), transparent 75%)",
        badge: "bg-emerald-500/10 text-emerald-300 ring-emerald-500/25",
        operator: "text-emerald-200",
        chip: "bg-emerald-500/[0.07] text-emerald-200/90 ring-1 ring-inset ring-emerald-500/25",
        verdict: "jd.verdict.eu"
    },
    us: {
        button: "bg-amber-500/10 text-amber-300 ring-1 ring-inset ring-amber-500/30",
        panel: "bg-amber-500/[0.03]",
        glow: "radial-gradient(340px 260px at 70% 0%, rgba(245,158,11,0.09), transparent 75%)",
        badge: "bg-amber-500/10 text-amber-300 ring-amber-500/25",
        operator: "text-amber-200",
        chip: "bg-amber-500/[0.07] text-amber-200/90 ring-1 ring-inset ring-amber-500/25",
        verdict: "jd.verdict.us"
    }
} as const;

export function JurisdictionDemo({ s = {} }: { s?: Record<string, string> }) {
    /** Resolve a key; a value that is not a key (a company name) passes through. */
    const T = (k: string) => s[k] ?? EN[k] ?? k;
    /** A keyholder chip is a name that may carry a keyed suffix. */
    const TK = (k: string) => k.split(" ").map((w) => (w in EN ? T(w) : w)).join(" ");

    const [active, setActive] = useState<VendorId>("firebase");
    const vendor = VENDORS.find((v) => v.id === active)!;
    const tone = TONES[vendor.posture];

    return (
        <div className="frame overflow-hidden">

            {/* Vendor switch */}
            <div className="flex flex-wrap items-center gap-2 border-b border-surface-800/60 bg-surface-950/50 px-4 py-3 sm:px-6">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-500">
                    {T("jd.strip")}
                </span>
                {VENDORS.map((v) => (
                    <button
                        key={v.id}
                        type="button"
                        onClick={() => setActive(v.id)}
                        aria-pressed={v.id === active}
                        className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                            v.id === active
                                ? TONES[v.posture].button
                                : "text-surface-400 ring-1 ring-inset ring-surface-800 hover:text-surface-200 hover:ring-surface-700"
                        }`}>
                        {T(v.label)}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1.15fr_0.85fr]">

                {/* ── The four rows ─────────────────────────────────── */}
                <div className="divide-y divide-surface-800/60">
                    {ROWS.map((row) => {
                        // The first row is the constant. Everything else swings.
                        const constant = row.key === "region";
                        const value = vendor[row.key];

                        return (
                            <div key={row.key} className="px-5 py-5 sm:px-7">
                                <div className="flex items-baseline justify-between gap-3">
                                    <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-500">
                                        {T(row.label)}
                                    </span>
                                    {row.hint && (
                                        <span className={`text-[11px] transition-colors duration-300 ${
                                            constant ? "text-surface-600" : "text-surface-500"
                                        }`}>
                                            {T(row.hint)}
                                        </span>
                                    )}
                                </div>

                                <div className="mt-2.5">
                                    {row.key === "keyholders" ? (
                                        <div className="flex flex-wrap gap-2">
                                            {(value as string[]).map((who) => {
                                                const isYou = who === "jd.you";
                                                return (
                                                    <span
                                                        key={who}
                                                        className={`inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-sm transition-all duration-300 ${
                                                            isYou
                                                                ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/25"
                                                                : tone.chip
                                                        }`}>
                                                        {!isYou && (
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                                                 stroke="currentColor" strokeWidth="2.5"
                                                                 strokeLinecap="round" strokeLinejoin="round">
                                                                <path d="M15 7h3a5 5 0 0 1 0 10h-3m-6 0H6A5 5 0 0 1 6 7h3"/>
                                                                <path d="M8 12h8"/>
                                                            </svg>
                                                        )}
                                                        {TK(who)}
                                                    </span>
                                                );
                                            })}
                                        </div>
                                    ) : row.key === "operator" ? (
                                        <p className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                                            <span className={`text-lg font-semibold transition-colors duration-300 ${tone.operator}`}>
                                                {T(vendor.operator)}
                                            </span>
                                            <span className="text-sm text-surface-500">
                                                {T(vendor.operatorSeat)}
                                            </span>
                                        </p>
                                    ) : constant ? (
                                        <>
                                            <p className="text-base leading-relaxed text-surface-300">
                                                {T("jd.constant")}
                                                <span className="ml-2 inline-flex items-center rounded-md bg-white/[0.04] px-1.5 py-0.5 align-middle text-[11px] text-surface-500 ring-1 ring-inset ring-white/5">
                                                    {T("jd.unchanged")}
                                                </span>
                                            </p>
                                            <p className="mt-1 font-mono text-xs text-surface-500">{T(value as string)}</p>
                                        </>
                                    ) : (
                                        <p className="text-base leading-relaxed text-surface-400">{T(value as string)}</p>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* ── The read-out ──────────────────────────────────── */}
                <div className={`relative flex flex-col justify-between gap-6 border-t border-surface-800/60 p-6 transition-colors duration-500 lg:border-l lg:border-t-0 sm:p-7 ${tone.panel}`}>
                    <div
                        className="pointer-events-none absolute inset-0 opacity-70 transition-opacity duration-500"
                        aria-hidden="true"
                        style={{ background: tone.glow }}
                    />

                    <div className="relative">
                        <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset transition-colors duration-300 ${tone.badge}`}>
                            {vendor.posture !== "us" ? (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>
                                    <path d="m9 12 2 2 4-4"/>
                                </svg>
                            ) : (
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                     strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0"/>
                                    <path d="M12 9v4"/><path d="M12 17h.01"/>
                                </svg>
                            )}
                            {T(tone.verdict)}
                        </span>

                        <p className="mt-4 text-[15px] leading-relaxed text-surface-300">
                            {T(vendor.note)}
                        </p>
                    </div>

                    {/* The one structural sentence the whole page rests on */}
                    <div className="frame relative p-4">
                        <p className="text-[13px] leading-relaxed text-surface-400">
                            {vendor.posture === "none" ? (
                                <>
                                    <b className="text-surface-200">{T("jd.struct.none.lead")}</b>
                                    {T("jd.struct.none.rest")}
                                </>
                            ) : vendor.posture === "eu" ? (
                                <>
                                    {T("jd.struct.eu.a")}{" "}
                                    <b className="text-surface-200">{T("jd.struct.eu.b")}</b>
                                    {T("jd.struct.eu.c")}
                                </>
                            ) : (
                                <>
                                    {T("jd.struct.us.a")}{" "}
                                    <b className="text-surface-200">{T("jd.struct.us.b")}</b>
                                    {T("jd.struct.us.c")} <i>{T("jd.struct.us.could")}</i>{" "}
                                    {T("jd.struct.us.d")}
                                </>
                            )}
                        </p>
                    </div>
                </div>
            </div>

            <p className="border-t border-surface-800/60 bg-surface-950/40 px-5 py-3 text-[11px] leading-relaxed text-surface-500 sm:px-7">
                {T("jd.footnote")}
            </p>
        </div>
    );
}

export default JurisdictionDemo;
