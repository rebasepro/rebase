#!/usr/bin/env node
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const distEntry = join(here, "..", "dist", "index.es.js");
const srcDir = join(here, "..", "src");

/**
 * Warn when the built CLI is older than the source it was built from.
 *
 * `rebase` runs `dist/`, and a global install of this package is usually a
 * symlink to a working checkout — so every agent and shell on the machine runs
 * whatever was last built, not what is in the code. A stale build is invisible:
 * the command works, it just silently lacks the subcommand you added, which
 * reads as "my change did nothing" rather than "you forgot to build".
 *
 * Development-only by construction: `src/` is not in the published `files`
 * list, so this is skipped entirely for installed copies.
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

function warnIfStale() {
    if (!existsSync(srcDir) || !existsSync(distEntry)) return;
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
        `[33m⚠ rebase CLI: dist/ is ${ago} older than src/ — you are running a stale build.[0m\n` +
        `  Rebuild with: (cd ${join(here, "..")} && npm run build)\n`
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
        `\x1b[31m✗ rebase CLI: not built yet — ${distEntry} is missing.\x1b[0m\n` +
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
 */
const wantsStack = process.argv.includes("--debug") || process.env.REBASE_DEBUG === "1";

entry(process.argv).catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`\x1b[31m✗ ${message}\x1b[0m\n`);
    if (wantsStack && error instanceof Error && error.stack) {
        process.stderr.write(`\n${error.stack}\n`);
    } else {
        process.stderr.write("\x1b[90m  Re-run with --debug for the stack trace.\x1b[0m\n");
    }
    process.exit(1);
});
