import { useCallback, useEffect, useMemo, useState } from "react";
import { RebaseApiError } from "@rebasepro/types";
import type { RebaseClient, SchemaAPI, TableDescriptor } from "@rebasepro/types";
import { useAuthController } from "./useAuthController";
import { useRebaseClient } from "./useRebaseClient";

/**
 * Where the tables are: being fetched, here, or not to be had.
 *
 * @group Tables
 */
export type TableDescriptorsStatus = "loading" | "ready" | "error";

/**
 * Why a backend serves no tables at all (see {@link TableDescriptorsState.unavailable}).
 *
 * - `"no-schema-api"`: the client has no `schema` — it is not a Rebase client,
 *   or one built before `client.schema` existed.
 * - `"no-auth"`: the backend answered `404 SCHEMA_UNAVAILABLE` because no
 *   authentication is configured there, so there is nobody to describe the
 *   tables to.
 * - `"predates-route"`: the backend answered a bare `404` — its runtime is
 *   older than `GET /api/schema/tables` and has to be upgraded.
 *
 * @group Tables
 */
export type TableDescriptorsUnavailableReason = "no-schema-api" | "no-auth" | "predates-route";

/**
 * The tables `GET /api/schema/tables` serves the signed-in caller.
 *
 * @group Tables
 */
export interface TableDescriptorsState {
    /**
     * The tables, as served to whoever is signed in now. Empty while loading,
     * after an error on the first load, and when the backend serves none.
     */
    tables: readonly TableDescriptor[];
    status: TableDescriptorsStatus;
    /** Why the tables could not be loaded, when `status` is `"error"`. */
    error: Error | undefined;
    /**
     * The backend serves no tables to anyone — auth is not configured there,
     * it predates the route, or the client has no `schema` at all. Not an
     * error: `status` is `"ready"` and `tables` is empty, so an app that
     * passes its collections itself keeps working.
     */
    unavailable: boolean;
    /** Which of those it is, when {@link unavailable} is set. */
    unavailableReason: TableDescriptorsUnavailableReason | undefined;
    /**
     * Ask again. What is shown stays until the answer arrives; with an `ETag`
     * the server answers an unchanged schema with a `304`.
     */
    reload: () => void;
}

/**
 * Options of {@link useTableDescriptors}.
 *
 * @group Tables
 */
export interface UseTableDescriptorsOptions {
    /** `false` asks for nothing and answers no tables, ready. Default `true`. */
    enabled?: boolean;
}

const NO_TABLES: readonly TableDescriptor[] = [];

/** The code `client.schema.tables()` rejects with when the backend serves no tables. */
const SCHEMA_UNAVAILABLE = "SCHEMA_UNAVAILABLE";

/**
 * One request per client, caller and reload, however many components ask at
 * once — and across a strict-mode remount, whose second mount finds the first
 * mount's request still in flight and waits for it instead of sending another.
 */
const inFlight = new WeakMap<SchemaAPI, { key: string; promise: Promise<TableDescriptor[]> }>();

function fetchTables(schema: SchemaAPI, key: string): Promise<TableDescriptor[]> {
    const pending = inFlight.get(schema);
    if (pending && pending.key === key) return pending.promise;
    const promise = schema.tables();
    inFlight.set(schema, { key, promise });
    const forget = () => {
        if (inFlight.get(schema)?.promise === promise) inFlight.delete(schema);
    };
    promise.then(forget, forget);
    return promise;
}

function asError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error));
}

/**
 * Which kind of "no tables here" a `SCHEMA_UNAVAILABLE` rejection is. The
 * client answers a bare `404` (a server older than the route) with its own
 * `SCHEMA_UNAVAILABLE` error carrying the original response as `cause`; the
 * server's own refusal (no auth configured) carries none.
 */
function unavailableReasonOf(error: RebaseApiError): TableDescriptorsUnavailableReason {
    return error.cause instanceof RebaseApiError ? "predates-route" : "no-auth";
}

/** What the hook last learned, and for which caller and reload. */
interface Settled {
    /** The caller (and reload) this answer belongs to. */
    identity: string;
    tables: readonly TableDescriptor[];
    status: "ready" | "error";
    error: Error | undefined;
    unavailableReason: TableDescriptorsUnavailableReason | undefined;
}

