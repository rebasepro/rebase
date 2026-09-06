/**
 * Every install setting this repository declares is one pnpm actually reads.
 *
 * pnpm 11 stopped reading its settings from `.npmrc`. Nothing announced it: the
 * file stayed on disk, the twenty-line comment above `minimum-release-age=4320`
 * kept explaining why the supply-chain floor mattered, and `pnpm config get
 * minimum-release-age` answered `undefined`. Eight settings were in that state
 * at once — the tree resolved with pnpm's defaults, in the *isolated*
 * node_modules layout despite `node-linker=hoisted`, with no release-age floor
 * at all, while npm 12 printed one "Unknown project config" warning per line on
 * every npm command. The same move to `pnpm-workspace.yaml` had been made in
 * the generated scaffold months earlier and never here.
 *
 * A setting that silently stops applying is the failure mode this gate exists
 * for, so it asks pnpm rather than reading the file: every top-level key in
 * `pnpm-workspace.yaml` must come back from `pnpm config`, and a scalar must
 * come back with the value declared. A key that has been renamed, mis-cased or
 * dropped by a pnpm major then fails here instead of quietly doing nothing.
 *
 * `.npmrc` is expected to be absent. If one comes back, every key in it must be
 * one pnpm answers for, and must not duplicate a key `pnpm-workspace.yaml`
 * already sets — a duplicate is dead weight that only npm ever mentions, and it
 * is how the last one survived.
 *
 * Run: pnpm run check:pnpm-settings
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const workspaceFile = path.join(repoRoot, "pnpm-workspace.yaml");
const npmrcFile = path.join(repoRoot, ".npmrc");

/**
 * The supply-chain floor, asserted by name and value.
 *
 * The rest of this gate is generic — it checks that whatever is declared is
 * live. This one is checked for its actual number, because "declared and live"
 * would still pass if somebody set it to zero, and zero is exactly what it was
 * once set to, "temporarily", for a single canary package.
 */
const MINIMUM_RELEASE_AGE = "4320";

/**
 * npm-only keys a future `.npmrc` may legitimately carry, with the reason.
 *
 * Empty on purpose: nothing in this repository needs npm's own configuration
 * today. Adding an entry is the way to keep a key pnpm does not answer for —
 * and the reason is the entry, so a key nobody can explain cannot be added.
 */
const NPM_ONLY = new Map();

/** `minimum-release-age` → `minimumReleaseAge`. */
function camelCase(key) {
    return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Top-level keys of `pnpm-workspace.yaml`, with their inline scalar value.
 *
 * Hand-parsed, like `workspaceGlobs` in publishable-packages.mjs: a top-level
 * key is one at column zero, and everything this file declares is either a
 * scalar on the same line or a block beneath. `value` is null for a block.
 */
function declaredSettings() {
    const found = [];
    const lines = fs.readFileSync(workspaceFile, "utf8").split("\n");
    for (const [index, line] of lines.entries()) {
        const match = /^([A-Za-z][A-Za-z0-9_]*):(.*)$/.exec(line);
        if (!match) continue;
        const [, key, rest] = match;
        const inline = rest.trim().replace(/\s+#.*$/, "");
        found.push({ key, value: inline === "" ? null : inline, line: index + 1 });
    }
    return found;
}

/** Everything pnpm believes about this directory, as one object. */
function effectiveConfig() {
    const raw = execFileSync("pnpm", ["config", "list", "--json"], {
        cwd: repoRoot,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
    });
    return JSON.parse(raw);
}

/** How a YAML scalar compares to the JSON value pnpm reports. */
function sameScalar(declared, effective) {
    if (effective === undefined) return false;
    const stripped = declared.replace(/^['"]|['"]$/g, "");
    return String(effective) === stripped;
}

const problems = [];
let config;
try {
    config = effectiveConfig();
} catch (error) {
    console.error(`  FAIL could not run \`pnpm config list --json\`: ${error.message}`);
    process.exit(1);
}

let checked = 0;
for (const { key, value, line } of declaredSettings()) {
    checked++;
    if (!(key in config)) {
        problems.push(
            `pnpm-workspace.yaml:${line} declares \`${key}\` and \`pnpm config get ${key}\` `
            + "answers `undefined` — pnpm is not reading it, so the setting does nothing"
        );
        continue;
    }
    if (value !== null && !sameScalar(value, config[key])) {
        problems.push(
            `pnpm-workspace.yaml:${line} declares \`${key}: ${value}\` but pnpm reports `
            + `\`${JSON.stringify(config[key])}\` — something else is overriding it`
        );
    }
}

if (checked === 0) {
    problems.push("Read no settings out of pnpm-workspace.yaml — the gate is checking nothing.");
}

if (String(config.minimumReleaseAge) !== MINIMUM_RELEASE_AGE) {
    problems.push(
        `\`pnpm config get minimumReleaseAge\` is \`${config.minimumReleaseAge}\`, not `
        + `${MINIMUM_RELEASE_AGE}. That is the three-day window between a compromised publish `
        + "and its discovery. To take one fresh version, pass "
        + "`--config.minimum-release-age=0` for that install, or add the exact "
        + "`name@version` to `minimumReleaseAgeExclude`."
    );
}

if (fs.existsSync(npmrcFile)) {
    const declared = new Set(declaredSettings().map(s => s.key));
    for (const [index, raw] of fs.readFileSync(npmrcFile, "utf8").split("\n").entries()) {
        const line = raw.trim();
        if (line === "" || line.startsWith("#") || line.startsWith(";")) continue;
        const key = line.split("=")[0].trim().replace(/\[\]$/, "");
        if (key === "") continue;
        const camel = camelCase(key);
        if (NPM_ONLY.has(key)) continue;
        if (declared.has(camel)) {
            problems.push(
                `.npmrc:${index + 1} sets \`${key}\`, which pnpm-workspace.yaml already sets as `
                + `\`${camel}\`. The .npmrc copy is dead — pnpm reads the workspace file — and `
                + "npm warns about it on every command. Delete the line."
            );
            continue;
        }
        if (!(camel in config)) {
            problems.push(
                `.npmrc:${index + 1} sets \`${key}\` and \`pnpm config get ${camel}\` answers `
                + "`undefined`, so the setting does nothing. Move it to pnpm-workspace.yaml as "
                + `\`${camel}\`, or add it to NPM_ONLY in this file with the reason npm needs it.`
            );
        }
    }
}

if (problems.length > 0) {
    console.error("✗ pnpm settings that are not in effect:\n");
    for (const p of problems) console.error(`  ${p}`);
    console.error("");
    process.exit(1);
}

console.log(
    `✓ ${checked} pnpm-workspace.yaml setting(s) are live, minimumReleaseAge is `
    + `${MINIMUM_RELEASE_AGE}${fs.existsSync(npmrcFile) ? "" : ", and there is no .npmrc"}.`
);
