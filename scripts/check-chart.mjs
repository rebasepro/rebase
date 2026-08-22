#!/usr/bin/env node
/**
 * The Helm chart, rendered.
 *
 * The chart shipped with no coverage of any kind — no lint, no render, nothing
 * in CI. That is a bad trade for this particular artifact, because a chart's
 * failure mode is not a stack trace: it is a cluster that comes up looking
 * right. `_validate.tpl` exists precisely for that, with nineteen refusals
 * guarding topologies that produce no error at runtime — and every one of them
 * was unexercised, so a template edit could quietly stop refusing and nothing
 * would notice until a deployment counted its rate limits three times.
 *
 * Three things are checked, in increasing order of what they can catch:
 *
 *   1. `helm lint` — the chart parses and its metadata is well-formed.
 *   2. Renders. Each topology is rendered and read: the roles, who provisions,
 *      which units exist, where the ingress sends `/api/functions`. These are
 *      the decisions the chart makes on the operator's behalf, and they are
 *      invisible in the values file.
 *   3. Refusals. Every `fail` in `_validate.tpl` must be reachable from a case
 *      below. The list is extracted from the template rather than written out
 *      here, so a refusal added later fails this check until it has a case —
 *      the same shape as `runtime-surfaces.test.ts`'s "has a probe for every
 *      declared surface", and for the same reason.
 *
 * Run:  node scripts/check-chart.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CHART = path.join(ROOT, "charts/rebase");

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

const problems = [];

/** The four values every valid render needs, plus an image that is not the stock one. */
const BASE = [
    "--set", "config.databaseUrl=postgres://rebase:rebase@db:5432/rebase",
    "--set", "config.jwtSecret=0123456789012345678901234567890123456789",
    "--set", "config.serviceKey=9876543210987654321098765432109876543210",
    "--set", "ingress.host=api.example.com",
    "--set", "image.repository=example/my-app"
];

function helm(args) {
    try {
        return { ok: true, out: execFileSync("helm", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) };
    } catch (err) {
        // helm writes refusals to stderr and exits non-zero. Both streams matter:
        // a template error names the file on one and the message on the other.
        return { ok: false, out: `${err.stdout ?? ""}${err.stderr ?? ""}` };
    }
}

function render(extra = []) {
    return helm(["template", "rebase", CHART, ...BASE, ...extra]);
}

// ── 0. helm must exist ───────────────────────────────────────────────────────
if (!helm(["version", "--short"]).ok) {
    console.error(
        `${RED}✗ helm is not installed.${NC}\n` +
        `  This check renders the chart; it cannot be done without helm.\n` +
        `  macOS: brew install helm   ·   CI: azure/setup-helm@v4\n`
    );
    process.exit(1);
}

// ── 1. lint ──────────────────────────────────────────────────────────────────
const lint = helm(["lint", CHART, ...BASE]);
if (!lint.ok) problems.push(`helm lint failed:\n${lint.out.split("\n").map(l => `      ${l}`).join("\n")}`);

// ── 2. renders ───────────────────────────────────────────────────────────────

/** Deployment/Service/Job names in a rendered manifest, by kind. */
function namesOf(yaml, kind) {
    const names = [];
    for (const doc of yaml.split(/^---$/m)) {
        if (!new RegExp(`^kind:\\s*${kind}\\s*$`, "m").test(doc)) continue;
        const m = /^metadata:\s*\n(?:\s+.*\n)*?\s+name:\s*(\S+)/m.exec(doc);
        if (m) names.push(m[1]);
    }
    return names.sort();
}

/** The container env of one Deployment, as a map. */
function envOf(yaml, deploymentName) {
    const doc = yaml.split(/^---$/m).find(d =>
        /^kind:\s*Deployment\s*$/m.test(d) && new RegExp(`name:\\s*${deploymentName}\\s*$`, "m").test(d));
    if (!doc) return undefined;
    const env = {};
    const re = /^\s+- name: ([A-Z_][A-Z0-9_]*)\n\s+value: (.*)$/gm;
    for (const m of doc.matchAll(re)) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    return env;
}

function check(label, condition, detail) {
    if (!condition) problems.push(`${label}: ${detail}`);
}

