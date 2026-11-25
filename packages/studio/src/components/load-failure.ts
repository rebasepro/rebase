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
 * ## A tool the server does not offer
 *
 * A backend may leave a tool's API out on purpose: the route answers 404, or
 * 501 when the feature is not configured. Nothing about the project is broken
 * and there is nothing to retry, so the pane says the tool is not available on
 * this server instead of putting "Not found" in red over an empty list that
 * still offers to create things.
 *
 * Only the call that stands for the tool may read a 404 that way: a pane's
 * own listing or a Database section's read, passed `{ toolLevel: true }`. A
 * 404 from a route about one item — a branch's diff, one cron job's runs — is
 * that item gone, and the default keeps it a failure to read, with Retry.
 *
 * The view that renders one of these is `load-failure-view.tsx`. It is a
 * separate file so that this classifier — the part with the rules in it — can
 * be tested without dragging in `@rebasepro/app` and, behind it, react-router.
 */

export type LoadFailureKind =
    /** The project's own rules, or the caller's own role, said no. Not an error. */
    | "denied"
    /** We could not reach or read the source — including a session the server no longer accepts. */
    | "unavailable"
    /** The server does not serve this tool's API (404, or 501 for a feature it has not configured). Not an error. */
    | "not_offered";

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

/**
 * A message that is nothing but "Not found": what a server that has no such
 * route answers, flattened by an SDK that dropped the status.
 */
const BARE_NOT_FOUND = /^(?:404\s+)?not found\.?$/i;

/** Whether `detail` says no more than "Not found", and so adds nothing under a title. */
export function isBareNotFound(detail: string): boolean {
    return BARE_NOT_FOUND.test(detail.trim());
}

export interface ClassifyOptions {
    /**
     * The request is the tool's own listing — the one whose route is the
     * tool's API — so a 404 or 501 means the server does not offer the tool.
     * Off by default: from a per-item route a 404 is the item, not the tool.
     */
    toolLevel?: boolean;
}

export function classifyLoadFailure(err: unknown, options: ClassifyOptions = {}): LoadFailure {
    const detail = err instanceof Error ? err.message : String(err);
    const status = statusOf(err);

    // From the tool's own listing, 404 and 501 are the server saying it has no
    // such API: a backend that leaves the tool out, or one that has not
    // configured it. Without a status, only a message that is "Not found" and
    // nothing else counts — "No row DJBH" or "Bucket not found" are about a
    // resource, not the route.
    const notOffered = options.toolLevel === true && (status !== null
        ? status === 404 || status === 501
        : isBareNotFound(detail));
    if (notOffered) return { kind: "not_offered", detail, retryable: false };

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
