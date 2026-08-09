#!/usr/bin/env node
/**
 * Docs API-drift verifier.
 *
 * Two stages, cheap-first:
 *   1. `api-names` — every locale. Greps code fences for `@rebasepro/*` imports
 *      and SDK member calls, and flags identifiers the packages do not export.
 *      Catches the class of bug where a confidently-written API is invented and
 *      then machine-translated into all six locales.
 *      Stage 1 also carries the checks that are not about fenced TypeScript at
 *      all: deploy build contexts, the marketing site's highlighted-HTML
 *      snippets, the shell commands in the agent skills and example READMEs,
 *      and the agent bundle's own MCP manifests.
 *   2. `snippets` — English + agent skills only (the other locales are
 *      generated from English by website/scripts/translate_docs.mjs). Compiles
 *      each fenced ts/js block against workspace source.
 *
 * Both stages also cover the repository's *own* agent instructions — `AGENT.md`,
 * `.agents/` and `.agent/workflows/` (see AGENT_INSTRUCTION_GLOBS in
 * docs-verify/extract.mjs). They were the one documentation surface no glob
 * reached, and they drifted the whole time everything else stayed clean: the
 * relation API they taught (`cardinality` + `direction`) had not existed since
 * the authored relation type became a closed `kind` union.
 *
 * Usage:
 *   node scripts/verify-docs.mjs              both stages
 *   node scripts/verify-docs.mjs --names      stage 1 only (fast, no compile)
 *   node scripts/verify-docs.mjs --snippets   stage 2 only
 *   node scripts/verify-docs.mjs --strict     exit non-zero on findings
 *
 * Default exit code is 0 (warn-first). Drop `--strict` in once the baseline is
 * clean to make it blocking.
 */
