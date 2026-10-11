/**
 * A byte count as an operator reads it in an error message: `10MB`, `1.5MB`,
 * `512KB`, `1000 bytes`.
 *
 * The body-limit messages used to round to whole megabytes, so a limit of
 * 1000 bytes said "Maximum size is 0MB" and one of 512 KiB said "1MB" — the
 * one number the caller needed was wrong in both. Units are binary (1 MB =
 * 1024 × 1024 bytes), as the limits themselves are configured.
 */
export function formatByteSize(bytes: number): string {
    const KB = 1024;
    const MB = KB * 1024;
    if (bytes >= MB) return `${trim(bytes / MB)}MB`;
    if (bytes >= KB) return `${trim(bytes / KB)}KB`;
    return `${bytes} bytes`;
}

/** One decimal at most, and none when it is zero. */
function trim(value: number): string {
    const rounded = Math.round(value * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
