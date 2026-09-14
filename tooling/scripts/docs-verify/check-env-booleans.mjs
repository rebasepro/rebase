/**
 * Every boolean environment variable is read through `parseEnvBoolean`.
 *
 * `FORCE_LOCAL_STORAGE=false` switched the production storage guard OFF. The
 * guard read `!process.env.FORCE_LOCAL_STORAGE` — a test for "set", not for
 * "true" — and every non-empty string is truthy, so the operator who wrote
 * `false` to say "there is no durable volume here" got the local backend
 * registered and lost every upload at the next redeploy. The boot schema
 * parsed the same variable correctly, one file away; nothing compared them.
 *
 * Around it were six other spellings of "is this true" — `=== "true"`,
 * `=== "1"`, `!== "false"`, `!== "0"`, `1|true|yes`, `1|true|yes|on` — each
 * deciding a different variable, no two agreeing on `0`, `yes` or `TRUE`.
 * `@rebasepro/types` owns the one parser now; this holds the source to it.
 *
 * ## Findings
 *
 *   - **A spelled comparison**: an env read compared with `"true"`, `"1"`,
 *     `"false"`, `"0"`, `"yes"`, `"no"`, `"on"` or `"off"`. Whatever it
 *     compares, it is a private list of which spellings count.
 *   - **A raw read of a boolean**: `process.env.NAME`, for a NAME the platform
 *     reads as a boolean, anywhere but inside `parseEnvBoolean(…)`. That is the
 *     shape `!process.env.FORCE_LOCAL_STORAGE` had. A variable is a boolean when
 *     a boot schema declares it as one, or when any reader parses it as one —
 *     so parsing a variable in one place obliges every other place.
 *
 * Only `process.env.NAME` and `hostEnv().NAME` are held to the second rule.
 * `env.NAME` is as often the *parsed* env, where the value is a boolean already
 * and `if (env.REBASE_SERVE_STATIC)` is right. A raw injected bag tested for
 * truthiness is the one shape a source scan cannot tell apart — the `bucket`
 * resolver's `!env.FORCE_LOCAL_STORAGE` was one — which is why
 * `packages/server/test/init-storage.test.ts` holds both readers of that
 * variable to one table as well.
 *
 * Run: node tooling/scripts/docs-verify/check-env-booleans.mjs
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { shippedSourceFiles, stripComments } from "./check-env-reads.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..", "..", "..");

const GREEN = "\x1b[0;32m";
const RED = "\x1b[0;31m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/** The boot schemas. A field declared as a boolean there is one everywhere. */
const SCHEMAS = ["packages/server/src/env.ts", "packages/server/src/boot/env.ts"];

const SCHEMA_BOOLEAN =
    /^\s*([A-Z][A-Z0-9_]*):\s*(?:boolString|optionalBoolString|z\.enum\(\[\s*"true",\s*"false",\s*""\s*\]\))/gm;

/** `.NAME` or `["NAME"]` after an env expression; the name is group 1 or 2. */
const KEY = String.raw`\s*(?:\.\s*([A-Z][A-Z0-9_]*)|\[\s*["'\x60]([A-Z][A-Z0-9_]*)["'\x60]\s*\])`;
/** An env expression: `process.env`, a bag called `env`, or `hostEnv()`. */
const ENV = String.raw`(?:process\.env|\benv|\b[A-Za-z_$][\w$]*[Ee]nv\(\s*\))`;
/** A raw env expression — never the parsed object. */
const RAW_ENV = String.raw`(?:process\.env|\b[A-Za-z_$][\w$]*[Ee]nv\(\s*\))`;
const LITERAL = String.raw`["'\x60](?:true|false|1|0|yes|no|on|off|TRUE|FALSE)["'\x60]`;
const OP = String.raw`\s*(?:===|!==|==|!=)\s*`;

