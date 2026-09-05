/**
 * The always-on instruction files, against the server client they describe.
 *
 * `templates/template/ai-instructions.md` is loaded into every session an
 * assistant has in a scaffolded project, and the page that documents it is
 * translated into six locales. Rule 3 said "always use `rebase.data.<slug>`".
 * `RebaseServerClient` is declared as `Omit<RebaseClient, "data">` — `data` is
 * removed there deliberately, so that server-side code has to say whose
 * identity a read runs under. The one rule an assistant sees before every task
 * named the one accessor that does not exist.
 *
 * Two checks, both derived:
 *
 *   1. Every `rebase.<name>` in those files is a member of
 *      `RebaseServerClient`.
 *   2. Every `@rebasepro/…` subpath in them is one the package actually
 *      publishes, read from its own `exports` map — which catches the other
 *      half of the same drift, a guard import pointed at a subpath that is not
 *      there.
 *   3. Every script in the scaffold's own `package.json` is named in the
 *      instruction file, and the scaffold ships an `.mcp.json` pointing at
 *      `@rebasepro/mcp`. An assistant that has to guess at the run scripts
 *      invents `npm run migrate`; one with no MCP block never finds the tools
 *      at all.
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { loadSdkExports } from "./sdk-exports.mjs";

/** Every file that is loaded into a session, or documents one that is. */
const INSTRUCTION_GLOBS = [
    "packages/cli/templates/template/ai-instructions.md",
    "packages/cli/templates/template/CLAUDE.md",
    "packages/cli/templates/overlays/*/ai-instructions.md",
    "website/src/content/docs/**/ai/instruction-files.md"
];

/**
 * `rebase.` followed by something that is not a member access at all.
 *
 * `rebase.json` is a filename, `rebase.pro` is the domain and
 * `*.rebase.website` is the managed hostname. All three are written in
 * backticks beside real accessors, and all three are fixed strings rather than
 * a category that grows — an unknown fourth one should be reported, not
 * guessed at.
 */
const NOT_ACCESSORS = new Set(["json", "pro", "website"]);

/**
 * Every specifier a `@rebasepro/*` package publishes, from its own `exports`
 * map — the authority on what an import line may name.
 *
 * `PACKAGE_ENTRIES` in `sdk-exports.mjs` lists only the subpaths the snippet
 * typechecker compiles, which is a smaller set on purpose; a subpath missing
 * from it is not a broken import.
 */
function publishedSpecifiers(root) {
    const out = new Set();
    for (const rel of globSync("packages/*/package.json", { cwd: root })) {
        let pkg;
        try {
            pkg = JSON.parse(readFileSync(path.join(root, rel), "utf8"));
        } catch {
            continue;
        }
        if (!pkg.name?.startsWith("@rebasepro/")) continue;
        out.add(pkg.name);
        for (const key of Object.keys(pkg.exports ?? {})) {
            if (key === "." || key === "./package.json") continue;
            out.add(pkg.name + key.replace(/^\./, ""));
        }
    }
    return out;
}

/** Backticked spans and fenced lines — where an identifier is shown, not described. */
function* codeSpans(text) {
    for (const m of text.matchAll(/`([^`\n]+)`/g)) yield { text: m[1], index: m.index };
    let offset = 0;
    let inFence = false;
    for (const line of text.split("\n")) {
        if (/^\s*```/.test(line)) inFence = !inFence;
        else if (inFence) yield { text: line, index: offset };
        offset += line.length + 1;
    }
}

function lineAt(text, index) {
    return text.slice(0, index).split("\n").length;
}

