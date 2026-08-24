#!/usr/bin/env node
/**
 * Every image a user is told to pull must have an automated publisher.
 *
 * This exists because 0.13.0 shipped with the self-host path dead. The
 * scaffolded `docker-compose.yml` presents `rebase build` + `docker compose up`
 * as *the* way to self-host, `.env` pins `REBASE_VERSION` to the released
 * version, and the compose file names `rebasepro/server:${REBASE_VERSION}`. That
 * repository did not exist on Docker Hub at any tag, so the first command in the
 * file a new project is handed ended at:
 *
 *     pull access denied for rebasepro/server, repository does not exist
 *
 * Nothing caught it, and the reason is worth stating plainly. `verify-selfhost.mts`
 * covers the bundle → fold → mount → response chain, and its own header says what
 * it leaves out: "What that adds over this script is a container and an image
 * tag." So the one component of the self-host story that is an *artifact* rather
 * than code was the one component nothing asserted. Meanwhile
 * `cloudbuild-runtime.yaml` did have a Docker Hub push step, and even documents
 * this exact symptom — but it runs only when a human types
 * `gcloud builds submit`, and no release pipeline does.
 *
 * Hence two modes, because there are two distinct failures:
 *
 *   default   Hermetic. A user-facing image reference whose only publisher is a
 *             human's memory is a broken promise waiting for a release. Fails
 *             unless an automatically-triggered workflow publishes it.
 *
 *   --live    Network. Asks the registry whether the tag for the current version
 *             is actually pullable. This is a release gate — it can only pass
 *             after a release has published, so it does not belong in the
 *             per-commit pipeline.
 *
 * Run:  node scripts/check-runtime-image.mjs [--live] [--version 0.13.0]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const RED = "\x1b[0;31m";
const GREEN = "\x1b[0;32m";
const YELLOW = "\x1b[1;33m";
const DIM = "\x1b[2m";
const NC = "\x1b[0m";

/**
 * Compose files a user either receives from `rebase init` or is pointed at by
 * the docs. Their image references are promises made to someone who has no way
 * to know whether the artifact exists.
 */
const USER_FACING_COMPOSE = [
    "packages/cli/templates/template/docker-compose.yml",
    "infra/docker/docker-compose.selfhost.yml"
];

/**
 * The Helm chart makes the same promise by a different mechanism.
 *
 * `helm install` with no `image.tag` resolves the tag from `appVersion`, so the
 * chart's own metadata *is* an image reference handed to a user — and the
 * chart's README calls that command the minimum viable install. It drifted the
 * week it was written: `appVersion` said 0.15.0 while `@rebasepro/server` was
 * 0.14.1 and Docker Hub's newest tag was 0.14.1, so the documented install
 * rendered a tag nothing had ever built and landed in ImagePullBackOff.
 *
 * Two different faults, so two checks. The hermetic one holds `appVersion` to
 * the version the repository is actually cutting, which is the drift a commit
 * can introduce. The `--live` one asks whether that tag exists yet, which only a
 * release can answer.
 */
const CHART = "infra/charts/rebase/Chart.yaml";
const CHART_IMAGE_DEFAULT = "infra/charts/rebase/values.yaml";

/**
 * Images published by someone else. `postgres:18-alpine` needs no pipeline here;
 * asserting a publisher for it would be asserting something about Docker Inc.
 * Anything NOT matched by this list is ours to publish.
 */
// `pgvector/pgvector` is the official Postgres image with the `vector`
// extension built in, published by the pgvector project. It is the only entry
// here with an org prefix, which is what makes it worth a note: the heuristic
// everywhere else is that a bare name is somebody else's and `org/name` is ours,
// and this is the case that breaks it.
const THIRD_PARTY = [/^postgres:/, /^pgvector\//, /^redis:/, /^minio\//, /^alpine:/, /^node:/, /^busybox:/];

/** Workflows that run without a human typing a command. */
function automatedWorkflows() {
    const dir = path.join(ROOT, ".github/workflows");
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => f.endsWith(".yml") || f.endsWith(".yaml"))
        .map(f => ({ file: `.github/workflows/${f}`, text: fs.readFileSync(path.join(dir, f), "utf8") }))
        // `workflow_dispatch` alone is still a human pressing a button, which is
        // exactly the failure mode this check exists for.
        .filter(w => /^on:/m.test(w.text) && /^\s*(push|release|schedule):/m.test(w.text));
}

