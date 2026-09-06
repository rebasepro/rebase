/**
 * The `static` job of .github/workflows/verify.yml, as one command.
 *
 * The job used to be twenty-five hand-written YAML steps. That made the list of
 * gates a thing only CI knew: a contributor could not run it, `verify-quality.sh`
 * ran a different and much smaller set, and adding a gate meant editing the
 * workflow. A list that lives in one place and is executable from both sides
 * cannot drift from itself.
 *
 * The per-step rationale that used to sit in the YAML lives in `why` below, and
 * `docs/gates.md` renders the same set as a table. `check:gates-doc` fails when
 * the two disagree.
 *
 *   pnpm ci:static            run everything (skipping what this machine cannot)
 *   pnpm ci:static --list     print the gate list, one script per line
 *
 * Two gates need something the repository cannot install: Docker (the runtime
 * image boot) and Helm (the chart render). On a laptop without them the gate is
 * skipped with a notice. Under CI — where `CI` is set and both are installed by
 * the workflow — a missing prerequisite is a failure, because a gate that
 * silently skips itself in the pipeline is worse than no gate.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const inCI = Boolean(process.env.CI);

/** ~4GB: two of these type-check the whole monorepo and OOM at the default. */
const BIG_HEAP = { NODE_OPTIONS: "--max_old_space_size=4096" };

/**
 * Every gate the `static` job runs, in the order it runs them.
 *
 * `run` is a package.json script name; `why` is the rationale that used to be a
 * YAML comment above the step. Keep them together — the comment is the only
 * record of what each gate was added to catch, and a gate nobody can explain is
 * the first one somebody deletes.
 */