// 2a. Unsplit — the default, and the shape everything else must not disturb.
const single = render();
if (!single.ok) {
    problems.push(`the default topology does not render:\n${single.out}`);
} else {
    check("unsplit", namesOf(single.out, "Deployment").length === 1,
        `expected one Deployment, got ${namesOf(single.out, "Deployment").join(", ")}`);
    const env = envOf(single.out, "rebase-rebase-api") ?? {};
    check("unsplit", !("REBASE_ROLE" in env),
        "REBASE_ROLE is set on the single-process deployment — the unsplit shape must be byte-identical to what compose runs");
}

// 2b. Split, all three units.
const split = render([
    "--set", "split=true",
    "--set", "functions.enabled=true",
    "--set", "worker.enabled=true"
]);
if (!split.ok) {
    problems.push(`the split topology does not render:\n${split.out}`);
} else {
    const deployments = namesOf(split.out, "Deployment");
    check("split", deployments.length === 3, `expected three Deployments, got ${deployments.join(", ")}`);

    const roles = Object.fromEntries(
        deployments.map(d => [d, envOf(split.out, d)?.REBASE_ROLE])
    );
    check("split", roles["rebase-rebase-api"] === "api", `api unit has REBASE_ROLE=${roles["rebase-rebase-api"]}`);
    check("split", roles["rebase-rebase-functions"] === "functions", `functions unit has REBASE_ROLE=${roles["rebase-rebase-functions"]}`);
    check("split", roles["rebase-rebase-worker"] === "worker", `worker unit has REBASE_ROLE=${roles["rebase-rebase-worker"]}`);

    // Exactly one owner of the schema. This is the refusal the runtime enforces
    // at boot, so a chart that renders two provisioners produces a crash loop on
    // one pod — recoverable, but only after someone reads the log.
    const provisioning = deployments.filter(d => (envOf(split.out, d)?.REBASE_MIGRATE_ON_BOOT ?? "ensure") !== "none");
    check("split", provisioning.length === 0,
        `with the migration Job enabled no pod should provision, but ${provisioning.join(", ")} does`);
    check("split", namesOf(split.out, "Job").length === 1,
        "the migration Job is the schema owner in a split and it is not rendered");

    // The worker mounts no HTTP anyone routes to, so a Service for it would be
    // an object a routing mistake could successfully resolve to.
    check("split", !namesOf(split.out, "Service").includes("rebase-rebase-worker"),
        "the worker got a Service; it serves no HTTP surface at all");

    // Functions are reached through the ingress, one hop, not through the api's
    // proxy — two hops means one rate-limit bucket for every caller.
    check("split", /rebase-rebase-functions/.test(split.out.split(/^---$/m).find(d => /^kind:\s*Ingress/m.test(d)) ?? ""),
        "the ingress does not route anything to the functions Service");
    check("split", !("REBASE_FUNCTIONS_UPSTREAM" in (envOf(split.out, "rebase-rebase-api") ?? {})),
        "the api forwards to the functions unit as well as the ingress routing there — that is two hops");

    // More than one HTTP process, so the rate limit must not be per-process.
    check("split", (envOf(split.out, "rebase-rebase-api") ?? {}).REBASE_RATE_LIMIT_STORE === "sql",
        "a multi-process topology did not force the shared rate-limit store");
}

// 2c. Split with a static app — the independently released unit.
const withStatic = render([
    "--set", "split=true",
    "--set", "functions.enabled=true",
    "--set-json", 'staticApps=[{"name":"admin","path":"/admin","image":{"repository":"example/admin","tag":"1.4.0"}}]'
]);
if (!withStatic.ok) {
    problems.push(`the static-app topology does not render:\n${withStatic.out}`);
} else {
    check("static", namesOf(withStatic.out, "Deployment").includes("rebase-rebase-admin"),
        "the static app has no Deployment of its own");
    // The Service carries the same name and is rendered first, so narrow to the
    // Deployment or this reads a document with no container in it and reports
    // a missing image that is perfectly present.
    const doc = withStatic.out.split(/^---$/m).find(d =>
        /^kind:\s*Deployment\s*$/m.test(d) && /name:\s*rebase-rebase-admin\s*$/m.test(d)) ?? "";
    check("static", /image:\s*example\/admin:1\.4\.0/.test(doc),
        "the static app did not take its own image and tag — independent release is the whole point of the unit");
    // A static bundle needs no database and no JWT; the runtime short-circuits
    // before it reads either, so these pods should carry no credentials.
    check("static", !/secretKeyRef|envFrom/.test(doc),
        "the static app's pod carries the release Secret; it needs neither a database nor a JWT");
}

