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
 * Run:  node tooling/scripts/check-chart.mjs
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CHART = path.join(ROOT, "infra/charts/rebase");

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

// ── 2e2. bundle.mode=url — the path that had never worked ────────────────────
/**
 * A documented topology that nothing exercised, and it was broken end to end.
 *
 * The runtime's fetch looked for a marker file no bundle has ever carried, so
 * every `mode: url` install rejected its own bundle as "not a Rebase bundle".
 * `helm lint` and a render cannot see that — but they can see the four things
 * the working version needs, which is what this checks.
 */
const urlMode = render([
    "--set", "bundle.mode=url",
    "--set", "bundle.url=https://control-plane.example/bundles/p1"
]);
if (!urlMode.ok) {
    problems.push(`the url-bundle topology does not render:\n${urlMode.out}`);
} else {
    const env = envOf(urlMode.out, "rebase-rebase-api") ?? {};
    check("bundle url", env.REBASE_BUNDLE_URL === "https://control-plane.example/bundles/p1",
        "REBASE_BUNDLE_URL is not set, so the runtime has no bundle to fetch");
    check("bundle url", !("REBASE_BUNDLE" in env),
        "REBASE_BUNDLE is set alongside a URL — it means \"already on disk\" and wins, " +
        "so the fetch would be skipped and the runtime would boot against an empty directory");
    check("bundle url", Boolean(env.REBASE_BUNDLE_FETCH_DIR),
        "REBASE_BUNDLE_FETCH_DIR is not set, so the bundle unpacks into the container's " +
        "writable layer instead of the volume sized for it");

    const doc = urlMode.out.split(/^---$/m).find(d =>
        /^kind:\s*Deployment\s*$/m.test(d) && /name:\s*rebase-rebase-api\s*$/m.test(d)) ?? "";
    const mount = doc.match(/- name: bundle-scratch\n\s+mountPath: "?([^"\n]+)"?/)?.[1];
    check("bundle url", mount === env.REBASE_BUNDLE_FETCH_DIR,
        `the bundle volume is mounted at ${mount ?? "(nowhere)"} but the runtime is told to ` +
        `unpack into ${env.REBASE_BUNDLE_FETCH_DIR} — the install would land on the ` +
        "container's writable layer and exhaust it");
    check("bundle url", /emptyDir: \{\}|emptyDir:\n\s+sizeLimit:/.test(doc),
        "the bundle volume renders `emptyDir:` with nothing under it, which parses as null " +
        "and is rejected by the API server");
    check("bundle url", /ephemeral-storage:/.test(doc),
        "no ephemeral-storage is reserved — Autopilot grants 1Gi by default and a real " +
        "dependency tree exhausts it mid-install, where npm neither errors nor is evicted");
}

// 2e3. mode=image must NOT carry any of that.
const imageMode = render([]);
if (imageMode.ok) {
    const env = envOf(imageMode.out, "rebase-rebase-api") ?? {};
    check("bundle image", !env.REBASE_BUNDLE_URL && !env.REBASE_BUNDLE_FETCH_DIR,
        "a baked-image bundle is being told to fetch one");
    check("bundle image", Boolean(env.REBASE_BUNDLE),
        "REBASE_BUNDLE is not set, so the runtime would look for a bundle in its working directory");
    check("bundle image", !/bundle-scratch/.test(imageMode.out),
        "a scratch volume is mounted for a bundle that is already in the image");
}

// ── 2e4. every unit that answers a request knows how far away the caller is ──
/**
 * `TRUSTED_PROXY_HOPS` was the one topology variable this gate did not assert,
 * and it was the one the chart never set on the api.
 *
 * Unset, the runtime reads 0, ignores X-Forwarded-For, and keys every rate limit
 * on the socket address it sees — which behind an ingress is the ingress. One
 * caller then exhausts the shared bucket for everyone, the auth limiters
 * included, and the only sign is a single warning line logged once. The
 * `functions` unit had always been given it, with a comment saying "same as the
 * api".
 */