/** `image: rebasepro/server:${REBASE_VERSION:-latest}` → `rebasepro/server` */
function imageRefsIn(text) {
    const refs = [];
    for (const line of text.split("\n")) {
        const m = /^\s*image:\s*["']?([^"'\s]+)/.exec(line);
        if (!m) continue;
        refs.push(m[1]);
    }
    return refs;
}

/** Strip the tag, including a `${VAR:-default}` one, leaving the repository. */
function repositoryOf(ref) {
    // Blank the interpolation first so its inner `:` (as in `${VAR:-latest}`) is
    // not mistaken for the tag separator, then cut at the last real colon. The
    // slice is taken from the ORIGINAL ref, so the blanking never reaches the
    // result.
    const withoutInterpolation = ref.replace(/\$\{[^}]*\}/g, "");
    const idx = withoutInterpolation.lastIndexOf(":");
    return (idx === -1 ? ref : ref.slice(0, idx)).trim();
}

/**
 * The single job in a workflow that mentions `needle`, as text.
 *
 * Crude on purpose: a YAML parser would be more correct, and this check has to
 * run before dependencies are installed. Jobs are the keys indented two spaces
 * under `jobs:`, which is the layout every workflow here uses.
 */
function jobContaining(text, needle) {
    const lines = text.split("\n");
    const starts = [];
    let inJobs = false;
    for (let i = 0; i < lines.length; i++) {
        if (/^jobs:\s*$/.test(lines[i])) { inJobs = true; continue; }
        if (!inJobs) continue;
        if (/^\S/.test(lines[i])) break;              // a new top-level key ends `jobs:`
        if (/^ {2}[A-Za-z0-9_-]+:\s*$/.test(lines[i])) starts.push(i);
    }
    for (let j = 0; j < starts.length; j++) {
        const body = lines.slice(starts[j], starts[j + 1] ?? lines.length).join("\n");
        if (body.includes(needle)) return body;
    }
    return null;
}

/**
 * A publisher that cannot authenticate is not a publisher.
 *
 * The existence check above is satisfied by any automated workflow that mentions
 * the repository — which is true of one whose registry credentials were never
 * configured. That is not hypothetical: the job that publishes `rebasepro/server`
 * was added and this check went green, while `DOCKERHUB_USERNAME` and
 * `DOCKERHUB_TOKEN` did not exist on the repository at all.
 *
 * A script cannot read repository secrets, so it cannot ask whether they are
 * set. What it can enforce is the property that makes a missing secret
 * survivable: the release must find out *before* it does anything it cannot take
 * back. npm cannot be unpublished and a pushed tag is already on the branch, so
 * a credentials check placed after them converts a missing secret into a
 * half-released version — npm and git carrying a number whose compose file names
 * an image that was never built. Which is precisely how 0.13.0 shipped.
 *
 * So: if a workflow both publishes to npm and pushes a first-party image, the
 * first mention of its registry credentials must come before the npm publish.
 */
function credentialOrderProblems(workflow, repo) {
    const { file } = workflow;
    // Per job, not per file. A workflow holds several — this one's canary job
    // publishes to npm and pushes no image, so measuring against the file's
    // first `publish` would compare two unrelated jobs and report a fault in
    // whichever happened to be written first.
    const job = jobContaining(workflow.text, repo);
    if (!job) return [];
    const text = job;

    const npmPublish = text.search(/^\s*run:.*\b(?:pnpm|npm|yarn)\b[^\n]*\bpublish\b/m);
    if (npmPublish === -1) return [];

    // The secrets this workflow feeds to its registry logins, whatever they are
    // named — matching on the login step keeps this from hard-coding Docker Hub.
    //
    // `GCP` is in the list because the release pushes to two registries and only
    // one of them authenticates with something called a token: the private
    // Artifact Registry push federates, so its credentials are named
    // `GCP_WORKLOAD_IDENTITY_PROVIDER` and `GCP_RELEASE_SERVICE_ACCOUNT`. They
    // gate the image the managed fleet pulls, which makes them the half of the
    // release with the *larger* blast radius, and until they were added here the
    // pattern matched neither and this check had no opinion about them at all.
    const secretNames = [...text.matchAll(/secrets\.([A-Z0-9_]*(?:DOCKER|REGISTRY|GCP)[A-Z0-9_]*)/g)]
        .map(m => m[1]);
    if (secretNames.length === 0) {
        return [`${file} pushes ${YELLOW}${repo}${NC} but names no registry credentials — ` +
            `either the login step is gone or it is authenticating some other way.`];
    }

    // Every credential, not the earliest one. This used to take the MINIMUM over
    // the names, which asks "is at least one credential checked early?" — a
    // question that stays true no matter how many others are checked late. The
    // moment the release grew a second registry that answer became actively
    // misleading: Docker Hub's check sat in the preflight, so a fleet credential
    // named for the first time three steps after `npm publish` scored exactly
    // the same. Verified by removing the fleet secrets from the preflight; the
    // old form still passed.
    const late = [...new Set(secretNames)].filter(n => text.indexOf(`secrets.${n}`) > npmPublish);
    if (late.length > 0) {
        return [
            `${file} checks its registry credentials (${YELLOW}${late.join(", ")}${NC}) ` +
            `only AFTER publishing to npm.\n` +
            `      npm cannot be unpublished, so a missing secret would leave a released version ` +
            `whose\n` +
            `      compose file pulls ${repo}:<version> — an image that was never built. Move the ` +
            `check\n` +
            `      before the first irreversible step.`
        ];
    }
    return [];
}

