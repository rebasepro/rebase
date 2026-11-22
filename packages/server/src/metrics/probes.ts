/**
 * Requests that are something watching the app rather than someone using it.
 *
 * An uptime monitor that fetches `/` every minute is, to the request counter,
 * indistinguishable from a visitor. On a platform that puts an idle project to
 * sleep, that one robot keeps every project awake forever, and it shows up as
 * traffic in every chart and in the billed request count. So a request is a
 * probe when it carries {@link PROBE_HEADER} (any value — a platform or a
 * customer marks its own checks with it) or when its `User-Agent` names a
 * well-known uptime monitor.
 *
 * A probe is still served exactly as any other request; it is only counted
 * apart, in `rebase_probe_requests_total`, so it stays visible without being
 * activity.
 *
 * The paths the platform itself reads (`/metrics`, `/health`, `/livez`,
 * `/readyz`) are not probes in this sense: they are not counted at all — see
 * `isUncountedPath` in `./index.ts`.
 *
 * @module
 */

/** A request with this header (any value) is a probe. */
export const PROBE_HEADER = "x-rebase-probe";

/** The counter probe requests go to, instead of `rebase_requests_total`. */
export const PROBE_REQUESTS_METRIC = "rebase_probe_requests_total";

/**
 * Product names of well-known uptime monitors and load-balancer health
 * checkers, lower case.
 *
 * Kept in step with the cloud waker's list (`PROBE_AGENTS`), which decides
 * that a request for a sleeping project must not wake it: what the waker
 * refuses to wake for, the runtime must not count as activity, or the two
 * disagree about whether the same monitor keeps a project awake. Exported so
 * the control plane can import this list instead of keeping its own copy.
 *
 * Matched as a product token of the `User-Agent`, never as a substring — see
 * {@link matchUptimeMonitor}. Some vendors spell their name more than one way;
 * each spelling is listed. A name with a space matches consecutive tokens.
 */
export const UPTIME_MONITOR_AGENTS: readonly string[] = [
    "uptimerobot",
    "pingdom",
    "statuscake",
    "better uptime",
    "betteruptime",
    "betterstack",
    "site24x7",
    "kube-probe",
    "googlehc",
    "google-health",
    "google-healthcheck",
    "elb-healthchecker",
    "datadog",
    "datadogsynthetics",
    "checkly",
    "uptime-kuma",
    "hetrixtools",
    "freshping",
    "newrelic",
    "newrelicpinger",
    "updown.io",
    "cron-job.org",
    "nodeping",
    "monitis",
    "uptimia",
    "healthchecks"
];

/**
 * Split a `User-Agent` into lower-case words: product names, versions and
 * the words inside comments.
 *
 * `Mozilla/5.0+(compatible;+UptimeRobot/2.0;+http://www.uptimerobot.com/)`
 * gives `mozilla`, `5.0`, `compatible`, `uptimerobot`, `2.0`, … — a monitor
 * names itself in a comment as often as in the product slot.
 */
function userAgentWords(userAgent: string): string[] {
    return userAgent.toLowerCase().split(/[\s/;()+,=]+/).filter(Boolean);
}

/**
 * Whether `word` is `name`, or `name` followed by punctuation: `pingdom` in
 * `pingdom.com_bot_version_1.4_`, `healthchecks` in `healthchecks.io`. A
 * letter or digit after the name is a different word (`datadogviewer` is not
 * `datadog`), which is what keeps a browser's own tokens from matching.
 */
function wordIs(word: string, name: string): boolean {
    if (!word.startsWith(name)) return false;
    if (word.length === name.length) return true;
    return /[^a-z0-9]/.test(word[name.length]);
}

/**
 * The monitor a `User-Agent` names, from {@link UPTIME_MONITOR_AGENTS}, or
 * `undefined`. Case-insensitive.
 */
export function matchUptimeMonitor(userAgent: string | undefined | null): string | undefined {
    if (!userAgent) return undefined;
    const words = userAgentWords(userAgent);
    for (const agent of UPTIME_MONITOR_AGENTS) {
        const parts = agent.split(" ");
        for (let i = 0; i + parts.length <= words.length; i++) {
            if (parts.every((part, offset) => wordIs(words[i + offset], part))) return agent;
        }
    }
    return undefined;
}

/** Why a request counts as a probe, as the labels of {@link PROBE_REQUESTS_METRIC}. */
export type ProbeKind =
    | { by: "header" }
    | { by: "user_agent"; agent: string };

/**
 * Whether a request is a probe, and why; `undefined` for an ordinary request.
 * The header wins over the user agent, so a platform probe that also carries
 * a monitor's user agent is labelled by the header it sent on purpose.
 */
export function classifyProbe(header: (name: string) => string | undefined): ProbeKind | undefined {
    if (header(PROBE_HEADER) !== undefined) return { by: "header" };
    const agent = matchUptimeMonitor(header("user-agent"));
    return agent ? { by: "user_agent", agent } : undefined;
}
