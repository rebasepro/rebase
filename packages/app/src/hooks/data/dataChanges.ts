import React, { useContext, useEffect, useReducer } from "react";
import type { CollectionAccessor, CollectionTrashAccessor, RebaseData } from "@rebasepro/types";
import { toSnakeCase } from "@rebasepro/utils";

/**
 * Says that a collection's rows changed, to every view of it in one `<Rebase>`.
 *
 * One per `<Rebase>`. The admin's data (`useData()`, so the form, the
 * collection views and a callback's `context.data`) and the flat layer the
 * row hooks read both emit on every write that succeeds, and a driver can
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
     * the admin addresses it, or the path its driver stores it under.
     */
    emit(path: string): void;
}

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
            // Copied first: a listener that re-subscribes while it runs would
            // otherwise be called again in this same pass. Listeners only set
            // state, so the reads they start are batched into one render.
            const called: (() => void)[] = [];
            for (const [key, set] of listeners) {
                if (key === path || resolveDataPath?.(key) === path) called.push(...set);
            }
            for (const onChange of called) onChange();
        }
    };
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
 * the accessor was asked for. Reads pass through untouched.
 *
 * @internal
 */
export function withDataChanges(data: RebaseData, changes: DataChanges): RebaseData {
    const accessors = new Map<string, CollectionAccessor>();
    const accessorFor = (path: string): CollectionAccessor => {
        let accessor = accessors.get(path);
        if (!accessor) {
            accessor = signalWrites(data.collection(path), () => changes.emit(path));
            accessors.set(path, accessor);
        }
        return accessor;
    };
    return new Proxy(data, {
        get(target, prop, receiver) {
            if (prop === "collection") return accessorFor;
            if (typeof prop === "symbol" || prop === "then" || prop === "toJSON" || prop === "$$typeof") {
                return Reflect.get(target, prop, receiver);
            }
            // `data.products`, named the way every data layer names it.
            return accessorFor(toSnakeCase(prop));
        }
    });
}

function signalWrites<M extends Record<string, unknown>>(accessor: CollectionAccessor<M>, emit: () => void): CollectionAccessor<M> {
    const after = <T, >(write: Promise<T>): Promise<T> => write.then((result) => {
        emit();
        return result;
    });
    type Accessor = CollectionAccessor<M>;
    // Only the writes the accessor has: an absent batch method stays absent,
    // which is how a caller tells it is not supported.
    const writes = new Map<PropertyKey, unknown>();
    writes.set("create", (...args: Parameters<Accessor["create"]>) => after(accessor.create(...args)));
    writes.set("update", (...args: Parameters<Accessor["update"]>) => after(accessor.update(...args)));
    writes.set("delete", (...args: Parameters<Accessor["delete"]>) => after(accessor.delete(...args)));
    if (accessor.createMany) {
        writes.set("createMany", (...args: Parameters<NonNullable<Accessor["createMany"]>>) => after(accessor.createMany!(...args)));
    }
    if (accessor.updateMany) {
        writes.set("updateMany", (...args: Parameters<NonNullable<Accessor["updateMany"]>>) => after(accessor.updateMany!(...args)));
    }
    if (accessor.deleteMany) {
        writes.set("deleteMany", (...args: Parameters<NonNullable<Accessor["deleteMany"]>>) => after(accessor.deleteMany!(...args)));
    }
    if (accessor.trash) writes.set("trash", signalPurges(accessor.trash, after));
    return new Proxy(accessor, {
        get(target, prop, receiver) {
            return writes.has(prop) ? writes.get(prop) : Reflect.get(target, prop, receiver);
        }
    });
}

function signalPurges<M extends Record<string, unknown>>(
    trash: CollectionTrashAccessor<M>,
    after: <T>(write: Promise<T>) => Promise<T>
): CollectionTrashAccessor<M> {
    return {
        find: (...args) => trash.find(...args),
        count: (...args) => trash.count(...args),
        purge: (...args) => after(trash.purge(...args)),
        ...(trash.purgeMany && { purgeMany: (ids: (string | number)[]) => after(trash.purgeMany!(ids)) })
    };
}
