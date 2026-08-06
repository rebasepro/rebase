export const defaultDateFormat = "MMMM dd, yyyy, HH:mm:ss";

/** Seven days, the distance past which a relative phrase stops being useful. */
const DEFAULT_MAX_MS = 7 * 24 * 60 * 60 * 1000;

export type FormatRelativeTimeOptions = {
    /**
     * The instant the distance is measured from. Defaults to the current time.
     * Pass it explicitly to make a caller testable without faking the clock.
     */
    now?: Date | number;
    /**
     * How far a value may sit from {@link now} and still be described
     * relatively. Beyond it the function returns `null` and the caller renders
     * an absolute date instead. Defaults to seven days.
     */
    maxMs?: number;
};

function toTime(value: Date | string | number | null | undefined): number | null {
    if (value === null || value === undefined || value === "") return null;
    const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
    return Number.isNaN(time) ? null : time;
}

/**
 * Describes an instant relative to another one — "5m ago", "in 3h".
 *
 * The direction is part of the answer. Every hand-rolled version of this in the
 * codebase computed `now - then` and then tested only the positive side, so a
 * timestamp in the future fell through to whichever branch happened to be
 * first: a date scheduled for next month read "Just now", and one a couple of
 * hours out read "-1d ago". Both are dates a CMS holds all the time — a publish
 * date, a due date, an expiry — and neither shape can occur here, because the
 * distance is measured with {@link Math.abs} and the tense is chosen from the
 * sign rather than assumed.
 *
 * Returns `null` when the value is unreadable, or when it is further than
 * {@link FormatRelativeTimeOptions.maxMs} away in either direction. `null` is
 * "say it another way", not an error: the caller owns the absolute format, and
 * the locale and precision that go with it.
 */
export function formatRelativeTime(
    value: Date | string | number | null | undefined,
    options: FormatRelativeTimeOptions = {}
): string | null {
    const then = toTime(value);
    if (then === null) return null;

    const now = options.now instanceof Date ? options.now.getTime() : (options.now ?? Date.now());
    const maxMs = options.maxMs ?? DEFAULT_MAX_MS;

    // Positive is the past, which is the only case the callers used to handle.
    const delta = now - then;
    const distance = Math.abs(delta);
    if (distance > maxMs) return null;

    const future = delta < 0;

    const minutes = Math.floor(distance / 60_000);
    if (minutes < 1) return future ? "in a moment" : "just now";
    if (minutes < 60) return future ? `in ${minutes}m` : `${minutes}m ago`;

    const hours = Math.floor(distance / 3_600_000);
    if (hours < 24) return future ? `in ${hours}h` : `${hours}h ago`;

    const days = Math.floor(distance / 86_400_000);
    return future ? `in ${days}d` : `${days}d ago`;
}
