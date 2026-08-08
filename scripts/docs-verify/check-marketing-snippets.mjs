/**
 * API-name check for the *marketing* pages, not the docs.
 *
 * The docs and the agent skills are covered twice over — `check-api-names.mjs`
 * greps every locale, and `typecheck-snippets.mjs` compiles the English fences
 * against workspace source. The marketing site was covered by neither, because
 * its snippets are not fenced code: they are syntax-highlighted HTML, written
 * as template literals full of `<span class="...">`, so nothing that looks for
 * ```ts finds them.
 *
 * That gap is not theoretical. It let a landing page ship `createClient()`
 * (never exported — the function is `createRebaseClient`), `client.orders
 * .retrieve(...)` and `.list(...)` (neither exists), `rebase.init({projectId})`
 * (a Firebase-shaped API Rebase never had), `.where("status", "eq", ...)`
 * (the operator is `"=="`), and `channel.on("message", ...)` — the exact call
 * `check-api-names.mjs` was built to catch, sitting on the page a reader is
 * most likely to copy from first.
 *
 * The check strips the markup back to source and then applies two tests:
 *
 *   1. Named imports from `@rebasepro/*` must be exported by that package.
 *   2. A small list of APIs that are *known* not to exist — the shapes above —
 *      must not appear. This is deliberately a denylist rather than a full
 *      parse: marketing snippets are elided and abbreviated on purpose, so
 *      compiling them would be all false positives. Naming the specific wrong
 *      spellings costs nothing and catches the regression that actually
 *      happens, which is someone copying an old snippet forward.
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { loadSdkExports } from "./sdk-exports.mjs";

const MARKETING_GLOBS = ["website/src/components/**/*.{astro,tsx}", "website/src/pages/**/*.{astro,tsx}"];

/**
 * Subpath specifiers that resolve for real but have no entry in
 * PACKAGE_ENTRIES, so the export map cannot answer for them. Checking the
 * subpath itself is `check-api-names.mjs`'s job on the docs side.
 */
