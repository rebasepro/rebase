/**
 * Shell commands in the agent skills and the example READMEs.
 *
 * The docs and the skills are covered for *TypeScript* — `check-api-names.mjs`
 * greps every locale and `typecheck-snippets.mjs` compiles the English fences.
 * Neither looks at a ```bash fence, and the CLI-command check that does
 * (`check-marketing-snippets.mjs`) was globbed to `website/src/{components,pages}`
 * and had never been pointed anywhere else. Everything this file catches lived
 * in that gap, unnoticed for as long as the files have existed:
 *
 *   - `rebase db studio` documented as a working command in two skills, when
 *     the driver's allowlist has never contained `studio` and it exits 1;
 *   - `rebase dev --port -p`, where the short flag is `-P` and `arg` is
 *     permissive, so `-p 3005` is silently ignored and the port is wrong;
 *   - `npm install -g rebase` / `npx rebase …` in the Kiro onboarding — the
 *     CLI's *binary* is `rebase`, its package is `@rebasepro/cli`, and the
 *     unscoped name belongs to an unrelated third party. A doc that says this
 *     tells the reader to install and execute a stranger's code;
 *   - `pnpm run dev:backend` as the first command in an example's README, for a
 *     script `app/package.json` does not have.
 *
 * Four checks, all derived from source (see `cli-commands.mjs`) so that a
 * renamed subcommand, a removed flag or a renamed script starts failing on the
 * commit that does it, rather than the day someone reads the doc.
 */
import { readFileSync, existsSync, globSync } from "node:fs";
import path from "node:path";
import { CLI_INVOCATIONS, loadCliCommands, loadCliFlags, loadWorkspaceBins } from "./cli-commands.mjs";
import { AGENT_INSTRUCTION_GLOBS } from "./extract.mjs";

/**
 * Everything outside `website/` that a reader copies a shell command from.
 * One level deep under `examples/` on purpose: every example has its own
 * `node_modules` here, and a `**` glob would walk into it.
 *
 * The repo's own agent instructions are in the list for the same reason the
 * skills are: `rebase db studio` was documented as a working command in the
 * schema-migration workflow, and `db studio` has never been in the driver's
 * allowlist.
 */
const DOC_GLOBS = [
    "tooling/rebase-agent-skills/**/*.md",
    "examples/*/*.md",
    "examples/*.md",
    // The published documentation, every locale.
    //
    // This was the last surface the command check did not reach, and it held
    // the same two bugs the check was written for: `rebase db studio` had a
    // section of its own in the CLI reference *and* in the schema page, and
    // `rebase auth create-user` was the first line of the auth example — six
    // locales each, because the translations are generated from English and
    // inherit whatever it says. Fenced blocks and inline code spans are what
    // `invocations()` already reads, so pointing it here needed no new parser,
    // only the glob nobody had added.
    "website/src/content/docs/**/*.md",
    "website/src/content/docs/**/*.mdx",
    ...AGENT_INSTRUCTION_GLOBS
];

/** Only these files get the run-script check — see `checkRunScripts`. */
const RUN_SCRIPT_GLOBS = ["examples/*/*.md", "examples/*.md", ...AGENT_INSTRUCTION_GLOBS];

/**
 * Files whose fences run at the monorepo root rather than in the directory the
 * file sits in.
 *
 * `checkRunScripts` derives the working directory from the doc's own path,
 * which is right for an example README and wrong for the agent instructions:
 * `.agent/workflows/deployment.md` says `pnpm run build`, and it means the
 * root's `build`, not a `package.json` in `.agent/workflows/` that does not and
 * will not exist. Without this the check would report the correct instruction
 * as a finding.
 */
const ROOT_CWD_GLOBS = AGENT_INSTRUCTION_GLOBS;

/**
 * Package-manager subcommands that are not run-scripts. `pnpm build` runs the
 * `build` script; `pnpm install` does not run an `install` script. Anything not
 * listed is treated as a script name, which is the direction that catches
 * things.
 */
const PM_BUILTINS = new Set([
    "install", "i", "add", "remove", "rm", "un", "uninstall", "update", "up", "upgrade",
    "dlx", "exec", "create", "init", "link", "unlink", "import", "rebuild", "prune",
    "publish", "pack", "audit", "licenses", "outdated", "list", "ls", "why", "store",
    "env", "config", "setup", "patch", "patch-commit", "server", "root", "bin", "fund",
    "dedupe", "ci", "login", "logout", "whoami", "version", "cache", "help"
]);

