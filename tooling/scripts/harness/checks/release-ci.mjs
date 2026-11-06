/**
 * A release ships the commit CI has already judged — and only after it judged it green.
 *
 * 2026-11-06: CI on main went red at 12:34 (a CLI test and a stale LLM mirror) and the
 * 0.28.2 release was dispatched at 15:13 anyway. publish.yml re-runs every lane before it
 * publishes, so nothing broken shipped, but the run failed half an hour in, on failures
 * CI had reported hours earlier. The red result was there; nobody looked.
 *
 * So a release-shaped command asks GitHub what CI said about the commit it would ship:
 * green passes, red blocks, and anything else — still running, cancelled, never run —
 * asks the person first. The commit is the remote branch's tip, not the local HEAD,
 * because a dispatch builds what is on GitHub.
 *
 * Like `control-plane`, this inspects a proposed command, so it runs at the hook, not
 * from the tree stamp. When GitHub cannot be asked it warns rather than passing: a check
 * that silently passes on a network error is the failure it exists to prevent.
 */
import { execFileSync } from "node:child_process";
import { finding, pass, WARN, FAIL } from "../lib/report.mjs";

export const id = "release-ci";
export const title = "A release ships a commit CI judged green";

/** Where a command starts: the string's start, or after a separator. Not inside quotes. */
const START = String.raw`(?:^|[;&|\n(])\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`;

/** Commands that publish a release, or push the tag that is one. */
const RELEASE_SHAPED = [
    new RegExp(`${START}gh\\s+workflow\\s+run\\s+(?:\\S+\\s+)*?publish(?:-runtime-image)?\\.yml\\b`),
    new RegExp(`${START}(?:npm|pnpm)\\s+(?:-r\\s+|--recursive\\s+)?publish\\b`),
    new RegExp(`${START}git\\s+push\\b[^;&|\\n]*\\s(?:refs/tags/)?v\\d+\\.\\d+\\.\\d+`),
    new RegExp(`${START}git\\s+push\\b[^;&|\\n]*\\s--(?:tags|follow-tags)\\b`),
];

export function isReleaseShaped(command = "") {
    return RELEASE_SHAPED.some((re) => re.test(command));
}

/** The branch a dispatch builds: `--ref <name>` / `-r <name>`, else main. */
export function releaseRef(command = "") {
    const match = /\s(?:--ref|-r)[=\s]+([^\s;&|]+)/.exec(command);
    return match ? match[1] : "main";
}

/** What GitHub says: the ref's tip, and CI's runs on that commit, newest first. */
function readCiFromGitHub(ref, cwd) {
    const gh = (args) => execFileSync("gh", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000 }).trim();
    const sha = gh(["api", `repos/{owner}/{repo}/commits/${ref}`, "--jq", ".sha"]);
    const runs = JSON.parse(gh(["run", "list", "--workflow", "ci.yml", "--commit", sha, "--limit", "5", "--json", "status,conclusion,url"]));
    return { sha, runs };
}

export function run(ctx, { command = "", readCi = readCiFromGitHub } = {}) {
    if (!command || !isReleaseShaped(command)) return [pass(id, "No release-shaped command to check.")];

    const ref = releaseRef(command);
    let ci;
    try {
        ci = readCi(ref, ctx.root);
    } catch (error) {
        return [finding(id, WARN,
            `Could not read CI's result for ${ref} from GitHub (${String(error.message ?? error).split("\n")[0]}).`,
            `Check it yourself before releasing: gh run list --workflow ci.yml --branch ${ref} --limit 3`)];
    }

    const short = ci.sha.slice(0, 10);
    const latest = ci.runs[0];
    if (!latest) {
        return [finding(id, WARN, `CI has not run on ${short}, the tip of ${ref} this release would build.`,
            `Wait for CI on ${short}, or push so it runs, before releasing.`)];
    }
    if (latest.status !== "completed") {
        return [finding(id, WARN, `CI on ${short} (the tip of ${ref}) is still ${latest.status}: ${latest.url}`,
            "Wait for it to finish green, then release.")];
    }
    if (latest.conclusion === "success") return [pass(id, `CI passed on ${short}, the tip of ${ref}.`)];
    if (latest.conclusion === "failure") {
        return [finding(id, FAIL, `CI failed on ${short}, the tip of ${ref} this release would build: ${latest.url}`,
            "Fix what it reports and push; release once CI on the new tip is green.")];
    }
    return [finding(id, WARN, `CI on ${short} (the tip of ${ref}) ended ${latest.conclusion}, not green: ${latest.url}`,
        "Re-run it (gh run rerun <id>) and release once it passes.")];
}
