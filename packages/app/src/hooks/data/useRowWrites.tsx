import { useCallback, useMemo, useRef, useState } from "react";
import type { EntityStatus } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { buildCompositeId, resolvePrimaryKeys, rowToViewModel } from "@rebasepro/common";
import { useRebaseContext } from "../useRebaseContext";
import { messageOf, useSdkData } from "./sdkData";
import { deleteWithCallbacks, writeWithSaveCallbacks } from "./writeCallbacks";

/**
 * @group Hooks and utilities
 */
export interface UseRowWritesResult {
    /** Insert a row; resolves to the row as stored. */
    create<M extends Record<string, unknown> = Record<string, unknown>>(
        collection: string, values: Partial<M>, id?: string | number): Promise<M>;
    /** Change the given fields of a row; resolves to the row as stored. */
    update<M extends Record<string, unknown> = Record<string, unknown>>(
        collection: string, id: string | number, values: Partial<M>): Promise<M>;
    /** Delete a row. */
    remove(collection: string, id: string | number): Promise<void>;
    /** Whether a write is in flight. */
    saving: boolean;
    /** The last write's failure, cleared when the next one starts. */
    error?: string;
}

type Row = Record<string, unknown>;

/**
 * A collection the admin registered — what its `browserCallbacks` are handed.
 * The data layer's resolver is typed for any data source's config; this is
 * the admin's.
 */
function isAdminCollection(value: object | undefined): value is AdminCollection {
    return value !== undefined
        && "slug" in value && typeof value.slug === "string"
        && "properties" in value && typeof value.properties === "object" && value.properties !== null;
}

/** A row's own `id` column, where it has one. */
function idOf(row: Row): string | number | undefined {
    const id = row.id;
    return typeof id === "string" || typeof id === "number" ? id : undefined;
}

/**
 * Create, change and delete rows through the same flat data layer
 * {@link useRows} reads. Each write that succeeds refreshes every view of
 * that collection in this `<Rebase>` that cannot subscribe to it — `useRows`,
 * `useRow`, `useRowCount`, `useAggregate` and the admin's collection views. A
 * failed write rejects, and also sets `error`.
 *
 * A write runs the collection's `admin.browserCallbacks` exactly as the
 * record form's save does: `beforeSave` (which may change the values, or
 * throw to stop the write), then `afterSave` or `afterSaveError`; and
 * `beforeDelete`, then `afterDelete`. They are handed the same values the
 * form hands them, in the admin's shape — dates as `Date`s, a relation as an
 * `EntityRelation` — and `previousValues` is the row as it was. Where the
 * collection has callbacks, an update or a delete reads the row first.
 *
 * ```tsx
 * const { update, saving } = useRowWrites();
 * await update<Order>("orders", order.id, { status: "shipped" });
 * ```
 *
 * @group Hooks and utilities
 */
