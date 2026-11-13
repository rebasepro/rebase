import React, { useContext, useEffect, useReducer } from "react";
import type { TableAccessor, TableTrashAccessor, RebaseData } from "@rebasepro/cms-types";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * Says that a collection's rows changed, to every view of it in one `<Rebase>`.
 *
 * One per `<Rebase>`. The admin's data (`useData()`, so the form and the
 * collection views) and the flat layer the row hooks and `context.data` read
 * both emit on every write that succeeds, and a driver can
 * announce changes made elsewhere (`DataDriver.subscribeToExternalChanges`).
 * A view that cannot subscribe to its data source — an in-memory driver, the
 * MCP tool driver, a client with no socket — reads again when its collection
 * is named. A view that does subscribe ignores it: its subscription already
 * delivers the change.
 *
 * @internal
 */
export interface DataChanges {
    /** Call `onChange` each time the collection at `path` is said to have changed; returns the unsubscribe. */
    subscribe(path: string, onChange: () => void): () => void;
    /**
     * Say the collection at `path` changed: its slug or subcollection path, as
     * the admin addresses it, or the path its driver stores it under. Its
     * listeners hear of it once for a burst of changes: {@link CHANGE_QUIET_MS}
     * after the last, or {@link CHANGE_MAX_WAIT_MS} after the first.
     */
    emit(path: string): void;
    /**
     * Say a write to the collection at `path` was sent; call what it returns
     * once it settles. While one is in flight its collection's listeners wait
     * for it — its reply is one more change — up to the burst's maximum wait.
     */
    writing(path: string): () => void;
}

/**
 * How long a collection's views wait after a change for the next one before
 * they read again. Long enough to span the gap between one write's reply and
 * the next write being sent — a loop of `await update(…)` sends the next in
 * the same task — and replies to writes sent together that land in separate
 * tasks (each HTTP response, each MCP `tools/call` reply); short enough that
 * a lone write's refresh lands well inside the tenth of a second that still
 * reads as instant.
 */
export const CHANGE_QUIET_MS = 50;

/**
 * The longest a collection's views go without reading again while its
 * changes keep coming, counted from the first: a long run of writes, or one
 * that hangs, still shows its progress every second. Long enough that a loop
 * of writes over a slow transport (an MCP `tools/call` is a round trip
 * through the host) re-reads a few times, not once per row, each re-read one
 * more call competing with the writes.
 */
export const CHANGE_MAX_WAIT_MS = 1_000;

/**
 * @param resolveDataPath where a driver stores a collection, for the path the
 * admin addresses it by — so a change a driver announces under its stored
 * path (`diagnosis`) reaches the views of the collection stored there
 * (`fs_diagnosis`).
 *
 * @internal
 */
export function createDataChanges(resolveDataPath?: (path: string) => string | undefined): DataChanges {
    const listeners = new Map<string, Set<() => void>>();
    // Kept by where each collection is stored, so a burst said under its slug
    // and under its stored path is one burst, heard once.
    const pending = new Map<string, { paths: Set<string>; deadline: number; timer?: ReturnType<typeof setTimeout> }>();
    const inFlight = new Map<string, number>();
    const storedPath = (path: string) => resolveDataPath?.(path) ?? path;

    /** Hear of `stored`'s burst a quiet window from now, or at its deadline if that comes first. */
    const schedule = (stored: string) => {
        const burst = pending.get(stored);
        if (!burst) return;
        if (burst.timer !== undefined) clearTimeout(burst.timer);
        const wait = Math.max(0, Math.min(CHANGE_QUIET_MS, burst.deadline - Date.now()));
        burst.timer = setTimeout(() => due(stored), wait);
    };

    const due = (stored: string) => {
        const burst = pending.get(stored);
        if (!burst) return;
        burst.timer = undefined;
        const left = burst.deadline - Date.now();
        // A write still in flight says so when it lands: wait for it, but no
        // longer than the deadline.
        if ((inFlight.get(stored) ?? 0) > 0 && left > 0) {
            burst.timer = setTimeout(() => due(stored), left);
            return;
        }
        pending.delete(stored);
        flush(burst.paths);
    };

    return {
        subscribe(path, onChange) {
            let set = listeners.get(path);
            if (!set) {
                set = new Set();
                listeners.set(path, set);
            }
            set.add(onChange);
            return () => {
                set.delete(onChange);
                if (set.size === 0) listeners.delete(path);
            };
        },
        emit(path) {
            const stored = storedPath(path);
            let burst = pending.get(stored);
            if (!burst) {
                burst = { paths: new Set(), deadline: Date.now() + CHANGE_MAX_WAIT_MS };
                pending.set(stored, burst);
            }
            burst.paths.add(path);
            schedule(stored);
        },
        writing(path) {
            const stored = storedPath(path);
            inFlight.set(stored, (inFlight.get(stored) ?? 0) + 1);
            let settled = false;
            return () => {
                if (settled) return;
                settled = true;
                const left = (inFlight.get(stored) ?? 1) - 1;
                if (left > 0) {
                    inFlight.set(stored, left);
                    return;
                }
                inFlight.delete(stored);
                // A burst held for it is heard a quiet window on — after the
                // write's own change, or at once a window on if it failed.
                schedule(stored);
            };
        }
    };

    function flush(burstPaths: Set<string>) {
        const paths = [...burstPaths];
        // Collected first, as a set: a listener that re-subscribes while it
        // runs would otherwise be called again in this same pass, and a view
        // reached under two names is told once. Listeners only set state, so
        // the reads they start are batched into one render. Matched by where
        // each is stored, either way round: a view may name a collection by
        // its slug and the write by its stored path (an app's code names it
        // as the tools do), or the reverse.
        const called = new Set<() => void>();
        for (const path of paths) {
            const stored = resolveDataPath?.(path) ?? path;
            for (const [key, set] of listeners) {
                if (key === path || (resolveDataPath?.(key) ?? key) === stored) set.forEach((onChange) => called.add(onChange));
            }
        }
        for (const onChange of called) onChange();
    }
}