// 2d. A functions unit pinned to its own build — independent release.
const pinned = render([
    "--set", "split=true",
    "--set", "functions.enabled=true",
    "--set", "functions.image.tag=0.0.1-pinned"
]);
if (!pinned.ok) {
    problems.push(`the pinned-unit topology does not render:\n${pinned.out}`);
} else {
    const api = pinned.out.split(/^---$/m).find(d =>
        /^kind:\s*Deployment\s*$/m.test(d) && /name:\s*rebase-rebase-api\s*$/m.test(d)) ?? "";
    const fns = pinned.out.split(/^---$/m).find(d =>
        /^kind:\s*Deployment\s*$/m.test(d) && /name:\s*rebase-rebase-functions\s*$/m.test(d)) ?? "";

    check("pinned", /image:\s*\S+:0\.0\.1-pinned/.test(fns),
        "the functions unit did not take its pinned tag — per-unit release is the point of the values key");
    check("pinned", !/0\.0\.1-pinned/.test(api),
        "pinning the functions unit moved the api too, which is the opposite of independent release");
    // The repository is inherited when only a tag is pinned: one project, one
    // image, one unit held behind.
    check("pinned", /image:\s*example\/my-app:0\.0\.1-pinned/.test(fns),
        "a tag-only pin did not inherit the release-wide repository");
}

// 2e. The strict policy reaches every unit that could disagree.
const strict = render([
    "--set", "split=true",
    "--set", "functions.enabled=true",
    "--set", "worker.enabled=true",
    "--set", "sharedState.requireSchemaMatch=true"
]);
if (!strict.ok) {
    problems.push(`the strict-schema topology does not render:\n${strict.out}`);
} else {
    for (const unit of ["api", "functions", "worker"]) {
        check("strict", (envOf(strict.out, `rebase-rebase-${unit}`) ?? {}).REBASE_REQUIRE_SCHEMA_MATCH === "true",
            `${unit} did not get REBASE_REQUIRE_SCHEMA_MATCH — a unit that does not check is a unit that cannot refuse`);
    }
}

// ── 2f. parity with the runtime's pod contract ───────────────────────────────
/**
 * The chart cannot import TypeScript, so this is where it is held to the
 * contract the control plane gets by importing it.
 *
 * Only the parts that are statements about the *runtime* are compared. The
 * chart and the control plane legitimately differ on resources, scheduling,
 * where the environment comes from and what the container is called — those are
 * different jobs producing different manifests. What is compared here is what
 * a deployment cannot get wrong without producing a cluster that looks healthy.
 */
const contractSrc = fs.readFileSync(
    path.join(ROOT, "packages/server/src/deploy/pod-contract.ts"), "utf-8");

/** Read a `export const NAME = "value"` / `= 5` out of the contract. */
function contractValue(name) {
    const m = contractSrc.match(new RegExp(`export const ${name}\\s*=\\s*([^;\n]+)`));
    return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
}

/** The probe → path map, read out of RUNTIME_PROBE_PATHS. */
function contractProbePaths() {
    const block = contractSrc.slice(contractSrc.indexOf("RUNTIME_PROBE_PATHS = {"));
    const body = block.slice(0, block.indexOf("}"));
    const out = {};
    for (const m of body.matchAll(/(\w+):\s*(RUNTIME_\w+)/g)) {
        out[m[1]] = contractValue(m[2]);
    }
    return out;
}

/** Probe → path as the chart actually renders it, for one Deployment. */
function probesOf(yaml, deploymentName) {
    const doc = yaml.split(/^---$/m).find(d =>
        /^kind:\s*Deployment\s*$/m.test(d) && new RegExp(`name:\\s*${deploymentName}\\s*$`, "m").test(d));
    if (!doc) return {};
    const out = {};
    for (const m of doc.matchAll(/(liveness|readiness|startup)Probe:\s*\n\s+httpGet:\s*\n\s+path:\s*(\S+)/g)) {
        out[m[1]] = m[2];
    }
    return out;
}

