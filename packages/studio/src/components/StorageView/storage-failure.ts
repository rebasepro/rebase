/**
 * Why a storage listing failed — and whether it is the platform's fault.
 *
 * ## Why this is a function
 *
 * The pane rendered one view for every failure: a red card titled **"Error
 * loading storage"** with whatever string came back underneath.
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
 */

export type StorageFailureKind =
    /** The project's own authorize hook said no. Not an error. */
    | "denied"
    /** We could not reach or read the store. */
    | "unavailable";

export interface StorageFailure {
    kind: StorageFailureKind;
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

export function classifyStorageFailure(err: unknown): StorageFailure {
    const detail = err instanceof Error ? err.message : String(err);
    const status = statusOf(err);

    // 403 is the hook's answer; 401 means the caller is not signed in as anyone
    // the hook can evaluate, which is the same conversation from the other end.
    // The message match is the fallback, because an SDK that flattens an error
    // to a string is exactly how this reached the screen unclassified.
    const denied =
        status === 403 ||
        status === 401 ||
        /\bnot authori[sz]ed\b|\bforbidden\b|\bpermission denied\b/i.test(detail);

    return denied
        ? { kind: "denied", detail, retryable: false }
        : { kind: "unavailable", detail, retryable: true };
}
