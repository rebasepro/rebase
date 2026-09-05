/**
 * Deploy-doc build-context lint — every locale.
 *
 * The scaffold's backend/frontend Dockerfiles are multi-stage and copy the
 * whole workspace (pnpm-workspace.yaml, backend/, config/). Their build context
 * MUST be the project root; the Dockerfile is selected with `-f backend/Dockerfile`
 * (or, in compose, `context: .` + `dockerfile: backend/Dockerfile`).
 *
 * A deploy guide that tells the reader to use `./backend` (or `./frontend`) as
 * the build *context* produces a build that fails at the first `COPY
 * pnpm-workspace.yaml` — the file isn't in that context. This bug shipped in
 * four English guides once (aws/azure/gcp/scaleway) and, because the other five
 * locales are generated from English, it would have reached all six. This is the
 * cheap textual net so it can't come back silently.
 *
 * The invariant checked: no build instruction may use `./backend` or
 * `./frontend` as its context. The correct forms (`-f backend/Dockerfile .`,
 * `context: .`) are unaffected because they never name `./backend` as a context.
 */
import { readFileSync, globSync } from "node:fs";
import path from "node:path";

/** Docs a reader copies deploy commands from — every locale + the hub doc. */
const DEPLOY_DOC_GLOBS = [
    "website/src/content/docs/**/deployment/*.md",
    "website/src/content/docs/**/getting-started/deployment.md"
];

/**
 * Each rule flags one way of naming `./backend`/`./frontend` as a build context.
 * Correct usages (`-f backend/Dockerfile .`, `dockerfile: backend/Dockerfile`,
 * `context: .`) contain no `./backend` context token and never match.
 */
const RULES = [
    {
        id: "docker-build-context",
        // `docker build ... ./backend`  — context is the trailing ./backend|./frontend
        re: /\bdocker\s+build\b[^\n]*\s\.\/(backend|frontend)\b/,
        hint: "use `docker build -f backend/Dockerfile .` (context = project root)"
    },
    {
        id: "gcloud-build-context",
        // `gcloud builds submit ... ./backend`
        re: /\bgcloud\s+builds\s+submit\b[^\n]*\s\.\/(backend|frontend)\b/,
        hint: "build from the project root; `gcloud builds submit` uploads the given dir as context"
    },
    {
        id: "compose-build-short",
        // compose short form: `build: ./backend`
        re: /^\s*build:\s*\.\/(backend|frontend)\b/,
        hint: "use `build:\\n  context: .\\n  dockerfile: backend/Dockerfile`"
    },
    {
        id: "compose-build-context",
        // compose long form: `context: ./backend`
        re: /^\s*context:\s*\.\/(backend|frontend)\b/,
        hint: "context must be the project root: `context: .`"
    },
    {
        id: "scaffold-dockerfile",
        // The rule above assumed a `backend/Dockerfile` whose context was
        // merely wrong. There is no such file: `rebase init` scaffolds a
        // project whose compose stack mounts a bundle into the PUBLISHED
        // runtime image, and the only Dockerfile the CLI writes comes from
        // `rebase eject`, at the project root. Six guides told the reader to
        // build one anyway — `docker build -f backend/Dockerfile .` against a
        // path that does not exist, which is where every one of them stopped.
        re: /backend\/Dockerfile/,
        // English only: the five other locales are machine-translated from
        // these files and are refreshed by `website/scripts/translate_docs.mjs`,
        // not by hand. Failing on a stale translation would block the fix to
        // the page it was translated from.
        only: /^website\/src\/content\/docs\/docs\//,
        hint: "the scaffold ships no backend/Dockerfile — use `rebase build` plus " +
            "`FROM rebasepro/server:<version>` / `COPY dist-bundle /bundle`, the shape " +
            "self-hosting.md and hetzner.md use"
    }
];

/**
 * @param {string} root repo root
 * @returns {{ findings: Array<{file:string,line:number,text:string,rule:string,hint:string}>, scanned:number }}
 */
export function checkDeployBuildContext(root) {
    const seen = new Set();
    const files = [];
    for (const glob of DEPLOY_DOC_GLOBS) {
        for (const f of globSync(glob, { cwd: root })) {
            if (!seen.has(f)) {
                seen.add(f);
                files.push(f);
            }
        }
    }

    const findings = [];
    for (const rel of files) {
        const lines = readFileSync(path.join(root, rel), "utf8").split("\n");
        lines.forEach((text, i) => {
            for (const rule of RULES) {
                if (rule.only && !rule.only.test(rel)) continue;
                if (rule.re.test(text)) {
                    findings.push({ file: rel, line: i + 1, text: text.trim(), rule: rule.id, hint: rule.hint });
                }
            }
        });
    }

    return { findings, scanned: files.length };
}