const GATES = [
    {
        run: "typecheck",
        env: BIG_HEAP,
        why: `Authoritative type gate. Resolves @rebasepro/* to SOURCE (not dist), so it
is immune to stale build output, build ordering, and incremental caches —
unlike \`pnpm build\` (esbuild), which strips types WITHOUT checking them.
This is what stops a type regression from silently merging.

It runs two programs: the monorepo, and \`tsconfig.tests.json\` for test
files, which nothing type-checked at all until a deleted type name survived
in a test for an entire refactor.`
    },
    {
        run: "check:core-types",
        env: BIG_HEAP,
        why: `The core packages ALONE, with @rebasepro/cms-types absent from the program.
The type check above includes cms-types, and a TypeScript augmentation applies
to the whole program — so the \`admin\` field it declares is visible to every core
package there, which makes that gate structurally unable to catch a core package
using it. \`packages/inference\` was writing \`admin.readOnly\`, \`pnpm typecheck\`
said 0 errors, and only a per-package tsc found it.`
    },
    {
        run: "check:headless",
        why: `Proves BaaS mode stays honest: imports every collection file and server
package under a loader hook that rejects React and @rebasepro UI packages.
Reads source directly, so it needs no build and fails fast.`
    },
    {
        run: "check:types-headless",
        why: `The type-level counterpart. check:headless proves the backend never
*executes* React and passed for months while 13 shipped .d.ts files began
with \`import React from "react"\` and @types/react was a devDependency
only — so a BaaS install had nothing to resolve them against. This scans
the text of core sources AND built .d.ts, plus the manifests.`
    },
    {
        run: "check:browser-deps",
        why: `The mirror of check:headless, and the half nothing asked: does the
BROWSER reach the server's dependencies? It did. \`@rebasepro/types\`
declared a hono peer for one \`import type\` in an adapter a browser can
never call, and npm 7+ and pnpm 8+ auto-install peers — so every app that
ran \`npm install @rebasepro/client\` got a 2.8 MB server framework in its
node_modules, its lockfile and its security scanners.

It has run in no pipeline since it was written. A gate in package.json
and in no job is a gate that does not exist, which is why docs/gates.md
and check:gates-doc now exist too.`
    },
    {
        run: "check:baas-types",
        env: BIG_HEAP,
        why: `And the end-to-end proof: a real BaaS project (server + driver + client,
a collection file, SDK calls) typechecked with \`react\` mapped to a stub
that stands in for its absence. Catches a React type reached through an
alias, which a text scan cannot see.`
    },
    {
        run: "check:runtime-image",
        why: `The scaffold hands every new project a compose file naming a container
image. 0.13.0 shipped with that image published nowhere, so the first
command in the file failed with "repository does not exist" — and nothing
noticed, because \`verify-selfhost.mts\` deliberately covers everything about
self-hosting EXCEPT the container and the tag. Hermetic: it asserts an
automatically-triggered workflow publishes the image, not that the registry
currently answers. The live probe belongs to the release, and runs there.`
    },
    {
        run: "check:runtime-deps",
        why: `The image promises to supply @rebasepro/common, /utils and friends so a
bundle does not vendor them. Nothing checked those copies could actually
load: three of their dependencies were missing from the image's npm
install, and the first one surfaced only when a project was promoted to
the managed runtime and could not read a single collection.

It also reads required PEERS and version RANGES, because "missing" has
three shapes and only one of them is absence: the image installed
nodemailer ^6.9.0 against a declared ^9.0.0 — present, three majors
behind, and lazily imported, so it would have failed on some tenant's
first outgoing email rather than at boot.`
    },
    {
        run: "check:chart",
        needs: "helm",
        why: `The chart shipped with no coverage of any kind, and its failure mode is
a cluster that comes up looking right: nineteen refusals in
\`_validate.tpl\` guard topologies that produce no runtime error, and not
one of them was ever reached. This lints, renders the three documented
topologies and asserts every refusal is still reachable.

CI installs Helm v4.2.4 — the version the docs claim the chart is rendered
against. A guide that names a version CI does not use is a guide making a
promise nobody checks.`
    },
    {
        run: "check:runtime-image:boots",
        needs: "docker",
        why: `The gate every other one could not be. \`check:chart\` reads a rendered
manifest, \`check:runtime-image\` reads tags — and a manifest that is
entirely correct still produced a container that refused to start,
because an image ENV and an entrypoint guard defeated it from inside.
Nothing had ever executed infra/docker/entrypoint.mjs or booted the image;
\`bundle.mode=url\` shipped dead and stayed dead as a result. This builds
the image and starts it against a real Postgres, both ways a bundle can
arrive, and checks it still refuses when given neither.`
    },
    {
        run: "check:names",
        why: `Renames leak where a codemod cannot see them: a bare name in an array,
a .astro file, an extensionless .env.example, a Tailwind @source path.`
    },
    {
        run: "check:deps",
        why: `An undeclared import resolves here and under npm/yarn hoisting, and
fails under pnpm's isolated layout — so it type-checks, builds and tests
green, then breaks on first import for an installing user.
\`@rebasepro/firebase\` shipped that way with seven \`@firebase/*\` imports.`
    },
    {
        run: "check:publishable-set",
        why: `The release must not enumerate its own contents. \`publish.yml\` named its
publishable packages as literal paths; one of those directories moved on
2026-08-24, pnpm matched nothing, exited 0, and @rebasepro/agent-skills
silently fell out of four releases — while the CLI, which depends on it
as \`workspace:*\`, baked the stale version into its published manifest.
Every check in the pipeline asked whether the packages it FOUND were
right; none asked whether it had found them all.`
    },
    {
        run: "check:package-contents",
        why: `\`files: ["dist", "src"]\` ships the sources on purpose and the tests
beside them by accident. Invisible from the repository: whether a
package publishes its tests depends only on whether its author put them
in \`src/\` or in \`test/\`. @rebasepro/client was shipping twenty-seven of
them, and these tests are written to name the defect they pin.`
    },
    {
        run: "check:lint",
        why: `Nothing in any pipeline ran ESLint. \`verify-quality.sh\` does, but that was
a script a human chooses to run, so a lint error could sit on main
indefinitely — and one was: a \`no-control-regex\` error in
packages/rls-check. \`--quiet\` (errors only) matches what that script
treats as a hard failure; warnings stay advisory.`
    },
    {
        run: "check:hooks",
        why: `The 184th stale closure, which the 183 already there would hide.

\`exhaustive-deps\` cannot be an error — adding the missing dependency is
as often the bug as the fix — so it is a warning, and \`eslint --quiet\`
above does not print warnings at all. That left 183 candidate stale
closures accumulating where nobody would see a new one arrive.

This pins them in tooling/scripts/hooks-baseline.json and fails on anything new.
It also fails when a finding is FIXED, asking for the baseline to be
banked — otherwise the file slowly describes a codebase that no longer
exists, which is the same lie as a stale gate.`
    },
    {
        run: "check:unused",
        why: `\`@typescript-eslint/no-unused-vars\` reports at \`warn\`, and every lint
script runs eslint with \`--quiet\`, which prints errors only — so the rule
has been firing into nothing. This ratchets the half that means work was
computed and discarded, which is where the bugs are: a kanban board's
search term and a plugin's error view were both sitting in that list,
read into a variable and then used nowhere.`
    },
    {
        run: "check:test-scripts",
        why: `\`pnpm -r test\` walks the packages that define a \`test\` script, so one
without it is not reported as skipped — it is not reported at all.
\`packages/firebase\` has five tests, written against a declared
\`@jest/globals\`, that have never executed in any pipeline.`
    },
    {
        run: "check:control-chars",
        why: `A literal NUL inside a sentinel string in \`packages/client/src/collection.ts\`
made grep and ripgrep classify the file as binary and skip it in silence:
418 lines of the client's core collection API returned nothing for every
search anyone ran, and an empty result reads exactly like "no matches".`
    },
    {
        run: "check:floors",
        why: `Six manifests said Node 20, four said 20.10, one said 20, seven said
nothing, the dogfood app said 18 and five translated quickstarts told
readers 18+ — while .nvmrc, which is what everyone installs, said
22.22.0. Neither manager enforces \`engines\` on its own (pnpm installs a
\`>=99.0.0\` project and exits 0), so what makes the number load-bearing is
\`bin/rebase.js\`'s own floor check and the scaffold's \`engineStrict\` —
both of which read the declaration this gate keeps honest. The React peer
floor decayed the same way.`
    },
    {
        run: "check:pnpm-settings",
        why: `pnpm 11 stopped reading its settings from \`.npmrc\` and said nothing. Eight
were dead at once, including the three-day \`minimum-release-age\` floor whose
own comment explains what it bounds — so the tree resolved with pnpm's
defaults, in the isolated node_modules layout despite \`node-linker=hoisted\`,
with no supply-chain window at all. This asks pnpm rather than reading the
file: every setting declared in pnpm-workspace.yaml must come back from
\`pnpm config\`, with the value declared.`
    },
    {
        run: "check:jsdoc-coverage",
        why: `The property and relation types are authored by hand, and for most of
their fields the ONLY explanation anywhere is an editor's hover. A third
of them had none, which is how \`readOnly\` and \`disabled\` came to be used
interchangeably — they are not the same thing, and nothing said so.`
    },
    {
        run: "check:rebase-props",
        why: `The \`<Rebase>\` props table documented ten of twenty-four props, and two
of the ten were declared on RebaseProps and never read by Rebase.tsx. A
hand-written table drifts the moment a prop is added.`
    },
    {
        run: "check:property-options",
        why: `The properties page listed 30 of the 36 keys the \`Admin*Options\`
interfaces declare, and four of the six it missed — \`locale\`,
\`minimumFractionDigits\`, \`maximumFractionDigits\`, \`notation\` — were in
no English page at all. The sibling of check:rebase-props, same reason.`
    },
    {
        run: "check:subpath-imports",
        why: `Two places recommended \`@rebasepro/studio/components/SQLEditor/SQLEditor\`
as a deep import. That package exports \`.\` and nothing else, so following
the advice fails with ERR_PACKAGE_PATH_NOT_EXPORTED and there is nothing
the reader can configure to fix it.`
    },
    {
        run: "check:studio-tools",
        why: `The Studio docs table names each tool's slug and drawer group, which are
facts about one useMemo in RebaseStudio.tsx. cron-jobs.md sent readers to
an "Automation" section that has never existed.`
    },
    {
        run: "check:ui-string-paths",
        why: `The backups pane said "See docs/backups.md" — a path in this repository,
not in the reader's project, so following it finds nothing and there is
no way to discover where the page actually is.`
    },
    {
        run: "check:untranslated",
        why: `The admin ships seven non-English locales and 200-odd strings that have
a translation key are also written out as English literals, where no
translation reaches them. Found by looking at the running panel: a
product card with a missing image said "File not found", and
\`file_not_found\` is translated seven ways.`
    },
    {
        run: "check:glued-code",
        why: `Astro and JSX drop the newline between a word and an adjacent tag rather
than collapsing it to a space, so a paragraph broken across two source
lines at that boundary renders "or runrebase dev". Invisible in the
source and in the diff; seven instances were shipping across three
marketing pages, all found by measuring the rendered gap between two
boxes rather than by reading.`
    },
    {
        run: "check:contributor-setup",
        why: `CONTRIBUTING's Getting Started is three files making claims about each
other — the steps, app/.env.example, and the compose file that starts the
database. They disagreed on the username, the password and the SSL mode,
and no step created the .env at all, so \`db:push\` silently pushed to a
different database than the one the previous step had started.`
    },
    {
        run: "check:gates-doc",
        why: `docs/gates.md is the map of this list, and a map that is allowed to go
stale is worse than none: it tells a contributor a gate does not exist.
This fails when a gate script has no row, when a row names a script that
is gone, and when a name breaks the \`check:\` / \`verify:\` / \`test:\` rule.`
    },
    {
        run: "verify:docs:strict",
        why: `The docs verifier existed but ran in no pipeline at all, and defaulted to
exit 0, so documented APIs could drift from the source indefinitely — and
had: a wiring example that could not compile and a \`userManagement\` prop
that does not exist. The baseline is clean now, so it runs \`--strict\`.`
    },
    {
        run: "check:derived-names",
        why: `Column names, constraint names, policy names, junction tables: the
identifiers this framework DERIVES and writes into a customer's database,
where they then outlive every release that follows. 0.13 improved the
foreign-key derivation and every aged database in the field disagreed with
the code the moment it upgraded. Runs before the build on purpose — it
reads source (TSX_TSCONFIG_PATH maps @rebasepro/* onto src), so a stale
dist cannot make it pass.`
    },
    {
        run: "check:portable-core",
        why: `What the request path depends on Node for. A ratchet, not a wall: the
baseline may shrink and may never grow, so a branch that puts a new
\`node:crypto\` or a new Node-only package in front of every request has
to say so here rather than a year from now, inside a runtime port.`
    },
    {
        run: "check:schema-fresh",
        why: `The checked-in \`schema.generated.ts\` can stop describing the schema
without anybody editing anything — a library upgrade moves a derived
foreign-key name, the collections watcher never fires, and boot-ensure
renames the column while relation validation refuses to start on the
stale module. It can also go stale the ordinary way: a collection added,
the generator not re-run. \`rebase dev\` runs the first check with \`--fix\`
on a developer's machine; nothing ran either against this repository,
whose generated schema is also what the self-host acceptance gate builds
its bundle from — and which broke every deploy once already.

Reads source, like the step above, so a stale dist cannot make it pass.`
    }
];

