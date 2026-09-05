import { RebaseApiError } from "@rebasepro/types";

/**
 * The code a write carries when a collection callback rejected it and did not
 * say how. Distinct from `INVALID_INPUT`, which the framework's own validation
 * raises: this one means *your* rule refused, so the message is the author's.
 *
 * `details.stage` names which callback refused — `beforeSave`, `beforeDelete`,
 * `afterSave` or `afterDelete`. An `after*` hook runs inside the write's
 * transaction, so a throw there rolls the row back too; the caller is told the
 * write did not happen and which hook decided that.
 */
export const CALLBACK_REJECTED = "CALLBACK_REJECTED";

/**
 * Turn whatever a user callback threw into something the API layer can answer
 * with.
 *
 * ### Why a plain `throw` has to mean 400
 *
 * Both `docs/collections/callbacks.md` ("Throw an error to **block the save**")
 * and `docs/backend/hooks.md` ("the operation is rejected with an HTTP 400
 * error response") promised this, and neither delivered it: an `Error` thrown
 * from `beforeSave` reached the client as
 *
 *     500 {"error":{"message":"Internal Server Error","code":"INTERNAL_ERROR"}}
 *
 * with the author's message visible only in the server log, because the error
 * normalizer masks 5xx bodies — correctly, since a 500 is by definition
 * something the caller must not be told about.
 *
 * But a callback is not the server failing. It is the application speaking, in
 * code its author wrote, about a request its author judged invalid. The
 * conservative reading — "an unrecognised throw might be a real bug, so 500" —
 * costs every validation rule its message and makes the documented example
 * wrong. A rule that wants a 500 can still raise one explicitly.
 *
 * ### Why `after*` comes through here too
 *
 * `afterSave` and `afterDelete` run inside the write's transaction and are
 * awaited, so a throw in one aborts the transaction: the row is not there when
 * the request ends. Left unconverted, the caller saw a 500 for a write that a
 * rule deliberately undid, and had no way to tell that from a database outage.
 * Converted, it is the same 400 `CALLBACK_REJECTED` a `before*` hook produces,
 * with `stage` naming the hook that refused.
 *
 * ### What passes through untouched
 *
 * Anything that already carries a status: `RebaseApiError` from
 * `@rebasepro/types` (the browser-safe class a `config/collections/*.ts` file
 * can import — the collection file is bundled into the admin SPA, so it may not
 * import the server package), and the server's own `ApiError`, recognised
 * structurally rather than by `instanceof` because a monorepo can resolve two
 * copies of a package and `instanceof` is false across them.
 *
 * @param error What the callback threw.
 * @param stage The callback name, for the log line.
 * @param path  The collection path, for the log line.
 */
export function toCallbackError(error: unknown, stage: string, path: string): unknown {
    if (error !== null && typeof error === "object") {
        const carried = error as { status?: unknown; statusCode?: unknown };
        // Already an answerable HTTP outcome — the author chose the status.
        if (typeof carried.statusCode === "number" || typeof carried.status === "number") {
            return error;
        }
    }

    const message = error instanceof Error
        ? error.message
        : typeof error === "string" ? error : `${stage} rejected the write`;

    return new RebaseApiError(message, {
        status: 400,
        code: CALLBACK_REJECTED,
        details: { stage, path },
        cause: error
    });
}
