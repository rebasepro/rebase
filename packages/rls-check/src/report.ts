/**
 * Rendering: {@link ScanResult} in, text or JSON out. No Postgres, no I/O.
 *
 * Two hard rules shape everything here.
 *
 * 1. Colour is decoration, never information. The plain-text form is what ends
 *    up pasted into a CI log or a GitHub issue, so every severity is spelled
 *    out as a word and every section has a textual heading. Turning colour off
 *    must not remove a single fact.
 *
 * 2. Heuristic findings are quarantined. They render in their own section,
 *    after the confident ones, behind a sentence that says they need human
 *    judgement. A tool that mixes "your table is public" with "this might be a
 *    junction table" trains people to distrust both.
 */

import type { Check, Finding, ScanResult, Severity } from "./types";
import { SEVERITIES } from "./types";

// ---------------------------------------------------------------------------
// Severity ordering
// ---------------------------------------------------------------------------

/** Higher is worse. `info` = 0 … `critical` = 4. */
export function severityRank(severity: Severity): number {
    return SEVERITIES.indexOf(severity);
}

/** The worst severity present, or `null` for an empty list. */
export function maxSeverity(findings: readonly Finding[]): Severity | null {
    let worst: Severity | null = null;
    for (const finding of findings) {
        if (worst === null || severityRank(finding.severity) > severityRank(worst)) {
            worst = finding.severity;
        }
    }

    return worst;
}

/**
 * Does this result trip `--fail-on`? Heuristic findings count: a caller who
 * does not want them can `--skip` the check, but silently discounting them
 * would make the exit code disagree with the report.
 */
export function exceedsThreshold(findings: readonly Finding[], failOn: Severity | "none"): boolean {
    if (failOn === "none") return false;
    const threshold = severityRank(failOn);

    return findings.some((finding) => severityRank(finding.severity) >= threshold);
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

type Paint = (value: string) => string;

const identity: Paint = (value) => value;

const code = (open: number, close: number): Paint => (value) => `\u001B[${open}m${value}\u001B[${close}m`;

interface Style {
    bold: Paint;
    dim: Paint;
    red: Paint;
    boldRed: Paint;
    yellow: Paint;
    cyan: Paint;
    green: Paint;
}

const PLAIN: Style = {
    bold: identity,
    dim: identity,
    red: identity,
    boldRed: identity,
    yellow: identity,
    cyan: identity,
    green: identity
};

const COLOUR: Style = {
    bold: code(1, 22),
    dim: code(2, 22),
    red: code(31, 39),
    boldRed: (value) => `\u001B[1m\u001B[31m${value}\u001B[39m\u001B[22m`,
    yellow: code(33, 39),
    cyan: code(36, 39),
    green: code(32, 39)
};

function severityPaint(style: Style, severity: Severity): Paint {
    switch (severity) {
        case "critical":
            return style.boldRed;
        case "high":
            return style.red;
        case "medium":
            return style.yellow;
        case "low":
            return style.cyan;
        case "info":
            return style.dim;
    }
}

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const DEFAULT_WIDTH = 88;
const MIN_WIDTH = 48;
const MAX_WIDTH = 100;

export function clampWidth(columns: number | undefined): number {
    if (!columns || !Number.isFinite(columns)) return DEFAULT_WIDTH;

    return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Math.floor(columns)));
}

/** Word-wrap, preserving deliberate newlines in the source text. */
function wrap(text: string, width: number): string[] {
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
        const words = paragraph.trim().split(/\s+/).filter((word) => word.length > 0);
        if (words.length === 0) {
            lines.push("");
            continue;
        }
        let current = "";
        for (const word of words) {
            if (current.length === 0) {
                current = word;
            } else if (current.length + 1 + word.length <= width) {
                current += ` ${word}`;
            } else {
                lines.push(current);
                current = word;
            }
        }
        if (current.length > 0) lines.push(current);
    }

    return lines;
}

function indent(lines: readonly string[], pad: string): string[] {
    return lines.map((line) => (line.length === 0 ? "" : pad + line));
}

/**
 * Human-readable object path for a finding. Kept boring on purpose — people
 * grep these out of CI logs.
 */
