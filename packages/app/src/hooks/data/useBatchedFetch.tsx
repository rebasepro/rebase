import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { CollectionAccessor, Entity, FindResponse, RebaseData } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { resolvePrimaryKeys } from "@rebasepro/common";
import { useData } from "./useData";
import { isConnectionLostError } from "../../util/realtime";
import type { FetchResult } from "./useFetch";

/**
 * The most ids one batch reads. The same ceiling the API puts on a page.
 */
const MAX_BATCH = 1_000;

/** What one record looks like to the previews that show it. */
interface Snapshot {
    entity?: Entity<any>;
    dataLoading: boolean;
    dataLoadingError?: Error;
}

const LOADING: Snapshot = Object.freeze({ dataLoading: true });

interface Batch {
    /** Ids this batch still answers for; a slot that leaves drops out. */
    ids: Set<string>;
    stop?: () => void;
}

interface Slot {
    snapshot: Snapshot;
    listeners: Set<() => void>;
    refs: number;
    batch?: Batch;
}

/**
 * One collection's batched record reads, for the previews of references.
 *
 * Every id a preview asks for in the same tick is read by one query — `where
 * <key> in [ids]` — and kept live by ONE subscription to that query, instead
 * of one `listenById` per id. A reference column showing 23 distinct targets
 * was 23 subscriptions, 23 single-row reads and 23 server refetches per write
 * to the target collection; it is one of each now.
 *
 * Authorization is unchanged: the read goes through the same accessor, as the
 * signed-in user, that each `listenById` did. Nothing is shared between data
 * clients — a batcher belongs to one `RebaseData`, and a sign-out replaces it.
 *
 * Kept per id: a reference counter. A slot lives while a preview shows it; the
 * batch's subscription closes when the last id it answers for is let go.
 * Releases are settled a microtask later, so a preview that remounts at once
 * (React's StrictMode, a list re-keying) keeps its record and its subscription.
 */
class RecordBatcher {
    private readonly slots = new Map<string, Slot>();
    private readonly pending = new Set<string>();
    private readonly released = new Set<string>();
    private flushScheduled = false;
    private settleScheduled = false;

    constructor(
        private readonly accessor: CollectionAccessor<any>,
        /** The one key column, and its type — `undefined` for a composite key. */
        private readonly key: { fieldName: string; type: "string" | "number" } | undefined
    ) {}

    peek(id: string): Snapshot {
        return this.slots.get(id)?.snapshot ?? LOADING;
    }

    subscribe(id: string, listener: () => void): () => void {
        let slot = this.slots.get(id);
        if (!slot) {
            slot = { snapshot: LOADING, listeners: new Set(), refs: 0 };
            this.slots.set(id, slot);
            this.pending.add(id);
            this.scheduleFlush();
        }
        slot.refs++;
        slot.listeners.add(listener);
        const owned = slot;
        return () => {
            owned.listeners.delete(listener);
            owned.refs--;
            if (owned.refs === 0) {
                this.released.add(id);
                this.scheduleSettle();
            }
        };
    }

    private scheduleFlush(): void {
        if (this.flushScheduled) return;
        this.flushScheduled = true;
        queueMicrotask(() => {
            this.flushScheduled = false;
            const ids = [...this.pending];
            this.pending.clear();
            for (let i = 0; i < ids.length; i += MAX_BATCH) this.start(ids.slice(i, i + MAX_BATCH));
        });
    }

    private scheduleSettle(): void {
        if (this.settleScheduled) return;
        this.settleScheduled = true;
        queueMicrotask(() => {
            this.settleScheduled = false;
            for (const id of this.released) {
                const slot = this.slots.get(id);
                if (!slot || slot.refs > 0) continue;
                this.slots.delete(id);
                this.pending.delete(id);
                const batch = slot.batch;
                if (!batch) continue;
                batch.ids.delete(id);
                if (batch.ids.size === 0) batch.stop?.();
            }
            this.released.clear();
        });
    }

    private set(id: string, batch: Batch, snapshot: Snapshot): void {
        const slot = this.slots.get(id);
        if (!slot || slot.batch !== batch) return;
        slot.snapshot = snapshot;
        for (const listener of [...slot.listeners]) listener();
    }

