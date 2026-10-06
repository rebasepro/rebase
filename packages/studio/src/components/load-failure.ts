/**
 * Why a Studio listing failed — and whether it is the platform's fault.
 *
 * ## Why this is a function
 *
 * The storage pane rendered one view for every failure: a red card titled
 * **"Error loading storage"** with whatever string came back underneath.
 *
 * On 2026-08-27 a customer opened the Files tab of a healthy project and read
 * "Error loading storage — Not authorized for this object". Nothing was broken.
 * That project's own `storageAuthorize` hook refuses an unscoped listing on
 * purpose — its comment says a `list` that is not scoped to a team "is precisely
 * the enumeration this exists to stop" — and the Files tab always opens at the
 * bucket root. The console took a policy working exactly as written and
 * presented it as a fault in the platform, which sends the reader hunting for a
 * problem that does not exist.
 *
 * A refusal and a failure need different words, a different colour, and a
 * different next step: one is "your rule said no", the other is "we could not
 * ask". Retry is an affordance for the second and noise on the first.
 *
 * ## Why it is shared
 *
 * Storage was the only pane that had learned this. Backups, Cron Jobs, API Keys
 * and Branches each caught the error, opened a snackbar that is gone in four
 * seconds, and left their list empty — so a reader who looked away, or arrived
 * after the toast, was told "No backups found yet" about a database that has
 * backups and an account that may not list them. One classifier and one view, so
 * the next pane inherits the distinction instead of rediscovering it.
 *
 * The view that renders one of these is `load-failure-view.tsx`. It is a
 * separate file so that this classifier — the part with the rules in it — can
 * be tested without dragging in `@rebasepro/app` and, behind it, react-router.
 */

export type LoadFailureKind =
    /** The project's own rules, or the caller's own role, said no. Not an error. */
    | "denied"
    /** We could not reach or read the source — including a session the server no longer accepts. */
    | "unavailable";

export interface LoadFailure {
    kind: LoadFailureKind;
    /** The message as the server gave it, never re-worded. */
    detail: string;
    /** Offering retry against a standing policy teaches people the button does nothing. */
    retryable: boolean;
}

/** HTTP status carried by whatever the SDK threw, if it carries one. */
function statusOf(err: unknown): number | null {
    if (typeof err !== "object" || err === null) return null;
    for (const key of ["status", "statusCode", "code"]) {
        const v = (err as Record<string, unknown>)[key];
        if (typeof v === "number" && v >= 100 && v < 600) return v;
    }
    return null;
}

export function classifyLoadFailure(err: unknown): LoadFailure {
    const detail = err instanceof Error ? err.message : String(err);
    const status = statusOf(err);

    // 403 is the rule's answer, and the only status that is. A 401 is the
    // session — expired, revoked, signed out elsewhere — and says nothing about
    // what the caller's role may do; a 5xx is the platform, even when its
    // message says "permission denied" (a missing GRANT is answered that way).
    // Both are failures to read, with Retry.
    //
    // The message match is only for an error that carries no status at all: an
    // SDK that flattens an error to a string is how a refusal reached the
    // screen unclassified.
    const denied = status !== null
        ? status === 403
        : /\bnot authori[sz]ed\b|\bforbidden\b|\bpermission denied\b/i.test(detail);

    return denied
        ? { kind: "denied", detail, retryable: false }
        : { kind: "unavailable", detail, retryable: true };
}