const CONTRACT_PROBES = contractProbePaths();
check("contract", Object.keys(CONTRACT_PROBES).length === 3,
    `could not read RUNTIME_PROBE_PATHS out of pod-contract.ts (got ${JSON.stringify(CONTRACT_PROBES)}) — ` +
    "this check is vacuous until it parses, so it fails rather than passing empty");

if (single.ok) {
    const probes = probesOf(single.out, "rebase-rebase-api");
    for (const [probe, wanted] of Object.entries(CONTRACT_PROBES)) {
        check("contract", probes[probe] === wanted,
            `the ${probe} probe targets ${probes[probe] ?? "(none)"}, and pod-contract.ts says ${wanted}. ` +
            "Liveness and startup must not depend on the database: /health opens every configured " +
            "driver and answers 503, so a database blip on liveness is a restart loop and on startup " +
            "is a pod that never starts.");
    }

    const drain = contractValue("RUNTIME_PRESTOP_DRAIN_SECONDS");
    check("contract", /preStop:/.test(single.out),
        "no preStop hook is rendered — kubelet signals the pod and removes its endpoint concurrently, " +
        "so without one the ingress keeps routing to a process that has stopped accepting");
    check("contract", new RegExp(`sleep ${drain}`).test(single.out),
        `the preStop drain is not the contract's ${drain}s`);
}

if (split.ok) {
    // Every unit, not just the api: a worker that restart-loops on a database
    // blip is the same bug in a process nobody is watching.
    for (const unit of ["api", "functions", "worker"]) {
        const probes = probesOf(split.out, `rebase-rebase-${unit}`);
        for (const [probe, wanted] of Object.entries(CONTRACT_PROBES)) {
            check("contract", probes[probe] === wanted,
                `${unit}'s ${probe} probe targets ${probes[probe] ?? "(none)"}, contract says ${wanted}`);
        }
    }
}

/**
 * The refusal list and the contract list must be the same set.
 *
 * A variable the runtime treats as topology but the chart does not refuse is
 * settable through `config.env`; one the chart refuses but the runtime no
 * longer reads is a refusal for nothing. Both directions are checked, because
 * only the first is dangerous and only the second is likely.
 */
const validateSrc = fs.readFileSync(
    path.join(CHART, "templates/_validate.tpl"), "utf-8");
