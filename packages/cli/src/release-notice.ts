import { spawn } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

/**
 * "Rebase X is out" — one line on stderr when this CLI is behind the release
 * on its channel.
 *
 * Rebase moves fast, and the agents that work in a project only learn about a
 * release if something in front of them says so: they do not read changelogs,
 * but they do read what a command prints. So every command but `upgrade` ends
 * with the line while one is due, naming the command that moves the project
 * (and its agent skills) to it.
 *
 * Nothing waits on the network. The answer is read from
 * `~/.rebase/release-check.json`; when that is a day old, a detached process
 * asks the registry for `@rebasepro/cli`'s dist-tags and rewrites it, and the
 * line shows from the next command on. The request carries nothing about the
 * project or the person: it is the same GET `npm view` makes.
 *
 * Off in CI, and with `REBASE_NO_UPDATE_CHECK=1` or `NO_UPDATE_NOTIFIER` (the
 * variable npm's own notifier reads).
 */

/** How long a registry answer is trusted before it is asked again. */
export const RELEASE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Set for the CLIs a command runs for itself, so the line is printed once. */
export const RELEASE_NOTICE_SHOWN_ENV = "REBASE_RELEASE_NOTICE_SHOWN";

export function releaseCheckPath(home: string = os.homedir()): string {
    return path.join(home, ".rebase", "release-check.json");
}

/** What the background check last heard from the registry. */
export interface ReleaseCheck {
    checkedAt: string;
    distTags: Record<string, string>;
}

export function readReleaseCheck(file: string = releaseCheckPath()): ReleaseCheck | null {
    try {
        const parsed: unknown = JSON.parse(fs.readFileSync(file, "utf-8"));
        if (!parsed || typeof parsed !== "object") return null;
        const { checkedAt, distTags } = parsed as { checkedAt?: unknown; distTags?: unknown };
        if (typeof checkedAt !== "string" || !distTags || typeof distTags !== "object") return null;
        const tags = Object.fromEntries(
            Object.entries(distTags).filter((entry): entry is [string, string] => typeof entry[1] === "string")
        );
        return { checkedAt, distTags: tags };
    } catch {
        return null;
    }
}

function flagSet(value: string | undefined): boolean {
    return value !== undefined && value !== "" && value !== "0" && value.toLowerCase() !== "false";
}

/**
 * Whether this invocation may print the line and refresh the check.
 *
 * `command` is the first word typed. `upgrade` is the remedy itself, and
 * `telemetry` is where a person goes to see what this CLI sends.
 */
export function releaseNoticeEnabled(env: NodeJS.ProcessEnv, command: string | undefined): boolean {
    if (command === undefined || command === "upgrade" || command === "telemetry") return false;
    if (flagSet(env.CI) || flagSet(env.REBASE_NO_UPDATE_CHECK) || env.NO_UPDATE_NOTIFIER !== undefined) return false;
    return !flagSet(env[RELEASE_NOTICE_SHOWN_ENV]);
}

const SEMVER = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/** Negative when `a` is older than `b`, positive when newer, 0 when equal or unreadable. */
export function compareVersions(a: string, b: string): number {
    const x = SEMVER.exec(a);
    const y = SEMVER.exec(b);
    if (!x || !y) return 0;
    for (let i = 1; i <= 3; i++) {
        const diff = Number(x[i]) - Number(y[i]);
        if (diff !== 0) return diff;
    }
    const [preA, preB] = [x[4], y[4]];
    if (preA === preB) return 0;
    if (preA === undefined) return 1;
    if (preB === undefined) return -1;
    const partsA = preA.split(".");
    const partsB = preB.split(".");
    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
        const [pa, pb] = [partsA[i], partsB[i]];
        if (pa === undefined) return -1;
        if (pb === undefined) return 1;
        const [na, nb] = [/^\d+$/.test(pa) ? Number(pa) : NaN, /^\d+$/.test(pb) ? Number(pb) : NaN];
        if (!Number.isNaN(na) && !Number.isNaN(nb)) {
            if (na !== nb) return na - nb;
        } else if (pa !== pb) {
            return pa < pb ? -1 : 1;
        }
    }
    return 0;
}

/**
 * The release this CLI should move to, or `null` when it is current.
 *
 * As `rebase upgrade` chooses: `latest`, or — for a CLI on a prerelease — its
 * channel's tag when that is ahead of `latest`. A canary build is not told
 * about a stable release older than itself, and a stable one is never pointed
 * at a canary. A version this cannot read (a source checkout's) is told
 * nothing.
 */