/**
 * The tables the backend serves the signed-in caller, from
 * `client.schema.tables()` — what `<RebaseCMS>` projects into its default
 * collections and what every schema-aware Studio view renders from. It lives
 * here, in the runtime both register into, so Studio reads the tables with or
 * without a CMS on the page.
 *
 * - Nothing is asked until the auth controller knows who is signed in. The
 *   answer is redacted per caller, so it is asked again whenever the signed-in
 *   user or their roles change; meanwhile `status` is `"loading"` and `tables`
 *   is empty — a previous caller's tables are never shown to the next one,
 *   nor after sign-out.
 * - Nobody signed in: no request, no tables, `"ready"`. The route answers only
 *   signed-in callers.
 * - A backend that serves no tables (`SCHEMA_UNAVAILABLE`, or a client with no
 *   `schema`) is `"ready"` with `unavailable` set, not an error;
 *   `unavailableReason` says which.
 * - `reload()` asks again for the same caller and keeps showing the current
 *   tables until the answer arrives.
 *
 * @group Tables
 */
export function useTableDescriptors(options: UseTableDescriptorsOptions = {}): TableDescriptorsState {
    const enabled = options.enabled ?? true;
    const client = useRebaseClient<RebaseClient>();
    const schema = client?.schema;
    const authController = useAuthController();

    const user = authController.user;
    const roles = user?.roles ? [...user.roles].sort().join(",") : "";
    // `undefined`: not known yet. `null`: nobody is signed in.
    const caller = authController.initialLoading ? undefined : user ? `${user.uid}|${roles}` : null;

    const [reloads, setReloads] = useState(0);
    const reload = useCallback(() => setReloads(n => n + 1), []);

    const active = enabled && schema !== undefined && typeof caller === "string";
    const identity = active ? `${caller}#${reloads}` : undefined;

    const [settled, setSettled] = useState<Settled | undefined>(undefined);

    // Signing out forgets what the last caller was served, so signing in again
    // — as anyone, the same person included — starts from nothing. Adjusted
    // during render, React's pattern for state that follows a prop.
    const [seenCaller, setSeenCaller] = useState(caller);
    if (seenCaller !== caller) {
        setSeenCaller(caller);
        if (caller === null && settled !== undefined) setSettled(undefined);
    }

    useEffect(() => {
        if (!active || !schema || identity === undefined) return;
        let current = true;
        fetchTables(schema, identity).then(
            tables => {
                if (current) setSettled({ identity, tables, status: "ready", error: undefined, unavailableReason: undefined });
            },
            (error: unknown) => {
                if (!current) return;
                if (error instanceof RebaseApiError && error.code === SCHEMA_UNAVAILABLE) {
                    setSettled({ identity, tables: NO_TABLES, status: "ready", error: undefined, unavailableReason: unavailableReasonOf(error) });
                    return;
                }
                setSettled(previous => ({
                    identity,
                    // A failed reload keeps the same caller's tables on screen.
                    tables: previous && sameCaller(previous.identity, identity) ? previous.tables : NO_TABLES,
                    status: "error",
                    error: asError(error),
                    unavailableReason: undefined
                }));
            }
        );
        return () => {
            current = false;
        };
    }, [active, schema, identity]);

    return useMemo<TableDescriptorsState>(() => {
        const state = (
            tables: readonly TableDescriptor[],
            status: TableDescriptorsStatus,
            error: Error | undefined,
            unavailableReason: TableDescriptorsUnavailableReason | undefined
        ): TableDescriptorsState => ({ tables, status, error, unavailable: unavailableReason !== undefined, unavailableReason, reload });
        if (!enabled) return state(NO_TABLES, "ready", undefined, undefined);
        if (schema === undefined) return state(NO_TABLES, "ready", undefined, "no-schema-api");
        if (caller === undefined) return state(NO_TABLES, "loading", undefined, undefined);
        if (caller === null) return state(NO_TABLES, "ready", undefined, undefined);
        if (settled && settled.identity === identity) {
            return state(settled.tables, settled.status, settled.error, settled.unavailableReason);
        }
        // Reloading for the same caller: what they were shown stays.
        if (settled && identity !== undefined && sameCaller(settled.identity, identity)) {
            return state(settled.tables, settled.status, settled.error, settled.unavailableReason);
        }
        return state(NO_TABLES, "loading", undefined, undefined);
    }, [enabled, schema, caller, settled, identity, reload]);
}

/** Whether two identities name the same caller, whatever the reload. */
function sameCaller(a: string, b: string): boolean {
    return a.slice(0, a.lastIndexOf("#")) === b.slice(0, b.lastIndexOf("#"));
}