export function checkAiInstructions(root) {
    const findings = [];
    const { membersOf } = loadSdkExports(root);
    const members = membersOf("@rebasepro/types", "RebaseServerClient");
    const specifiers = publishedSpecifiers(root);

    // A resolution failure would silently pass every file. Say so instead.
    if (!members.size) {
        return {
            findings: [
                {
                    file: "packages/types/src/controllers/client.ts",
                    line: 0,
                    message:
                        "`RebaseServerClient` resolved to no members — this check is not running. " +
                        "Fix the type resolution before trusting a clean result."
                }
            ],
            scanned: 0
        };
    }

    const files = new Set(INSTRUCTION_GLOBS.flatMap((g) => globSync(g, { cwd: root })));
    let scanned = 0;

    for (const rel of files) {
        if (rel.split(path.sep).some((p) => p === "node_modules")) continue;
        scanned++;
        const text = readFileSync(path.join(root, rel), "utf8");
        const reported = new Set();
        const report = (line, message) => {
            const key = `${line}:${message}`;
            if (reported.has(key)) return;
            reported.add(key);
            findings.push({ file: rel, line, message });
        };

        for (const span of codeSpans(text)) {
            for (const m of span.text.matchAll(/\brebase\.([A-Za-z_$][\w$]*)/g)) {
                const name = m[1];
                if (NOT_ACCESSORS.has(name) || members.has(name)) continue;
                report(
                    lineAt(text, span.index),
                    `\`rebase.${name}\` — \`RebaseServerClient\` has no \`${name}\`. ` +
                        `Members: ${[...members].sort().join(", ")}`
                );
            }
            for (const m of span.text.matchAll(/@rebasepro\/[\w.-]+(?:\/[\w.-]+)*/g)) {
                const written = m[0];
                if (specifiers.has(written)) continue;
                // Three or more segments past the scope is a path *into* a
                // package — `@rebasepro/app/src/components/…` is a file to read,
                // not an import specifier, and this check has nothing to say
                // about it. Exactly one segment past the package name is a
                // subpath claim, and that is checkable.
                const segments = written.split("/");
                if (segments.length !== 3) continue;
                report(
                    lineAt(text, span.index),
                    `\`${written}\` is not a published subpath of \`${segments[0]}/${segments[1]}\`. ` +
                        `Known: ${[...specifiers].filter((s) => s.startsWith(`${segments[0]}/${segments[1]}`)).sort().join(", ")}`
                );
            }
        }
    }

    checkScaffold(root, findings);
    return { findings, scanned };
}

/** The default `rebase init` layout — the one every quickstart produces. */
const SCAFFOLD = "packages/cli/templates/template";

/**
 * What a fresh scaffold hands its assistant: the run scripts, and the MCP block.
 *
 * The headless overlay is deliberately not checked here. It deletes
 * `config/collections` and ships a smaller script list, so it is a different
 * file's job, and asserting the base template's scripts against it would only
 * teach the check to accept less.
 */
function checkScaffold(root, findings) {
    const instructions = path.join(root, SCAFFOLD, "ai-instructions.md");
    let text;
    try {
        text = readFileSync(instructions, "utf8");
    } catch {
        findings.push({ file: `${SCAFFOLD}/ai-instructions.md`, line: 0, message: "missing" });
        return;
    }

    let scripts = {};
    try {
        scripts = JSON.parse(readFileSync(path.join(root, SCAFFOLD, "package.json"), "utf8")).scripts ?? {};
    } catch {
        /* the template package.json is checked elsewhere */
    }
    for (const name of Object.keys(scripts)) {
        if (text.includes(`\`pnpm ${name}\``) || text.includes(`\`${name}\``)) continue;
        findings.push({
            file: `${SCAFFOLD}/ai-instructions.md`,
            line: 0,
            message:
                `the scaffold declares a \`${name}\` script that this file never names. ` +
                "An assistant that cannot see a command invents one."
        });
    }

    const mcpPath = path.join(root, SCAFFOLD, ".mcp.json");
    let mcp;
    try {
        mcp = JSON.parse(readFileSync(mcpPath, "utf8"));
    } catch {
        findings.push({
            file: `${SCAFFOLD}/.mcp.json`,
            line: 0,
            message: "missing or unparseable — a fresh scaffold must ship the MCP server block"
        });
        return;
    }
    const args = mcp?.mcpServers?.rebase?.args ?? [];
    if (!args.includes("@rebasepro/mcp")) {
        findings.push({
            file: `${SCAFFOLD}/.mcp.json`,
            line: 0,
            message: `\`mcpServers.rebase\` does not run \`@rebasepro/mcp\` (args: ${JSON.stringify(args)})`
        });
    }
}
