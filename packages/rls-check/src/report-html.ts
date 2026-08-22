/**
 * Rendering: {@link ScanResult} in, one self-contained HTML file out. No
 * Postgres, no I/O — the same contract `report.ts` holds to.
 *
 * This exists because the text report is written for a terminal and the person
 * who needs to act on it is usually not the person who ran it. A `--fail-on`
 * exit code stops a pipeline; it does not survive being forwarded to whoever
 * owns the database. So the HTML form is the artifact: one file, attachable to
 * a ticket, readable by someone who will never install this tool.
 *
 * Four rules shape everything here, and three of them are inherited from
 * `report.ts` on purpose — a second renderer that quietly relaxed them would
 * make the two disagree about the same scan.
 *
 * 1. **Colour is decoration, never information.** Every severity is spelled out
 *    as a word next to its swatch, every section has a textual heading. The
 *    report has to survive being printed in greyscale, which is exactly what
 *    happens when it reaches a compliance review.
 *
 * 2. **Heuristic findings are quarantined.** Their own section, after the
 *    confident ones, behind a sentence saying they need human judgement.
 *
 * 3. **The caveats outrank the findings.** A scan by a privileged role, or one
 *    whose catalogue reads failed, renders its warning above everything — for
 *    the same reason the text report does it: a check that could not run
 *    returns no findings, which looks identical to a check that found nothing.
 *
 * 4. **Nothing leaves the machine, including at read time.** No stylesheet
 *    link, no font host, no script, no image URL — a security report that makes
 *    a network request when opened is not one. It also has to render from
 *    `file://` on a laptop with no connection, which is where it will be read.
 *
 * The security property that matters most here is escaping. Every string in a
 * {@link ScanResult} that is not our own prose — table names, policy names,
 * roles, the `fix` SQL, the server version banner — comes from the scanned
 * database, and this file turns them into markup. A table called
 * `<img src=x onerror=…>` is a legal Postgres identifier. {@link escapeHtml} is
 * applied at every interpolation without exception, including inside `<pre>`,
 * and `renderHtml` never accepts pre-built markup from a caller.
 */

import type { Finding, ScanResult, Severity } from "./types";
import { SEVERITIES } from "./types";
import { formatTarget, severityRank } from "./report";

/**
 * The one primitive this whole file rests on.
 *
 * Escapes the five characters that can change the meaning of markup, in both
 * element and attribute position, so a single function covers every
 * interpolation site and there is no "safe here, unsafe there" judgement to get
 * wrong. Ampersand goes first or it double-escapes the replacements.
 */
export function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export interface HtmlRenderOptions {
    /** Echoed in the summary so the exit code is never a mystery. */
    failOn: Severity | "none";
    /**
     * `host:port` for the header. {@link ScanResult} deliberately carries no
     * port (it is a redaction surface), so the CLI passes the display form in.
     */
    endpoint?: string;
    /** Shown in the header. */
    version?: string;
}

const PLATFORM_LABEL: Record<ScanResult["platform"], string> = {
    supabase: "Supabase",
    neon: "Neon",
    rebase: "Rebase",
    postgrest: "PostgREST",
    unknown: "PostgreSQL (no platform markers)"
};

/** Sort key: worst first, then a stable schema/table/id ordering. */
function compareFindings(a: Finding, b: Finding): number {
    const bySeverity = severityRank(b.severity) - severityRank(a.severity);
    if (bySeverity !== 0) return bySeverity;

    const bySchema = a.target.schema.localeCompare(b.target.schema);
    if (bySchema !== 0) return bySchema;

    const aName = a.target.table ?? a.target.view ?? a.target.routine ?? "";
    const bName = b.target.table ?? b.target.view ?? b.target.routine ?? "";
    const byName = aName.localeCompare(bName);
    if (byName !== 0) return byName;

    const byId = a.id.localeCompare(b.id);
    if (byId !== 0) return byId;

    return (a.target.policy ?? "").localeCompare(b.target.policy ?? "");
}

function plural(count: number, one: string, many: string): string {
    return count === 1 ? one : many;
}

/**
 * Only `https://` and `http://` links are emitted, and only as the whole href.
 *
 * `Finding.docs` is set by our own checks today, so this is defence against a
 * future check that builds the URL from something the database said — a
 * `javascript:` href would be a scripting vector that escaping alone does not
 * close, because the escaped text is perfectly valid inside an attribute.
 */
