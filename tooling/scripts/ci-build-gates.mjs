/**
 * The `build-gates` job of .github/workflows/verify.yml, as one command.
 *
 * `ci:static` did this for the gates that read SOURCE; this is the other half,
 * and it existed as eleven hand-written YAML steps for exactly as long as the
 * static list did. The cost is the same one: the list was something only CI
 * knew. `verify-quality.sh` — the command CONTRIBUTING and the pull-request
 * template tell you to run before opening a PR — ran the build, `ci:static`,
 * the unit suites and Playwright, and none of these. `check:generated`, the one
 * gate CONTRIBUTING explicitly warns you about forgetting, was among them.
 *
 * Everything here reads what `pnpm run build` emitted, which is the whole
 * reason it is not in `ci:static`. They compile a *scaffolded project*, or read
 * a published `.d.ts`, or budget a built bundle — all of which resolve
 * `@rebasepro/*` through `node_modules` and its `exports` map rather than onto
 * source. `@rebasepro/server/functions` points at `dist/functions/index.d.ts`,
 * so before the build it resolves to nothing and the baas preset fails TS2307.
 * A developer's checkout has a stale `dist` lying around and never sees it;
 * CI has none, which is why these have to run after the build and not before.
 *
 *   pnpm run build           first — this refuses to run without it
 *   pnpm ci:build-gates      then everything below, in order
 *   pnpm ci:build-gates --list   print the gate list, one script per line
 *
 * The per-step rationale that used to sit in the YAML lives in `why` below, and
 * `docs/gates.md` renders the same set as a table. `check:gates-doc` fails when
 * the two disagree — including when a gate is in the table's "after the build"
 * section and in no runner.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/** ~4GB: these type-check whole projects and OOM at the default. */
const BIG_HEAP = { NODE_OPTIONS: "--max_old_space_size=4096" };

/**
 * Every gate the `build-gates` job runs, in the order it runs them.
 *
 * `run` is a package.json script name; `why` is the rationale that used to be a
 * YAML comment above the step. Keep them together — the comment is the only
 * record of what each gate was added to catch, and a gate nobody can explain is
 * the first one somebody deletes.
 */