/** Flags accepted anywhere by `arg`, and by the package managers themselves. */
const UNIVERSAL_FLAGS = new Set(["--help", "-h", "--version", "-v"]);

/** Line number of an offset, for a clickable `file:line`. */
function lineAt(text, index) {
    return text.slice(0, index).split("\n").length;
}

/**
 * `<!-- docs-verify: ignore -->` on its own line, exempting the block that
 * follows it (up to the next blank line).
 *
 * A doc that warns *against* a command has to spell the command out — the best
 * thing `rebase-deployment` does is say there is no bare `rebase deploy`, and
 * the tables here now say there is no `rebase db studio`. Without an opt-out
 * this check would punish exactly the sentences that fix the problem. The
 * marker is the spelling `extract.mjs` already uses, so there is one convention
 * rather than two.
 *
 * @returns {Set<number>} 1-based line numbers to skip.
 */
function ignoredLines(lines) {
    const ignored = new Set();
    for (let i = 0; i < lines.length; i++) {
        if (!/<!--\s*docs-verify:\s*ignore\s*-->/.test(lines[i])) continue;
        ignored.add(i + 1);
        let j = i + 1;
        while (j < lines.length && lines[j].trim() === "") j++;
        for (; j < lines.length && lines[j].trim() !== ""; j++) ignored.add(j + 1);
    }
    return ignored;
}

/**
 * Every place a `rebase …` command is *shown to a reader* in markdown, with the
 * rest of the invocation so its flags can be checked too.
 *
 * Two shapes, because markdown has two: a line inside a fence (optionally with
 * a `$` prompt), and an inline code span. Prose is deliberately not scanned —
 * "rebase dev" mid-sentence is as likely to be a description as a command.
 */
