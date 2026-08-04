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
    "docker/docker-compose.selfhost.yml"
];

/**
 * Images published by someone else. `postgres:18-alpine` needs no pipeline here;
 * asserting a publisher for it would be asserting something about Docker Inc.
 * Anything NOT matched by this list is ours to publish.
 */
const THIRD_PARTY = [/^postgres:/, /^redis:/, /^minio\//, /^alpine:/, /^node:/, /^busybox:/];

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
    `${USER_FACING_COMPOSE.length} shipped compose file(s)${live ? `, live against ${version}` : ""}.${NC}`);

if (problems.length > 0) {
    console.error(`\n${RED}✗ ${problems.length} problem(s):${NC}\n`);
    for (const p of problems) console.error(`  ${RED}•${NC} ${p}\n`);
    process.exit(1);
}

console.log(`${GREEN}✓ every shipped image reference has an automated publisher.${NC}\n`);