export function useRowWrites(): UseRowWritesResult {
    const { data, changes, resolveCollection } = useSdkData("useRowWrites");
    const context = useRebaseContext();
    // Read when a write runs, so a new context does not make new functions.
    const contextRef = useRef(context);
    contextRef.current = context;
    const [inFlight, setInFlight] = useState(0);
    const [error, setError] = useState<string>();
    // Which write's failure `error` may show: an older write that fails after
    // a newer one started does not overwrite the newer one's outcome.
    const latest = useRef(0);

    const run = useCallback(async <T, >(write: () => Promise<T>): Promise<T> => {
        const ticket = ++latest.current;
        setInFlight((n) => n + 1);
        setError(undefined);
        try {
            return await write();
        } catch (failure) {
            if (ticket === latest.current) setError(messageOf(failure));
            throw failure;
        } finally {
            setInFlight((n) => n - 1);
        }
    }, []);

    /**
     * The collection whose browser callbacks a save or a delete of `slug`
     * runs, where it has one: without, the write reads nothing first.
     */
    const callbacksOf = useCallback((slug: string, write: "save" | "delete"): AdminCollection | undefined => {
        const collection = resolveCollection(slug);
        if (!isAdminCollection(collection)) return undefined;
        const callbacks = collection.browserCallbacks;
        const runs = write === "save"
            ? Boolean(callbacks?.beforeSave || callbacks?.afterSave || callbacks?.afterSaveError)
            : Boolean(callbacks?.beforeDelete || callbacks?.afterDelete);
        return runs ? collection : undefined;
    }, [resolveCollection]);

    const viewModel = useCallback((slug: string, row: Row): Row =>
        rowToViewModel(row, slug, resolveCollection), [resolveCollection]);

    /**
     * Write a row, inside the collection's browser callbacks. The row goes
     * through the same accessor a write without callbacks does; what
     * `beforeSave` returned is sent as it is, since every transport takes
     * the admin's values, as the form's save sends them.
     */
    const saveWithCallbacks = useCallback(async (
        collection: AdminCollection, slug: string, status: EntityStatus, values: Row, id: string | number | undefined
    ): Promise<Row> => {
        const accessor = data.collection(slug);
        const previous = status === "existing" && id !== undefined ? await accessor.findById(id) : undefined;
        const keys = resolvePrimaryKeys(collection);
        return writeWithSaveCallbacks<Row, Row>({
            collection,
            path: slug,
            entityId: id,
            values: viewModel(slug, values),
            previousValues: previous ? viewModel(slug, previous) : undefined,
            status,
            context: contextRef.current,
            // Signalled as soon as the row is written: an `afterSave` that
            // throws does not unwrite it.
            write: async (toSave) => {
                const row = status === "existing" && id !== undefined
                    ? await accessor.update(id, toSave)
                    : await accessor.create(toSave, id);
                changes.emit(slug);
                return row;
            },
            // Addressed as the admin addresses a record read back.
            saved: (row) => ({
                id: keys.length > 0 ? buildCompositeId(row, keys) : idOf(row) ?? id ?? "",
                values: viewModel(slug, row)
            })
        });
    }, [data, changes, viewModel]);

    const create = useCallback(<M extends Record<string, unknown> = Record<string, unknown>>(
        slug: string, values: Partial<M>, id?: string | number
    ): Promise<M> => run(async () => {
        const collection = callbacksOf(slug, "save");
        // The row a write answers is the row the server sends whichever way it
        // was written; `M` describes it, as it does for `collection<M>()`.
        if (collection) return await saveWithCallbacks(collection, slug, "new", values, id) as M;
        const row = await data.collection<M>(slug).create(values, id);
        changes.emit(slug);
        return row;
    }), [data, changes, run, callbacksOf, saveWithCallbacks]);

    const update = useCallback(<M extends Record<string, unknown> = Record<string, unknown>>(
        slug: string, id: string | number, values: Partial<M>
    ): Promise<M> => run(async () => {
        const collection = callbacksOf(slug, "save");
        if (collection) return await saveWithCallbacks(collection, slug, "existing", values, id) as M;
        const row = await data.collection<M>(slug).update(id, values);
        changes.emit(slug);
        return row;
    }), [data, changes, run, callbacksOf, saveWithCallbacks]);

    const remove = useCallback((slug: string, id: string | number): Promise<void> => run(async () => {
        const accessor = data.collection(slug);
        const removeRow = async () => {
            await accessor.delete(id);
            changes.emit(slug);
        };
        const collection = callbacksOf(slug, "delete");
        if (!collection) return removeRow();
        const row = await accessor.findById(id);
        await deleteWithCallbacks({
            collection,
            path: slug,
            id,
            row: { id, ...(row ? viewModel(slug, row) : {}) },
            context: contextRef.current,
            remove: removeRow
        });
    }), [data, changes, run, callbacksOf, viewModel]);

    const saving = inFlight > 0;
    return useMemo(() => ({ create, update, remove, saving, error }), [create, update, remove, saving, error]);
}
