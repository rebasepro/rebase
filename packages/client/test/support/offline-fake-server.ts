/**
 * A stand-in for the REST collection the offline engine replays against.
 *
 * It answers the way the real routes do where the engine's decisions depend on
 * it: a missing row is a 404 on `update` and `delete` (the fakes in the older
 * suites deleted a missing row silently, which hid every bug that hinges on that
 * 404), a 409 is whatever the test says, and `online: false` is a network error
 * before the request reaches anything.
 */
import { RebaseApiError } from "@rebasepro/types";
import type { CollectionClient } from "../../src/collection";
import { OfflineManager } from "../../src/offline";
import { MemoryOfflineStore, type PendingMutation } from "../../src/offline-store";
import { runLocalQuery } from "../../src/offline-query";

export type Row = Record<string, unknown>;

export const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

export const networkError = () => new RebaseApiError("fetch failed", { status: 0, code: "NETWORK_ERROR" });

export interface Call {
    op: string;
    id?: unknown;
    data?: unknown;
    options?: Record<string, unknown>;
}

export function fakeServer() {
    const state = { online: true };
    const rows = new Map<string, Row>();
    const calls: Call[] = [];
    let reject: ((op: string, id: unknown, data: unknown, options?: Record<string, unknown>) => Error | undefined) | undefined;
    let afterCommit: ((op: string) => Error | undefined) | undefined;
    let findGate: Promise<Row[]> | undefined;
    let findByIdError: (() => Error | undefined) | undefined;
    const listeners: ((result: { data: Row[] }) => void)[] = [];
    const byIdListeners: ((row: Row | null) => void)[] = [];
    const check = (op: string, id?: unknown, data?: unknown, options?: Record<string, unknown>) => {
        calls.push({ op, id, data, options });
        if (!state.online) throw networkError();
        const error = reject?.(op, id, data, options);
        if (error) throw error;
    };
    const client = {
        async find(params?: unknown) {
            check("find");
            if (findGate) {
                const gated = await findGate;
                return { data: gated, meta: { total: gated.length, limit: 20, offset: 0, hasMore: false } };
            }
            return runLocalQuery([...rows.values()], params as never);
        },
        async findById(id: string | number) {
            check("findById", id);
            const error = findByIdError?.();
            if (error) throw error;
            return rows.get(String(id));
        },
        async create(data: Row, id?: string | number, options?: Record<string, unknown>) {
            check("create", id ?? data.id, data, options);
            const row = { ...data, id: id ?? data.id ?? `srv-${rows.size + 1}` };
            rows.set(String(row.id), row);
            return row;
        },
        async update(id: string | number, data: Row, options?: Record<string, unknown>) {
            check("update", id, data, options);
            const existing = rows.get(String(id));
            if (!existing) throw new RebaseApiError("Not found", { status: 404, code: "NOT_FOUND" });
            const row = { ...existing, ...data, id };
            rows.set(String(id), row);
            const lost = afterCommit?.("update");
            if (lost) throw lost;
            return row;
        },
        async delete(id: string | number, options?: Record<string, unknown>) {
            check("delete", id, undefined, options);
            if (!rows.has(String(id))) throw new RebaseApiError("Not found", { status: 404, code: "NOT_FOUND" });
            rows.delete(String(id));
        },
        async deleteMany(ids: (string | number)[], options?: Record<string, unknown>) {
            check("deleteMany", ids, undefined, options);
            for (const id of ids) rows.delete(String(id));
        },
        async count() {
            check("count");
            return rows.size;
        },
        listen(_params: unknown, onUpdate: (result: { data: Row[] }) => void) {
            listeners.push(onUpdate);
            return () => undefined;
        },
        listenById(_id: unknown, onUpdate: (row: Row | null) => void) {
            byIdListeners.push(onUpdate);
            return () => undefined;
        }
    };
    return {
        state,
        rows,
        calls,
        listeners,
        byIdListeners,
        client: client as unknown as CollectionClient<Row>,
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
