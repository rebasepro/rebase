/**
 * Is an external tool a gate needs present on this machine, and answering?
 *
 * Every probe is bounded. `ci:static` once asked `docker info` with no timeout
 * while Docker Desktop was unresponsive: the child never returned, the runner
 * sat silent for thirty minutes after `check:chart`, and nothing in the output
 * said it was waiting on Docker. Killing that one child let the run finish.
 *
 * Docker is asked for its SERVER version rather than `docker info`, which can
 * exit 0 with only a client section when no daemon answers — a probe that says
 * yes to a machine that cannot start a container.
 *
 * Shared by the `ci:static` runner and every gate that probes a tool itself, so
 * all of them give the same answer and the same reason.
 */
import { spawnSync } from "node:child_process";

/** How long a probe may take before the tool counts as not answering. */
export const PROBE_TIMEOUT_MS = 20_000;

const PROBES = {
    docker: {
        args: ["version", "--format", "{{.Server.Version}}"],
        // The template renders nothing when there is no server to describe.
        answered: (stdout) => stdout.trim() !== ""
    },
    helm: {
        args: ["version", "--short"],
        answered: () => true
    }
};

/**
 * Run the tool's probe, bounded by `timeoutMs`.
 *
 * `env` is where the tool is looked up (its `PATH`) and what it runs with.
 *
 * @param {keyof typeof PROBES} tool
 * @param {{ timeoutMs?: number, env?: NodeJS.ProcessEnv }} [options]
 * @returns {{ ok: true, version: string } | { ok: false, reason: string }}
 */
export function probeTool(tool, { timeoutMs = PROBE_TIMEOUT_MS, env = process.env } = {}) {
    const probe = PROBES[tool];
    if (!probe) throw new Error(`No probe for "${tool}". Known: ${Object.keys(PROBES).join(", ")}.`);

    const command = `${tool} ${probe.args.join(" ")}`;
    const result = spawnSync(tool, probe.args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: timeoutMs,
        // A wedged client may not honour SIGTERM, and spawnSync waits for the
        // child it signalled — which is the hang this module exists to bound.
        killSignal: "SIGKILL",
        env
    });

    if (result.error?.code === "ENOENT") return { ok: false, reason: `${tool} is not on PATH` };
    if (result.error?.code === "ETIMEDOUT") {
        return { ok: false, reason: `${tool} did not answer within ${timeoutMs / 1000}s (\`${command}\`)` };
    }
    if (result.error) return { ok: false, reason: `\`${command}\` could not run: ${result.error.message}` };

    const said = result.stderr.trim().split("\n")[0];
    const because = said ? `: ${said}` : "";
    if (result.signal) return { ok: false, reason: `\`${command}\` was killed by ${result.signal}${because}` };
    if (result.status !== 0) return { ok: false, reason: `\`${command}\` exited ${result.status}${because}` };
    if (!probe.answered(result.stdout)) {
        return { ok: false, reason: `\`${command}\` exited 0 but no ${tool} server answered${because}` };
    }
    return { ok: true, version: result.stdout.trim() };
}