function safeHref(url: string): string | null {
    return /^https?:\/\//i.test(url) ? url : null;
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

/**
 * Inline, because rule 4 forbids a stylesheet link, and a system font stack
 * because a font host is a network request too.
 *
 * The dark palette is defined only in a `prefers-color-scheme` block over a
 * complete light `:root`, so a viewer whose browser reports no preference gets
 * the light set rather than half of each. Print rules flatten the surfaces to
 * white and keep the severity words, which are what carry the meaning once the
 * colour is gone.
 */
const STYLES = `
:root{
  --ground:#F7F8FA; --surface:#FFFFFF; --surface-2:#EEF1F5;
  --ink:#12161C; --ink-2:#454E5C; --ink-3:#6C7583;
  --line:#DEE3EA; --line-strong:#C3CAD5;
  --brand:#0070F4;
  --critical:#B3261E; --high:#C2410C; --medium:#9A6207; --low:#1F6FA8; --info:#6C7583;
  --critical-bg:rgba(179,38,30,.09); --high-bg:rgba(194,65,12,.09);
  --medium-bg:rgba(154,98,7,.10); --low-bg:rgba(31,111,168,.09); --info-bg:rgba(108,117,131,.09);
  --ok:#0E7A55; --ok-bg:rgba(14,122,85,.10);
  --warn:#9A6207; --warn-bg:rgba(154,98,7,.10);
}
@media (prefers-color-scheme:dark){
  :root{
    --ground:#0D1014; --surface:#151A21; --surface-2:#1C232C;
    --ink:#EAEEF3; --ink-2:#AAB4C1; --ink-3:#7B8592;
    --line:#232B35; --line-strong:#333D49;
    --brand:#5AA6FF;
    --critical:#FF7B72; --high:#FFA657; --medium:#E3B341; --low:#79C0FF; --info:#8B949E;
    --critical-bg:rgba(255,123,114,.12); --high-bg:rgba(255,166,87,.12);
    --medium-bg:rgba(227,179,65,.12); --low-bg:rgba(121,192,255,.12); --info-bg:rgba(139,148,158,.12);
    --ok:#56D4A0; --ok-bg:rgba(86,212,160,.13);
    --warn:#E3B341; --warn-bg:rgba(227,179,65,.13);
  }
}
*{box-sizing:border-box}
body{
  margin:0; background:var(--ground); color:var(--ink);
  font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased;
}
code,pre,.mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace}
.wrap{max-width:940px;margin:0 auto;padding:40px 24px 80px}
a{color:var(--brand)}

header.top{border-bottom:1px solid var(--line-strong);padding-bottom:24px}
.tool{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);font-family:ui-monospace,monospace}
h1{font-size:30px;line-height:1.15;letter-spacing:-.02em;margin:12px 0 0;font-weight:700}
.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px 28px;margin-top:22px}
.fact .k{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-3);font-family:ui-monospace,monospace}
.fact .v{margin-top:3px;font-size:14px;color:var(--ink-2);word-break:break-word}

.verdict{margin:28px 0 0;padding:16px 20px;border-radius:6px;border:1px solid var(--line);background:var(--surface)}
.verdict.clean{background:var(--ok-bg);border-color:var(--ok)}
.verdict.warn{background:var(--warn-bg);border-color:var(--warn)}
.verdict.bad{background:var(--critical-bg);border-color:var(--critical)}
.verdict h2{margin:0 0 4px;font-size:17px;letter-spacing:-.01em}
.verdict p{margin:0;font-size:14.5px;color:var(--ink-2)}

.caveat{margin-top:18px;padding:16px 20px;border-radius:6px;background:var(--warn-bg);border:1px solid var(--warn)}
.caveat h3{margin:0 0 6px;font-size:14px;letter-spacing:.02em}
.caveat p{margin:0 0 8px;font-size:14px;color:var(--ink-2)}
.caveat ul{margin:8px 0 0;padding-left:20px;font-size:13.5px;color:var(--ink-2)}
.caveat li{margin-bottom:4px}
.caveat li code{font-size:12.5px}

.counts{display:flex;flex-wrap:wrap;gap:8px;margin-top:26px}
.count{display:flex;align-items:baseline;gap:7px;padding:7px 12px;border-radius:5px;border:1px solid var(--line);background:var(--surface);font-size:13px}
.count b{font-family:ui-monospace,monospace;font-size:15px;font-variant-numeric:tabular-nums}
.count.zero{opacity:.5}

h2.section{font-size:13px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3);
  font-family:ui-monospace,monospace;margin:44px 0 4px;padding-bottom:8px;border-bottom:1px solid var(--line-strong)}
.lede{font-size:14px;color:var(--ink-2);margin:12px 0 0}

.finding{margin-top:16px;background:var(--surface);border:1px solid var(--line);border-radius:6px;overflow:hidden}
.finding > .head{display:flex;flex-wrap:wrap;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--line)}
.sev{display:inline-flex;align-items:center;gap:6px;font-family:ui-monospace,monospace;font-size:11px;
  font-weight:700;letter-spacing:.08em;text-transform:uppercase;padding:3px 8px;border-radius:4px}
.sev::before{content:"";width:7px;height:7px;border-radius:50%;background:currentColor;flex:none}
.sev.critical{color:var(--critical);background:var(--critical-bg)}
.sev.high{color:var(--high);background:var(--high-bg)}
.sev.medium{color:var(--medium);background:var(--medium-bg)}
.sev.low{color:var(--low);background:var(--low-bg)}
.sev.info{color:var(--info);background:var(--info-bg)}
.cid{font-family:ui-monospace,monospace;font-size:12.5px;font-weight:600}
.target{font-family:ui-monospace,monospace;font-size:12.5px;color:var(--ink-3);word-break:break-all}
.finding > .body{padding:16px 18px}
.finding h3{margin:0 0 10px;font-size:16px;line-height:1.35;letter-spacing:-.01em}
.finding p{margin:0 0 12px;font-size:14.5px;color:var(--ink-2)}
.row{display:grid;grid-template-columns:74px 1fr;gap:12px;margin-top:12px;align-items:start}
.row .k{font-family:ui-monospace,monospace;font-size:10.5px;letter-spacing:.11em;text-transform:uppercase;
  color:var(--ink-3);padding-top:3px}
.row .v{font-size:14.5px;color:var(--ink-2)}
pre{margin:0;padding:12px 14px;background:var(--surface-2);border:1px solid var(--line);border-radius:5px;
  overflow-x:auto;font-size:13px;line-height:1.5;color:var(--ink);white-space:pre}

footer{margin-top:56px;padding-top:20px;border-top:1px solid var(--line-strong);font-size:13px;color:var(--ink-3)}
footer p{margin:0 0 6px}

@media print{
  :root{--ground:#FFF;--surface:#FFF;--surface-2:#F4F4F4;--ink:#000;--ink-2:#222;--ink-3:#555;
    --line:#CCC;--line-strong:#999}
  body{font-size:11pt}
  .wrap{max-width:none;padding:0}
  .finding{break-inside:avoid;page-break-inside:avoid}
  .verdict,.caveat{break-inside:avoid}
}
`.trim();

// ---------------------------------------------------------------------------
// Fragments
// ---------------------------------------------------------------------------

function renderFacts(result: ScanResult, options: HtmlRenderOptions): string {
    const endpoint = options.endpoint ?? result.database.host;

    // Some servers report a bare `18.4`, others a full `PostgreSQL 15.6 on …`.
    // A row reading "Server  18.4" tells the reader nothing.
    const serverVersion = /^[\d.]/.test(result.serverVersion.trim())
        ? `PostgreSQL ${result.serverVersion}`
        : result.serverVersion;

    const scanned = [
        `${result.stats.schemas} ${plural(result.stats.schemas, "schema", "schemas")}`,
        `${result.stats.tables} ${plural(result.stats.tables, "table", "tables")}`,
        `${result.stats.policies} ${plural(result.stats.policies, "policy", "policies")}`,
        `${result.stats.checksRun} ${plural(result.stats.checksRun, "check", "checks")}`
    ].join(" · ");

    const facts: [string, string][] = [
        ["Database", `${endpoint}/${result.database.name}`],
        ["Server", serverVersion],
        ["Platform", PLATFORM_LABEL[result.platform]],
        ["Scanned", scanned]
    ];

    return `<div class="facts">${facts
        .map(
            ([key, value]) =>
                `<div class="fact"><div class="k">${escapeHtml(key)}</div><div class="v">${escapeHtml(value)}</div></div>`
        )
        .join("")}</div>`;
}

/**
 * The one-sentence answer, above everything.
 *
 * "Inconclusive" is its own state and outranks "clean": a scan whose catalogue
 * reads failed has not earned the word clean, and a reader who skims one line
 * of this report must not be told otherwise.
 */
function renderVerdict(result: ScanResult, certain: readonly Finding[], heuristic: readonly Finding[]): string {
    const degraded = result.diagnostics?.degraded ?? [];

    if (degraded.length > 0) {
        return `<div class="verdict warn"><h2>Inconclusive</h2><p>${escapeHtml(
            `${degraded.length} catalogue ${plural(degraded.length, "read", "reads")} failed, so some checks could not run. ` +
                "Findings below are real, but their absence proves nothing."
        )}</p></div>`;
    }

    if (certain.length === 0 && heuristic.length === 0) {
        return `<div class="verdict clean"><h2>No findings</h2><p>${escapeHtml(
            "Every table, view and policy in scope passed all checks."
        )}</p></div>`;
    }

    const worst = certain[0]?.severity;
    const tone = worst === "critical" || worst === "high" ? "bad" : "warn";
    const parts: string[] = [];
    if (certain.length > 0) parts.push(`${certain.length} confirmed ${plural(certain.length, "finding", "findings")}`);
    if (heuristic.length > 0) parts.push(`${heuristic.length} worth checking`);

    return `<div class="verdict ${tone}"><h2>${escapeHtml(parts.join(" · "))}</h2><p>${escapeHtml(
        certain.length > 0
            ? "Confirmed findings are listed first. Each one names the object, what the database will actually do, and how to fix it."
            : "Nothing confirmed. The heuristics below match a shape that is usually a mistake — read them and decide."
    )}</p></div>`;
}

function renderPrivilegeCaveat(): string {
    return `<div class="caveat"><h3>This scan ran as a role RLS cannot constrain</h3><p>${escapeHtml(
        "The connection was a superuser, a table owner, or a role with BYPASSRLS. That is why it could read the true " +
            "catalog, and it is also why nothing below describes what this connection experiences. The findings are " +
            "about what OTHER roles get."
    )}</p></div>`;
}

function renderDegradedCaveat(degraded: readonly { what: string; error: string }[]): string {
    const items = degraded
        .map((item) => `<li><code>${escapeHtml(item.what)}</code> — ${escapeHtml(item.error)}</li>`)
        .join("");

    return `<div class="caveat"><h3>${escapeHtml(
        `This scan was incomplete: ${degraded.length} catalogue ${plural(degraded.length, "read", "reads")} failed`
    )}</h3><p>${escapeHtml(
        "Checks that depend on what could not be read report nothing, which looks exactly like finding nothing. " +
            "Treat this run as inconclusive rather than clean."
    )}</p><ul>${items}</ul></div>`;
}

function renderCounts(result: ScanResult): string {
    const counts = [...SEVERITIES]
        .reverse()
        .map((severity) => {
            const count = result.findings.filter((finding) => finding.severity === severity).length;

            return `<div class="count${count === 0 ? " zero" : ""}"><span class="sev ${severity}">${escapeHtml(
                severity
            )}</span><b>${count}</b></div>`;
        })
        .join("");

    return `<div class="counts">${counts}</div>`;
}

function renderFinding(finding: Finding): string {
    const out: string[] = [];

    out.push('<article class="finding">');
    out.push(
        `<div class="head"><span class="sev ${finding.severity}">${escapeHtml(
            finding.severity
        )}</span><span class="cid">${escapeHtml(finding.id)}</span><span class="target">${escapeHtml(
            formatTarget(finding.target)
        )}</span></div>`
    );
    out.push('<div class="body">');
    out.push(`<h3>${escapeHtml(finding.title)}</h3>`);

    if (finding.detail.trim().length > 0) {
        out.push(`<p>${escapeHtml(finding.detail)}</p>`);
    }

    if (finding.impact.trim().length > 0) {
        out.push(`<div class="row"><div class="k">Impact</div><div class="v">${escapeHtml(finding.impact)}</div></div>`);
    }

    if (finding.fix && finding.fix.trim().length > 0) {
        // `<pre>` and never wrapped: the point of this block is that it survives
        // a copy into a psql session exactly as written.
        out.push(
            `<div class="row"><div class="k">Fix</div><div class="v"><pre>${escapeHtml(
                finding.fix.replace(/\s+$/, "")
            )}</pre></div></div>`
        );
    }

    const href = finding.docs ? safeHref(finding.docs) : null;
    if (href) {
        out.push(
            `<div class="row"><div class="k">Docs</div><div class="v"><a href="${escapeHtml(
                href
            )}">${escapeHtml(href)}</a></div></div>`
        );
    }

    out.push("</div></article>");

    return out.join("");
}

/** Findings grouped under a textual severity heading, worst group first. */
function renderFindingGroups(findings: readonly Finding[], opts: { headings?: boolean } = {}): string {
    const out: string[] = [];
    const showHeadings = opts.headings !== false;

    for (const severity of [...SEVERITIES].reverse()) {
        const group = findings.filter((finding) => finding.severity === severity);
        if (group.length === 0) continue;

        if (showHeadings) {
            out.push(
                `<h2 class="section">${escapeHtml(severity)} · ${group.length} ${escapeHtml(
                    plural(group.length, "finding", "findings")
                )}</h2>`
            );
        }
        for (const finding of group) out.push(renderFinding(finding));
    }

    return out.join("");
}

function renderFooter(result: ScanResult, options: HtmlRenderOptions): string {
    const failing = options.failOn !== "none" &&
        result.findings.some((finding) => severityRank(finding.severity) >= severityRank(options.failOn as Severity));

    const exitLine =
        options.failOn === "none"
            ? "Exit code 0 — --fail-on none, so findings never fail the run."
            : failing
                ? `Exit code 1 — at least one finding is "${options.failOn}" or worse (--fail-on ${options.failOn}).`
                : `Exit code 0 — nothing at or above "${options.failOn}" (--fail-on ${options.failOn}).`;

    return `<footer><p>${escapeHtml(exitLine)}</p><p>${escapeHtml(
        `Scanned ${result.scannedAt} · read-only, and nothing left this machine. This file makes no network requests.`
    )}</p><p>rls-check is free and maintained by the team behind Rebase — <a href="https://rebase.pro">rebase.pro</a></p></footer>`;
}

// ---------------------------------------------------------------------------
// Document
// ---------------------------------------------------------------------------

/**
 * The whole report as one HTML document, ready to write to a file.
 *
 * Deterministic: two scans of an unchanged database differ only by
 * `scannedAt`, which keeps the output diffable when someone commits it.
 */
export function renderHtml(result: ScanResult, options: HtmlRenderOptions): string {
    const certain = result.findings.filter((finding) => finding.confidence !== "heuristic").sort(compareFindings);
    const heuristic = result.findings.filter((finding) => finding.confidence === "heuristic").sort(compareFindings);
    const degraded = result.diagnostics?.degraded ?? [];

    const title = options.version ? `rls-check ${options.version}` : "rls-check";
    const endpoint = options.endpoint ?? result.database.host;

    const body: string[] = [];

    body.push('<div class="wrap">');
    body.push('<header class="top">');
    body.push(`<div class="tool">${escapeHtml(title)} · read-only Row-Level Security audit</div>`);
    body.push(`<h1>${escapeHtml(`${endpoint}/${result.database.name}`)}</h1>`);
    body.push(renderFacts(result, options));
    body.push("</header>");

    body.push(renderVerdict(result, certain, heuristic));

    // Both caveats outrank the findings, and both survive every other option,
    // for the same reason: a check that could not run is indistinguishable in
    // the output from a check that found nothing.
    if (result.scannerIsPrivileged) body.push(renderPrivilegeCaveat());
    if (degraded.length > 0) body.push(renderDegradedCaveat(degraded));

    body.push(renderCounts(result));

    if (certain.length > 0) {
        body.push(renderFindingGroups(certain));
    }

    if (heuristic.length > 0) {
        body.push('<h2 class="section">Worth checking</h2>');
        body.push(
            `<p class="lede">${escapeHtml(
                "These are heuristics, not proofs. They match a shape that is usually a mistake, but each one may be " +
                    "deliberate in your schema — read them and decide. They are listed separately so nothing above " +
                    "needs a second opinion."
            )}</p>`
        );
        body.push(renderFindingGroups(heuristic, { headings: false }));
    }

    body.push(renderFooter(result, options));
    body.push("</div>");

    return [
        "<!doctype html>",
        '<html lang="en">',
        "<head>",
        '<meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width, initial-scale=1">',
        // Belt and braces against rule 4: even if a future edit introduced an
        // external reference, the document is not permitted to fetch it.
        `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`,
        `<title>${escapeHtml(`RLS audit · ${endpoint}/${result.database.name}`)}</title>`,
        `<style>${STYLES}</style>`,
        "</head>",
        "<body>",
        body.join("\n"),
        "</body>",
        "</html>",
        ""
    ].join("\n");
}