export function newerRelease(current: string, distTags: Record<string, string>): string | null {
    const parsed = SEMVER.exec(current);
    if (!parsed) return null;
    const candidates = [distTags.latest];
    const channel = parsed[4]?.split(".")[0];
    if (channel && /^[A-Za-z][0-9A-Za-z-]*$/.test(channel)) candidates.push(distTags[channel]);
    let best: string | null = null;
    for (const candidate of candidates) {
        if (typeof candidate !== "string" || !SEMVER.test(candidate)) continue;
        if (compareVersions(candidate, current) > 0 && (best === null || compareVersions(candidate, best) > 0)) best = candidate;
    }
    return best;
}

/** The line itself: what is out, and the command that gets it. */
export function releaseNoticeLines(current: string, newer: string, inProject: boolean): string[] {
    const head = `Rebase ${newer} is out; this CLI is ${current}.`;
    return inProject
        ? [
            `${head} \`rebase upgrade\` moves this project to it and refreshes its agent skills.`,
            "Read the changelog first: https://rebase.pro/docs/changelog/. (REBASE_NO_UPDATE_CHECK=1 hides this.)"
        ]
        : [
            `${head} Update it with \`npm install -g @rebasepro/cli@${newer}\` (or your package manager's equivalent).`,
            "(REBASE_NO_UPDATE_CHECK=1 hides this.)"
        ];
}

export function releaseCheckStale(check: ReleaseCheck | null, now: number = Date.now()): boolean {
    if (!check) return true;
    const at = Date.parse(check.checkedAt);
    return !(at > now - RELEASE_CHECK_INTERVAL_MS) || at > now;
}

/**
 * The script the detached process runs: ask the registry, write the answer.
 *
 * `checkedAt` is written even when the request fails, keeping the tags it had,
 * so an offline machine asks once a day rather than on every command. Written
 * beside the file and renamed over it, so a command reading at the same moment
 * sees the old answer or the new one.
 */
const REFRESH_SCRIPT = `
const fs = require("fs");
const path = require("path");
const [file, url] = process.argv.slice(1);
let previous = {};
try { previous = JSON.parse(fs.readFileSync(file, "utf8")).distTags || {}; } catch {}
const write = (distTags) => {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = file + "." + process.pid + ".tmp";
        fs.writeFileSync(tmp, JSON.stringify({ checkedAt: new Date().toISOString(), distTags }) + "\\n");
        fs.renameSync(tmp, file);
    } catch {}
};
fetch(url, { signal: AbortSignal.timeout(10000), headers: { accept: "application/json" } })
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((tags) => write(tags && typeof tags === "object" ? tags : previous))
    .catch(() => write(previous));
`;

/** Where `@rebasepro/cli`'s dist-tags are asked for: the configured npm registry, or npm's. */
export function distTagsUrl(env: NodeJS.ProcessEnv): string {
    const registry = (env.npm_config_registry || "https://registry.npmjs.org/").replace(/\/+$/, "");
    return `${registry}/-/package/@rebasepro%2fcli/dist-tags`;
}

/** Start the background check. Never waits, never throws. */
export function refreshReleaseCheckInBackground(file: string = releaseCheckPath(), env: NodeJS.ProcessEnv = process.env): void {
    try {
        const child = spawn(process.execPath, ["-e", REFRESH_SCRIPT, file, distTagsUrl(env)], {
            detached: true,
            stdio: "ignore",
            env: { ...env, [RELEASE_NOTICE_SHOWN_ENV]: "1" }
        });
        child.on("error", () => { /* nothing to do */ });
        child.unref();
    } catch {
        // A notice is never worth a failed command.
    }
}

/**
 * Wire the notice into this process: print it as the process exits — after
 * the command's own output, which is where an agent reads its next step — and
 * refresh the check when it is due.
 *
 * Exported pieces carry the logic; this is the one place that touches
 * `process`.
 */
export function installReleaseNotice(opts: { command: string | undefined; current: string; inProject: boolean }): void {
    if (!releaseNoticeEnabled(process.env, opts.command)) return;
    // Children of this command inherit it, so a CLI run for itself stays quiet.
    process.env[RELEASE_NOTICE_SHOWN_ENV] = "1";
    const file = releaseCheckPath();
    const check = readReleaseCheck(file);
    if (releaseCheckStale(check)) refreshReleaseCheckInBackground(file);
    const newer = check ? newerRelease(opts.current, check.distTags) : null;
    if (!newer) return;
    const lines = releaseNoticeLines(opts.current, newer, opts.inProject);
    process.once("exit", () => {
        try {
            process.stderr.write(`\n${lines.join("\n")}\n`);
        } catch {
            // stderr closed: nobody to tell.
        }
    });
}
