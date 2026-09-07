/**
 * Version-pin drift — docs, marketing site, and the Terraform module.
 *
 * Every shipped artifact that names the runtime version reads it from a
 * variable — the compose template says `rebasepro/server:${REBASE_VERSION}`,
 * the chart defaults to `.Chart.appVersion`, `main.tf` interpolates
 * `var.runtime_version` — and `check:runtime-image` holds the chart to
 * `@rebasepro/server`. Prose and mock terminals have no such variable, so the
 * versions an author typed by hand are the only ones that rot, and they rot
 * silently: the self-hosting guide sat on `rebasepro/server:0.14.1` for three
 * minors, telling every reader to deploy a runtime three releases old, while
 * every gate stayed green.
 *
 * A stale pin is not a cosmetic problem. `FROM rebasepro/server:0.14.1` is a
 * copyable instruction, and a reader who follows it gets an old runtime and the
 * bugs fixed since. So: a literal version on a Rebase-owned anchor must be the
 * current one.
 *
 * ## Where the line is drawn
 *
 * **Anchored patterns are checked everywhere.** `rebasepro/server:<semver>`,
 * `@rebasepro/<pkg>@<semver>`, a chart `--version`, a bundle manifest's
 * `builtAgainst`, the `rls-check` banner — each of these names a version *to
 * use*, and there is no reading of them where a past release is correct.
 *
 * **Bare versions are checked inside code fences and uncommented code only.** A
 * fence is something a reader copies; a stale version in one is a broken
 * instruction. Prose and comments are where the honest history lives —
 * "`rebase doctor --policies` catches this, from 0.10.0 on", "a panel used
 * before 0.17.0 holds the old value", "that capability landed after 0.16.0" —
 * and those sentences are frozen facts about past releases, not pins. Flagging
 * them would mean an allowlist that grows on every release, so they are left
 * alone by design.
 *
 * **A threshold is not a pin.** `semverCompare "<=0.16.0"` in the chart's
 * validator, and the `fail` message that explains it, name the release where
 * URL bundle fetching started existing. That number is a property of history
 * and must not move with the current version — bumping it would silently
 * disarm the guard. Lines carrying a comparison or a directional word are
 * therefore exempt from the bare-version rule.
 *
 * The bare-version rule only matches `0.x.y`, which is what Rebase ships today.
 * Example versions belonging to *the reader's* project (`tag: "1.4.0"`,
 * `app-1.4.0.tar.gz`, `acme/api:1.4.0`) are deliberately outside it — they are
 * the user's numbers and must not move. Anchored patterns keep working after
 * 1.0; revisit the bare rule then.
 */
