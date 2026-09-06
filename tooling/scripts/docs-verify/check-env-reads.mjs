/**
 * Every environment variable the shipped code *reads* is on the reference page.
 *
 * `check-env-reference.mjs` already checks the two Zod boot schemas against
 * `getting-started/configuration.md`. That is the front door, and plenty of
 * variables come in through a window: `MFA_ENCRYPTION_KEY_PREVIOUS` is read
 * directly in `auth/mfa-crypto.ts`, `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY`
 * decides whether a machine may rewrite your collection files, and
 * `REBASE_BUNDLE_TOKEN` is the credential a tenant fetches its bundle with —
 * none of them is in a schema, so none of them was checked, and none of them
 * was on the page.
 *
 * The page opens by promising it lists them. This checks the other direction:
 * a variable the code reads and the page does not name.
 *
 * ## What counts as a read
 *
 * Three shapes, because the code uses three:
 *
 *   - `process.env.NAME` / `process.env["NAME"]` — the ordinary one.
 *   - `env.NAME` — the boot env object and the telemetry env, both plain
 *     `process.env`-shaped records passed around rather than read in place.
 *   - a `NAME`-shaped string literal on a line that also mentions `env` —
 *     `export const BUNDLE_TOKEN_ENV = "REBASE_BUNDLE_TOKEN"` and
 *     `readVar(env, "REBASE_DRIVER", suffix)`. Both are reads; neither looks
 *     like one.
 *
 * Comments are stripped first, so a variable named in a docblock is not a read.
 *
 * Run: node tooling/scripts/docs-verify/check-env-reads.mjs
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");
const PAGE = "website/src/content/docs/docs/getting-started/configuration.md";

/** Shipped source only: the runtime, the drivers and the CLI. */
const GLOBS = [
    "packages/server/src/**/*.ts",
    "packages/server-postgres/src/**/*.ts",
    "packages/server-mongo/src/**/*.ts",
    "packages/cli/src/**/*.ts",
    "packages/common/src/**/*.ts",
    "packages/types/src/**/*.ts"
];

const GREEN = "[0;32m";
const RED = "[0;31m";
const DIM = "[2m";
const NC = "[0m";

/**
 * Not part of Rebase's environment contract.
 *
 * Four groups: variables somebody else owns (`NODE_ENV`, dotenv's own),
 * variables a *platform* sets that the runtime reads to work out where it is
 * running (`K_SERVICE`, `KUBERNETES_SERVICE_HOST`), test hooks that exist so
 * the suite can drive a code path, and names that appear only in a kind
 * literal frozen at what 0.17.3 shipped — kept byte-identical for the copies
 * of `@rebasepro/types` inlined in published drivers, which compare it and
 * throw on a difference. This runtime binds from the amendment beside it, so
 * those names are not reads here; the page lists what the amendment names.
 *
 * Each entry is a variable a reader would be confused to find on a
 * configuration page, not one that is inconvenient to document.
 */
const NOT_OURS = new Map([
    ["NODE_ENV", "the platform's, and the page explains it in prose"],
    ["DOTENV_CONFIG_PATH", "dotenv's own preload variable"],
    ["DOTENV_CONFIG_QUIET", "dotenv's own preload variable"],
    // Read to *recognise* where the process is running, never set by anyone
    // configuring Rebase. Documenting them would tell a reader to set a
    // variable that decides whether the runtime thinks it is on Cloud Run.
    ["AWS_LAMBDA_FUNCTION_NAME", "AWS sets it; read to detect scale-to-zero"],
    ["CLOUD_RUN_JOB", "Google sets it; read to detect scale-to-zero"],
    ["KUBERNETES_SERVICE_HOST", "Kubernetes sets it; read to detect the platform"],
    ["K_CONFIGURATION", "Cloud Run sets it; read to detect the platform"],
    ["K_REVISION", "Cloud Run sets it; read to detect the platform"],
    ["K_SERVICE", "Cloud Run sets it; read to detect the platform"],
    ["JEST_WORKER_ID", "the test runner's; read to refuse a dev secret under test"],
    ["VITEST_WORKER_ID", "the test runner's; read to refuse a dev secret under test"],
    ["REBASE_E2E", "a test hook: the e2e suite sets it to skip a prompt"],
    ["REBASE_AUTO_GENERATE", "a test hook for `rebase dev`"],
    ["REBASE_GENERATE", "a test hook for `rebase dev`"],
    ["REBASE_RESET_EMAIL", "a test hook for `rebase auth reset-password`"],
    ["REBASE_RESET_PASSWORD", "a test hook for `rebase auth reset-password`"],
    ["REBASE_DEV_PROJECT_ROOT", "set by `rebase dev` for the child process it spawns"],
    // `--port` is known in the CLI and needed in the server, and the child's
    // environment is the only channel between them. Nobody sets it by hand; a
    // reader who did would be telling the server a port was named when it was
    // derived, and turning a harmless walk into a boot failure.
    ["REBASE_DEV_PORT_EXPLICIT", "set by `rebase dev` for the backend it spawns"],
    // The CLI resolves which database this project is on — a pure decision, no
    // daemon started — and tells the driver, so the driver's own text can stop
    // recommending `rebase db generate` on a database that refuses it. Nobody
    // sets it; a reader who did would only be lying to the driver about which
    // database they are on.
    ["REBASE_DEV_DATABASE_KIND", "set by the CLI for the driver child it spawns"],
    ["REBASE_JSON", "set by the CLI for its own subprocesses"],
    // Only in the frozen 0.17.3 `bucket` literal in resource_kinds.ts; the
    // runtime binds from the amendment, which the page documents.
    ["STORAGE_BUCKET", "the frozen 0.17.3 bucket literal; not read by this runtime"],
    ["STORAGE_PUBLIC_URL", "the frozen 0.17.3 bucket literal; not read by this runtime"]
]);