export function formatTarget(target: Finding["target"]): string {
    const parts: string[] = [];

    if (target.table) {
        parts.push(target.column ? `${target.schema}.${target.table}.${target.column}` : `${target.schema}.${target.table}`);
    } else if (target.view) {
        parts.push(`${target.schema}.${target.view}`);
    } else if (target.routine) {
        parts.push(`${target.schema}.${target.routine}()`);
    } else {
        parts.push(`schema ${target.schema}`);
    }

    if (target.policy) parts.push(`policy "${target.policy}"`);

    return parts.join(" · ");
}

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

const PLATFORM_LABEL: Record<ScanResult["platform"], string> = {
    supabase: "Supabase",
    neon: "Neon",
    rebase: "Rebase",
    postgrest: "PostgREST",
    unknown: "PostgreSQL (no platform markers)"
};

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export interface RenderOptions {
    color: boolean;
    /** Findings only: no banner, no summary. The privilege caveat still prints. */
    quiet?: boolean;
    /** Echoed in the summary so the exit code is never a mystery. */
    failOn: Severity | "none";
    /** Terminal width; clamped into a readable range. */
    width?: number;
    /**
     * `host:port` for the header. {@link ScanResult} deliberately carries no
     * port (it is a redaction surface), so the CLI passes the display form in.
     */
    endpoint?: string;
    /** Shown in the banner. */
    version?: string;
}

const RULE = "─";

/**
 * What the scan could not read, and what that costs.
 *
 * Named per failed read rather than summarised, because which catalogue failed
 * decides which checks went quiet — and the reader is the only one who can
 * judge whether the missing ones mattered.
 */
function renderDegradedCaveat(
    degraded: { what: string; error: string }[],
    style: Style,
    width: number
): string[] {
    const out: string[] = [];
    out.push(style.yellow(`⚠ This scan was incomplete: ${degraded.length} catalogue read(s) failed.`));
    out.push(...wrap(
        "Checks that depend on what could not be read report nothing, which looks exactly " +
        "like finding nothing. Treat this run as inconclusive rather than clean.",
        width
    ));
    for (const item of degraded) {
        out.push(`  • ${item.what}: ${item.error}`);
    }
    return out;
}

