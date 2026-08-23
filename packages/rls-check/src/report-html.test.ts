/**
 * Unit tests for the HTML report.
 *
 * The escaping block is the important one, for the same reason the redaction
 * block matters in `report.test.ts`: this renderer turns strings the *scanned
 * database* chose — table names, policy names, roles, error text — into markup,
 * and the resulting file is meant to be forwarded to someone else. A report
 * that executes the database's content when a colleague opens it would be a
 * vulnerability shipped by a security tool.
 *
 * Everything else pins a rule the renderer inherits from `report.ts`: the
 * caveats outrank the findings, heuristics stay quarantined, and severity is
 * always a word and never only a colour.
 */

import { describe, expect, it } from "vitest";

import { escapeHtml, renderHtml, type HtmlRenderOptions } from "./report-html";
import type { Finding, ScanResult } from "./types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function finding(overrides: Partial<Finding> = {}): Finding {
    return {
        id: "rls-disabled",
        severity: "critical",
        title: "Row-level security is not enabled on public.profiles",
        target: { schema: "public", table: "profiles" },
        detail: "The table has row-level security disabled, so every policy on it is inert.",
        impact: "Any caller reaching this table over an API reads and writes every row.",
        fix: "ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;\nALTER TABLE public.profiles FORCE ROW LEVEL SECURITY;",
        docs: "https://rebase.pro/docs/rls-check#rls-disabled",
        confidence: "certain",
        ...overrides
    };
}

function result(overrides: Partial<ScanResult> = {}): ScanResult {
    return {
        diagnostics: { degraded: [], tlsVerificationDisabled: false, excludedSchemas: [], unrecognizedGrantees: [] },
        scannedAt: "2026-07-26T09:00:00.000Z",
        database: { host: "db.abcdefghijkl.supabase.co", name: "postgres" },
        serverVersion: "PostgreSQL 15.6 on aarch64-unknown-linux-gnu",
        platform: "supabase",
        scannerIsPrivileged: false,
        stats: { schemas: 2, tables: 18, policies: 24, tablesWithoutRls: 3, checksRun: 14 },
        findings: [finding()],
        ...overrides
    };
}

const OPTIONS: HtmlRenderOptions = {
    failOn: "high",
    endpoint: "db.abcdefghijkl.supabase.co:5432",
    version: "0.16.0"
};

function render(overrides: Partial<ScanResult> = {}, options: HtmlRenderOptions = OPTIONS): string {
    return renderHtml(result(overrides), options);
}

// ---------------------------------------------------------------------------
// Escaping
// ---------------------------------------------------------------------------

describe("escapeHtml", () => {
    it("escapes every character that can change the meaning of markup", () => {
        expect(escapeHtml(`<a href="x" title='y'>&</a>`)).toBe(
            "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;&lt;/a&gt;"
        );
    });

    it("escapes the ampersand first, so replacements are not double-escaped", () => {
        expect(escapeHtml("<")).toBe("&lt;");
        expect(escapeHtml("&lt;")).toBe("&amp;lt;");
    });
});

/**
 * Every tag this renderer is allowed to open. The escaping test below asserts
 * that no other tag name ever appears — which is a stronger claim than "the
 * payload string is absent", because it fails for any injection shape, not the
 * one the test happened to imagine.
 */
const EMITTED_TAGS = new Set([
    "!doctype", "html", "head", "meta", "title", "style", "body",
    "div", "header", "h1", "h2", "h3", "p", "ul", "li", "span", "b",
    "article", "pre", "code", "a", "footer"
]);

/** Tag names the document actually opens or closes, in order. */
function tagsIn(html: string): string[] {
    return [...html.matchAll(/<\/?([a-zA-Z!][a-zA-Z0-9-]*)/g)].map((match) => match[1].toLowerCase());
}

describe("hostile content from the scanned database", () => {
    /** A legal Postgres identifier, and a stored-XSS payload. */
    const PAYLOAD = `<img src=x onerror="alert(1)">`;

    it("never opens a tag the renderer does not emit itself", () => {
        const html = render({
            database: { host: `h${PAYLOAD}`, name: `db${PAYLOAD}` },
            serverVersion: `PostgreSQL ${PAYLOAD}`,
            findings: [
                finding({
                    target: { schema: `s${PAYLOAD}`, table: `t${PAYLOAD}`, policy: `p${PAYLOAD}` },
                    title: `title ${PAYLOAD}`,
                    detail: `detail ${PAYLOAD}`,
                    impact: `impact ${PAYLOAD}`,
                    fix: `SELECT '${PAYLOAD}';`
                })
            ],
            diagnostics: {
                degraded: [{ what: `read ${PAYLOAD}`, error: `error ${PAYLOAD}` }],
                tlsVerificationDisabled: false,
                excludedSchemas: [],
                unrecognizedGrantees: []
            }
        }, { ...OPTIONS, endpoint: `endpoint${PAYLOAD}` });

        const unexpected = [...new Set(tagsIn(html))].filter((tag) => !EMITTED_TAGS.has(tag));

        expect(unexpected).toEqual([]);
        expect(html).not.toContain(PAYLOAD);
        // …and the content is still present, escaped, rather than dropped. The
        // word `onerror` survives as text, which is exactly right: inside text
        // content it is prose, and dropping it would hide what the table is
        // really called from the person reading the report.
        expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    });

    it("escapes a payload inside the copy-pasteable fix block", () => {
        const html = render({ findings: [finding({ fix: `CREATE POLICY "</pre><script>alert(1)</script>" ON t;` })] });

        expect(html).not.toContain("<script>");
        expect(html).toContain("&lt;/pre&gt;&lt;script&gt;");
    });

    it("drops a docs link that is not http(s)", () => {
        // eslint-disable-next-line no-script-url
        const html = render({ findings: [finding({ docs: "javascript:alert(1)" })] });

        expect(html).not.toContain("javascript:");
        expect(html).not.toContain(">Docs<");
    });

    it("keeps an ordinary https docs link", () => {
        const html = render();

        expect(html).toContain('href="https://rebase.pro/docs/rls-check#rls-disabled"');
    });
});

