#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = join(here, "..", "dist", "index.es.js");
const srcDir = join(here, "..", "src");

/**
 * Colour, but only for a terminal.
 *
 * Every other line the CLI prints goes through chalk, which checks this for
 * itself. These three did not — they are written before the bundle is even
 * imported, so they hard-coded `\x1b[31m` — and stderr is exactly where that
 * costs something: `rebase status extra 2>err.txt` wrote the escapes into the
 * file, and CI logs, `2>&1 | grep`, and every agent reading a failed command's
 * output got them too.
 *
 * `NO_COLOR` and `FORCE_COLOR` are the two conventions chalk honours, so
 * honouring the same two keeps one CLI rather than two.
 */
const useColor = process.env.FORCE_COLOR !== undefined && process.env.FORCE_COLOR !== "0"
    ? true
    : Boolean(process.stderr.isTTY) && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text);
const red = (text) => paint(31, text);
const yellow = (text) => paint(33, text);
const dim = (text) => paint(90, text);

/**
 * Refuse to run on a Node older than this CLI's own floor, before anything else.
 *
 * `engines.node` is declared on all 22 packages and `check:floors` keeps the
 * numbers in step — on the reasoning that "npm and pnpm check `engines` on
 * install, so the number is load-bearing". pnpm 11 does not: a project whose
 * `engines.node` is `>=99.0.0` installs silently and exits 0, and so does a
 * *dependency* declaring it. npm prints `EBADENGINE` and also exits 0. So the
 * declared floor was enforced by nothing at all, and `rebase init` on Node 20
 * said nothing until a syntax error surfaced from inside a dependency —
 * `checkNodeVersion` existed but only `rebase doctor` ever called it.
 *
 * First, and before `await import("../dist/…")`, because the bundle is the
 * thing most likely to fail incomprehensibly on an old runtime: the point is to
 * name the version rather than let the reader debug a stack trace in minified
 * output.
 *
 * The floor is read from this package's own `package.json` rather than written
 * here, so it cannot drift from what `check:floors` gates and from what
 * `rebase doctor` reports. The comparison duplicates
 * `doctor-environment.ts`'s — importing it would mean importing the bundle,
 * which is the thing being guarded — and `bin-floor.test.ts` asserts the two
 * still agree.
 */
function assertNodeFloor() {
    let required;
    try {
        const manifest = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
        required = manifest?.engines?.node;
    } catch {
        return; // No manifest, no floor to enforce. Never a reason to refuse.
    }
    if (typeof required !== "string") return;

    // `>=x[.y[.z]]`, the only form any engines.node in this repo takes. Anything
    // else parses to nothing and the guard stands down rather than guessing.
    const declared = required.match(/>=\s*v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!declared) return;
    const running = process.versions.node.match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
    if (!running) return;

    for (let i = 1; i <= 3; i++) {
        const min = Number(declared[i] ?? 0);
        const now = Number(running[i] ?? 0);
        if (now > min) return;
        if (now < min) {
            process.stderr.write(
                `${red(`✗ rebase CLI: Node ${process.versions.node} is running, and Rebase needs ${required}.`)}\n` +
                `  Install Node ${declared[1]} or newer (nvm install ${declared[1]}), then reinstall dependencies.\n`
            );
            process.exit(1);
        }
    }
}

assertNodeFloor();

/**
 * Warn when the built CLI is older than the source it was built from.
 *
 * `rebase` runs `dist/`, and a global install of this package is usually a
 * symlink to a working checkout — so every agent and shell on the machine runs
 * whatever was last built, not what is in the code. A stale build is invisible:
 * the command works, it just silently lacks the subcommand you added, which
 * reads as "my change did nothing" rather than "you forgot to build".
 *
 * Development-only, and only for the person developing it — see
 * `isCliDevelopment`.
 *
 * Writes to **stderr**. Agents parse stdout as JSON under `--json`, and a
 * warning there would corrupt the one guarantee those commands make.
 */
function newestMtimeMs(dir, deadline) {
    let newest = 0;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (Date.now() > deadline) break; // never let a warning cost real time
        if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
            newest = Math.max(newest, newestMtimeMs(full, deadline));
        } else if (/\.tsx?$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
            // Tests are not bundled, so editing one does not make dist stale.
            // Counting them cried wolf on the ordinary edit-test-run loop.
            newest = Math.max(newest, statSync(full).mtimeMs);
        }
    }
    return newest;
}

/**
 * Whether the person running this is working on the CLI, which is the only
 * person a stale build means anything to.
 *
 * `src/` alone did not say so. A published install has none — `files` leaves it
 * out — but the global `rebase` on a CLI developer's machine is usually linked
 * to the checkout, so a bare `rebase cloud deploy` typed in a customer project
 * resolved to the monorepo's `bin/` and printed "dist/ is 159h older than src/"
 * on every run. That project had pinned its own `@rebasepro/cli` 0.25.1, did not
 * contain the source being compared, and could do nothing about it.
 *
 * So the warning needs all of:
 * - the package is not under `node_modules` — anything there is an install,
 *   whatever files it happens to carry;
 * - it sits in a pnpm workspace, which is what a checkout of this repo is;
 * - the command was run from inside that workspace (a worktree under it
 *   counts), or `REBASE_CLI_DEV` is set, for testing a dev build against a
 *   project elsewhere.
 */
