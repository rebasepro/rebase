import React, { useMemo, useState } from "react";

/**
 * "European hosts" deserves an actual map, and the section it replaces was a
 * card grid — the one thing SITE-STORY says a section may not be twice in a row.
 *
 * There is no coastline here on purpose. A hand-authored Europe outline looks
 * wrong in ways readers notice immediately, so the geography is carried by real
 * coordinates on a graticule plus country labels. Every pin is projected from
 * the city's actual latitude and longitude, which means the shape you see is
 * genuinely the shape of European hosting rather than an illustration of it.
 */

interface City {
    name: string;
    country: string;
    lat: number;
    lon: number;
    /**
     * Label placement. European data centres cluster hard around the Rhine, so
     * "always draw the label to the right" puts Frankfurt through Falkenstein.
     * `side` flips the label across the pin, `dy` nudges it off a neighbour.
     */
    side?: "left" | "right";
    dy?: number;
}

interface Host {
    id: string;
    name: string;
    seat: string;
    /** Outside the EU, so it carries a caveat the others do not. */
    nonEu?: boolean;
    cities: City[];
    url: string | null;
    note: string;
}

const C = (name: string, country: string, lat: number, lon: number,
           side?: "left" | "right", dy?: number): City => ({ name, country, lat, lon, side, dy });

const FALKENSTEIN = C("Falkenstein", "Germany", 50.48, 12.37, "right", -5);
const NUREMBERG = C("Nuremberg", "Germany", 49.45, 11.08, "right", 11);
const HELSINKI = C("Helsinki", "Finland", 60.17, 24.94, "left");
const GRAVELINES = C("Gravelines", "France", 50.99, 2.13, "left", -5);
const ROUBAIX = C("Roubaix", "France", 50.69, 3.17, "left", 12);
const STRASBOURG = C("Strasbourg", "France", 48.58, 7.75, "right", 10);
const FRANKFURT = C("Frankfurt", "Germany", 50.11, 8.68, "right", -6);
const WARSAW = C("Warsaw", "Poland", 52.23, 21.01, "right");
const PARIS = C("Paris", "France", 48.86, 2.35, "left");
const AMSTERDAM = C("Amsterdam", "Netherlands", 52.37, 4.90, "left", -4);
const BERLIN = C("Berlin", "Germany", 52.52, 13.40, "right");
const MADRID = C("Madrid", "Spain", 40.42, -3.70, "right");
const LONDON = C("London", "United Kingdom", 51.51, -0.13, "left", 8);
const ZURICH = C("Zurich", "Switzerland", 47.38, 8.54, "right", 10);
const GENEVA = C("Geneva", "Switzerland", 46.20, 6.14, "left");
const VIENNA = C("Vienna", "Austria", 48.21, 16.37, "right");
const SOFIA = C("Sofia", "Bulgaria", 42.70, 23.32, "right");

const HOSTS: Host[] = [
    {
        id: "hetzner",
        name: "Hetzner",
        seat: "Germany",
        cities: [FALKENSTEIN, NUREMBERG, HELSINKI],
        url: "https://www.hetzner.com/cloud/",
        note: "A German GmbH running its own data centres. The reason half of European side-projects are cheap."
    },
    {
        id: "ovh",
        name: "OVHcloud",
        seat: "France",
        cities: [GRAVELINES, ROUBAIX, STRASBOURG, FRANKFURT, WARSAW],
        url: "https://www.ovhcloud.com/en/public-cloud/",
        note: "The largest European host by some distance, and it builds its own servers."
    },
    {
        id: "scaleway",
        name: "Scaleway",
        seat: "France",
        cities: [PARIS, AMSTERDAM, WARSAW],
        url: "https://www.scaleway.com/en/pricing/",
        note: "French, developer-shaped, with a managed Postgres if you would rather not run your own."
    },
    {
        id: "ionos",
        name: "IONOS",
        seat: "Germany",
        cities: [FRANKFURT, BERLIN, MADRID, LONDON],
        url: "https://cloud.ionos.com/",
        note: "The boring enterprise option, which is a compliment when the topic is where your data sleeps."
    },
    {
        id: "upcloud",
        name: "UpCloud",
        seat: "Finland",
        cities: [HELSINKI, FRANKFURT, MADRID, WARSAW],
        url: "https://upcloud.com/pricing",
        note: "Finnish, and unusually loud about disk performance — which is the thing Postgres cares about."
    },
    {
        id: "exoscale",
        name: "Exoscale",
        seat: "Switzerland",
        nonEu: true,
        cities: [ZURICH, GENEVA, VIENNA, FRANKFURT, SOFIA],
        url: "https://www.exoscale.com/pricing/",
        note: "Swiss-seated with EU regions, so read the jurisdiction note below before picking a Swiss one."
    },
    {
        id: "infomaniak",
        name: "Infomaniak",
        seat: "Switzerland",
        nonEu: true,
        cities: [GENEVA],
        url: "https://www.infomaniak.com/en/hosting/public-cloud",
        note: "Swiss, employee-owned, and noisier about renewable power than anyone else on this list."
    }
];

