/**
 * The request a log line was written in, for every line written in it.
 *
 * The request line carries `requestId`; a line a route handler, a hook or a
 * function writes while serving that request did not, so the two could not be
 * joined, and a function author had to pass `getRequestId(c)` into every call.
 * This middleware runs the rest of the request inside an async context, and the
 * logger asks it (through `_setLogContextProvider`) for the request's id and
 * caller on every line.
 *
 * Host-side: `AsyncLocalStorage` is what the portable logger cannot import.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Context, MiddlewareHandler } from "hono";
import type { HonoEnv } from "../api/types";
import { _setLogContextProvider } from "./logger";

const current = new AsyncLocalStorage<Context<HonoEnv>>();

let installed = false;

function install(): void {
    if (installed) return;
    installed = true;
    const previous = _setLogContextProvider(() => {
        const c = current.getStore();
        // Another copy of this module may serve the request (more than one
        // can be loaded into a process); ask the provider it replaced.
        if (!c) return previous?.();
        const fields: Record<string, unknown> = {};
        const requestId = c.get("requestId");
        if (requestId) fields.requestId = requestId;
        const uid = (c.get("user") as { uid?: string } | undefined)?.uid;
        if (uid) fields.uid = uid;
        return fields;
    });
}

/** Run the rest of the request where its log lines can find it. Mount right after `requestId()`. */
export function requestLogContext(): MiddlewareHandler<HonoEnv> {
    install();
    return (c, next) => current.run(c, next);
}