function* invocations(text) {
    const parse = (raw, index) => {
        const cleaned = raw
            .replace(/^\s*\$\s*/, "")
            .replace(/^(?:npx|bunx)\s+/, "")
            .replace(/^pnpm\s+dlx\s+/, "")
            .replace(/^(?:pnpm|npm|yarn)\s+(?:run\s+)?/, "");
        const m = /^rebase\s+([a-z][a-z0-9-]*)((?:\s+\S+)*)\s*$/.exec(cleaned);
        if (!m) return null;
        const rest = m[2] ?? "";
        const subMatch = /^\s+([a-z][a-z0-9-]*)/.exec(rest);
        return { index, command: m[1], subcommand: subMatch?.[1], rest };
    };

    // Inline code spans — headings, tables and prose all use them.
    for (const m of text.matchAll(/`([^`\n]+)`/g)) {
        const found = parse(m[1], m.index);
        if (found) yield found;
    }

    // Whole lines — how a fenced block writes a command.
    let offset = 0;
    for (const line of text.split("\n")) {
        const withoutComment = line.replace(/\s+#.*$/, "");
        const found = parse(withoutComment, offset);
        if (found) yield found;
        offset += line.length + 1;
    }

    // The `npx rebase …` / `pnpm rebase …` shapes the marketing check already
    // knows about, for anything the two passes above did not reach.
    for (const re of CLI_INVOCATIONS) {
        for (const m of text.matchAll(new RegExp(re.source, re.flags))) {
            yield { index: m.index, command: m[1], subcommand: m[2], rest: "" };
        }
    }
}

/** Flags written in an invocation's tail. */
function flagsIn(rest) {
    return [...rest.matchAll(/(?:^|\s)(-{1,2}[A-Za-z][\w-]*)/g)].map(m => m[1]);
}

/**
 * Options tables.
 *
 * `| `--port` | `-p` | Set the backend port |` is a claim about the CLI exactly
 * as much as a fenced command is, and it is the shape that drifts silently:
 * nobody runs a table. The command it belongs to is the nearest preceding
 * heading that names one.
 */
function* tableFlags(text) {
    let command = null;
    let offset = 0;
    for (const line of text.split("\n")) {
        const start = offset;
        offset += line.length + 1;

        if (/^#{2,6}\s/.test(line)) {
            const named = /`(?:rebase\s+)?([a-z][a-z0-9-]*)(?:\s+[a-z][a-z0-9-]*)?`/.exec(line);
            command = named?.[1] ?? null;
            continue;
        }
        if (!command || !line.startsWith("|")) continue;

        const cells = line.split("|").slice(1, -1);
        for (const cell of cells.slice(0, 2)) {
            const flag = /^\s*`(-{1,2}[A-Za-z][\w-]*)`\s*$/.exec(cell);
            if (flag) yield { index: start, command, flag: flag[1] };
        }
    }
}

/**
 * `pnpm run <script>` in an example README must name a script that exists.
 *
 * Scoped to `examples/` because only there is the working directory knowable:
 * a fence starts in the directory the README lives in, and `cd` moves it (from
 * the repo root as well as from the current directory, since example READMEs
 * write both). A skill's fences run in the reader's own project, which this
 * repository does not have.
 */
function checkRunScripts(root, rel, text, findings, home = path.dirname(rel)) {
    const scriptsOf = dir => {
        const pkgPath = path.join(root, dir, "package.json");
        if (!existsSync(pkgPath)) return null;
        try {
            return new Set(Object.keys(JSON.parse(readFileSync(pkgPath, "utf8")).scripts ?? {}));
        } catch {
            return null;
        }
    };

    /** Workspace package directories, by package name, for `--filter`. */
    const byName = new Map();
    for (const pkgRel of globSync(["packages/*/package.json", "examples/*/package.json", "app/*/package.json", "app/package.json"], { cwd: root })) {
        try {
            const name = JSON.parse(readFileSync(path.join(root, pkgRel), "utf8")).name;
            if (name) byName.set(name, path.dirname(pkgRel));
        } catch { /* not a package we can read */ }
    }

    let cwd = home;
    let inFence = false;
    let offset = 0;

    for (const line of text.split("\n")) {
        const start = offset;
        offset += line.length + 1;

        if (/^\s*```/.test(line)) {
            inFence = !inFence;
            // Each fence is its own shell session, starting where the README is.
            if (inFence) cwd = home;
            continue;
        }
        if (!inFence) continue;

        const cd = /^\s*cd\s+(\S+)/.exec(line.replace(/\s+#.*$/, ""));
        if (cd) {
            const target = cd[1].replace(/^\.\//, "");
            const fromCwd = path.normalize(path.join(cwd, target));
            // Example READMEs say "from the repo root" as often as they say
            // "from this folder", so try both readings and take the one that
            // names a directory that exists.
            if (existsSync(path.join(root, fromCwd))) cwd = fromCwd;
            else if (existsSync(path.join(root, target))) cwd = target;
            continue;
        }

        const run = /^\s*(?:\$\s*)?(pnpm|npm|yarn)\s+(.*)$/.exec(line.replace(/\s+#.*$/, ""));
        if (!run) continue;

        let rest = run[2].trim().split("&&")[0].trim().split(/\s+/);
        let dir = cwd;

        // `pnpm --filter <pkg> <script>` names its own directory.
        const filterAt = rest.indexOf("--filter");
        if (filterAt !== -1 && rest[filterAt + 1]) {
            const target = rest[filterAt + 1].replace(/^["']|["']$/g, "");
            const resolved = byName.get(target) ?? (existsSync(path.join(root, target)) ? target : null);
            if (!resolved) {
                findings.push({
                    file: rel,
                    line: lineAt(text, start),
                    message: `\`--filter ${target}\` names no workspace package and no directory`
                });
                continue;
            }
            dir = resolved;
            rest = rest.slice(filterAt + 2);
        }

        rest = rest.filter(token => !token.startsWith("-"));
        if (!rest.length) continue;

        let script = rest[0];
        if (script === "run") script = rest[1];
        else if (PM_BUILTINS.has(script)) continue;
        if (!script) continue;

        const scripts = scriptsOf(dir);
        if (!scripts) {
            findings.push({
                file: rel,
                line: lineAt(text, start),
                message: `\`${run[1]} ${script}\` runs in \`${dir || "."}\`, which has no package.json`
            });
            continue;
        }
        if (!scripts.has(script)) {
            findings.push({
                file: rel,
                line: lineAt(text, start),
                message:
                    `\`${run[1]} ${script}\` — \`${path.join(dir, "package.json")}\` declares no such script. ` +
                    `Known: ${[...scripts].sort().join(", ")}`
            });
        }
    }
}

export function checkDocCommands(root) {
    const cli = loadCliCommands(root);
    const flags = loadCliFlags(root);
    const bins = loadWorkspaceBins(root);
    const findings = [];
    let scanned = 0;

    const runScriptFiles = new Set(RUN_SCRIPT_GLOBS.flatMap(g => globSync(g, { cwd: root })));
    const rootCwdFiles = new Set(ROOT_CWD_GLOBS.flatMap(g => globSync(g, { cwd: root })));

    for (const rel of new Set(DOC_GLOBS.flatMap(g => globSync(g, { cwd: root })))) {
        if (rel.split(path.sep).some(part => part === "node_modules" || part === "dist")) continue;
        // A changelog is a record of what *was* true. `rebase link` and `rebase
        // db pull` both shipped and were both later removed; the entries
        // announcing them are correct history, and rewriting them to match
        // today's CLI would be the actual error. It is also generated from the
        // release notes, so an edit here would not survive `check:generated`.
        if (path.basename(rel) === "CHANGELOG.md") continue;
        scanned++;
        const text = readFileSync(path.join(root, rel), "utf8");
        const skip = ignoredLines(text.split("\n"));
        const reported = new Set();
        const report = (line, message) => {
            if (skip.has(line)) return;
            const key = `${line}:${message}`;
            if (reported.has(key)) return;
            reported.add(key);
            findings.push({ file: rel, line, message });
        };

        // 1 + 2. Subcommands and flags shown to a reader must dispatch.
        for (const { index, command, subcommand, rest } of invocations(text)) {
            const line = lineAt(text, index);
            const subs = cli.sub.get(command);

            if (!cli.top.has(command)) {
                report(line, `\`rebase ${command}\` is not a CLI command — it exits 1 with "Unknown command"`);
                continue;
            }
            if (subs && subcommand && !subs.has(subcommand)) {
                report(
                    line,
                    `\`rebase ${command} ${subcommand}\` is not a subcommand of \`${command}\` — ` +
                        `it exits 1. Known: ${[...subs].sort().join(", ")}`
                );
                continue;
            }

            const accepted = flags.get(command);
            if (!accepted) continue;
            for (const flag of flagsIn(rest)) {
                if (UNIVERSAL_FLAGS.has(flag) || accepted.has(flag)) continue;
                report(
                    line,
                    `\`rebase ${command}\` does not accept \`${flag}\` — \`arg\` runs permissive here, ` +
                        `so it is silently ignored rather than rejected. Accepted: ${[...accepted].sort().join(", ")}`
                );
            }
        }

        // 3. Options tables make the same claim, in the shape nobody runs.
        for (const { index, command, flag } of tableFlags(text)) {
            const accepted = flags.get(command);
            if (!accepted || UNIVERSAL_FLAGS.has(flag) || accepted.has(flag)) continue;
            report(
                lineAt(text, index),
                `\`rebase ${command}\` does not accept \`${flag}\` — documented in an options table. ` +
                    `Accepted: ${[...accepted].sort().join(", ")}`
            );
        }

        // 4. A binary name is not a package name.
        const INSTALLS = /(?:npm\s+(?:install|i|add)|pnpm\s+(?:add|install|dlx)|yarn\s+(?:global\s+)?add|npx|bunx)\s+((?:-{1,2}[\w-]+\s+)*)([@\w][\w@/.-]*)/g;
        for (const m of text.matchAll(INSTALLS)) {
            const pkg = m[2];
            const owner = bins.get(pkg);
            if (!owner) continue;
            report(
                lineAt(text, m.index),
                `\`${pkg}\` is the *binary* name shipped by \`${owner}\`, not a package on npm — ` +
                    `installing or running it fetches an unrelated third party's package. Use \`${owner}\`.`
            );
        }

        // 5. Example READMEs: every `pnpm run <script>` must exist.
        if (runScriptFiles.has(rel)) {
            checkRunScripts(root, rel, text, findings, rootCwdFiles.has(rel) ? "" : undefined);
        }
    }

    return { findings, scanned };
}