// ---------------------------------------------------------------------------
// Nothing leaves the machine
// ---------------------------------------------------------------------------

describe("the document is self-contained", () => {
    const html = render();

    it("has no script, stylesheet link, or embedded resource", () => {
        expect(html).not.toMatch(/<script/i);
        expect(html).not.toMatch(/<link/i);
        expect(html).not.toMatch(/\ssrc=/i);
        expect(html).not.toMatch(/@import/i);
        expect(html).not.toMatch(/url\(/i);
    });

    it("declares a Content-Security-Policy that forbids fetching anything", () => {
        expect(html).toContain("default-src 'none'");
    });

    it("says so in the footer, because the claim is the point", () => {
        expect(html).toContain("nothing left this machine");
        expect(html).toContain("This file makes no network requests");
    });

    it("carries its own styles inline", () => {
        expect(html).toMatch(/<style>/);
        expect(html).toContain("prefers-color-scheme");
        expect(html).toContain("@media print");
    });
});

// ---------------------------------------------------------------------------
// Caveats outrank findings
// ---------------------------------------------------------------------------

describe("caveats", () => {
    it("warns when the scanning role could not be constrained by RLS", () => {
        const html = render({ scannerIsPrivileged: true });

        expect(html).toContain("This scan ran as a role RLS cannot constrain");
        expect(html).toContain("about what OTHER roles get");
    });

    it("omits that warning for an unprivileged scan", () => {
        expect(render()).not.toContain("RLS cannot constrain");
    });

    it("names every catalogue read that failed", () => {
        const html = render({
            diagnostics: {
                degraded: [{ what: "role_table_grants", error: "permission denied" }],
                tlsVerificationDisabled: false,
                excludedSchemas: [],
                unrecognizedGrantees: []
            }
        });

        expect(html).toContain("role_table_grants");
        expect(html).toContain("permission denied");
        expect(html).toContain("Treat this run as inconclusive rather than clean");
    });

    it("calls a degraded scan inconclusive rather than clean, even with no findings", () => {
        const html = render({
            findings: [],
            diagnostics: {
                degraded: [{ what: "pg_policies", error: "timeout" }],
                tlsVerificationDisabled: false,
                excludedSchemas: [],
                unrecognizedGrantees: []
            }
        });

        expect(html).toContain("Inconclusive");
        expect(html).not.toContain("No findings</h2>");
    });
});

// ---------------------------------------------------------------------------
// Verdict and structure
// ---------------------------------------------------------------------------

describe("the verdict", () => {
    it("reports a clean scan as no findings", () => {
        const html = render({ findings: [] });

        expect(html).toContain("No findings");
        expect(html).toContain("Every table, view and policy in scope passed all checks");
    });

    it("counts confirmed findings separately from heuristics", () => {
        const html = render({
            findings: [finding(), finding({ id: "junction-table-unprotected", confidence: "heuristic", severity: "low" })]
        });

        expect(html).toContain("1 confirmed finding · 1 worth checking");
    });
});

describe("heuristics stay quarantined", () => {
    const html = render({
        findings: [
            finding({ id: "junction-table-unprotected", confidence: "heuristic", severity: "low" }),
            finding()
        ]
    });

    it("puts them under their own heading with the judgement caveat", () => {
        expect(html).toContain("Worth checking");
        expect(html).toContain("These are heuristics, not proofs");
    });

    it("places every confident finding before the heuristic section", () => {
        expect(html.indexOf("rls-disabled")).toBeLessThan(html.indexOf("Worth checking"));
        expect(html.indexOf("Worth checking")).toBeLessThan(html.indexOf("junction-table-unprotected"));
    });
});

describe("severity is a word, not only a colour", () => {
    it("spells out every severity in the summary counts", () => {
        const html = render();

        for (const severity of ["critical", "high", "medium", "low", "info"]) {
            expect(html).toContain(`>${severity}</span>`);
        }
    });

    it("labels each finding with its severity as text", () => {
        expect(render()).toContain('<span class="sev critical">critical</span>');
    });
});

describe("ordering and determinism", () => {
    it("renders the worst severity first", () => {
        const html = render({
            findings: [
                finding({ id: "low-one", severity: "low" }),
                finding({ id: "critical-one", severity: "critical" })
            ]
        });

        expect(html.indexOf("critical-one")).toBeLessThan(html.indexOf("low-one"));
    });

    it("is byte-identical across two renders of the same result", () => {
        const scan = result();

        expect(renderHtml(scan, OPTIONS)).toBe(renderHtml(scan, OPTIONS));
    });
});

describe("the exit-code line", () => {
    it("explains a failing threshold", () => {
        // The threshold is quoted in the prose, and the prose is escaped like
        // everything else — so the bytes carry `&quot;`, not `"`.
        expect(render()).toContain("Exit code 1 — at least one finding is &quot;high&quot; or worse");
    });

    it("explains a passing threshold", () => {
        expect(render({ findings: [finding({ severity: "low" })] })).toContain("Exit code 0 — nothing at or above");
    });

    it("explains --fail-on none", () => {
        expect(render({}, { ...OPTIONS, failOn: "none" })).toContain("--fail-on none, so findings never fail the run");
    });
});