const problems = [];
const checked = [];

for (const rel of USER_FACING_COMPOSE) {
    const file = path.join(ROOT, rel);
    if (!fs.existsSync(file)) {
        problems.push(`${rel} does not exist — this list is stale, or a shipped compose file was deleted`);
        continue;
    }
    const text = fs.readFileSync(file, "utf8");
    for (const ref of imageRefsIn(text)) {
        const repo = repositoryOf(ref);
        if (THIRD_PARTY.some(re => re.test(ref))) continue;
        checked.push({ rel, ref, repo });

        const publishers = automatedWorkflows().filter(w => w.text.includes(repo));
        if (publishers.length === 0) {
            problems.push(
                `${rel} tells a user to pull ${YELLOW}${repo}${NC}, but no automatically-triggered ` +
                `workflow publishes it.\n` +
                `      A build config that only runs from a developer's shell does not count: a ` +
                `release will ship\n` +
                `      the reference without the artifact, and the user finds out with ` +
                `"repository does not exist".`
            );
        }
    }
}

// ── The chart's default tag ──────────────────────────────────────────────────

const chartPath = path.join(ROOT, CHART);
const valuesPath = path.join(ROOT, CHART_IMAGE_DEFAULT);
let chartAppVersion;
let chartVersion;
let chartRepository;

