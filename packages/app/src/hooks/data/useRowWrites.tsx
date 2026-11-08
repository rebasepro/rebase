import { useCallback, useMemo, useRef, useState } from "react";
import { useRebaseContext } from "../useRebaseContext";
import { messageOf, useSdkData } from "./sdkData";
import { createRowWriter } from "./rowWrites";

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
 * `beforeDelete`, then `afterDelete`. They are handed rows as the server
 * sends them — the values you pass, `previousValues` the row as it was — and
 * what `beforeSave` returns is written. Where the collection has callbacks,
 * an update or a delete reads the row first. Writes through the browser's
 * `context.data` do the same.
 *
 * ```tsx
 * const { update, saving } = useRowWrites();
 * await update<Order>("orders", order.id, { status: "shipped" });
 * ```
 *
 * @group Hooks and utilities
 */
export function useRowWrites(): UseRowWritesResult {
    const layer = useSdkData("useRowWrites");
    const context = useRebaseContext();
    // Read when a write runs, so a new context does not make new functions.
    const contextRef = useRef(context);
    contextRef.current = context;
    const writer = useMemo(() => createRowWriter(layer, () => contextRef.current), [layer]);
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

    // The row a write answers is the row the server sends; `M` describes it,
    // as it does for `collection<M>()`.
    const create = useCallback(<M extends Record<string, unknown> = Record<string, unknown>>(
        slug: string, values: Partial<M>, id?: string | number
    ): Promise<M> => run(async () => await writer.create(slug, values, id) as M), [run, writer]);

    const update = useCallback(<M extends Record<string, unknown> = Record<string, unknown>>(
        slug: string, id: string | number, values: Partial<M>
    ): Promise<M> => run(async () => await writer.update(slug, id, values) as M), [run, writer]);

    const remove = useCallback((slug: string, id: string | number): Promise<void> =>
        run(() => writer.remove(slug, id)), [run, writer]);

    const saving = inFlight > 0;
    return useMemo(() => ({ create, update, remove, saving, error }), [create, update, remove, saving, error]);
}