// ── Projection ─────────────────────────────────────────────────────────────
// Equirectangular, with longitude squeezed by cos(mean latitude) so the shape
// is not stretched sideways. Good enough for 20 pins across 30° of latitude.
const LON_MIN = -9, LON_MAX = 30, LAT_MIN = 38.5, LAT_MAX = 63;
const SQUEEZE = Math.cos((48 * Math.PI) / 180);
const W = 620, H = 470, PAD = 34;

const project = (lat: number, lon: number) => {
    const spanX = (LON_MAX - LON_MIN) * SQUEEZE;
    const spanY = LAT_MAX - LAT_MIN;
    const x = PAD + (((lon - LON_MIN) * SQUEEZE) / spanX) * (W - PAD * 2);
    const y = PAD + ((LAT_MAX - lat) / spanY) * (H - PAD * 2);
    return { x, y };
};

// Country labels sit at a representative point, not a centroid — they only have
// to tell the reader which cluster is which.
const LABELS: { text: string; lat: number; lon: number }[] = [
    { text: "FINLAND", lat: 62.4, lon: 25.5 },
    { text: "POLAND", lat: 53.6, lon: 20.0 },
    { text: "GERMANY", lat: 53.4, lon: 9.6 },
    { text: "NETHERLANDS", lat: 53.4, lon: 4.4 },
    { text: "FRANCE", lat: 46.9, lon: 2.0 },
    { text: "SWITZERLAND", lat: 45.2, lon: 7.6 },
    { text: "AUSTRIA", lat: 47.1, lon: 15.4 },
    { text: "SPAIN", lat: 39.6, lon: -4.4 },
    { text: "BULGARIA", lat: 41.6, lon: 24.6 },
    { text: "UK", lat: 53.0, lon: -2.6 }
];