const chartTopology = new Set(
    (validateSrc.match(/\$topologyEnv := list ([^\n]+)/)?.[1] ?? "")
        .match(/"([A-Z_][A-Z0-9_]*)"/g)?.map(q => q.replace(/"/g, "")) ?? []);
const contractTopology = new Set(
    (contractSrc.slice(contractSrc.indexOf("TOPOLOGY_ENV_VARS = ["))
        .split("]")[0].match(/"([A-Z_][A-Z0-9_]*)"/g) ?? []).map(q => q.replace(/"/g, "")));

check("contract", contractTopology.size > 0,
    "could not read TOPOLOGY_ENV_VARS out of pod-contract.ts");
const notRefused = [...contractTopology].filter(v => !chartTopology.has(v));
const refusedForNothing = [...chartTopology].filter(v => !contractTopology.has(v));
check("contract", notRefused.length === 0,
    `_validate.tpl does not refuse ${notRefused.join(", ")} in config.env, and pod-contract.ts calls ` +
    "it a topology variable — so an operator can set it and the chart will not stop them");
check("contract", refusedForNothing.length === 0,
    `_validate.tpl refuses ${refusedForNothing.join(", ")}, which pod-contract.ts no longer lists`);

// ── 3. every refusal is reachable ────────────────────────────────────────────

/**
 * The refusals, read out of the template.
 *
 * A `fail` message is matched by the literal text before its first format
 * specifier, which is the part `printf` leaves alone. Short prefixes are
 * ambiguous, so anything under 12 characters is reported rather than silently
 * matched loosely.
 */
function declaredRefusals() {
    const text = fs.readFileSync(path.join(CHART, "templates/_validate.tpl"), "utf8");
    const out = [];
    for (const m of text.matchAll(/fail\s*(?:\(printf\s*)?"((?:[^"\\]|\\.)*)"/g)) {
        const literal = m[1].replace(/\\"/g, '"');
        const stable = literal.split("%")[0].trim();
        out.push({ literal, stable });
    }
    return out;
}

/** Each case is a render that must fail. The union of their output must cover every refusal. */
const REFUSAL_CASES = [
    ["no database url", ["--set", "config.databaseUrl="]],
    ["no jwt secret", ["--set", "config.jwtSecret="]],
    ["no service key", ["--set", "config.serviceKey="]],
    ["bundle mode nonsense", ["--set", "bundle.mode=magnet"]],
    ["bundle url mode with no url", ["--set", "bundle.mode=url", "--set", "bundle.url="]],
    ["stock image with mode=image", ["--set", "image.repository=rebasepro/server"]],
    ["units enabled without a split", ["--set", "functions.enabled=true"]],
    ["only and exclude together", [
        "--set", "split=true", "--set", "functions.enabled=true",
        "--set-json", 'functions.only=["a"]', "--set-json", 'functions.exclude=["b"]'
    ]],
    ["memory rate limits across processes", [
        "--set", "split=true", "--set", "functions.enabled=true",
        "--set", "sharedState.rateLimitStore=memory"
    ]],
    ["rate limit store nonsense", ["--set", "sharedState.rateLimitStore=redis"]],
    ["topology variable in config.env", ["--set", "config.env.REBASE_ROLE=worker"]],
    ["static app with no name", ["--set-json", 'staticApps=[{"path":"/x","image":{"repository":"e/x"}}]']],
    ["static app with no path", ["--set-json", 'staticApps=[{"name":"x","image":{"repository":"e/x"}}]']],
    ["static app path without a slash", ["--set-json", 'staticApps=[{"name":"x","path":"x","image":{"repository":"e/x"}}]']],
    ["two static apps on one path", ["--set-json",
        'staticApps=[{"name":"a","path":"/x","image":{"repository":"e/a"}},{"name":"b","path":"/x","image":{"repository":"e/b"}}]']],
    ["two static apps with one name", ["--set-json",
        'staticApps=[{"name":"a","path":"/x","image":{"repository":"e/a"}},{"name":"a","path":"/y","image":{"repository":"e/a"}}]']],
    ["static app with no image", ["--set-json", 'staticApps=[{"name":"x","path":"/x"}]']],
    ["static app inside the api prefix", ["--set-json", 'staticApps=[{"name":"x","path":"/api/x","image":{"repository":"e/x"}}]']],
    ["ingress with no host", ["--set", "ingress.host="]],
    ["migration mode nonsense", ["--set", "migrationJob.mode=obliterate"]],
    ["a unit pinned without a split", ["--set", "functions.image.tag=0.0.1"]],
    ["a unit bundle URL with a baked-in bundle", [
        "--set", "split=true", "--set", "functions.enabled=true",
        "--set", "functions.bundleUrl=https://example.com/b.tgz"
    ]]
];

let refusalOutput = "";
for (const [label, extra] of REFUSAL_CASES) {
    const result = render(extra);
    if (result.ok) {
        problems.push(`${YELLOW}${label}${NC} rendered successfully — it should have been refused`);
        continue;
    }
    refusalOutput += `\n${result.out}`;
}

for (const { literal, stable } of declaredRefusals()) {
    if (stable.length < 12) {
        problems.push(
            `a refusal in _validate.tpl starts with a format specifier ("${literal.slice(0, 40)}…"), ` +
            "so this check cannot match it. Put some literal text first."
        );
        continue;
    }
    if (!refusalOutput.includes(stable)) {
        problems.push(
            `no case in REFUSAL_CASES triggers: ${YELLOW}"${stable.slice(0, 70)}…"${NC}\n` +
            "      A refusal nothing reaches is a refusal that can stop refusing without anyone noticing.\n" +
            `      Add a case to ${DIM}scripts/check-chart.mjs${NC}.`
        );
    }
}

// ── Report ───────────────────────────────────────────────────────────────────
const refusalCount = declaredRefusals().length;
console.log(`\n${DIM}Linted the chart, rendered 5 topologies, and reached ${refusalCount} refusal(s) ` +
    `from ${REFUSAL_CASES.length} case(s).${NC}`);

if (problems.length > 0) {
    console.error(`\n${RED}✗ ${problems.length} problem(s):${NC}\n`);
    for (const p of problems) console.error(`  ${RED}•${NC} ${p}\n`);
    process.exit(1);
}

console.log(`${GREEN}✓ the chart renders every topology it documents, and every refusal is reachable.${NC}\n`);
