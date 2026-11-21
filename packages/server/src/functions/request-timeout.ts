import type { MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";
import { logger } from "../utils/logger";
import { ApiError, errorHandler } from "../api/errors";

/** Default ceiling for a custom function request, in milliseconds. */
export const DEFAULT_FUNCTIONS_TIMEOUT_MS = 30_000;

/**
 * Default cap on the timeout a function declares for itself
 * (`defineFunction(…, { timeoutMs })`), in milliseconds.
 */
export const DEFAULT_FUNCTIONS_MAX_TIMEOUT_MS = 300_000;

/**
 * The server-wide timeout of a function request, and where it was set: the
 * built-in default, `REBASE_FUNCTIONS_TIMEOUT_MS`, or the `functionsTimeoutMs`
 * option. The 504 names it, so the caller knows what to raise.
 */
export interface FunctionsTimeout {
    ms: number;
    source: "default" | "env" | "option";
}

/** The cap on a function's own timeout, and whether `REBASE_FUNCTIONS_MAX_TIMEOUT_MS` set it. */
export interface FunctionsMaxTimeout {
    ms: number;
    source: "default" | "env";
}

/**
 * The timeout one request ran under, for the 504: the server-wide one, or the
 * function's own (`declaredMs`, cut to the cap when it asked for more).
 */
type AppliedTimeout =
    | ({ kind: "server" } & FunctionsTimeout)
    | { kind: "function"; ms: number; declaredMs: number; max: FunctionsMaxTimeout };

/**
 * Resolve the functions request timeout from config, then env, then the
 * default, and say which of them it came from.
 *
 * `0` (or any non-positive number) disables the ceiling — for a deployment
 * whose proxy already imposes one, or a function that legitimately streams for
 * minutes.
 */
export function resolveFunctionsTimeout(configured?: number): FunctionsTimeout {
    if (typeof configured === "number" && Number.isFinite(configured)) {
        return { ms: Math.max(0, Math.floor(configured)), source: "option" };
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
            return { ms: Math.floor(fromEnv), source: "env" };
        }
    }
    return { ms: DEFAULT_FUNCTIONS_TIMEOUT_MS, source: "default" };
}

/** {@link resolveFunctionsTimeout}, the milliseconds only. */
export function resolveFunctionsTimeoutMs(configured?: number): number {
    return resolveFunctionsTimeout(configured).ms;
}

/**
 * The most a function may declare as its own timeout:
 * `REBASE_FUNCTIONS_MAX_TIMEOUT_MS`, else {@link DEFAULT_FUNCTIONS_MAX_TIMEOUT_MS}.
 *
 * A function file is project code, and a timeout it declares is a promise to
 * hold a socket that long. The cap is the server's answer to how long that may
 * be. Unlike the server-wide timeout it has no "off": a blank, zero, negative
 * or non-numeric value reads as unset.
 */
export function resolveFunctionsMaxTimeout(): FunctionsMaxTimeout {
    const raw = process.env.REBASE_FUNCTIONS_MAX_TIMEOUT_MS?.trim();
    if (raw) {
        const fromEnv = Number(raw);
        if (Number.isFinite(fromEnv) && fromEnv >= 1) {
            return { ms: Math.floor(fromEnv), source: "env" };
        }
    }
    return { ms: DEFAULT_FUNCTIONS_MAX_TIMEOUT_MS, source: "default" };
}

/** `defineFunction(…, { timeoutMs })`, as the 504 quotes it. */
const DECLARE_HINT = "`defineFunction(…, { timeoutMs })`";

/** What the 504 says: the limit that applied, where it was set, and what to change. */
function timeoutMessage(applied: AppliedTimeout): string {
    const after = `Function timed out after ${applied.ms}ms`;
    if (applied.kind === "function") {
        const maxSetting = `REBASE_FUNCTIONS_MAX_TIMEOUT_MS${applied.max.source === "default" ? ", by default" : ""}`;
        if (applied.declaredMs > applied.ms) {
            return `${after}: the function declares \`timeoutMs: ${applied.declaredMs}\`, and this server caps a function's own timeout at ${applied.ms}ms (${maxSetting}). Raise REBASE_FUNCTIONS_MAX_TIMEOUT_MS, or move the work to a job.`;
        }
        return `${after}, the timeout the function declares (\`timeoutMs: ${applied.declaredMs}\`). Raise it there, up to this server's cap of ${applied.max.ms}ms (${maxSetting}).`;
    }
    const orDeclare = `Declare a longer one on the function, ${DECLARE_HINT}`;
    if (applied.source === "option") {
        return `${after}, the timeout the \`functionsTimeoutMs\` option sets (it wins over REBASE_FUNCTIONS_TIMEOUT_MS). ${orDeclare}, or raise \`functionsTimeoutMs\` for every function.`;
    }
    if (applied.source === "env") {
        return `${after}, the timeout REBASE_FUNCTIONS_TIMEOUT_MS sets. ${orDeclare}, or raise REBASE_FUNCTIONS_TIMEOUT_MS for every function.`;
    }
    return `${after}, the default timeout. ${orDeclare}, or raise REBASE_FUNCTIONS_TIMEOUT_MS (or \`functionsTimeoutMs\`) for every function.`;
}