export function EuropeMapDemo() {
    const [activeId, setActiveId] = useState<string | null>(null);
    const active = HOSTS.find((h) => h.id === activeId) ?? null;

    const activeCities = useMemo(
        () => new Set((active?.cities ?? []).map((c) => c.name)),
        [active]
    );

    // Every distinct city across every provider — the pins that are always drawn.
    const allCities = useMemo(() => {
        const seen = new Map<string, City>();
        HOSTS.forEach((h) => h.cities.forEach((c) => seen.set(c.name, c)));
        return [...seen.values()];
    }, []);

    const graticule = useMemo(() => {
        const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
        for (let lon = -10; lon <= LON_MAX; lon += 10) {
            const a = project(LAT_MAX, lon), b = project(LAT_MIN, lon);
            lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
        for (let lat = 40; lat <= LAT_MAX; lat += 5) {
            const a = project(lat, LON_MIN), b = project(lat, LON_MAX);
            lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
        }
        return lines;
    }, []);

    return (
        <div className="frame overflow-hidden">
            <div className="grid grid-cols-1 lg:grid-cols-[1.25fr_0.75fr]">

                {/* ── The map ───────────────────────────────────────── */}
                <div className="relative border-b border-surface-800/60 p-4 sm:p-6 lg:border-b-0 lg:border-r">
                    <div
                        className="pointer-events-none absolute inset-0"
                        aria-hidden="true"
                        style={{ background: "radial-gradient(70% 60% at 50% 40%, rgba(0,112,244,0.10), transparent 72%)" }}
                    />

                    <svg viewBox={`0 0 ${W} ${H}`} className="relative w-full" role="img"
                         aria-label="Data-centre cities of seven European hosting providers, plotted by latitude and longitude">
                        <defs>
                            <radialGradient id="pinGlow">
                                <stop offset="0%" stopColor="rgba(0,112,244,0.55)"/>
                                <stop offset="100%" stopColor="rgba(0,112,244,0)"/>
                            </radialGradient>
                        </defs>

                        {graticule.map((l, i) => (
                            <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2}
                                  stroke="rgba(255,255,255,0.05)" strokeWidth="1"/>
                        ))}

                        {LABELS.map((l) => {
                            const { x, y } = project(l.lat, l.lon);
                            return (
                                <text key={l.text} x={x} y={y} textAnchor="middle"
                                      className="fill-surface-600 font-mono"
                                      style={{ fontSize: 9, letterSpacing: "0.14em" }}>
                                    {l.text}
                                </text>
                            );
                        })}

                        {allCities.map((c) => {
                            const { x, y } = project(c.lat, c.lon);
                            const on = active === null || activeCities.has(c.name);
                            const highlighted = active !== null && activeCities.has(c.name);

                            return (
                                <g key={c.name} className="transition-opacity duration-300"
                                   style={{ opacity: on ? 1 : 0.18 }}>
                                    {highlighted && (
                                        <circle cx={x} cy={y} r="26" fill="url(#pinGlow)">
                                            <animate attributeName="r" values="16;28;16" dur="2.6s" repeatCount="indefinite"/>
                                            <animate attributeName="opacity" values="0.9;0.35;0.9" dur="2.6s" repeatCount="indefinite"/>
                                        </circle>
                                    )}
                                    <circle cx={x} cy={y} r={highlighted ? 5 : 3.5}
                                            className="transition-all duration-300"
                                            fill={highlighted ? "#0070F4" : "rgba(255,255,255,0.35)"}
                                            stroke={highlighted ? "rgba(255,255,255,0.85)" : "none"}
                                            strokeWidth="1.25"/>
                                    {/* Only the selected host's cities are named. Seventeen labels in
                                        the Rhine basin cannot be nudged apart — they have to take
                                        turns, which is also what makes picking a host worth doing.
                                        The country labels carry the geography in the meantime. */}
                                    {highlighted && (
                                        <text
                                            x={c.side === "left" ? x - 9 : x + 9}
                                            y={y + 3.5 + (c.dy ?? 0)}
                                            textAnchor={c.side === "left" ? "end" : "start"}
                                            className="transition-colors duration-300"
                                            fill={highlighted ? "#ffffff" : "rgba(255,255,255,0.42)"}
                                            style={{ fontSize: 10.5 }}>
                                            {c.name}
                                        </text>
                                    )}
                                </g>
                            );
                        })}
                    </svg>

                    <p className="relative mt-1 text-center text-[11px] text-surface-500">
                        {active
                            ? `${active.name} — ${active.cities.length} location${active.cities.length > 1 ? "s" : ""}, seated in ${active.seat}`
                            : "Every pin is a place you could put your Postgres tonight. Pick a host to see whose it is."}
                    </p>
                </div>

                {/* ── The list ──────────────────────────────────────── */}
                <div className="flex flex-col p-5 sm:p-6">
                    <div className="mb-4 flex items-baseline justify-between gap-3">
                        <span className="text-[11px] font-semibold uppercase tracking-[0.15em] text-surface-500">
                            European hosts
                        </span>
                        {active && (
                            <button type="button" onClick={() => setActiveId(null)}
                                    className="text-[11px] text-surface-500 transition-colors hover:text-surface-200">
                                Show all
                            </button>
                        )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                        {HOSTS.map((h) => (
                            <button
                                key={h.id}
                                type="button"
                                onClick={() => setActiveId(h.id === activeId ? null : h.id)}
                                onMouseEnter={() => setActiveId(h.id)}
                                aria-pressed={h.id === activeId}
                                className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-all duration-200 ${
                                    h.id === activeId
                                        ? "bg-primary/10 text-primary ring-1 ring-inset ring-primary/30"
                                        : "text-surface-400 ring-1 ring-inset ring-surface-800 hover:text-surface-200 hover:ring-surface-700"
                                }`}>
                                {h.name}
                            </button>
                        ))}
                    </div>

                    {/* Fixed height so hovering the chips does not reflow the page under the cursor. */}
                    <div className="frame mt-5 min-h-[9.5rem] p-4">
                        {active ? (
                            <>
                                <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
                                    <span className="text-base font-semibold text-white">{active.name}</span>
                                    <span className="text-xs text-surface-500">seated in {active.seat}</span>
                                    {active.nonEu && (
                                        <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-inset ring-amber-500/25">
                                            outside the EU
                                        </span>
                                    )}
                                </div>
                                <p className="mt-2.5 text-sm leading-relaxed text-surface-400">{active.note}</p>
                                <p className="mt-3 font-mono text-[11px] leading-relaxed text-surface-500">
                                    {active.cities.map((c) => c.name).join(" · ")}
                                </p>
                                {active.url && (
                                    <a href={active.url} target="_blank" rel="noopener noreferrer"
                                       className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-surface-500 transition-colors hover:text-primary">
                                        Their pricing
                                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth="2" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round"
                                                  d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25"/>
                                        </svg>
                                    </a>
                                )}
                            </>
                        ) : (
                            <>
                                <p className="text-sm leading-relaxed text-surface-300">
                                    <b className="text-white">{allCities.length} cities. {HOSTS.length} companies.
                                    None of them us.</b>
                                </p>
                                <p className="mt-2.5 text-sm leading-relaxed text-surface-400">
                                    No affiliate links, no referral codes, no partner tier. A container and a Postgres
                                    connection string run anywhere, and where you put them is genuinely none of our
                                    business — which is the entire point of the page you are reading.
                                </p>
                            </>
                        )}
                    </div>

                    <p className="mt-4 pt-4 text-[11px] leading-relaxed text-surface-500 lg:mt-auto">
                        Locations as published by each provider, and they change — check before you commit.
                        Switzerland sits outside the EU under an adequacy decision, which is a different legal
                        position from a member state.
                    </p>
                </div>
            </div>
        </div>
    );
}

export default EuropeMapDemo;
