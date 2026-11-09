/**
 * A stand-in for the REST collection the offline engine replays against.
 *
 * It answers the way the real routes do where the engine's decisions depend on
 * it: a missing row is a 404 on `update` and `delete` (the fakes in the older
 * suites deleted a missing row silently, which hid every bug that hinges on that
 * 404), a 409 is whatever the test says, and `online: false` is a network error
 * before the request reaches anything.
 */
import { RebaseApiError, type FindParams, type FindResult, type WriteOptions } from "@rebasepro/types";
import { fakeCollectionClient } from "./fake-collection";
import { OfflineManager } from "../../src/offline";
import { MemoryOfflineStore, type PendingMutation } from "../../src/offline-store";
import { runLocalQuery } from "../../src/offline-query";

export type Row = Record<string, unknown>;

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A whole live page of `data`, as the socket delivers one. */
export const frame = (data: Row[]): FindResult<Row> => ({
    data,
    meta: { total: data.length, limit: 20, offset: 0, hasMore: false }
});

export const networkError = () => new RebaseApiError("fetch failed", { status: 0, code: "NETWORK_ERROR" });

export interface Call {
    op: string;
    id?: unknown;
    data?: unknown;
    options?: WriteOptions;
}

export function fakeServer() {
    const state = { online: true };
    const rows = new Map<string, Row>();
    const calls: Call[] = [];
    /** Answers stored under the idempotency key they were given for. */
    const answered = new Map<string, Row>();
    let reject: ((op: string, id: unknown, data: unknown, options?: WriteOptions) => Error | undefined) | undefined;
    let afterCommit: ((op: string) => Error | undefined) | undefined;
    let findGate: Promise<Row[]> | undefined;
    let findByIdError: (() => Error | undefined) | undefined;
    const listeners: ((result: FindResult<Row>) => void)[] = [];
    const byIdListeners: ((row: Row | undefined) => void)[] = [];
    const check = (op: string, id?: unknown, data?: unknown, options?: WriteOptions) => {
        calls.push({ op, id, data, options });
        if (!state.online) throw networkError();
        const error = reject?.(op, id, data, options);
        if (error) throw error;
    };
    const client = fakeCollectionClient<Row>({
        async find(params?: FindParams) {
            check("find");
            if (findGate) {
                const gated = await findGate;
                return { data: gated, meta: { total: gated.length, limit: 20, offset: 0, hasMore: false } };
            }
            return runLocalQuery([...rows.values()], params);
        },
        async findById(id: string | number) {
            check("findById", id);
            const error = findByIdError?.();
            if (error) throw error;
            return rows.get(String(id));
        },
        async create(data: Row, id?: string | number, options?: WriteOptions) {
            check("create", id ?? data.id, data, options);
            const row = { ...data, id: id ?? data.id ?? `srv-${rows.size + 1}` };
            rows.set(String(row.id), row);
            return row;
        },
        async update(id: string | number, data: Row, options?: WriteOptions) {
            check("update", id, data, options);
            // As the real `PATCH` does: a key it has seen is answered from its
            // record of the first request, and the edit is not applied again.
            const key = options?.idempotencyKey;
            const replayed = key === undefined ? undefined : answered.get(key);
            if (replayed) return replayed;
            const existing = rows.get(String(id));
            if (!existing) throw new RebaseApiError("Not found", { status: 404, code: "NOT_FOUND" });
            const row = { ...existing, ...data, id };
            rows.set(String(id), row);
            if (key !== undefined) answered.set(key, { ...row });
            const lost = afterCommit?.("update");
            if (lost) throw lost;
            return row;
        },
        async delete(id: string | number, options?: WriteOptions) {
            check("delete", id, undefined, options);
            if (!rows.has(String(id))) throw new RebaseApiError("Not found", { status: 404, code: "NOT_FOUND" });
            rows.delete(String(id));
        },
        async deleteMany(ids: (string | number)[], options?: WriteOptions) {
            check("deleteMany", ids, undefined, options);
            // As the real route does: one missing id refuses the whole batch.
            if (ids.some((id) => !rows.has(String(id)))) throw new RebaseApiError("Not found", { status: 404, code: "NOT_FOUND" });
            for (const id of ids) rows.delete(String(id));
        },
        async count(params?: FindParams) {
            check("count");
            return runLocalQuery([...rows.values()], { ...params, limit: 1_000_000 }).data.length;
        },
        listen(_params, onUpdate) {
            listeners.push(onUpdate);
            return () => undefined;
        },
        listenById(_id, onUpdate) {
            byIdListeners.push(onUpdate);
            return () => undefined;
        }
    });
    return {
        state,
        rows,
        calls,
        listeners,
        byIdListeners,
        client,
        setReject: (fn: typeof reject) => { reject = fn; },
        setAfterCommit: (fn: typeof afterCommit) => { afterCommit = fn; },
        setFindGate: (gate: Promise<Row[]> | undefined) => { findGate = gate; },
        setFindByIdError: (fn: typeof findByIdError) => { findByIdError = fn; }
    };
}

export type FakeServer = ReturnType<typeof fakeServer>;

export function manager(
    server: FakeServer,
    options: {
        syncIntervalMs?: number;
        onSyncError?: (error: Error, mutation: PendingMutation) => void;
        store?: MemoryOfflineStore;
    } = {}
) {
    const store = options.store ?? new MemoryOfflineStore();
    const offline = new OfflineManager({
        store,
        syncIntervalMs: options.syncIntervalMs ?? 0,
        onSyncError: options.onSyncError
    }, () => server.client);
    return { offline, store, posts: offline.wrap("posts", server.client) };
}

/** `navigator.onLine` as the browser reports it: false means writes are not even attempted. */
export function setNavigatorOnLine(value: boolean): void {
    Object.defineProperty(globalThis, "navigator", { value: { onLine: value }, configurable: true, writable: true });
}

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");

/** Put `navigator` back the way the test runner had it. */
export function restoreNavigator(): void {
    if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
    else delete (globalThis as { navigator?: unknown }).navigator;
}
