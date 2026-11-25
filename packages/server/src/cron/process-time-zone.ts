/**
 * The time zone a job without `timezone` runs in: the process's own, which is
 * UTC in the runtime image (it sets no `TZ`). Named in the logs, where "the
 * process's local time" told a reader nothing.
 */
export function processTimeZone(): string {
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    } catch {
        return "UTC";
    }
}
