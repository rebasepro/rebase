/**
 * A control plane that does not serve a route a command calls.
 *
 * The CLI is released on its own schedule, and the control plane it talks to
 * may be older than the command: a function the command calls may not be
 * mounted there yet, or a function may be mounted without the route the
 * command needs. Both answer 404, and a generic "Not found" for them reads as
 * "your project is gone" or "you typed the id wrong", which sends the reader
 * looking for a fault that is not theirs.
 *
 * So each command that calls such a route names what is missing and what to do
 * instead, with one code, `not_served`, a caller can branch on.
 * `control-plane-functions.test.ts` holds the list of functions this family
 * calls against the ones the control plane serves.
 */
import { fail, reportError } from "./context";
import { isMissingRoute } from "./cron";

/** The refusal code for a route the control plane does not serve. */
export const NOT_SERVED = "not_served";

/**
 * Whether an error is the control plane saying it has no such route, rather
 * than a route refusing this request.
 *
 * A Rebase backend answers a function it does not mount, or a route its
 * function does not have, with a 404 coded `FUNCTION_NOT_FOUND`; one from
 * before that envelope answers a bare `Not Found` or `No route for …`. A
 * function that is served and refuses an unknown project answers its own code
 * (`not_found`), so that 404 is not this one.
 */
export function isRouteNotServed(error: unknown): boolean {
    if (typeof error !== "object" || error === null) return false;
    if (!("status" in error) || error.status !== 404) return false;
    const code = "code" in error ? error.code : undefined;
    if (code === "FUNCTION_NOT_FOUND") return true;
    const message = "message" in error && typeof error.message === "string" ? error.message : undefined;
    return isMissingRoute(message);
}

/** What a command says when its route is not served: the thing, and what to do meanwhile. */
export interface Unserved {
    /** Completes "This control plane does not serve … yet": `app keys`. */
    what: string;
    /** What the reader can do instead, and whether anything changed. */
    hint: string;
}

/** Refuse with `not_served` when `error` is a missing route; return otherwise. */
export function refuseIfNotServed(error: unknown, unserved: Unserved): void {
    if (isRouteNotServed(error)) {
        fail(`This control plane does not serve ${unserved.what} yet.`, unserved.hint, NOT_SERVED);
    }
}

/**
 * Report a failed control-plane call: `not_served` for a missing route, the
 * family's usual report otherwise. Never returns.
 */
export function reportCallError(error: unknown, context: string, unserved: Unserved): never {
    refuseIfNotServed(error, unserved);
    reportError(error, context);
}
