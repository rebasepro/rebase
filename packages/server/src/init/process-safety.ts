import { logger } from "../utils/logger";

/**
 * Installed once per process. The singleton is process-global for the same
 * reason (see `singleton.ts`): more than one copy of this module can be loaded
 * — the image ships one at `/app/node_modules` and a project's bundle installs
 * another — and each copy would otherwise add its own listener.
 */
const HANDLER_SLOT = Symbol.for("@rebasepro/server:unhandled-rejection-handler");

type GlobalWithHandler = typeof globalThis & {
    [HANDLER_SLOT]?: (reason: unknown) => void;
};

/**
 * Log unhandled promise rejections instead of letting Node terminate the
 * process.
 *
 * Node has terminated on an unhandled rejection since v15. Hono catches
 * anything thrown or rejected inside an awaited handler, so the ordinary
 * request path is covered — but a fire-and-forget `void syncToCrm(body)`, a
 * `setTimeout(async () => …)`, or an unawaited `.then()` in one custom function
 * rejects outside Hono's frame. The default outcome is that one project's
 * floating promise ends the process; on the managed runtime that process is
 * shared, so every other tenant on the pod goes with it, and the request log
 * points nowhere because the request itself succeeded.
 *
 * A logged rejection is the better trade here: the process keeps serving, and
 * the stack reaches the operator. `uncaughtException` is deliberately **not**
 * handled — a synchronous throw that escaped every frame leaves the process in
 * a state we cannot reason about, and swallowing it would be a worse bargain
 * than a restart.
 *
 * Set `REBASE_EXIT_ON_UNHANDLED_REJECTION=1` to restore Node's default.
 *
 * @returns An uninstall function (used by tests), or `undefined` when nothing
 * was installed.
 */
export function installUnhandledRejectionHandler(): (() => void) | undefined {
    if (process.env.REBASE_EXIT_ON_UNHANDLED_REJECTION === "1") return undefined;

    const slot = globalThis as GlobalWithHandler;
    if (slot[HANDLER_SLOT]) return undefined;

    const handler = (reason: unknown): void => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        logger.error(
            "Unhandled promise rejection — the process kept running. This is almost always a " +
            "fire-and-forget call in application code (a custom function, a cron job, a callback). " +
            "Await it, or attach a .catch().",
            { error }
        );
    };

    slot[HANDLER_SLOT] = handler;
    process.on("unhandledRejection", handler);

    return () => {
        process.removeListener("unhandledRejection", handler);
        delete slot[HANDLER_SLOT];
    };
}
