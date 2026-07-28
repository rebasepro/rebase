/**
 * Scale-to-zero detection for the cron scheduler.
 *
 * The scheduler drives jobs with in-process `setTimeout`. That works on any
 * always-running instance, but on a platform that freezes or evicts the
 * container between requests (Cloud Run with `--min-instances=0`, AWS Lambda,
 * Vercel functions) the timers simply never fire — the process boots, logs the
 * jobs as registered, and silently runs nothing.
 *
 * None of these platforms expose their scaling floor to the container, so this
 * detection is a heuristic: it identifies the *platform*, not the setting. It
 * is a warning only — it must never influence boot.
 *
 * Environment variables used here were verified against vendor documentation:
 *  - `K_SERVICE` / `K_REVISION` / `K_CONFIGURATION` — Cloud Run services
 *    (Cloud Run container contract; no variable exposes min-instances).
 *  - `CLOUD_RUN_JOB` — Cloud Run jobs (same contract).
 *  - `AWS_LAMBDA_FUNCTION_NAME` — reserved AWS Lambda runtime variable.
 *  - `VERCEL=1` — Vercel system environment variable, available at runtime.
 *  - `KUBERNETES_SERVICE_HOST` — injected into every pod by the kubelet. Used
 *    as an *exclusion*: a Deployment pod runs continuously, and Knative on
 *    Kubernetes also sets `K_SERVICE`, so a pod is never warned about.
 */

/** Environment variable that permanently silences the scale-to-zero warning. */
export const CRON_ALWAYS_ON_ENV = "REBASE_CRON_ALWAYS_ON";

/** The subset of `process.env` this module reads. */
export type EnvLike = Record<string, string | undefined>;

export interface FreezableRuntime {
    /** Human-readable platform name, used verbatim in the warning. */
    platform: string;
    /** Names of the environment variables that identified the platform. */
    signals: string[];
}

/** Minimal shape of a registered job needed to build the warning. */
export interface WarnableJob {
    id: string;
    enabled: boolean;
}

export interface ScaleToZeroWarning {
    message: string;
    data: Record<string, unknown>;
}

/** Accepts the usual truthy spellings; anything else (including "") is false. */
function isTruthy(value: string | undefined): boolean {
    if (!value) return false;
    const normalised = value.trim().toLowerCase();
    return normalised === "1" || normalised === "true" || normalised === "yes" || normalised === "on";
}

/**
 * Identify a runtime whose instances can be frozen or torn down between
 * requests. Returns `undefined` when the platform is unknown or known to run
 * continuously.
 */
export function detectFreezableRuntime(env: EnvLike = process.env): FreezableRuntime | undefined {
    // A Kubernetes pod (GKE, EKS, self-hosted) runs continuously. Knative and
    // Cloud Run for Anthos set K_SERVICE *inside* a pod, so this exclusion has
    // to come first or every Knative pod would be a false positive.
    if (env.KUBERNETES_SERVICE_HOST) return undefined;

    if (env.K_SERVICE) {
        const signals = ["K_SERVICE"];
        if (env.K_REVISION) signals.push("K_REVISION");
        if (env.K_CONFIGURATION) signals.push("K_CONFIGURATION");
        return { platform: "Cloud Run", signals };
    }

    if (env.CLOUD_RUN_JOB) {
        return { platform: "Cloud Run Jobs", signals: ["CLOUD_RUN_JOB"] };
    }

    if (env.AWS_LAMBDA_FUNCTION_NAME) {
        return { platform: "AWS Lambda", signals: ["AWS_LAMBDA_FUNCTION_NAME"] };
    }

    if (env.VERCEL === "1") {
        return { platform: "Vercel", signals: ["VERCEL"] };
    }

    return undefined;
}

/** How many job ids to name before collapsing the rest into "+N more". */
const MAX_NAMED_JOBS = 10;

/**
 * Build the boot-time warning, or `undefined` when it does not apply.
 *
 * Fires only when all of the following hold:
 *  1. `NODE_ENV=production` — a laptop or CI run is not at risk.
 *  2. At least one *enabled* job is registered — nothing to lose otherwise.
 *  3. The environment looks like a freezable platform (see above).
 *  4. `REBASE_CRON_ALWAYS_ON` is not set to a truthy value.
 */
export function buildScaleToZeroWarning(
    jobs: WarnableJob[],
    env: EnvLike = process.env
): ScaleToZeroWarning | undefined {
    if (env.NODE_ENV !== "production") return undefined;
    if (isTruthy(env[CRON_ALWAYS_ON_ENV])) return undefined;

    const enabled = jobs.filter((job) => job.enabled).map((job) => job.id);
    if (enabled.length === 0) return undefined;

    const runtime = detectFreezableRuntime(env);
    if (!runtime) return undefined;

    const named = enabled.slice(0, MAX_NAMED_JOBS);
    const list = enabled.length > named.length
        ? `${named.join(", ")} (+${enabled.length - named.length} more)`
        : named.join(", ");

    const message = `[cron] ${runtime.platform} detected — in-process timers do not fire while an instance is frozen or scaled to zero, so ${enabled.length} enabled job(s) may never run: ${list}; drive them from an external scheduler instead (POST /api/cron/:id/trigger, e.g. Cloud Scheduler). ${runtime.platform} does not expose its scaling floor to the container, so an always-warm deployment cannot be confirmed from inside the process — set ${CRON_ALWAYS_ON_ENV}=1 to silence this if at least one instance is pinned warm.`;

    return {
        message,
        data: {
            platform: runtime.platform,
            signals: runtime.signals,
            jobs: enabled
        }
    };
}