export { GATES };

if (process.argv.includes("--list")) {
    for (const gate of GATES) console.log(gate.run);
    process.exit(0);
}

/** Is the external tool a gate needs on this machine? */
function haveTool(tool) {
    const probe = tool === "docker"
        ? spawnSync("docker", ["info"], { stdio: "ignore" })
        : spawnSync("helm", ["version"], { stdio: "ignore" });
    return probe.status === 0;
}

const bold = (s) => `[1m${s}[0m`;
const dim = (s) => `[2m${s}[0m`;
const red = (s) => `[31m${s}[0m`;
const green = (s) => `[32m${s}[0m`;
const yellow = (s) => `[33m${s}[0m`;

const failed = [];
const skipped = [];
const started = Date.now();

for (const gate of GATES) {
    if (gate.needs && !haveTool(gate.needs)) {
        if (inCI) {
            console.error(red(`\n✗ ${gate.run} needs ${gate.needs}, which is not available.`));
            console.error(dim(`  CI installs it; a pipeline that skips a gate is not running it.`));
            failed.push(gate.run);
            continue;
        }
        console.log(yellow(`\n⊘ ${gate.run} — skipped, no ${gate.needs} on this machine.`));
        skipped.push(gate.run);
        continue;
    }

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
    const note = skipped.length ? ` (${skipped.length} skipped: ${skipped.join(", ")})` : "";
    console.log(green(`✓ ci:static — ${GATES.length - skipped.length} gate(s) passed in ${minutes}m${note}`));
    process.exit(0);
}
console.error(red(`✗ ci:static — ${failed.length} of ${GATES.length} gate(s) failed in ${minutes}m:`));
for (const name of failed) console.error(red(`    pnpm run ${name}`));
process.exit(1);