for (const [label, rendered, units] of [
    ["unsplit", single, ["api"]],
    ["split", split, ["api", "functions"]],
]) {
    if (!rendered.ok) continue;
    for (const unit of units) {
        const env = envOf(rendered.out, `rebase-rebase-${unit}`) ?? {};
        check("proxy hops", env.TRUSTED_PROXY_HOPS === "1",
            `${label}/${unit} got TRUSTED_PROXY_HOPS=${env.TRUSTED_PROXY_HOPS ?? "(unset)"} behind the ` +
            "chart's own ingress. Unset or 0 means X-Forwarded-For is ignored and every caller " +
            "shares one rate-limit bucket, including the auth limiters.");
    }
}

// With no ingress of the chart's own there is nothing to trust, and saying so
// explicitly is what stops a copied values file from trusting a header nobody
// is stripping — which lets a caller forge its own address.
const noIngress = render(["--set", "ingress.enabled=false"]);
if (noIngress.ok) {
    const env = envOf(noIngress.out, "rebase-rebase-api") ?? {};
    check("proxy hops", env.TRUSTED_PROXY_HOPS === "0",
        `with ingress.enabled=false the api got TRUSTED_PROXY_HOPS=${env.TRUSTED_PROXY_HOPS ?? "(unset)"}; ` +
        "trusting a hop that no longer exists lets a client set its own X-Forwarded-For");
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

/**
 * Every Deployment the render produced, by name.
 *
 * Enumerated rather than listed: the drain check below was written against
 * three hardcoded unit names, and the static-app Deployment — added later, and
 * the one actually serving the page a person is looking at — was not among
 * them, so it shipped with no preStop hook at all. A workload added after this
 * is covered the day it is added.
 */
function deploymentNames(yaml) {
    return [...yaml.matchAll(/^kind:\s*Deployment\s*$[\s\S]*?^\s*name:\s*(\S+)\s*$/gm)]
        .map(m => m[1]);
}

/** Every rendered Deployment must drain before SIGTERM, whatever it serves. */
function checkDrain(label, rendered) {
    if (!rendered.ok) return;
    const drain = contractValue("RUNTIME_PRESTOP_DRAIN_SECONDS");
    for (const name of deploymentNames(rendered.out)) {
        const doc = rendered.out.split(/^---$/m).find(d =>
            /^kind:\s*Deployment\s*$/m.test(d) && new RegExp(`name:\\s*${name}\\s*$`, "m").test(d)) ?? "";
        check("contract", new RegExp(`preStop[\\s\\S]*?sleep ${drain}`).test(doc),
            `${label}/${name} has no preStop drain. Kubelet signals the pod and removes its ` +
            "endpoint concurrently, so without one the ingress keeps routing to a process that " +
            "has stopped accepting, and in-flight responses are truncated at exit.");
    }
}

if (single.ok) {
    const probes = probesOf(single.out, "rebase-rebase-api");
    for (const [probe, wanted] of Object.entries(CONTRACT_PROBES)) {
        check("contract", probes[probe] === wanted,
            `the ${probe} probe targets ${probes[probe] ?? "(none)"}, and pod-contract.ts says ${wanted}. ` +
            "Liveness and startup must not depend on the database: /health opens every configured " +
            "driver and answers 503, so a database blip on liveness is a restart loop and on startup " +
            "is a pod that never starts.");
    }

}

// Every topology, every workload in it — including the static apps, which are
// the reason this enumerates instead of listing.
checkDrain("unsplit", single);
checkDrain("split", split);
checkDrain("static", withStatic);

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
    ["migration mode the image refuses", ["--set", "migrationJob.mode=push"]],
    ["migration mode nonsense", ["--set", "migrationJob.mode=sync"]],
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
            `      Add a case to ${DIM}tooling/scripts/check-chart.mjs${NC}.`
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
