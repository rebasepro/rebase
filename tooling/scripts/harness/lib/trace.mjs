/**
 * Append-only record of what an agent actually did, written by the hooks.
 *
 * This is the half of the harness that makes evals meaningful. Grading only on
 * "did the test go green" scores the diff and misses how it was reached — an agent
 * that got there by editing the test, deploying to prod mid-task, or dropping a
 * codemod in the repo root scores identically to one that did it cleanly. The trace
 * is what the behavioural graders read, and it is the same stream the deploy gate
 * uses to know whether preflight ran before a deploy command.
 *
 * JSONL, one event per line, appended with a single `appendFileSync` so concurrent
 * agents in sibling worktrees cannot interleave a partial line.
 */
import fs from "node:fs";
import path from "node:path";

/** Traces live under the primary checkout's .claude so sibling worktrees share one stream per session. */
export function traceDir(primaryRoot) {
    return path.join(primaryRoot, ".claude", "harness", "traces");
}

export function tracePath(primaryRoot, sessionId) {
    // The eval runner pins the destination, because it spawns the agent as a subprocess
    // and never learns the session id that agent picks for itself. Without this the run
    // could only be graded on its diff, and the behavioural graders would have no input.
    if (process.env.REBASE_HARNESS_TRACE) return process.env.REBASE_HARNESS_TRACE;

    const safe = String(sessionId || "unknown").replace(/[^\w.-]/g, "_");
    return path.join(traceDir(primaryRoot), `${safe}.jsonl`);
}

/**
 * @param {string} file destination from tracePath()
 * @param {object} event arbitrary payload; `ts` and `seq` are added here
 */
export function append(file, event) {
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.appendFileSync(file, JSON.stringify({ ts: Date.now(), ...event }) + "\n");
    } catch {
        // A trace failure must never break the agent's turn. Losing an event costs
        // us grader fidelity; throwing here would cost the user their tool call.
    }
}

export function read(file) {
    try {
        return fs
            .readFileSync(file, "utf8")
            .split("\n")
            .filter(Boolean)
            .map((line) => {
                try {
                    return JSON.parse(line);
                } catch {
                    return null;
                }
            })
            .filter(Boolean);
    } catch {
        return [];
    }
}

/** Read hook input from stdin. Returns {} on anything unparseable, so hooks stay non-fatal. */
export async function readHookInput() {
    const chunks = [];
    for await (const chunk of process.stdin) chunks.push(chunk);
    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        return {};
    }
}