/** The 504's `details`: the limit, where it came from, and what the function asked for. */
function timeoutDetails(applied: AppliedTimeout): Record<string, unknown> {
    return applied.kind === "function"
        ? { timeoutMs: applied.ms, source: "function", declaredMs: applied.declaredMs, maxTimeoutMs: applied.max.ms }
        : { timeoutMs: applied.ms, source: applied.source };
}

/**
 * A per-request ceiling for the custom functions router.
 *
 * Custom functions are the one router that runs code the framework did not
 * write, and nothing else in the stack bounds how long that code takes: the
 * Node server is constructed without `requestTimeout`/`headersTimeout`, so a
 * handler awaiting a promise that never settles — a `fetch` to an unreachable
 * third party with no `AbortSignal`, a query on a wedged connection — holds its
 * socket and its request object until the client gives up. The process also
 * serves the project's data API, auth and realtime, so that is not only the
 * slow caller's problem.
 *
 * The handler is **not** killed — JavaScript cannot stop a function from the
 * outside. What is bounded is the client-visible request: after `ms` the caller
 * gets a 504 and the socket is released, and the handler's eventual result is
 * dropped. The handler is *told*, though: `getSignal(c)` is aborted at the same
 * moment, so a `fetch` or a driver call it was passed to stops too. It is a
 * ceiling, not a kill switch, and the exact number matters far less than its
 * existence.
 *
 * A function may set its own: `defineFunction(…, { timeoutMs })` reaches this
 * middleware through `c.get("functionTimeout")` and replaces the server-wide
 * timeout for its request, counted from the moment the request arrived here —
 * shorter or longer, but never past `max` (`REBASE_FUNCTIONS_MAX_TIMEOUT_MS`).
 * That also holds where the server-wide timeout is off (`0`): the function's
 * own still applies. The 504 says which limit it hit and where it was set.
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
 *
 * @param timeout The server-wide timeout: {@link resolveFunctionsTimeout}, or
 *   a number of milliseconds (read as the `functionsTimeoutMs` option).
 * @param max The cap on a function's own timeout; {@link resolveFunctionsMaxTimeout} by default.
 */
export function createFunctionsRequestTimeout(
    timeout: number | FunctionsTimeout,
    max: FunctionsMaxTimeout = resolveFunctionsMaxTimeout()
): MiddlewareHandler<HonoEnv> {
    const serverWide: FunctionsTimeout = typeof timeout === "number" ? { ms: timeout, source: "option" } : timeout;
    return async (c, next) => {
        // Set either way, so `getSignal(c)` hands every handler a signal it can
        // pass on without checking whether a ceiling is configured.
        const controller = new AbortController();
        c.set("functionSignal", controller.signal);
        const startedAt = Date.now();

        let applied: AppliedTimeout = { kind: "server", ...serverWide };
        let timer: ReturnType<typeof setTimeout> | undefined;
        let fired = false;
        let settle: (outcome: "timeout") => void = () => undefined;
        const timedOut = new Promise<"timeout">((resolve) => { settle = resolve; });

        // (Re)start the clock for `applied`, from the request's arrival.
        const arm = (): void => {
            if (timer) clearTimeout(timer);
            timer = undefined;
            if (applied.ms <= 0) return;
            timer = setTimeout(() => {
                fired = true;
                // Settled first, so the race is decided before a handler that
                // listens on the signal can return in reaction to it; then the
                // abort, so that handler — or a `fetch` it was handed to —
                // stops with the request.
                settle("timeout");
                controller.abort(new Error(`Function timed out after ${applied.ms}ms`));
            }, Math.max(0, startedAt + applied.ms - Date.now()));
        };

        c.set("functionTimeout", {
            declare(timeoutMs: number) {
                if (fired || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return;
                const declaredMs = Math.floor(timeoutMs);
                applied = { kind: "function", ms: Math.min(declaredMs, max.ms), declaredMs, max };
                arm();
            }
        });
        arm();

        try {
            const outcome = await Promise.race([next().then(() => "done" as const), timedOut]);
            if (outcome === "timeout") {
                const message = timeoutMessage(applied);
                logger.warn(
                    `[functions] ${c.req.method} ${c.req.path}: ${message} ` +
                    "Its signal was aborted; work not handed `getSignal(c)` keeps running."
                );
                // Through `errorHandler`, not `c.json`: that is what puts the
                // `requestId` in the body and hands the outcome to the request
                // log, so the Studio Logs entry for a timeout carries
                // `errorCode` like every other failure. Hand-built, it was the
                // one 504 nobody could join to a log line.
                const response = errorHandler(
                    new ApiError(504, "FUNCTION_TIMEOUT", message, timeoutDetails(applied)),
                    c
                ) as Response;
                // Written to the context, not only returned. A handler that
                // answers as soon as its signal aborts can write its own
                // response first, and Hono keeps the first one written: the
                // 504 has to replace it, or the caller reads the handler's
                // answer to a request that was already over.
                c.res = response;
                return response;
            }
        } finally {
            if (timer) clearTimeout(timer);
        }
        return undefined;
    };
}