const SPELLED = new RegExp(`${ENV}${KEY}${OP}${LITERAL}|${LITERAL}${OP}${ENV}${KEY}`, "g");
const PARSED = new RegExp(String.raw`parseEnvBoolean\(\s*(?:${ENV}|\w+)${KEY}`, "g");
/** A raw read, with what surrounds it: a parser call before, an assignment after. */
const RAW = new RegExp(String.raw`(parseEnvBoolean\(\s*|delete\s+)?${RAW_ENV}${KEY}(\s*=(?!=))?`, "g");

/**
 * Reads that stay hand-spelled, each with its reason. Keyed `<file> <NAME>`.
 *
 * Each entry is a place the parser cannot reach, not one where it would be
 * inconvenient — and an entry nothing matches is reported, so an exemption
 * cannot outlive the read it excused.
 */
const EXEMPT = new Map([
    [
        "packages/server/src/utils/logger.ts REBASE_LOG_RAW_QUERIES",
        "inlined into the portable `@rebasepro/server/functions` entry, which bundles everything but " +
            "hono — importing `@rebasepro/types` there would inline its kind registry with it. An exact " +
            "\"true\" fails closed, and the flag only un-redacts SQL outside production."
    ]
]);

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

export function checkEnvBooleans(root = DEFAULT_ROOT) {
    const booleans = new Set();
    for (const schema of SCHEMAS) {
        for (const m of readFileSync(path.join(root, schema), "utf8").matchAll(SCHEMA_BOOLEAN)) {
            booleans.add(m[1]);
        }
    }
    // Sanity: a schema rewrite that this pattern stops matching would leave the
    // raw-read rule checking nothing, and reporting clean.
    if (booleans.size < 10) {
        throw new Error(
            `Found only ${booleans.size} boolean field(s) in ${SCHEMAS.join(" and ")} — ` +
            "the schema pattern no longer matches how booleans are declared."
        );
    }

    const files = shippedSourceFiles(root);
    const sources = files.map(file => ({ file, source: stripComments(readFileSync(path.join(root, file), "utf8")) }));
    for (const { source } of sources) {
        for (const m of source.matchAll(PARSED)) booleans.add(m[1] || m[2]);
    }

    const findings = [];
    const used = new Set();
    const report = (file, source, index, name, kind, text) => {
        const key = `${file} ${name}`;
        if (EXEMPT.has(key)) {
            used.add(key);
            return;
        }
        findings.push({ file, line: lineOf(source, index), name, kind, text: text.trim() });
    };

    for (const { file, source } of sources) {
        for (const m of source.matchAll(SPELLED)) {
            report(file, source, m.index, m[1] || m[2] || m[3] || m[4], "spelled", m[0]);
        }
        for (const m of source.matchAll(RAW)) {
            const [text, prefix, dotted, bracketed, assignment] = m;
            const name = dotted || bracketed;
            if (prefix || assignment || !booleans.has(name)) continue;
            report(file, source, m.index, name, "raw", text);
        }
    }

    const dead = [...EXEMPT.keys()].filter(key => !used.has(key)).sort();
    return { findings, dead, booleans: booleans.size, files: files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    let result;
    try {
        result = checkEnvBooleans();
    } catch (error) {
        console.error(`${RED}✗ ${error.message}${NC}`);
        process.exit(2);
    }
    if (!result.findings.length && !result.dead.length) {
        console.log(`${GREEN}✓ All ${result.booleans} boolean environment variables are read through parseEnvBoolean.${NC}`);
        process.exit(0);
    }
    for (const f of result.findings) {
        console.error(`  ${RED}${f.file}:${f.line}${NC} ${f.kind === "raw" ? "raw read of" : "hand-spelled"} ${f.name} ${DIM}${f.text}${NC}`);
    }
    for (const key of result.dead) {
        console.error(`  ${RED}${key}${NC} ${DIM}is exempted but nothing reads it that way — delete the entry.${NC}`);
    }
    process.exit(1);
}