const GATES = [
    {
        run: "check:templates",
        why: `The scaffolded collection files, compiled once per preset as \`rebase init\`
lays them out, plus a probe that adds what a user adds first: a custom
component with an image inside it, attached by a lazy import thunk. Nothing
else checks them fast: the only thing that compiled them was the CMS init
e2e, inside a Docker build ~15 minutes in, so a template carrying a stale
collection shape stayed invisible until the very last gate.`
    },
    {
        run: "check:resource-graphs",
        why: `\`rebase.resources.json\` is generated from \`config/resources.ts\` and
committed, because a host reads it to decide what to provision before it
runs anything. \`rebase build\` rewrites it — but a \`runtime: "custom"\`
project never runs \`rebase build\`, it builds its own image. So for exactly
the projects where that file is the ONLY record of what they need, nothing
kept it fresh: \`rebase resources --check\` existed and nothing ran it, here
or anywhere.`
    },
    {
        run: "check:eject",
        env: BIG_HEAP,
        why: `\`rebase eject\` is the one command that hands a user server code to run,
and it was in NO job here and no end-to-end test: \`packages/cli/templates/\`
sits outside the CLI's tsconfig \`rootDir\`, so the entrypoint, Dockerfile
and compose file it writes had never been compiled, built or booted by
anything in this repository. Four HIGH defects shipped in that gap and were
found by reading — a headless entrypoint importing files \`--headless\`
deletes, a \`serveSPA\` path wrong by two directory levels, a Dockerfile
copying neither \`frontend\` nor \`rebase.json\`, and crons never compiled nor
passed.

This materializes a scaffolded project, runs the real command into it and
compiles what it emits, once per flavour, then checks the Dockerfile against
the project on disk. It does NOT build the image or boot it — that needs an
install against a lockfile no scaffold has yet, and belongs in the e2e lane.
Seconds, no network, no database.`
    },
    {
        run: "check:api-surface",
        why: `\`@rebasepro/server\` is the one package \`infra/docker/entrypoint.mjs\`
symlinks over a deployed bundle's own copy, so its exports move underneath
tenant code that is already built — during a fleet rollout nobody asked for.
A removed export is therefore not a compile error for anyone; it is a boot
failure, in a wave. 0.13.0 removed two exports from it with nothing here to
notice. Reads dist/index.d.ts, hence after the build.`
    },
    {
        run: "check:docs-imports",
        why: `Documentation is the one consumer of the API that is never compiled. A
skill can instruct people to import a deleted symbol indefinitely and
nothing notices — the code is a fenced block. Two were live when this was
added: a cron skill declaring the removed \`ctx.client\` in a type block
eight lines under its own prose saying the name was gone, and a backend
skill whose FIX for a confusing dual-package error was itself an import that
did not resolve. Reads the same baseline as the gate above.`
    },
    {
        run: "check:legacy-rls",
        why: `The pre-1.0 RLS constants look like dead compatibility and are not: on
2026-08-27 five of six managed tenants wrote every or nearly every policy in
the \`auth.uid()\` form — dadaki 64 of 64. Whoever eventually deletes them
will grep for usages, find two readers, and conclude from the code that
nothing depends on them. The dependency is in five databases, and this is
where that gets said. Exit condition is in the script.`
    },
    {
        run: "check:dts",
        why: `Whether the *published* types survive being resolved. Every gate in
\`ci:static\` maps \`@rebasepro/*\` onto source, so all of them were blind to
the state the packages were actually shipped in: extensionless relative
specifiers in the emitted .d.ts, which \`moduleResolution: "nodenext"\`
rejects — and TypeScript answers by typing the whole import \`any\` rather
than by erroring. Nobody reported it in the entire life of the packages,
because the only symptom appears in the consumer's own file and reads as
their tsconfig being wrong. Reads dist, hence after the build.`
    },
    {
        run: "check:bundle",
        why: `What a browser downloads before the login screen paints. Nothing measured
it, and three separate libraries had drifted into that set: exceljs (940 kB)
behind a \`lazy()\` that a barrel re-export cancelled, lucide's entire icon
map (822 kB) re-exported by name so tree-shaking could not touch it, and
every date-fns locale (641 kB) reached through \`import * as locales\`. None
of that fails a type check or a test.

Budgets the EAGER set — the entry chunk plus what index.html preloads — not
the dist, which is dominated by legitimately lazy routes and would therefore
punish the fix. Reads \`app/frontend/dist\`, hence after the build.`
    },
    {
        run: "test:gates",
        why: `The API-surface gate's own tests, over a fixture barrel. It spent its whole
life unable to see a member disappear from \`const rebase\` — a bare entry has
no members to lose — so the gate that guards the fleet needs a gate of its
own. Fixtures only: no build, no database.`
    },
    {
        run: "check:examples",
        env: BIG_HEAP,
        why: `The examples were in no pipeline and in no root script — \`pnpm build\`
covers \`./packages/*\` and \`./app\` only — so examples/firebase stopped
compiling at the BaaS/admin split and nothing said so for weeks. They
resolve @rebasepro/* to built output like a real user does, not to source
like \`pnpm typecheck\`, which is exactly why they catch a different class of
drift; hence after the build.`
    },
    {
        run: "check:generated",
        why: `llms.txt and sitemap.md are generated by the website's \`prebuild\` and
committed, so they only refresh when someone happens to build the site —
llms.txt sat a commit behind the docs it summarises. Regenerate and fail on
a diff, which is the whole check: if this step changes a tracked file, the
commit that changed the docs forgot to.`
    }
];

export { GATES };

if (process.argv.includes("--list")) {
    for (const gate of GATES) console.log(gate.run);
    process.exit(0);
}

const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;

// Every gate below reads build output. Without one they do not fail — several
// of them find nothing to look at and pass, which is the worse outcome: a
// green run that checked an empty set. Refuse instead.
const built = fs
    .readdirSync(path.join(repoRoot, "packages"), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && fs.existsSync(path.join(repoRoot, "packages", entry.name, "dist")));

if (built.length === 0) {
    console.error(red("✗ ci:build-gates — nothing is built.\n"));
    console.error(dim(
        "  No packages/*/dist. Every gate in this list reads what `pnpm run build`\n" +
        "  emitted, and several of them pass over an empty set rather than failing.\n\n" +
        "    pnpm run build\n"
    ));
    process.exit(1);
}

const failed = [];
const started = Date.now();

for (const gate of GATES) {
    console.log(`\n${bold(`━━━ ${gate.run} ━━━`)}`);
    const result = spawnSync("pnpm", ["run", gate.run], {
        cwd: repoRoot,
        stdio: "inherit",
        env: { ...process.env, ...(gate.env ?? {}) }
    });
    if (result.status !== 0) {
        failed.push(gate.run);
        // Print the rationale on failure only: it is the fastest answer to
        // "what is this gate even for", and nobody reads it when it passes.
        console.error(dim(`\n${gate.why.split("\n").map((line) => `  ${line}`).join("\n")}\n`));
    }
}

const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log("");
if (failed.length === 0) {
    console.log(green(`✓ ci:build-gates — ${GATES.length} gate(s) passed in ${minutes}m`));
    process.exit(0);
}
console.error(red(`✗ ci:build-gates — ${failed.length} of ${GATES.length} gate(s) failed in ${minutes}m:`));
for (const name of failed) console.error(red(`    pnpm run ${name}`));
process.exit(1);