function isCliDevelopment() {
    const packageDir = realpathSync(join(here, ".."));
    if (packageDir.split(sep).includes("node_modules")) return false;

    let root = packageDir;
    while (!existsSync(join(root, "pnpm-workspace.yaml"))) {
        const parent = dirname(root);
        if (parent === root) return false;
        root = parent;
    }

    if (parseFlag(process.env.REBASE_CLI_DEV)) return true;
    const fromRoot = relative(root, realpathSync(process.cwd()));
    return !fromRoot.startsWith("..") && !isAbsolute(fromRoot);
}

/**
 * `parseEnvBoolean` from `@rebasepro/types`, which cannot be imported yet: this
 * runs before the bundle, and in a fresh clone that package is not built either.
 */
function parseFlag(value) {
    return value !== undefined && /^(1|true|yes|on)$/i.test(value.trim());
}

function warnIfStale() {
    if (!existsSync(srcDir) || !existsSync(distEntry)) return;
    if (!isCliDevelopment()) return;
    const builtAt = statSync(distEntry).mtimeMs;
    const editedAt = newestMtimeMs(srcDir, Date.now() + 150);
    // A couple of seconds of slack: a build writes dist while src is being
    // stat'd, and a sub-second delta is that race, not a stale build.
    const staleByMs = editedAt - builtAt;
    if (staleByMs <= 2000) return;

    const seconds = Math.round(staleByMs / 1000);
    const ago = seconds >= 3600
        ? `${Math.round(seconds / 3600)}h`
        : seconds >= 60 ? `${Math.round(seconds / 60)}m` : `${seconds}s`;
    process.stderr.write(
        `${yellow(`⚠ rebase CLI: dist/ is ${ago} older than src/ — you are running a stale build.`)}\n` +
        "  Rebuild with: pnpm --filter @rebasepro/cli build\n"
    );
}

// A broken staleness check must never stop the CLI from running.
try {
    warnIfStale();
} catch {
    /* ignore */
}

/**
 * `dist/` is gitignored, so in a fresh clone it does not exist until someone
 * runs a build — and `rebase` is reached long before that: CONTRIBUTING's
 * getting-started steps call `db push` and `dev` through it. Importing a
 * missing module raises a bare ERR_MODULE_NOT_FOUND stack trace naming an
 * internal path, which reads as a broken repository rather than a missing step.
 *
 * stderr, like the staleness warning above, so `--json` output stays parseable.
 */
if (!existsSync(distEntry)) {
    const dev = existsSync(srcDir);
    process.stderr.write(
        `${red(`✗ rebase CLI: not built yet — ${distEntry} is missing.`)}\n` +
        (dev
            ? "  Build it with: pnpm --filter @rebasepro/cli build\n" +
              "  (or `pnpm build` from the repo root to build every package)\n"
            : "  This install looks incomplete; try reinstalling @rebasepro/cli.\n")
    );
    process.exit(1);
}

const { entry } = await import("../dist/index.es.js");

/**
 * The CLI's last line of defence.
 *
 * `entry()` returns a promise and nothing was awaiting it, so anything a
 * command threw surfaced as an unhandled rejection: Node's own stack trace,
 * rooted in `dist/index.es.js`, with the CLI's bundled line numbers and no
 * exit code of its own. "Collections directory not found" is a sentence a
 * developer can act on; the same sentence under ten frames of bundle internals
 * reads as a crash in Rebase.
 *
 * The message is the error's own — commands that already print something
 * friendly and exit never reach here. The stack is available behind
 * `--debug`/`REBASE_DEBUG`, because when the message is *not* enough that is
 * the only thing that helps.
 *
 * With two exceptions. A *usage* error: `rebase status extra` has no stack worth
 * reading — it points at `arg` and `utils/args.ts` — and the hint suggests
 * re-running with another flag, when the flags are precisely what went wrong.
 * And a *refusal* the CLI raised itself, having said why: the compose-port
 * check names the container holding the port and how to move, and its stack
 * points at the line that decided to refuse. `utils/args.ts` and
 * `utils/refusal.ts` mark those with `isUsageError` / `isRefusal` rather than a
 * class, because this file imports the bundle and `instanceof` cannot reach
 * across it.
 */
// After the bundle, which already imports this package, and spelled as the
// commands spell it: `wantsRawError` in `commands/cloud/errors.ts`.
const { parseEnvBoolean } = await import("@rebasepro/types");
const wantsStack = process.argv.includes("--debug") || parseEnvBoolean(process.env.REBASE_DEBUG) === true;
// Down to the driver too: `db`, `schema` and `doctor` run in a child process
// that prints its own failures, and it reads the same variable.
if (wantsStack) process.env.REBASE_DEBUG = "1";

entry(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    const saidWhy = Boolean(error && typeof error === "object" && (error.isUsageError || error.isRefusal));

    process.stderr.write(`${red(`✗ ${message}`)}\n`);
    if (wantsStack && error instanceof Error && error.stack) {
        process.stderr.write(`\n${error.stack}\n`);
    } else if (!saidWhy) {
        process.stderr.write(`${dim("  Re-run with --debug for the stack trace.")}\n`);
    }
    process.exit(1);
});
