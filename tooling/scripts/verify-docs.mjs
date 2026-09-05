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
 *      all: deploy build contexts, version pins, the marketing site's
 *      highlighted-HTML snippets, the shell commands in the agent skills and
 *      example READMEs, and the agent bundle's own MCP manifests.
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
 *   node tooling/scripts/verify-docs.mjs              both stages
 *   node tooling/scripts/verify-docs.mjs --names      stage 1 only (fast, no compile)
 *   node tooling/scripts/verify-docs.mjs --snippets   stage 2 only
 *   node tooling/scripts/verify-docs.mjs --strict     exit non-zero on findings
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
import { checkProseTypes } from "./docs-verify/check-prose-types.mjs";
import { checkVersionPins } from "./docs-verify/check-version-pins.mjs";
import { checkEnvReference } from "./docs-verify/check-env-reference.mjs";
import { checkUpgradeCoverage } from "./docs-verify/check-upgrade-coverage.mjs";
import { checkRlsCheckCount } from "./docs-verify/check-rls-check-count.mjs";
import { checkErrorCodes } from "./docs-verify/check-error-codes.mjs";
import { checkMcpToolTables } from "./docs-verify/check-mcp-tool-tables.mjs";
import { checkAiInstructions } from "./docs-verify/check-ai-instructions.mjs";
import { checkSkillClaims } from "./docs-verify/check-skill-claims.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

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
        out.proseTypes = checkProseTypes(ROOT).findings;
        out.versionPins = checkVersionPins(ROOT).findings;
        out.envReference = checkEnvReference(ROOT).findings;
        out.upgradeCoverage = checkUpgradeCoverage(ROOT).findings;
        out.errorCodes = checkErrorCodes(ROOT).findings;
        out.mcpToolTables = checkMcpToolTables(ROOT).findings;
        out.aiInstructions = checkAiInstructions(ROOT).findings;
        out.skillClaims = checkSkillClaims(ROOT).findings;
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
    console.log(`\n${YELLOW}━━━ Version pins (all locales + infra) ━━━${NC}`);
    const { findings: bad, scanned, expected } = checkVersionPins(ROOT);
    console.log(`${DIM}Scanned ${scanned} files against @rebasepro/server ${expected}.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every version a reader would copy names ${expected}.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} stale version pin(s) — expected ${expected}:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}:${b.line}${NC} ${DIM}[${b.rule}]${NC} ${b.what} is ${RED}${b.found}${NC}`);
            console.log(`      ${DIM}${b.text}${NC}`);
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Upgrade-guide coverage ━━━${NC}`);
    const { findings: bad, scanned } = checkUpgradeCoverage(ROOT);
    console.log(`${DIM}Checked ${scanned} release(s) that declare a breaking change.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every breaking release is covered by the upgrade guide.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} breaking release(s) missing from the upgrade guide:${NC}`);
        for (const b of bad) console.log(`  ${RED}${b.version}${NC} ${DIM}(${b.entries} breaking section)${NC}`);
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ rls-check count ━━━${NC}`);
    const { findings: bad, packageCount, scanned } = checkRlsCheckCount(ROOT);
    console.log(`${DIM}rls-check ships ${packageCount} checks; scanned ${scanned} file(s) that talk about it.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every stated check count matches the tool.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} stated count(s) disagree with the tool:${NC}`);
        for (const b of bad) console.log(`  ${RED}${b.file}:${b.line}${NC}\n      ${DIM}${b.message}${NC}`);
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Error-code reference ━━━${NC}`);
    const { findings: bad, scanned, total } = checkErrorCodes(ROOT);
    console.log(`${DIM}Found ${total} error code(s) across ${scanned} source file(s).${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every code the server can raise is documented, and every documented code exists.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} error-code reference problem(s):${NC}`);
        for (const b of bad) console.log(`  ${RED}${b.code}${NC}\n      ${DIM}${b.message}${NC}`);
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Environment reference ━━━${NC}`);
    const { findings: bad, scanned } = checkEnvReference(ROOT);
    console.log(`${DIM}Checked ${scanned} validated variable(s) against the configuration page.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every environment variable the runtime validates is documented.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} validated variable(s) missing from the reference:${NC}`);
        for (const key of bad) console.log(`  ${RED}${key}${NC}`);
        console.log(`      ${DIM}That page promises it lists every variable the schema validates.${NC}`);
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
    console.log(`\n${YELLOW}━━━ Always-on instruction files (all locales) ━━━${NC}`);
    const { findings: bad, scanned } = checkAiInstructions(ROOT);
    console.log(`${DIM}Scanned ${scanned} instruction file(s) against RebaseServerClient.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every accessor and specifier a scaffold teaches exists.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} rule(s) naming something that does not exist:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}:${b.line}${NC}`);
            console.log(`      ${DIM}${b.message}${NC}`);
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Skill claims against source ━━━${NC}`);
    const { findings: bad, scanned } = checkSkillClaims(ROOT);
    console.log(`${DIM}Checked ${scanned} skill file(s) against the values the code declares.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every limit, path, signature and count a skill states matches source.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} claim(s) the code contradicts:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}${NC}`);
            console.log(`      ${DIM}${b.message}${NC}`);
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ MCP tool tables ━━━${NC}`);
    const { findings: bad } = checkMcpToolTables(ROOT);
    console.log(`${DIM}Compared packages/mcp/README.md against ALL_TOOLS.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ The npm README's tool tables are the ones the server registers.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} generated block(s) out of date:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}${NC}`);
            console.log(`      ${DIM}${b.message}${NC}`);
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Agent bundle: manifests, tool names, repository URLs ━━━${NC}`);
    const { findings: bad, scanned } = checkAgentBundle(ROOT);
    console.log(`${DIM}Scanned ${scanned} MCP manifest(s), plus every tool name and first-party URL in tooling/rebase-agent-skills/.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every launcher, tool name and repository URL in the bundle names something that exists.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} reference(s) pointing at nothing:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}${NC}`);
            console.log(`      ${DIM}${b.message}${NC}`);
        }
    }
}

if (only === "both" || only === "names") {
    console.log(`\n${YELLOW}━━━ Type names claimed in prose (all locales) ━━━${NC}`);
    const { findings: bad, scanned } = checkProseTypes(ROOT);
    console.log(`${DIM}Scanned ${scanned} documentation files.${NC}`);
    if (!bad.length) {
        console.log(`${GREEN}✓ Every type name written outside a fence is declared.${NC}`);
    } else {
        findings += bad.length;
        console.log(`${RED}✗ ${bad.length} type name(s) that do not exist:${NC}`);
        for (const b of bad) {
            console.log(`  ${RED}${b.file}:${b.line}${NC}`);
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
                    `tooling/scripts/docs-verify/typecheck-snippets.mjs if the monorepo should not carry it.${NC}`
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
