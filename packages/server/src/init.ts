/**
 * `initializeRebaseBackend` — the one-call boot, written as the public steps it
 * stands for.
 *
 * Everything it does is a call a reader can make themselves: build the backend
 * (`createRebaseBackend`), make it the process default (`setDefaultBackend`),
 * mount it on the application's Hono app, attach the realtime websocket to its
 * server, start the timers. Copy the body and change
 * one line — mount only the data API, put it under another path, leave the
 * timers to another process — and you have the variant you need, built from
 * the same pieces.
 *
 * @module
 */
import type { Server } from "node:http";
import type { Hono } from "hono";
import type { HonoEnv } from "./api/types";
import { installUnhandledRejectionHandler } from "./init/process-safety";
import { createRebaseBackend, type RebaseBackend } from "./backend/create-backend";
import { setDefaultBackend } from "./backend/default-backend";
import type { RebaseBackendOptions } from "./backend/options";
import { resolveProvisionEnv } from "./boot/provision";

/** What {@link initializeRebaseBackend} takes: a backend's options, and where to serve it. */
export interface RebaseBackendConfig extends Omit<RebaseBackendOptions, "provision"> {
    /** The HTTP server the realtime websocket attaches to, and that `shutdown()` drains and closes. */
    server: Server;
    /** The application's Hono app, which the backend is mounted onto. */
    app: Hono<HonoEnv>;
    /** The prefix every route group is mounted under. Default `/api`. */
    basePath?: string;
    /**
     * Whether this process provisions the collection schema and its RLS
     * policies at boot. Default `true` — what every deployment does today.
     *
     * `false` on every process but one in a split deployment: `CREATE … IF NOT
     * EXISTS` reads the catalog and then writes to it, so N processes racing to
     * provision the same schema is a state nobody designed. `bootFromBundle`
     * derives it from `REBASE_ROLE`.
     *
     * Becomes `createRebaseBackend`'s `provision`: everything when `true`; the
     * framework's own tables and role but neither the collection schema nor
     * change capture when `false`.
     *
     * @internal Derived from `REBASE_ROLE` by `bootFromBundle`.
     */
    provisionSchema?: boolean;
}

/**
 * The backend {@link initializeRebaseBackend} returns: a {@link RebaseBackend}
 * that is already mounted, attached and started, whose `shutdown()` also
 * drains and closes the server it was given.
 */
export type RebaseBackendInstance = RebaseBackend;

/**
 * Build a backend and serve it: the process default, mounted on `config.app`
 * under `config.basePath`, its websocket on `config.server`, its timers
 * started.
 *
 * Exactly these steps, and nothing else:
 *
 * ```ts
 * installUnhandledRejectionHandler();
 * const backend = await createRebaseBackend({
 *     ...options,
 *     provision: !resolveProvisionEnv(process.env)
 *         ? false
 *         : provisionSchema === false ? { collections: false, realtime: false } : true
 * });
 * setDefaultBackend(backend);
 * backend.mount(app, { basePath });
 * await backend.attachRealtime(server);
 * backend.start();
 * ```
 *
 * The default is what the module-level API answers for — `rebase` outside a
 * request, `verifyAccessToken`, `getAccessModel`, `verifyCredential` — so code
 * written against those keeps answering for the one backend this process
 * serves.
 *
 * No try/catch: an init error propagates to the caller. The app entry point
 * (e.g. `startServer()`) should catch it and `process.exit(1)` — returning a
 * fake instance hides critical failures and leads to silent data loss.
 */
export async function initializeRebaseBackend(config: RebaseBackendConfig): Promise<RebaseBackendInstance> {
    const { app, server, basePath, provisionSchema, ...options } = config;

    // One floating promise in application code — a fire-and-forget call in a
    // custom function is the usual one — otherwise ends the process, and with
    // it every request in flight: on Rebase Cloud's managed runtime the
    // project's own pod (each project runs in a process of its own, never
    // shared between tenants). Log it and keep serving. Process-wide, so it belongs to the one call that owns the
    // process: a backend built with `createRebaseBackend` leaves the decision
    // to whoever does. Idempotent, and opt-out via
    // REBASE_EXIT_ON_UNHANDLED_REJECTION.
    installUnhandledRejectionHandler();

    const backend = await createRebaseBackend({
        ...options,
        // Everything this backend serves — unless this process is one of
        // several booting the same project and not the one that owns the
        // schema, which still keeps the framework's own tables current.
        // `REBASE_MIGRATE_ON_BOOT=none` turns the collection schema off on top
        // of either, where the DDL runs. `REBASE_PROVISION=false` turns off
        // everything, the framework's own tables included: the database is
        // changed by something else, and only read here.
        provision: !resolveProvisionEnv(process.env)
            ? false
            : provisionSchema === false ? { collections: false, realtime: false } : true
    });

    // The process serves this one backend, so the module-level API answers
    // for it.
    setDefaultBackend(backend);
    backend.mount(app, { basePath });
    await backend.attachRealtime(server);
    backend.start();

    return {
        ...backend,
        // This call was handed the server, so its shutdown closes it.
        shutdown: (timeoutMs, shutdownOptions) => backend.shutdown(timeoutMs, { server, ...shutdownOptions })
    };
}