/** @internal */
export const DataChangesContext = React.createContext<DataChanges | undefined>(undefined);

/**
 * A number that grows each time the collection at `path` is said to have
 * changed, for a view to put among the dependencies of the read it re-runs.
 * `enabled: false` — a view whose data source subscribes — never changes.
 *
 * @internal
 */
export function useDataChangeVersion(path: string, enabled: boolean): number {
    const changes = useContext(DataChangesContext);
    const [version, bump] = useReducer((n: number) => n + 1, 0);
    useEffect(() => enabled && changes ? changes.subscribe(path, bump) : undefined, [changes, path, enabled]);
    return version;
}

/**
 * `data` whose every write that succeeds says so on `changes`: `create`,
 * `update`, `delete`, their batch forms and the trash's purges, under the path
 * the accessor was asked for — and that each is in flight, so the views wait
 * for the rest of a run of writes. Reads pass through untouched.
 *
 * @internal
 */
export function withDataChanges(data: RebaseData, changes: DataChanges): RebaseData {
    const accessors = new Map<string, TableAccessor>();
    const accessorFor = (path: string): TableAccessor => {
        let accessor = accessors.get(path);
        if (!accessor) {
            accessor = signalWrites(data.table(path), changes, path);
            accessors.set(path, accessor);
        }
        return accessor;
    };
    return new Proxy(data, {
        get(target, prop, receiver) {
            if (prop === "table") return accessorFor;
            if (typeof prop === "symbol" || prop === "then" || prop === "toJSON" || prop === "$$typeof") {
                return Reflect.get(target, prop, receiver);
            }
            // `data.products`, named the way every data layer names it.
            return accessorFor(toSnakeCase(prop));
        }
    });
}

/**
 * Send one write to the collection at `path`, saying on `changes` that it is
 * in flight and, once it succeeds, that the collection changed. What every
 * data layer of a `<Rebase>` writes through.
 *
 * @internal
 */
export function signalWrite<T>(changes: DataChanges, path: string, send: () => Promise<T>): Promise<T> {
    const settled = changes.writing(path);
    let write: Promise<T>;
    try {
        write = send();
    } catch (error) {
        settled();
        throw error;
    }
    return write.then((result) => {
        changes.emit(path);
        settled();
        return result;
    }, (error: unknown) => {
        settled();
        throw error;
    });
}

/** A write sent through `send`, said on `changes` while in flight and once it succeeds. */
type Signalled = <T>(send: () => Promise<T>) => Promise<T>;

function signalWrites<M extends Record<string, unknown>>(
    accessor: TableAccessor<M>,
    changes: DataChanges,
    path: string
): TableAccessor<M> {
    const after: Signalled = <T>(send: () => Promise<T>): Promise<T> => signalWrite(changes, path, send);
    type Accessor = TableAccessor<M>;
    // Only the writes the accessor has: an absent batch method stays absent,
    // which is how a caller tells it is not supported.
    const writes = new Map<PropertyKey, unknown>();
    writes.set("create", (...args: Parameters<Accessor["create"]>) => after(() => accessor.create(...args)));
    writes.set("update", (...args: Parameters<Accessor["update"]>) => after(() => accessor.update(...args)));
    writes.set("delete", (...args: Parameters<Accessor["delete"]>) => after(() => accessor.delete(...args)));
    if (accessor.createMany) {
        writes.set("createMany", (...args: Parameters<NonNullable<Accessor["createMany"]>>) => after(() => accessor.createMany!(...args)));
    }
    if (accessor.updateMany) {
        writes.set("updateMany", (...args: Parameters<NonNullable<Accessor["updateMany"]>>) => after(() => accessor.updateMany!(...args)));
    }
    if (accessor.deleteMany) {
        writes.set("deleteMany", (...args: Parameters<NonNullable<Accessor["deleteMany"]>>) => after(() => accessor.deleteMany!(...args)));
    }
    if (accessor.trash) writes.set("trash", signalPurges(accessor.trash, after));
    return new Proxy(accessor, {
        get(target, prop, receiver) {
            return writes.has(prop) ? writes.get(prop) : Reflect.get(target, prop, receiver);
        }
    });
}

function signalPurges<M extends Record<string, unknown>>(
    trash: TableTrashAccessor<M>,
    after: Signalled
): TableTrashAccessor<M> {
    return {
        find: (...args) => trash.find(...args),
        count: (...args) => trash.count(...args),
        purge: (...args) => after(() => trash.purge(...args)),
        ...(trash.purgeMany && { purgeMany: (ids: (string | number)[]) => after(() => trash.purgeMany!(ids)) })
    };
}