export function renderReport(result: ScanResult, options: RenderOptions): string {
    const style = options.color ? COLOUR : PLAIN;
    const width = clampWidth(options.width);
    const out: string[] = [];

    const certain = result.findings.filter((finding) => finding.confidence !== "heuristic").sort(compareFindings);
    const heuristic = result.findings.filter((finding) => finding.confidence === "heuristic").sort(compareFindings);

    if (!options.quiet) {
        out.push(...renderHeader(result, style, width, options));
    }

    // The privilege caveat survives --quiet. Suppressing it would let someone
    // read a clean report as "we are fine" from a scan that could not possibly
    // have observed what a low-privilege caller sees.
    if (result.scannerIsPrivileged) {
        out.push(...renderPrivilegeCaveat(style, width));
        out.push("");
    }

    // The other half of the same disclosure: when the scan came in as a role RLS
    // does constrain, that role was added to the exposed set, which changes
    // which findings appear. Two runs of the same database as different roles
    // are allowed to disagree, and the report has to say why.
    const scanningAs = result.diagnostics?.scanningAsExposedRole;
    if (scanningAs) {
        out.push(...renderConnectingRoleNote(scanningAs, style, width));
        out.push("");
    }

    // Same reasoning as the privilege caveat above, and it survives --quiet for
    // the same reason: a check whose catalogue read failed returns no findings,
    // which is indistinguishable in the output from a check that found nothing.
    // One failed grants read silently disables `rls-disabled`, both view checks
    // and `anonymous-write-allowed`.
    const degraded = result.diagnostics?.degraded ?? [];
    if (degraded.length > 0) {
        out.push(...renderDegradedCaveat(degraded, style, width));
        out.push("");
    }

    // Also survives --quiet, and for the sharpest version of the same reason:
    // every check gates on a grant to an exposed role, and the exposed set is
    // recognised by name. A database served by a role this tool has never heard
    // of produces no findings at all — a green report on an open database.
    const unrecognized = result.diagnostics?.unrecognizedGrantees ?? [];
    if (unrecognized.length > 0) {
        out.push(...renderUnrecognizedRolesCaveat(unrecognized, style, width));
        out.push("");
    }

    if (certain.length === 0 && heuristic.length === 0) {
        out.push(degraded.length > 0
            // Not "no findings": the scan did not finish looking.
            ? style.yellow("No findings from the checks that ran — but the scan was incomplete. See above.")
            : style.green("No findings. Every table, view and policy in scope passed all checks."));
        out.push("");
    }

    if (certain.length > 0) {
        out.push(...renderFindingSections(certain, style, width));
    }

    if (heuristic.length > 0) {
        out.push(style.bold("WORTH CHECKING"));
        out.push(
            ...indent(
                wrap(
                    "These are heuristics, not proofs. They match a shape that is usually a mistake, " +
                        "but each one may be deliberate in your schema — read them and decide. They are " +
                        "listed separately so nothing above needs a second opinion.",
                    width - 2
                ),
                "  "
            ).map(style.dim)
        );
        out.push("");
        out.push(...renderFindingSections(heuristic, style, width, { headings: false }));
    }

    if (!options.quiet) {
        out.push(...renderSummary(result, certain, heuristic, style, width, options));
    }

    return `${out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function renderHeader(result: ScanResult, style: Style, width: number, options: RenderOptions): string[] {
    const out: string[] = [];
    const title = options.version ? `rls-check ${options.version}` : "rls-check";

    out.push(`${style.bold(title)}${style.dim("  ·  read-only Row-Level Security audit")}`);
    out.push(style.dim(RULE.repeat(width)));
    out.push("");

    const endpoint = options.endpoint ?? result.database.host;

    // Some servers report a bare `18.4`, others a full `PostgreSQL 15.6 on …`.
    // A header row reading "Server  18.4" tells the reader nothing.
    const serverVersion = /^[\d.]/.test(result.serverVersion.trim())
        ? `PostgreSQL ${result.serverVersion}`
        : result.serverVersion;

    // Every check gates on this set: a table is only "exposed" when one of these
    // roles can reach it. Printing it in the header is the difference between a
    // reader taking "No findings" at face value and noticing their own API role
    // is not in the list.
    const exposed = result.exposedRoles ?? [];

    const rows: [string, string][] = [
        ["Database", `${endpoint}/${result.database.name}`],
        ["Server", serverVersion],
        ["Platform", PLATFORM_LABEL[result.platform]],
        ["Exposed", `${exposed.length > 0 ? exposed.join(", ") : "PUBLIC"} (add yours with --role)`],
        [
            "Scanned",
            [
                `${result.stats.schemas} ${plural(result.stats.schemas, "schema", "schemas")}`,
                `${result.stats.tables} ${plural(result.stats.tables, "table", "tables")}`,
                `${result.stats.policies} ${plural(result.stats.policies, "policy", "policies")}`,
                `${result.stats.checksRun} ${plural(result.stats.checksRun, "check", "checks")}`
            ].join(" · ")
        ]
    ];

    for (const [label, value] of rows) {
        out.push(`${style.dim(label.padEnd(10))}${value}`);
    }
    out.push("");

    return out;
}

function renderPrivilegeCaveat(style: Style, width: number): string[] {
    const body = wrap(
        "This scan connected as a role that row-level security cannot constrain — a superuser, " +
            "a table owner, or a role with BYPASSRLS. That is why it can read the true catalog, " +
            "and it is also why nothing below describes what this connection experiences. " +
            "The findings are about what OTHER roles get.",
        width - 8
    );

    const out: string[] = [];
    out.push(`${style.yellow("Note")}  ${body[0] ?? ""}`);
    for (const line of body.slice(1)) out.push(`      ${line}`);

    return out;
}

/**
 * The scan connected as a role row-level security constrains, so that role was
 * treated as exposed.
 *
 * The counterpart to {@link renderPrivilegeCaveat}: one says "nothing below
 * describes this connection", the other says "this connection is one of the
 * things below". Both are disclosures about what the exposed set contains,
 * which is the only reason any of the findings say what they say.
 */
function renderConnectingRoleNote(role: string, style: Style, width: number): string[] {
    const body = wrap(
        `This scan connected as "${role}", which row-level security does constrain — no superuser, ` +
            "no BYPASSRLS, no ownership of the scanned tables. It has therefore been treated as a role " +
            "an untrusted caller can arrive as, and the findings below include what it reaches. " +
            "Scanning the same database as a privileged role will report a different set.",
        width - 8
    );

    const out: string[] = [];
    out.push(`${style.yellow("Note")}  ${body[0] ?? ""}`);
    for (const line of body.slice(1)) out.push(`      ${line}`);

    return out;
}

/**
 * The caveat that keeps a false negative from reading as a pass.
 *
 * Deliberately not a finding: the scan has no evidence that any of these roles
 * is reachable, and inventing a critical for every service account would be the
 * mirror of the bug it exists to prevent. It is a caveat with an exact remedy —
 * one flag, named roles — so the reader can convert it into real coverage.
 */
function renderUnrecognizedRolesCaveat(roles: string[], style: Style, width: number): string[] {
    const shown = roles.slice(0, 6);
    const rest = roles.length - shown.length;
    const list = shown.map((r) => `"${r}"`).join(", ") + (rest > 0 ? `, and ${rest} more` : "");

    const body = wrap(
        `${list} can read or write scanned tables here, and ` +
            "this scan does not know whether requests arrive as " +
            `${plural(roles.length, "it", "them")}. The checks only report a table as exposed when an ` +
            "exposed role can reach it, so anything served through " +
            `${plural(roles.length, "this role", "these roles")} was NOT assessed. If your ` +
            "application connects as one of them, re-run naming it — " +
            `for example: --role ${shown[0] ?? "app_user"}`,
        width - 8
    );

    const out: string[] = [];
    out.push(`${style.yellow("Note")}  ${body[0] ?? ""}`);
    for (const line of body.slice(1)) out.push(`      ${line}`);

    return out;
}

function renderFindingSections(
    findings: readonly Finding[],
    style: Style,
    width: number,
    opts: { headings?: boolean } = {}
): string[] {
    const out: string[] = [];
    const showHeadings = opts.headings !== false;

    for (const severity of [...SEVERITIES].reverse()) {
        const group = findings.filter((finding) => finding.severity === severity);
        if (group.length === 0) continue;

        if (showHeadings) {
            const paint = severityPaint(style, severity);
            out.push(
                `${paint(severity.toUpperCase())}${style.dim(
                    `  ·  ${group.length} ${plural(group.length, "finding", "findings")}`
                )}`
            );
            out.push(style.dim(RULE.repeat(width)));
            out.push("");
        }

        for (const finding of group) {
            out.push(...renderFinding(finding, style, width));
            out.push("");
        }
    }

    return out;
}

function renderFinding(finding: Finding, style: Style, width: number): string[] {
    const out: string[] = [];
    const paint = severityPaint(style, finding.severity);
    const body = width - 6;

    out.push(`  ${paint(`[${finding.severity}]`)} ${style.bold(finding.id)}  ${style.cyan(formatTarget(finding.target))}`);
    out.push(...indent(wrap(finding.title, body), "      "));

    if (finding.detail.trim().length > 0) {
        // A blank line, because without colour the title and the detail are the
        // same shape, and this is the form that ends up in a bug report.
        out.push("");
        out.push(...indent(wrap(finding.detail, body), "      ").map(style.dim));
    }

    if (finding.impact.trim().length > 0) {
        const impact = wrap(finding.impact, body - 8);
        out.push(`      ${style.bold("Impact")}  ${impact[0] ?? ""}`);
        for (const line of impact.slice(1)) out.push(`              ${line}`);
    }

    if (finding.fix && finding.fix.trim().length > 0) {
        out.push(`      ${style.bold("Fix")}`);
        // Never wrapped: the point of this block is that it survives a copy.
        for (const line of finding.fix.replace(/\s+$/, "").split("\n")) {
            out.push(line.length === 0 ? "" : `          ${style.green(line)}`);
        }
    }

    if (finding.docs) {
        out.push(`      ${style.dim("Docs")}    ${style.dim(finding.docs)}`);
    }

    return out;
}

function renderSummary(
    result: ScanResult,
    certain: readonly Finding[],
    heuristic: readonly Finding[],
    style: Style,
    width: number,
    options: RenderOptions
): string[] {
    const out: string[] = [];

    out.push(style.dim(RULE.repeat(width)));
    out.push(style.bold("Summary"));
    out.push("");

    const counts = [...SEVERITIES]
        .reverse()
        .map((severity) => {
            const count = result.findings.filter((finding) => finding.severity === severity).length;
            const text = `${severity} ${count}`;

            return count === 0 ? style.dim(text) : severityPaint(style, severity)(text);
        })
        .join(style.dim("   "));
    out.push(`  ${counts}`);

    out.push(
        `  ${style.dim(
            `${certain.length} confirmed · ${heuristic.length} worth checking · ` +
                `${result.stats.checksRun} ${plural(result.stats.checksRun, "check", "checks")} run against ` +
                `${result.stats.tables} ${plural(result.stats.tables, "table", "tables")} in ` +
                `${result.stats.schemas} ${plural(result.stats.schemas, "schema", "schemas")}`
        )}`
    );

    if (result.stats.tablesWithoutRls > 0) {
        out.push(
            `  ${style.dim(
                `${result.stats.tablesWithoutRls} of ${result.stats.tables} ${plural(
                    result.stats.tables,
                    "table has",
                    "tables have"
                )} row-level security disabled`
            )}`
        );
    }
    out.push("");

    const failing = exceedsThreshold(result.findings, options.failOn);
    if (options.failOn === "none") {
        out.push(`  ${style.dim("Exit code 0 — --fail-on none, so findings never fail the run.")}`);
    } else if (failing) {
        out.push(
            `  ${style.bold("Exit code 1")} ${style.dim(
                `— at least one finding is "${options.failOn}" or worse (--fail-on ${options.failOn}).`
            )}`
        );
    } else {
        out.push(
            `  ${style.bold("Exit code 0")} ${style.dim(
                `— nothing at or above "${options.failOn}" (--fail-on ${options.failOn}).`
            )}`
        );
    }
    out.push(`  ${style.dim(`Scanned ${result.scannedAt} · read-only, and nothing left this machine.`)}`);
    out.push("");
    out.push(style.dim("rls-check is free and maintained by the team behind Rebase — https://rebase.pro"));

    return out;
}

function plural(count: number, one: string, many: string): string {
    return count === 1 ? one : many;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

/**
 * Exactly the {@link ScanResult} shape, pretty-printed, nothing else. This is
 * the contract other people build on: stable keys, no ANSI, no wrapper object,
 * no timing noise that would make two identical scans diff.
 */
export function renderJson(result: ScanResult): string {
    const sorted: ScanResult = {
        ...result,
        findings: [...result.findings].sort(compareFindings)
    };

    return JSON.stringify(sorted, null, 2);
}

// ---------------------------------------------------------------------------
// Catalog
// ---------------------------------------------------------------------------

/**
 * `--list-checks`. Ordered by the severity the check *can* emit is tempting,
 * but a check has no fixed severity — so this is plain alphabetical by id,
 * which is also the order people write `--skip` lists in.
 */
export function renderCheckCatalog(checks: readonly Check[], options: { color: boolean; width?: number }): string {
    const style = options.color ? COLOUR : PLAIN;
    const width = clampWidth(options.width);
    const sorted = [...checks].sort((a, b) => a.id.localeCompare(b.id));
    const idWidth = sorted.reduce((max, check) => Math.max(max, check.id.length), 0);

    const out: string[] = [];
    out.push(style.bold(`${sorted.length} ${plural(sorted.length, "check", "checks")}`));
    out.push(style.dim(RULE.repeat(width)));
    out.push("");

    for (const check of sorted) {
        out.push(`  ${style.bold(check.id.padEnd(idWidth))}  ${check.title}`);
        const description = wrap(check.description, Math.max(MIN_WIDTH, width - idWidth - 6));
        for (const line of description) {
            out.push(`  ${" ".repeat(idWidth)}  ${style.dim(line)}`);
        }
        out.push("");
    }

    out.push(style.dim("Use --only <id> or --skip <id> (repeatable, or comma-separated) to select checks."));

    return `${out.join("\n")}\n`;
}