/**
 * Strips comments so a variable named in a docblock is not counted as a read.
 *
 * A state machine rather than two regexes. The regex version ate 78% of
 * `packages/server/src/init.ts`: a `/*` inside a string literal paired with a
 * closing marker thousands of lines later, and the gate then reported clean on
 * a quarter of the file — the worst outcome a check can have.
 * `REBASE_LIVE_SCHEMA_ALLOW_MACHINE_APPLY` was in the eaten part.
 *
 * Strings, template literals and regex literals are all recognised, because
 * each can contain the others' delimiters. Regex detection uses the usual
 * heuristic: a `/` opens a literal only where a value cannot already have ended.
 */
function stripComments(source) {
    let out = "";
    let i = 0;
    let prev = "";                       // last significant character emitted
    const REGEX_CAN_FOLLOW = "(,=:[!&|?{};+-*%~^<>";
    while (i < source.length) {
        const c = source[i];
        const next = source[i + 1];
        if (c === "/" && next === "/") {
            while (i < source.length && source[i] !== "\n") i++;
            continue;
        }
        if (c === "/" && next === "*") {
            i += 2;
            while (i < source.length && !(source[i] === "*" && source[i + 1] === "/")) {
                if (source[i] === "\n") out += "\n";     // keep line numbers usable
                i++;
            }
            i += 2;
            continue;
        }
        if (c === '"' || c === "'" || c === "`") {
            const quote = c;
            out += c;
            i++;
            while (i < source.length) {
                if (source[i] === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
                out += source[i];
                if (source[i] === quote) { i++; break; }
                i++;
            }
            prev = quote;
            continue;
        }
        if (c === "/" && (prev === "" || REGEX_CAN_FOLLOW.includes(prev))) {
            out += c;
            i++;
            let inClass = false;
            while (i < source.length && source[i] !== "\n") {
                if (source[i] === "\\") { out += source.slice(i, i + 2); i += 2; continue; }
                if (source[i] === "[") inClass = true;
                else if (source[i] === "]") inClass = false;
                out += source[i];
                const done = source[i] === "/" && !inClass;
                i++;
                if (done) break;
            }
            prev = "/";
            continue;
        }
        out += c;
        if (!/\s/.test(c)) prev = c;
        i++;
    }
    return out;
}

const NAME = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+$/;

export function checkEnvReads(root = DEFAULT_ROOT) {
    const files = [...new Set(GLOBS.flatMap(g => globSync(g, { cwd: root })))]
        .filter(f => !/\.test\.tsx?$|(^|\/)test\//.test(f))
        .sort();

    /** @type {Map<string, Set<string>>} */
    const reads = new Map();
    const record = (name, file) => {
        if (!reads.has(name)) reads.set(name, new Set());
        reads.get(name).add(file);
    };

    for (const file of files) {
        const source = stripComments(readFileSync(path.join(root, file), "utf8"));

        for (const m of source.matchAll(
            /process\.env(?:\.([A-Z][A-Z0-9_]*)|\[\s*["'`]([A-Z][A-Z0-9_]*)["'`]\s*\])/g
        )) {
            const name = m[1] || m[2];
            if (NAME.test(name)) record(name, file);
        }

        for (const m of source.matchAll(/\benv\.([A-Z][A-Z0-9_]*)\b/g)) {
            if (NAME.test(m[1])) record(m[1], file);
        }

        // A bare name in a string, on a line that is about the environment.
        for (const line of source.split("\n")) {
            if (!/env/i.test(line)) continue;
            for (const m of line.matchAll(/["'`]([A-Z][A-Z0-9_]*)["'`]/g)) {
                if (NAME.test(m[1])) record(m[1], file);
            }
        }
    }

    if (reads.size === 0) {
        throw new Error("Found no environment reads at all — the guard is checking nothing.");
    }

    const page = readFileSync(path.join(root, PAGE), "utf8");
    const documented = new Set([...page.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(m => m[1]));

    const findings = [...reads.keys()]
        .filter(name => !documented.has(name))
        .filter(name => !NOT_OURS.has(name))
        // `S3_BUCKET__MEDIA` is `S3_BUCKET` with a source suffix; the page
        // documents the base and the `__SUFFIX` convention once.
        .filter(name => !(name.includes("__") && documented.has(name.split("__")[0])))
        .sort()
        .map(name => ({ name, files: [...reads.get(name)].sort() }));

    // A `NOT_OURS` entry for something nothing reads any more is dead weight,
    // and a dead exemption is how a real finding gets absorbed later.
    const dead = [...NOT_OURS.keys()].filter(name => !reads.has(name)).sort();

    return { findings, dead, scanned: reads.size, files: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let result;
    try {
        result = checkEnvReads();
    } catch (error) {
        console.error(`${RED}✗ ${error.message}${NC}`);
        process.exit(2);
    }
    if (!result.findings.length && !result.dead.length) {
        console.log(`${GREEN}✓ All ${result.scanned} environment variables the code reads are documented.${NC}`);
        process.exit(0);
    }
    for (const f of result.findings) {
        console.error(`  ${RED}${f.name}${NC} ${DIM}${f.files.slice(0, 3).join(", ")}${NC}`);
    }
    for (const name of result.dead) {
        console.error(`  ${RED}${name}${NC} ${DIM}is exempted in NOT_OURS but nothing reads it — delete the entry.${NC}`);
    }
    process.exit(1);
}
