import { ensureMachineId, ensureProjectId, readConfig, writeConfig } from "./identity";
import { buildEvent, TelemetryEvent, TelemetryEventName } from "./payload";

export { TELEMETRY_SCHEMA_VERSION, bucket, durationBucket, errorClass, buildEvent, sanitize } from "./payload";
export type { TelemetryEvent, TelemetryEventName, TelemetryValue } from "./payload";
export { configPath, readConfig, writeConfig } from "./identity";
export type { TelemetryConfig } from "./identity";

/**
 * Where events go. Overridable so a fork can point at its own collector, and so
 * the tests never touch the network.
 */
export const DEFAULT_TELEMETRY_ENDPOINT = "https://app.rebase.pro/api/functions/telemetry";

export function endpoint(): string {
    return process.env.REBASE_TELEMETRY_ENDPOINT?.trim() || DEFAULT_TELEMETRY_ENDPOINT;
}

/** Why nothing would be sent right now, or `null` when it would. */
export type SuppressionReason =
    | "not_asked"
    | "declined"
    | "do_not_track"
    | "rebase_telemetry_disabled"
    | "ci";

/**
 * The one function that decides whether anything leaves the machine.
 *
 * Every path is a refusal except the last, which is the point: consent is
 * opt-in, so the default answer at every branch — never asked, unreadable
 * config, a set env var, a CI runner — is no.
 *
 * `DO_NOT_TRACK` is honoured because it is the cross-tool convention
 * (consoledonottrack.com); a user who has set it globally has already answered
 * this question and should not be asked again by us.
 *
 * `CI` is refused for a different reason: a build runner is not a person, and
 * counting one is both useless and misleading. A single pipeline re-running on
 * every push would otherwise outweigh every real developer in the data.
 */
export function suppressionReason(env: NodeJS.ProcessEnv = process.env): SuppressionReason | null {
    if (env.DO_NOT_TRACK && env.DO_NOT_TRACK !== "0") return "do_not_track";
    if (env.REBASE_TELEMETRY_DISABLED && env.REBASE_TELEMETRY_DISABLED !== "0") return "rebase_telemetry_disabled";
    if (env.CI && env.CI !== "false") return "ci";

    const config = readConfig();
    if (config.enabled === undefined) return "not_asked";
    if (!config.enabled) return "declined";
    return null;
}

export function isEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
    return suppressionReason(env) === null;
}

/** Record the user's answer. `false` is final — nothing prompts again. */
export function setConsent(enabled: boolean): void {
    const config = readConfig();
    writeConfig({
        ...config,
        enabled,
        decidedAt: new Date().toISOString(),
        // An id is minted only on acceptance. Generating one at decline time
        // would create the very record the user just refused.
        machineId: enabled ? (config.machineId ?? undefined) : undefined
    });
    if (enabled) ensureMachineId();
}

/**
 * Build the event that *would* be sent, without sending it.
 *
 * This is what `rebase telemetry show` prints, and it is deliberately the same
 * function the sender uses — a preview assembled by separate code is a promise
 * that drifts. Returns `null` when nothing would be sent, so the command can
 * say why instead of showing a payload that is never going anywhere.
 */
export function previewEvent(
    event: TelemetryEventName,
    properties: Record<string, unknown> = {},
    projectRoot?: string
): TelemetryEvent | null {
    const config = readConfig();
    if (!config.machineId) return null;
    return buildEvent(event, properties, {
        machineId: config.machineId,
        projectId: projectRoot ? ensureProjectId(projectRoot) : undefined
    });
}

/**
 * Send one event, or quietly do nothing.
 *
 * Three properties this must hold, in order of importance:
 *
 *  1. **It never throws.** Telemetry failing is not a reason for `rebase dev`
 *     to fail. Every error is swallowed.
 *  2. **It never blocks meaningfully.** A two-second ceiling, after which the
 *     command carries on regardless — a collector having a bad day must not
 *     become the CLI hanging.
 *  3. **It never sends without consent.** Enforced here rather than at the call
 *     sites, so a new call site cannot get it wrong.
 */
export async function recordEvent(
    event: TelemetryEventName,
    properties: Record<string, unknown> = {},
    options: { projectRoot?: string; timeoutMs?: number } = {}
): Promise<void> {
    try {
        if (!isEnabled()) return;

        const machineId = ensureMachineId();
        const projectId = options.projectRoot ? ensureProjectId(options.projectRoot) : undefined;
        const payload = buildEvent(event, properties, { machineId,
projectId });

        const abort = new AbortController();
        const timer = setTimeout(() => abort.abort(), options.timeoutMs ?? 2000);
        try {
            await fetch(endpoint(), {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload),
                signal: abort.signal
            });
        } finally {
            clearTimeout(timer);
        }
    } catch {
        // Deliberately silent. A warning here would be worse than useless: it
        // draws attention to a subsystem the user opted into and cannot act on,
        // in the middle of output they were actually reading.
    }
}