    private start(ids: string[]): void {
        const batch: Batch = { ids: new Set(ids) };
        for (const id of ids) {
            const slot = this.slots.get(id);
            if (slot) slot.batch = batch;
        }

        const onError = (error: Error) => {
            for (const id of batch.ids) {
                const current = this.slots.get(id)?.snapshot;
                // The connection is down, not the record: what is on screen
                // stays, and the subscription's next frame is the fresh one.
                if (current?.entity && isConnectionLostError(error)) continue;
                this.set(id, batch, { dataLoading: false, dataLoadingError: error });
            }
        };

        // A composite key has no single column to put an `in` on: each record
        // is read on its own, as before.
        if (!this.key) {
            const stops = ids.map(id => this.readOne(id, batch, onError));
            batch.stop = () => stops.forEach(stop => stop());
            return;
        }

        const values = ids.map(id => this.key!.type === "number" && !isNaN(Number(id)) ? Number(id) : id);
        const params = { where: { [this.key.fieldName]: ["in", values] }, limit: ids.length };
        const deliver = (response: FindResponse<any>) => {
            const byId = new Map(response.data.map(entity => [String(entity.id), entity]));
            for (const id of batch.ids) {
                // Absent from the answer is "not there" — deleted, or not
                // readable by this user — exactly as `listenById` reports it.
                this.set(id, batch, { entity: byId.get(id), dataLoading: false });
            }
        };

        if (this.accessor.listen) {
            batch.stop = this.accessor.listen(params as never, deliver, onError);
            return;
        }
        // The one-shot fallback, for a client with no socket.
        let stopped = false;
        batch.stop = () => { stopped = true; };
        this.accessor.find(params as never)
            .then(response => { if (!stopped) deliver(response); })
            .catch(error => { if (!stopped) onError(error instanceof Error ? error : new Error(String(error))); });
    }

    private readOne(id: string, batch: Batch, onError: (error: Error) => void): () => void {
        const deliver = (entity: Entity<any> | undefined | null) =>
            this.set(id, batch, { entity: entity ?? undefined, dataLoading: false });
        if (this.accessor.listenById) return this.accessor.listenById(id, deliver, onError);
        let stopped = false;
        this.accessor.findById(id)
            .then(entity => { if (!stopped) deliver(entity); })
            .catch(error => { if (!stopped) onError(error instanceof Error ? error : new Error(String(error))); });
        return () => { stopped = true; };
    }
}

/**
 * Batchers by data client, then by collection path.
 *
 * Key: the `RebaseData` instance (weakly — a client that is dropped takes its
 * batchers with it) and the path. A batcher holds only records some preview
 * still shows; nothing outlives its last subscriber.
 */
const BATCHERS = new WeakMap<RebaseData, Map<string, RecordBatcher>>();

function batcherFor(data: RebaseData, path: string, collection: AdminCollection<any>): RecordBatcher {
    let byPath = BATCHERS.get(data);
    if (!byPath) {
        byPath = new Map();
        BATCHERS.set(data, byPath);
    }
    let batcher = byPath.get(path);
    if (!batcher) {
        const keys = resolvePrimaryKeys(collection as never);
        batcher = new RecordBatcher(
            data.collection(path),
            keys.length === 1 ? { fieldName: keys[0].fieldName, type: keys[0].type } : undefined
        );
        byPath.set(path, batcher);
    }
    return batcher;
}

/**
 * {@link useFetch} for a record many previews on one screen ask for at once —
 * the target of a reference in a table cell, a card, an array of references.
 *
 * The ids every preview asks for in one tick are read together: one query and
 * one live subscription per batch, not one `listenById` per record. Updates
 * reach a preview per batch — a write to any record of the batch refetches the
 * batch — which is what a preview needs.
 *
 * For one record a view edits, use {@link useFetch}: it follows that record
 * alone and seeds from the record cache.
 *
 * @group Hooks and utilities
 */
export function useBatchedFetch<M extends Record<string, any>>({
    path,
    entityId,
    collection
}: {
    path: string;
    entityId?: string | number;
    collection: AdminCollection<M>;
}): FetchResult<M> {
    const data = useData();
    const id = entityId === undefined || entityId === null || entityId === "" ? undefined : String(entityId);
    const batcher = useMemo(
        () => id !== undefined ? batcherFor(data, path, collection) : undefined,
        [data, path, collection, id !== undefined]
    );

    const subscribe = useCallback(
        (listener: () => void) => batcher && id !== undefined ? batcher.subscribe(id, listener) : () => undefined,
        [batcher, id]
    );
    const getSnapshot = useCallback(
        () => batcher && id !== undefined ? batcher.peek(id) : NO_RECORD,
        [batcher, id]
    );
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
    return snapshot as FetchResult<M>;
}

const NO_RECORD: Snapshot = Object.freeze({ dataLoading: false });
