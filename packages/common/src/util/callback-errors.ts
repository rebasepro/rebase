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

/**
 * The refusal a callback expresses by returning `false` rather than throwing.
 *
 * `beforeDelete` is typed `boolean | void` and documented as "return false or
 * throw to block deletion". Returning `false` did stop the delete — and then the
 * route answered `204 No Content`, which says the row is gone. The admin panel
 * removed it from the list, a client that trusted the status dropped it from its
 * cache, and the next reload brought it back. A veto that reports success is
 * worse than no veto.
 *
 * 403, not the 400 a throw produces: a throw carries the author's message and
 * reads as "this input is wrong", while `false` is a flat refusal with no
 * explanation — the server understood the request and will not perform it. The
 * code is the same either way, so a client can handle both in one branch.
 *
 * @param stage The callback name, for `details.stage`.
 * @param path  The collection path, for `details.path`.
 */
export function callbackRefusal(stage: string, path: string): RebaseApiError {
    return new RebaseApiError(`${stage} refused the operation`, {
        status: 403,
        code: CALLBACK_REJECTED,
        details: { stage, path }
    });
}

/**
 * The collection a callback tier is about to be handed — or a refusal.
 *
 * Every callback props type declares `collection: CollectionConfig`,
 * non-optional, and the documented global-callback examples dereference it
 * (`if (collection.slug === "audit_log") return;`). The driver resolves that
 * value from the registry, which answers `undefined` for a path it does not
 * know, so the tiers used to receive it through a cast that quietly dropped the
 * `| undefined`. A global `beforeSave` reading `collection.slug` then threw a
 * `TypeError` that `toCallbackError` reported as a 400 `CALLBACK_REJECTED` —
 * the author's own rule blamed for a value the framework failed to supply.
 *
 * Skipping the tier instead is not available. `afterRead` is documented as the
 * place for "security-critical redaction (PII masking, row filtering) — no read
 * path bypasses it", and a tier that silently does not run on the paths the
 * registry cannot resolve is precisely such a bypass.
 *
 * So the contract is the third option: **a callback tier never runs without a
 * collection**, because a path that has none is refused before one can. That
 * costs nothing, because it is already true — every read and every write
 * reaches the database through `getCollectionByPath` in the driver's collection
 * helpers, which raises this same "not found" for the same paths. Asking here
 * only asks earlier, while the answer is still a 404 about the request instead
 * of a `TypeError` attributed to the application's hook.
 *
 * @param collection The collection the driver resolved, if it resolved one.
 * @param path       The collection path, for the message and `details`.
 */
export function requireCallbackCollection<C>(collection: C | undefined, path: string): C {
    if (!collection) {
        throw new RebaseApiError(`Collection not found: ${path}`, {
            status: 404,
            code: "NOT_FOUND",
            details: { path }
        });
    }
    return collection;
}