const UNCHECKED_SPECIFIERS = [/^@rebasepro\/[a-z-]+\//];

/** Wrong spellings that have each actually shipped to the marketing site. */
const FORBIDDEN = [
    {
        pattern: /\bcreateClient\s*\(/,
        message: "`createClient()` is not exported — the factory is `createRebaseClient({ baseUrl })`."
    },
    {
        pattern: /\brebase\s*\.\s*init\s*\(/,
        message: "`rebase.init()` does not exist — call `createRebaseClient({ baseUrl })`."
    },
    {
        pattern: /\bclient\s*\.\s*[a-zA-Z_$][\w$]*\s*\.\s*(?:retrieve|list)\s*\(/,
        message:
            "collections are reached through `client.data.<name>`, and the methods are " +
            "`find` / `findById`, not `list` / `retrieve`."
    },
    {
        pattern: /\.\s*where\s*\(\s*["'][^"']*["']\s*,\s*["'](?:eq|neq|gt|gte|lt|lte)["']/,
        message: 'operators are `"=="`, `"!="`, `">"`, `">="`, `"<"`, `"<="` — not `"eq"` / `"gte"`.',
    },
    {
        pattern: /\bchannel\s*\.\s*on\s*\(/,
        message: "`channel.on()` does not exist — use `channel.onBroadcast(event, handler)`, then `channel.join()`."
    },
    {
        pattern: /@rebasepro\/sdk_generator/,
        message: "there is no `@rebasepro/sdk_generator` package — the command is `rebase generate-sdk`."
    }
];

/**
 * The command tree, read out of the CLI source rather than copied here.
 *
 * A hardcoded list is the same staleness bug this whole file exists to catch —
 * it would have to be remembered every time a command is added or renamed, and
 * it would silently stop catching anything the day it drifted. Deriving it
 * means a removed subcommand starts failing the check on the commit that
 * removes it.
 *
 * A command whose module exposes no dispatch table gets `null`, meaning "top
 * level is known, subcommands are not checked" — better than inventing a list.
 */
function loadCliCommands(root) {
    const read = rel => {
        try {
            return readFileSync(path.join(root, rel), "utf8");
        } catch {
            return "";
        }
    };

    const cli = read("packages/cli/src/cli.ts");
    const declared = cli.match(/const namespacedCommands = \[([^\]]*)\]/);
    const top = new Set(
        declared ? [...declared[1].matchAll(/"([a-z][a-z0-9-]*)"/g)].map(m => m[1]) : []
    );
    // Commands that take no subcommand still have to be recognised at the top.
    for (const name of ["init", "dev", "build", "start", "doctor", "eject", "generate-sdk"]) top.add(name);

    /** `case "x":` — how the CLI's own command modules dispatch. */
    const cases = source => {
        const found = [...source.matchAll(/case\s+"([a-z][a-z0-9-]*)"\s*:/g)].map(m => m[1]);
        return found.length ? new Set(found) : null;
    };

    const sub = new Map([
        ["auth", cases(read("packages/cli/src/commands/auth.ts"))],
        ["skills", cases(read("packages/cli/src/commands/skills.ts"))],
        ["api-keys", cases(read("packages/cli/src/commands/api-keys.ts"))],
        ["apps", cases(read("packages/cli/src/commands/apps.ts"))],
        ["cloud", cases(read("packages/cli/src/commands/cloud/index.ts"))]
    ]);

    // `schema` and `db` do not dispatch themselves — they hand rawArgs to the
    // active database driver, so the real subcommand list lives there and is
    // written as `subcommand === "x"` rather than a switch.
    const driver = read("packages/server-postgres/src/cli.ts");
    const driverSubs = new Set([...driver.matchAll(/subcommand === "([a-z][a-z0-9-]*)"/g)].map(m => m[1]));
    if (driverSubs.size) {
        sub.set("schema", driverSubs);
        sub.set("db", driverSubs);
    }

    return { top, sub };
}

/**
 * Marketing copy says "rebase is", "rebase and", "rebase.pro" constantly, so a
 * bare `rebase <word>` match is only a command in two shapes:
 *
 *   1. after a shell prompt or a package runner — `$ rebase db push`;
 *   2. as a quoted string in *data* position — `command: "rebase db push"` or
 *      `const cmd = "rebase dev"`. The CLI page keeps its commands as data and
 *      adds the `$` in the template, so shape 1 alone never sees them; that is
 *      exactly where `rebase auth bootstrap` (no such subcommand) sat.
 *
 * Data position is what keeps shape 2 honest. A quoted string anywhere would
 * also match `search("rebase tutorial")`, where "rebase tutorial" is a search
 * query in an SDK example — an argument, not a command.
 */
const CLI_INVOCATIONS = [
    /(?:\$\s*|npx\s+|pnpm dlx\s+|pnpm\s+)rebase ([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g,
    /[:=]\s*["'`]rebase ([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g
];

/** Turn syntax-highlighted HTML back into something resembling source. */
function decode(source) {
    return source
        .replace(/<[^>]+>/g, "")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#123;/g, "{")
        .replace(/&#125;/g, "}")
        .replace(/&nbsp;/g, " ")
        // `&amp;` last: decoding it first would turn `&amp;lt;` into `<`.
        .replace(/&amp;/g, "&");
}

/** Line number of an offset, for a clickable `file:line`. */
function lineAt(text, index) {
    return text.slice(0, index).split("\n").length;
}

export function checkMarketingSnippets(root) {
    const { byPackage } = loadSdkExports(root);
    const cli = loadCliCommands(root);
    const findings = [];
    let scanned = 0;

    for (const glob of MARKETING_GLOBS) {
        for (const rel of globSync(glob, { cwd: root })) {
            scanned++;
            const text = decode(readFileSync(path.join(root, rel), "utf8"));

            // 1. Named imports must exist.
            for (const m of text.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s*from\s*["'](@rebasepro\/[^"']+)["']/g)) {
                const specifier = m[2];
                if (UNCHECKED_SPECIFIERS.some(re => re.test(specifier))) continue;
                const exported = byPackage.get(specifier);
                if (!exported) {
                    findings.push({ file: rel, line: lineAt(text, m.index), message: `unknown package \`${specifier}\`` });
                    continue;
                }
                for (const raw of m[1].split(",")) {
                    // Strip `as` aliases and any comment the highlighter left behind.
                    const name = raw.replace(/\/\/.*$/gm, "").trim().split(/\s+as\s+/)[0].trim();
                    if (!name || /[^\w$]/.test(name)) continue;
                    if (!exported.has(name)) {
                        findings.push({
                            file: rel,
                            line: lineAt(text, m.index),
                            message: `\`${name}\` is not exported by \`${specifier}\``
                        });
                    }
                }
            }

            // 2. Known-wrong spellings.
            for (const { pattern, message } of FORBIDDEN) {
                const re = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : pattern.flags + "g");
                for (const m of text.matchAll(re)) {
                    findings.push({ file: rel, line: lineAt(text, m.index), message });
                }
            }

            // 3. CLI commands shown to a reader must actually dispatch.
            const reported = new Set();
            for (const re of CLI_INVOCATIONS) {
                for (const m of text.matchAll(re)) {
                    const [, command, subcommand] = m;
                    const subs = cli.sub.get(command);
                    let message = null;

                    if (!cli.top.has(command)) {
                        message = `\`rebase ${command}\` is not a CLI command — it exits 1 with "Unknown command"`;
                    } else if (subs && subcommand && !subs.has(subcommand)) {
                        message =
                            `\`rebase ${command} ${subcommand}\` is not a subcommand of \`${command}\` — ` +
                            `it exits 1. Known: ${[...subs].sort().join(", ")}`;
                    }
                    if (!message) continue;

                    const line = lineAt(text, m.index);
                    // Both patterns can match the same site; report it once.
                    const key = `${line}:${command}:${subcommand ?? ""}`;
                    if (reported.has(key)) continue;
                    reported.add(key);
                    findings.push({ file: rel, line, message });
                }
            }
        }
    }

    return { findings, scanned };
}
