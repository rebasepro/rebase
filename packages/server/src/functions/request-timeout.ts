import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";

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
    const fromEnv = Number(process.env.REBASE_FUNCTIONS_TIMEOUT_MS);
    if (Number.isFinite(fromEnv) && fromEnv >= 0) {
        return Math.floor(fromEnv);
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
                return c.json({
                    error: {
                        message: "Function timed out",
                        code: "FUNCTION_TIMEOUT"
                    }
                }, 504);
            }
        } finally {
            if (timer) clearTimeout(timer);
        }
        return undefined;
    };
}
