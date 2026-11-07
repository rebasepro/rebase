import { useCallback, useMemo, useRef, useState } from "react";
import { messageOf, useSdkData } from "./sdkData";

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
 * {@link useRows} reads. Each write that succeeds refreshes every
 * `useRows`, `useRow`, `useRowCount` and `useAggregate` of that collection in
 * this `<Rebase>`. A failed write rejects, and also sets `error`.
 *
 * ```tsx
 * const { update, saving } = useRowWrites();
 * await update<Order>("orders", order.id, { status: "shipped" });
 * ```
 *
 * @group Hooks and utilities
 */
export function useRowWrites(): UseRowWritesResult {
    const { data, changes } = useSdkData("useRowWrites");
    const [inFlight, setInFlight] = useState(0);
    const [error, setError] = useState<string>();
    // Which write's failure `error` may show: an older write that fails after
    // a newer one started does not overwrite the newer one's outcome.
    const latest = useRef(0);

    const run = useCallback(async <T, >(collection: string, write: () => Promise<T>): Promise<T> => {
        const ticket = ++latest.current;
        setInFlight((n) => n + 1);
        setError(undefined);
        try {
            const result = await write();
            changes.emit(collection);
            return result;
        } catch (failure) {
            if (ticket === latest.current) setError(messageOf(failure));
            throw failure;
        } finally {
            setInFlight((n) => n - 1);
        }
    }, [changes]);

    const create = useCallback(<M extends Record<string, unknown> = Record<string, unknown>>(
        collection: string, values: Partial<M>, id?: string | number
    ): Promise<M> => run(collection, () => data.collection<M>(collection).create(values, id)), [data, run]);

    const update = useCallback(<M extends Record<string, unknown> = Record<string, unknown>>(
        collection: string, id: string | number, values: Partial<M>
    ): Promise<M> => run(collection, () => data.collection<M>(collection).update(id, values)), [data, run]);

    const remove = useCallback((collection: string, id: string | number): Promise<void> =>
        run(collection, () => data.collection(collection).delete(id)), [data, run]);

    const saving = inFlight > 0;
    return useMemo(() => ({ create, update, remove, saving, error }), [create, update, remove, saving, error]);
}