if (!fs.existsSync(chartPath) || !fs.existsSync(valuesPath)) {
    problems.push(`${CHART} or ${CHART_IMAGE_DEFAULT} does not exist — this check is stale, or the chart was deleted`);
} else {
    // Two flat keys out of a small file. A YAML parser is not worth a dependency
    // this script cannot have: it runs before `pnpm install`.
    const chartText = fs.readFileSync(chartPath, "utf8");
    const m = /^appVersion:\s*["']?([^"'\s#]+)/m.exec(chartText);
    chartAppVersion = m?.[1];
    const v = /^version:\s*["']?([^"'\s#]+)/m.exec(chartText);
    chartVersion = v?.[1];

    const valuesText = fs.readFileSync(valuesPath, "utf8");
    const r = /^\s{2}repository:\s*["']?([^"'\s#]+)/m.exec(valuesText);
    chartRepository = r?.[1];

    const serverVersion = JSON.parse(
        fs.readFileSync(path.join(ROOT, "packages/server/package.json"), "utf8")
    ).version;

    if (!chartAppVersion) {
        problems.push(`${CHART} declares no appVersion — \`helm install\` then renders an image with an empty tag`);
    } else if (chartAppVersion !== serverVersion) {
        problems.push(
            `${CHART} sets ${YELLOW}appVersion: ${chartAppVersion}${NC} but @rebasepro/server is ` +
            `${YELLOW}${serverVersion}${NC}.\n` +
            `      appVersion IS the default image tag — \`helm install\` with no \`image.tag\` renders\n` +
            `      ${chartRepository ?? "<repository>"}:${chartAppVersion}. Ahead of the release it names a tag ` +
            `nothing has built;\n` +
            `      behind it, every default install silently runs an old runtime against a current bundle.`
        );
    }

    // The chart's own version tracks the release too. It is what a user types
    // into `helm install --version`, so a chart published at a number the
    // runtime never cut is the same broken promise as an image tag that was
    // never built — one command further back.
    if (chartVersion !== serverVersion) {
        problems.push(
            `${CHART} sets ${YELLOW}version: ${chartVersion}${NC} but @rebasepro/server is ` +
            `${YELLOW}${serverVersion}${NC}.\n` +
            `      The chart ships with the runtime and is published at its version, so these are one number.`
        );
    }

    // The chart is an artifact a user is told to install, exactly like the image,
    // and it spent its first weeks reachable only by cloning the repository. The
    // image's version of this defect shipped in 0.13.0 and cost a release; this
    // is the same assertion one artifact over.
    const chartPublishers = automatedWorkflows().filter(w =>
        /helm\s+push/.test(w.text) && /charts\/rebase/.test(w.text));
    if (chartPublishers.length === 0) {
        problems.push(
            `${CHART} is documented as an install target, but no automatically-triggered workflow ` +
            `packages and pushes it.\n` +
            `      A chart you can only get by cloning the repository is not a chart anybody installs, ` +
            `and the\n` +
            `      failure looks like a user who "did not read the docs" rather than like a missing artifact.`
        );
    }

    if (!chartRepository) {
        problems.push(`${CHART_IMAGE_DEFAULT} declares no image.repository — nothing to publish, and nothing to pull`);
    } else if (!THIRD_PARTY.some(re => re.test(chartRepository))) {
        checked.push({ rel: CHART_IMAGE_DEFAULT, ref: `${chartRepository}:${chartAppVersion}`, repo: chartRepository });
        if (automatedWorkflows().filter(w => w.text.includes(chartRepository)).length === 0) {
            problems.push(
                `${CHART_IMAGE_DEFAULT} defaults to ${YELLOW}${chartRepository}${NC}, but no ` +
                `automatically-triggered workflow publishes it.`
            );
        }
    }
}

// Once per publisher/repository pair, not once per reference: the same image is
// named by both shipped compose files, and reporting it twice reads as two faults.
for (const repo of [...new Set(checked.map(c => c.repo))]) {
    for (const w of automatedWorkflows().filter(w => w.text.includes(repo))) {
        problems.push(...credentialOrderProblems(w, repo));
    }
}

if (checked.length === 0) {
    problems.push(
        "no first-party image references found in the shipped compose files — either the " +
        "`image:` syntax changed or THIRD_PARTY now swallows everything, and this check is passing on nothing"
    );
}

// ── --live: is the tag actually pullable? ────────────────────────────────────

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const versionArg = argv.indexOf("--version");
const version = versionArg !== -1
    ? argv[versionArg + 1]
    : JSON.parse(fs.readFileSync(path.join(ROOT, "packages/cli/package.json"), "utf8")).version;

/**
 * Docker Hub's registry, unauthenticated. A missing repository and a private one
 * are indistinguishable from out here (both answer 401 on the token exchange),
 * and that is fine: a self-hoster cannot tell them apart either, so both are
 * failures for the same reason.
 */
async function hubTagExists(repo, tag) {
    const scope = `repository:${repo}:pull`;
    const tokenRes = await fetch(
        `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`
    );
    if (!tokenRes.ok) return { ok: false, why: `token exchange ${tokenRes.status}` };
    const { token } = await tokenRes.json();

    const res = await fetch(`https://registry-1.docker.io/v2/${repo}/manifests/${tag}`, {
        headers: {
            Authorization: `Bearer ${token}`,
            Accept: [
                "application/vnd.oci.image.index.v1+json",
                "application/vnd.docker.distribution.manifest.list.v2+json",
                "application/vnd.docker.distribution.manifest.v2+json"
            ].join(", ")
        }
    });
    return { ok: res.ok, why: `manifest ${res.status}` };
}

if (live) {
    // One probe per repository, not per reference: the same image is named by
    // both shipped compose files, and reporting it twice reads as two faults.
    for (const repo of [...new Set(checked.map(c => c.repo))]) {
        // Only Docker Hub short names are probeable this way; a registry-qualified
        // reference (europe-west1-docker.pkg.dev/...) needs credentials we do not have.
        if (repo.includes(".") || repo.split("/").length > 2) {
            console.log(`${DIM}  … skipping ${repo} (not a Docker Hub short name)${NC}`);
            continue;
        }
        const { ok, why } = await hubTagExists(repo, version);
        if (!ok) problems.push(`${repo}:${version} is not pullable from Docker Hub (${why})`);
        else console.log(`${GREEN}  ✓${NC} ${repo}:${version} is pullable`);
    }
}

// ── Report ───────────────────────────────────────────────────────────────────

console.log(`\n${DIM}Checked ${checked.length} first-party image reference(s) across ` +
    `${USER_FACING_COMPOSE.length} shipped compose file(s) and the Helm chart` +
    `${chartAppVersion ? ` (appVersion ${chartAppVersion})` : ""}` +
    `${live ? `, live against ${version}` : ""}.${NC}`);

if (problems.length > 0) {
    console.error(`\n${RED}✗ ${problems.length} problem(s):${NC}\n`);
    for (const p of problems) console.error(`  ${RED}•${NC} ${p}\n`);
    process.exit(1);
}

console.log(`${GREEN}✓ every shipped image reference has an automated publisher.${NC}\n`);
