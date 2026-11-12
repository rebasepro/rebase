import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuthController, useRebaseClient } from "@rebasepro/app";
import { RebaseApiError } from "@rebasepro/types";
import type { RebaseClient, SchemaAPI, TableDescriptor } from "@rebasepro/types";

/**
 * Where the tables are: being fetched, here, or not to be had.
 *
 * @group Tables
 */
export type TableDescriptorsStatus = "loading" | "ready" | "error";

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
    /**
     * Ask again. What is shown stays until the answer arrives; with an `ETag`
     * the server answers an unchanged schema with a `304`.
     */
    reload: () => void;
}

/** Options of {@link useTableDescriptors}. */
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

/** What the hook last learned, and for which caller and reload. */
interface Settled {
    /** The caller (and reload) this answer belongs to. */
    identity: string;
    tables: readonly TableDescriptor[];
    status: "ready" | "error";
    error: Error | undefined;
    unavailable: boolean;
}

/**
 * The tables the backend serves the signed-in caller, from
 * `client.schema.tables()` — what `<RebaseCMS>` projects into its default
 * collections.
 *
 * - Nothing is asked until the auth controller knows who is signed in. The
 *   answer is redacted per caller, so it is asked again whenever the signed-in
 *   user or their roles change; meanwhile `status` is `"loading"` and `tables`
 *   is empty — a previous caller's tables are never shown to the next one,
 *   nor after sign-out.
 * - Nobody signed in: no request, no tables, `"ready"`. The route answers only
 *   signed-in callers.
 * - A backend that serves no tables (`SCHEMA_UNAVAILABLE`, or a client with no
 *   `schema`) is `"ready"` with `unavailable` set, not an error.
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
                if (current) setSettled({ identity, tables, status: "ready", error: undefined, unavailable: false });
            },
            (error: unknown) => {
                if (!current) return;
                if (error instanceof RebaseApiError && error.code === SCHEMA_UNAVAILABLE) {
                    setSettled({ identity, tables: NO_TABLES, status: "ready", error: undefined, unavailable: true });
                    return;
                }
                setSettled(previous => ({
                    identity,
                    // A failed reload keeps the same caller's tables on screen.
                    tables: previous && sameCaller(previous.identity, identity) ? previous.tables : NO_TABLES,
                    status: "error",
                    error: asError(error),
                    unavailable: false
                }));
            }
        );
        return () => {
            current = false;
        };
    }, [active, schema, identity]);

    return useMemo<TableDescriptorsState>(() => {
        if (!enabled) return { tables: NO_TABLES, status: "ready", error: undefined, unavailable: false, reload };
        if (schema === undefined) return { tables: NO_TABLES, status: "ready", error: undefined, unavailable: true, reload };
        if (caller === undefined) return { tables: NO_TABLES, status: "loading", error: undefined, unavailable: false, reload };
        if (caller === null) return { tables: NO_TABLES, status: "ready", error: undefined, unavailable: false, reload };
        if (settled && settled.identity === identity) {
            return { tables: settled.tables, status: settled.status, error: settled.error, unavailable: settled.unavailable, reload };
        }
        // Reloading for the same caller: what they were shown stays.
        if (settled && identity !== undefined && sameCaller(settled.identity, identity)) {
            return { tables: settled.tables, status: settled.status, error: settled.error, unavailable: settled.unavailable, reload };
        }
        return { tables: NO_TABLES, status: "loading", error: undefined, unavailable: false, reload };
    }, [enabled, schema, caller, settled, identity, reload]);
}

/** Whether two identities name the same caller, whatever the reload. */
function sameCaller(a: string, b: string): boolean {
    return a.slice(0, a.lastIndexOf("#")) === b.slice(0, b.lastIndexOf("#"));
}
