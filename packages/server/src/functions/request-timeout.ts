import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";
import { ApiError, errorHandler } from "../api/errors";

/** Default ceiling for a custom function request, in milliseconds. */
export const DEFAULT_FUNCTIONS_TIMEOUT_MS = 30_000;

/**
 * Resolve the functions request timeout from config, then env, then the default.
 *
 * `0` (or any non-positive number) disables the ceiling — for a deployment
 * whose proxy already imposes one, or a function that legitimately streams for
 * minutes.
 */
export function resolveFunctionsTimeoutMs(configured?: number): number {
    if (typeof configured === "number" && Number.isFinite(configured)) {
        return Math.max(0, Math.floor(configured));
    }
    // Blank means unset, not zero. `Number("")` and `Number(" ")` are both 0,
    // and 0 here means "no ceiling" — so a compose file with
    // `REBASE_FUNCTIONS_TIMEOUT_MS=${SOMETHING}` and `SOMETHING` undefined, or
    // a `.env` line with the name and no value, silently switched off the one
    // bound on how long code the framework did not write may hold a socket.
    // Declaring a variable without setting it is the ordinary way to write
    // both of those files, and the failure is invisible: nothing logs, and the
    // deployment behaves exactly as it did before the ceiling existed.
    const raw = process.env.REBASE_FUNCTIONS_TIMEOUT_MS?.trim();
    if (raw) {
        const fromEnv = Number(raw);
        if (Number.isFinite(fromEnv) && fromEnv >= 0) {
            return Math.floor(fromEnv);
        }
    }
    return DEFAULT_FUNCTIONS_TIMEOUT_MS;
}

/**
 * A per-request ceiling for the custom functions router.
 *
 * Custom functions are the one router that runs code the framework did not
 * write, and nothing else in the stack bounds how long that code takes: the
 * Node server is constructed without `requestTimeout`/`headersTimeout`, so a
 * handler awaiting a promise that never settles — a `fetch` to an unreachable
 * third party with no `AbortSignal`, a query on a wedged connection — holds its
 * socket and its request object until the client gives up. On the managed
 * runtime the process is shared between tenants, so that is not only the slow
 * caller's problem.
 *
 * The handler is **not** cancelled — it cannot be, there is no cancellation
 * token to hand user code. What is bounded is the client-visible request: after
 * `ms` the caller gets a 504 and the socket is released, and the handler's
 * eventual result is dropped. It is a ceiling, not a kill switch, and the exact
 * number matters far less than its existence.
 *
 * "The handler keeps running" is a **Node** guarantee, not a property of the
 * contract. It follows from the process outliving the request, which is not
 * true on an isolate-based host: there, work still in flight when the response
 * resolves is terminated rather than orphaned. So a handler must not depend on
 * finishing after its 504 — anything that has to complete belongs in
 * `waitUntil()`, which is the one construct both hosts honour. See
 * `./wait-until.ts`.
 *
 * Mounted in front of the auth middleware rather than behind it, so a wedged
 * driver — the failure that also hangs `withAuth()` — is covered too.
 */
export function createFunctionsRequestTimeout(ms: number): MiddlewareHandler<HonoEnv> {
    return async (c, next) => {
        if (ms <= 0) return next();

        let timer: ReturnType<typeof setTimeout> | undefined;
        const timedOut = new Promise<"timeout">((resolve) => {
            timer = setTimeout(() => resolve("timeout"), ms);
        });

        try {
            const outcome = await Promise.race([next().then(() => "done" as const), timedOut]);
            if (outcome === "timeout") {
                logger.warn(
                    `[functions] ${c.req.method} ${c.req.path} exceeded the ${ms}ms request timeout — ` +
                    "answering 504. The handler is still running; it cannot be cancelled from here. " +
                    "Give outbound calls an AbortSignal, or raise `functionsTimeoutMs` / REBASE_FUNCTIONS_TIMEOUT_MS."
                );
                // Through `errorHandler`, not `c.json`: that is what puts the
                // `requestId` in the body and hands the outcome to the request
                // log, so the Studio Logs entry for a timeout carries
                // `errorCode` like every other failure. Hand-built, it was the
                // one 504 nobody could join to a log line.
                return errorHandler(
                    new ApiError(504, "FUNCTION_TIMEOUT", "Function timed out"),
                    c
                ) as Response;
            }
        } finally {
            if (timer) clearTimeout(timer);
        }
        return undefined;
    };
}