import path from "node:path";
import { writeSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { typecheckSnippets } from "./docs-verify/typecheck-snippets.mjs";
import { checkApiNames } from "./docs-verify/check-api-names.mjs";
import { checkDeployBuildContext } from "./docs-verify/check-deploy-build-context.mjs";
import { checkMarketingSnippets } from "./docs-verify/check-marketing-snippets.mjs";
import { checkDocCommands } from "./docs-verify/check-doc-commands.mjs";
import { checkAgentBundle } from "./docs-verify/check-agent-bundle.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RED = "[0;31m";
const GREEN = "[0;32m";
const YELLOW = "[1;33m";
const DIM = "[2m";
const NC = "[0m";

const argv = process.argv.slice(2);
const strict = argv.includes("--strict");
const asJson = argv.includes("--json");
const verbose = argv.includes("--verbose");
const only = argv.includes("--names") ? "names" : argv.includes("--snippets") ? "snippets" : "both";

let findings = 0;

// Machine-readable mode: emit findings and exit, so tooling (and the
// annotation pass) can consume them without scraping the pretty output.
if (asJson) {
    const out = {};
    if (only !== "snippets") {
        out.names = (await checkApiNames(ROOT)).unknown;
        out.deployBuildContext = checkDeployBuildContext(ROOT).findings;
        out.marketing = checkMarketingSnippets(ROOT).findings;
        out.docCommands = checkDocCommands(ROOT).findings;
        out.agentBundle = checkAgentBundle(ROOT).findings;
    }
    if (only !== "names") {
        const r = await typecheckSnippets(ROOT);
        out.setupErrors = r.setupErrors;
        out.unresolvedImports = r.unresolved;
        out.snippets = r.failures.map((f) => ({
            file: f.snippet.file,
            fenceLine: f.snippet.line,
            lang: f.snippet.lang,
            codes: [...new Set(f.messages.map((m) => m.code))],
            messages: f.messages
        }));
    }
    // `console.log` to a pipe is asynchronous, and `process.exit` does not wait
    // for it: piping a findings-sized payload anywhere truncated it at the 64K
    // pipe buffer, so a consumer saw a subset — or unparseable JSON — and no
    // error. Write synchronously instead.
    writeSync(1, JSON.stringify(out, null, 2) + "\n");
    process.exit(0);
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Docs API names (all locales) ━━━${NC}`);
    const { unknown, scanned, fences } = await checkApiNames(ROOT);
    console.log(`${DIM}Scanned ${fences} code fences across ${scanned} files.${NC}`);
    if (!unknown.length) {
        console.log(`${GREEN}✓ No unknown SDK identifiers referenced.${NC}`);
    } else {
        findings += unknown.length;
        console.log(`${RED}✗ ${unknown.length} unknown identifier reference(s):${NC}`);
        for (const u of unknown) {
            console.log(
                `  ${RED}${u.name}${NC} — not exported by ${u.specifier}` +
                    (u.hint ? ` ${DIM}(${u.hint})${NC}` : "")
            );
            for (const loc of u.locations.slice(0, 6)) console.log(`      ${DIM}${loc}${NC}`);
            if (u.locations.length > 6) {
                console.log(`      ${DIM}… and ${u.locations.length - 6} more${NC}`);
            }
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Deploy-doc build context (all locales) ━━━${NC}`);
    const { findings: bad, scanned } = checkDeployBuildContext(ROOT);
    console.log(`${DIM}Scanned ${scanned} deployment docs.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ No build instruction uses ./backend or ./frontend as its context.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} bad build-context reference(s) — context must be the project root:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}:${b.line}${NC} ${DIM}[${b.rule}]${NC}`);
            console.log(`      ${DIM}${b.text}${NC}`);
            console.log(`      ${DIM}→ ${b.hint}${NC}`);
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Marketing-page snippets ━━━${NC}`);
    const { findings: bad, scanned } = checkMarketingSnippets(ROOT);
    console.log(`${DIM}Scanned ${scanned} marketing components and pages.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ No unknown SDK identifiers or dead CLI commands on the marketing site.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} stale marketing snippet reference(s):${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}:${b.line}${NC}`);
            console.log(`      ${DIM}${b.message}${NC}`);
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Skill + example shell commands ━━━${NC}`);
    const { findings: bad, scanned } = checkDocCommands(ROOT);
    console.log(`${DIM}Scanned ${scanned} skill and example markdown files.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every documented CLI command, flag and run-script exists.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} command(s) a reader cannot run:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}:${b.line}${NC}`);
            console.log(`      ${DIM}${b.message}${NC}`);
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Agent-bundle manifests ━━━${NC}`);
    const { findings: bad, scanned } = checkAgentBundle(ROOT);
    console.log(`${DIM}Scanned ${scanned} MCP manifest(s) in rebase-agent-skills/.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every MCP server manifest names something that exists.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} manifest(s) pointing at nothing:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}${NC}`);
            console.log(`      ${DIM}${b.message}${NC}`);
        }
    }
}

if (only === "both" || only === "snippets") {
    console.log(`\n${YELLOW}━━━ Docs snippet typecheck (en + skills) ━━━${NC}`);
    const { failures, snippetCount, skipped, files, stubbed, setupErrors, unresolved, externalCount } =
        await typecheckSnippets(ROOT);
    console.log(
        `${DIM}Compiled ${snippetCount} snippets from ${files} files ` +
            `(${skipped} opted out via no-verify, ${externalCount} third-party module(s) stubbed).${NC}`
    );

    // A misconfigured verifier reports "clean" for the snippets it can no longer
    // check, so surface it before the results it produced.
    if (setupErrors.length) {
        findings += setupErrors.length;
        console.log(`${RED}✗ ${setupErrors.length} broken module mapping(s) — coverage is silently reduced:${NC}`);
        for (const e of setupErrors) console.log(`    ${e}`);
    }

    if (unresolved.length) {
        findings += unresolved.length;
        console.log(`${RED}✗ ${unresolved.length} unresolvable import(s) — stubbed as \`any\`, so these fences are unchecked:${NC}`);
        for (const u of unresolved) {
            console.log(`  ${RED}${u.specifier}${NC}`);
            for (const loc of u.locations.slice(0, 6)) console.log(`      ${DIM}${loc}${NC}`);
            if (u.locations.length > 6) {
                console.log(`      ${DIM}… and ${u.locations.length - 6} more${NC}`);
            }
            console.log(
                `      ${DIM}→ install it, or add it to EXTERNAL_PACKAGES in ` +
                    `scripts/docs-verify/typecheck-snippets.mjs if the monorepo should not carry it.${NC}`
            );
        }
    }

    if (verbose) {
        const top = [...stubbed].sort((a, b) => b[1] - a[1]).slice(0, 30);
        console.log(`${DIM}Ambient-stubbed identifiers: ${top.map(([n, c]) => `${n}(${c})`).join(", ")}${NC}`);
    }

    if (!failures.length) {
        console.log(`${GREEN}✓ All snippets typecheck against workspace source.${NC}`);
    } else {
        const total = failures.reduce((n, f) => n + f.messages.length, 0);
        findings += total;
        console.log(`${RED}✗ ${total} error(s) in ${failures.length} snippet(s):${NC}`);
        const byFile = new Map();
        for (const f of failures) {
            if (!byFile.has(f.snippet.file)) byFile.set(f.snippet.file, []);
            byFile.get(f.snippet.file).push(f);
        }
        for (const [file, fs] of [...byFile].sort()) {
            const n = fs.reduce((a, f) => a + f.messages.length, 0);
            console.log(`\n  ${YELLOW}${file}${NC} ${DIM}(${n})${NC}`);
            for (const f of fs) {
                for (const m of f.messages) {
                    console.log(`    ${DIM}:${m.docLine}${NC} ${DIM}TS${m.code}${NC} ${m.text}`);
                }
            }
        }
    }
}

console.log("");
if (findings === 0) {
    console.log(`${GREEN}✓ Docs verification clean.${NC}`);
    process.exit(0);
}
if (strict) {
    console.log(`${RED}✗ Docs verification: ${findings} finding(s).${NC}`);
    process.exit(1);
}
console.log(`${YELLOW}⚠ Docs verification: ${findings} finding(s) (warn-only; pass --strict to enforce).${NC}`);
process.exit(0);