import { readFileSync, writeFileSync, globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Everything a reader could copy a version out of. Locales included: they are
 * machine-translated from English, and a translation carries the pin verbatim,
 * so five locales sat on `0.13.0` while English had moved to `0.14.1`.
 */
const GLOBS = [
    "website/src/content/docs/**/*.md",
    "website/src/content/docs/**/*.mdx",
    "website/src/components/**/*.astro",
    "website/src/components/**/*.tsx",
    "website/src/pages/**/*.astro",
    "infra/**/*.md",
    "infra/**/*.tf",
    "infra/**/*.yaml",
    "infra/**/*.yml",
    "infra/**/*.tpl",
    "packages/cli/templates/**/*.md",
    "packages/cli/templates/**/*.yml",
    "infra/**/Dockerfile*",
    "infra/**/*.sh",
    // Maintainer scripts document how to run themselves, and those usage
    // comments name tags too: `server.Dockerfile` told anyone building the
    // image by hand to tag it `0.11.0`, six releases after that stopped being
    // the version. Anchored patterns only — see ANCHORED_ONLY.
    "tooling/scripts/**/*.sh",
    "tooling/scripts/**/*.mts",
    "tooling/rebase-agent-skills/**/*.md",
    // MCP-registry manifests. `packages/mcp/server.json` sat on `0.16.0` two
    // releases after that stopped being the version, and nothing referenced it
    // — not `files` in its own package.json, not a workflow, not a script — so
    // it was deleted rather than fixed. This glob is why re-adding one costs
    // nothing to keep honest: a `version` that lags is a finding on the commit
    // that adds it, not on the day somebody tries to publish it.
    "packages/*/server.json",
    "examples/*/*.md",
    "README.md",
    ".agent/workflows/*.md"
];

/**
 * Files that record history rather than instruct. A changelog entry naming
 * `0.16.0` is correct precisely because it is old, and an audit is a dated
 * report; rewriting either to the current version would be falsifying it.
 */
const HISTORY = [
    /(^|\/)CHANGELOG\.md$/,
    /^website\/src\/content\/blog\//,
    /^docs\/audits\//,
    /(^|\/)compatibility\.mdx?$/,
    // This check's own source and README quote the stale pins that motivated
    // it. Rewriting those to the current version would erase the example.
    /^tooling\/scripts\/docs-verify\/(check-version-pins\.mjs|README\.md)$/,
    /^tooling\/scripts\/release\.sh$/
];

/** Anchors that name a version *to use*. Group 1 is the version. */
const ANCHORS = [
    {
        id: "runtime-image",
        re: /rebasepro\/server:(\d+\.\d+\.\d+)/g,
        what: "runtime image tag"
    },
    {
        id: "npm-pin",
        re: /@rebasepro\/[a-z0-9-]+@(\d+\.\d+\.\d+)/g,
        what: "npm version pin"
    },
    {
        id: "npm-dep-pin",
        re: /"@rebasepro\/[a-z0-9-]+"\s*:\s*"(\d+\.\d+\.\d+)"/g,
        what: "npm dependency pin"
    },
    {
        id: "chart-version",
        re: /--version[= ]"?v?(\d+\.\d+\.\d+)"?/g,
        what: "chart version"
    },
    {
        id: "built-against",
        re: /"builtAgainst"\s*:\s*"(\d+\.\d+\.\d+)"/g,
        what: "bundle manifest `builtAgainst`"
    },
    {
        id: "rls-check-banner",
        re: /\brls-check (\d+\.\d+\.\d+)\b/g,
        what: "rls-check banner"
    },
    {
        // `tag: "0.15.0"`, `--set image.tag=0.15.0`. Restricted to `0.x.y`:
        // the neighbouring examples pin the *reader's* own app image
        // (`tag: "1.4.0"`), and those numbers are theirs to choose.
        id: "image-tag",
        re: /\b(?:image\.)?tag[:=]\s*"?(0\.\d+\.\d+)"?/g,
        what: "runtime image tag"
    }
];

/** Bare `0.x.y` in copyable code — a version the reader would paste as-is. */
const BARE = /(?<![\w.-])0\.\d+\.\d+(?![\w.-])/g;

/**
 * Files where a bare version is data rather than an instruction, so only the
 * anchored patterns apply. A maintainer script's usage comment naming
 * `rebasepro/server:0.11.0` is a pin and must move; the version literals in its
 * *code* are the opposite — `verify-bundle-corpus.mts` holds
 * `DRIVER_SKEW = ["0.10.0", …]` and a `PROVISIONING_FLOOR`, and a corpus of old
 * releases that silently became a corpus of the current one would test nothing.
 */
const ANCHORED_ONLY = [/^tooling\/scripts\//];

/**
 * Lines that compare against a version rather than name one to use. The chart
 * validator's `semverCompare "<=0.16.0"` is the case that matters: that number
 * marks where the runtime gained URL bundle fetching, and moving it with the
 * release would turn a working guard into a no-op.
 */
const THRESHOLD =
    /semverCompare|[<>]=?\s*"?\d|\b(?:after|above|below|before|since|prior to|earlier|later|up to|at or (?:below|above))\b/i;

/** Lines that are prose in a code file: comments carry history, not pins. */
const COMMENT = /^\s*(?:#|\/\/|\/\*|\*(?!\/)|<!--|\{\{\/\*|--)/;

/**
 * A line opts out with a trailing `<!-- version-pin: ignore -->` or
 * `# version-pin: ignore`, for the rare snippet that must show an old release
 * (an upgrade example showing where you came *from*).
 */
const OPT_OUT = /version-pin:\s*ignore/;

const isHistory = (rel) => HISTORY.some((re) => re.test(rel));

/**
 * Lines a reader would copy verbatim: fenced code in markdown, and any
 * non-comment line elsewhere. Everything else is prose — including the comment
 * blocks in `main.tf` and `cloudbuild-runtime.yaml`, which explain past
 * releases and past incidents and are correct precisely because they are old.
 */
function copyableLines(rel, lines) {
    const copyable = new Set();
    if (/\.mdx?$/.test(rel)) {
        let open = false;
        lines.forEach((text, i) => {
            if (/^\s*(```|~~~)/.test(text)) {
                open = !open;
                return;
            }
            if (open) copyable.add(i);
        });
        return copyable;
    }
    lines.forEach((text, i) => {
        if (!COMMENT.test(text)) copyable.add(i);
    });
    return copyable;
}

/**
 * @param {string} root repo root
 * @param {string} [expected] version every pin must name; defaults to @rebasepro/server's
 * @returns {{ findings: Array<{file:string,line:number,text:string,found:string,rule:string,what:string}>, scanned:number, expected:string }}
 */
export function checkVersionPins(root, expected) {
    // The stable release, prerelease suffix stripped. The canary job bumps every
    // package to `0.18.0-canary.<sha>` in its own checkout before publishing, and
    // documentation must go on naming a version a reader can actually pull — so a
    // canary checkout must not make every pin look stale, or make `--write` stamp
    // a canary tag into the self-hosting guide.
    const current = (
        expected ??
        JSON.parse(readFileSync(path.join(root, "packages/server/package.json"), "utf8")).version
    ).replace(/[-+].*$/, "");

    const seen = new Set();
    for (const glob of GLOBS) {
        for (const f of globSync(glob, { cwd: root })) {
            if (!f.includes("node_modules") && !isHistory(f)) seen.add(f);
        }
    }

    const findings = [];
    for (const rel of [...seen].sort()) {
        const lines = readFileSync(path.join(root, rel), "utf8").split("\n");
        const copyable = copyableLines(rel, lines);
        const bareChecked = !ANCHORED_ONLY.some((re) => re.test(rel));

        lines.forEach((text, i) => {
            if (OPT_OUT.test(text)) return;

            const hits = new Map(); // version → rule, first anchor wins
            for (const anchor of ANCHORS) {
                anchor.re.lastIndex = 0;
                for (const m of text.matchAll(anchor.re)) {
                    if (m[1] !== current && !hits.has(m[1])) hits.set(m[1], anchor);
                }
            }
            if (bareChecked && copyable.has(i) && !THRESHOLD.test(text)) {
                for (const m of text.matchAll(BARE)) {
                    if (m[0] !== current && !hits.has(m[0])) {
                        hits.set(m[0], { id: "bare-version",
what: "version" });
                    }
                }
            }
            for (const [found, rule] of hits) {
                findings.push({
                    file: rel,
                    line: i + 1,
                    text: text.trim().slice(0, 160),
                    found,
                    rule: rule.id,
                    what: rule.what
                });
            }
        });
    }

    return { findings,
scanned: seen.size,
expected: current };
}

/**
 * Rewrite every stale pin to `expected`.
 *
 * A guard with no writer becomes a chore: the release bumps 22 packages and the
 * chart, and the next CI run fails on forty-odd files somebody now has to edit
 * by hand. That is how a gate gets baselined into silence. `release.sh` runs
 * this beside the Chart.yaml stamp, for the same reason that one exists.
 *
 * Only the versions the check flagged are touched, on the lines it flagged
 * them — prose, comments and thresholds are never rewritten.
 *
 * @param {string} root repo root
 * @param {string} [expected]
 */
export function writeVersionPins(root, expected) {
    const { findings, expected: current } = checkVersionPins(root, expected);

    const byFile = new Map();
    for (const f of findings) {
        if (!byFile.has(f.file)) byFile.set(f.file, []);
        byFile.get(f.file).push(f);
    }

    const written = [];
    for (const [rel, hits] of byFile) {
        const abs = path.join(root, rel);
        const lines = readFileSync(abs, "utf8").split("\n");
        for (const hit of hits) {
            const i = hit.line - 1;
            lines[i] = lines[i].split(hit.found).join(current);
        }
        writeFileSync(abs, lines.join("\n"));
        written.push({ file: rel,
count: hits.length });
    }

    return { written,
expected: current,
total: findings.length };
}

// `node tooling/scripts/docs-verify/check-version-pins.mjs [--write]`
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
    if (process.argv.includes("--write")) {
        const { written, expected, total } = writeVersionPins(root);
        for (const w of written) console.log(`  ${w.file} (${w.count})`);
        console.log(
            total
                ? `Rewrote ${total} pin(s) to ${expected} across ${written.length} file(s).`
                : `Every version pin already names ${expected}.`
        );
    } else {
        const { findings, expected } = checkVersionPins(root);
        for (const f of findings) {
            console.log(`${f.file}:${f.line} [${f.rule}] ${f.what} is ${f.found}, expected ${expected}`);
        }
        console.log(
            findings.length
                ? `\n${findings.length} stale pin(s). Rewrite them with --write.`
                : `Every version pin names ${expected}.`
        );
        process.exitCode = findings.length ? 1 : 0;
    }
}
