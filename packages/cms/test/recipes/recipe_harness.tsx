import React from "react";
import { BrowserRouter } from "react-router";
import type { DataDriver, FilterValues, OrderByTuple, User, WhereFilterOp } from "@rebasepro/types";
import type { ComponentOverrideMap, CollectionCustomView } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";

/**
 * What every recipe test stands on: `<Rebase>` over an in-memory data driver
 * and a router — the same two things a user's project mounts — and nothing
 * else. A recipe that needs more than this to run needs more than its own file
 * in a user's project too, and that is what the tests are here to notice.
 */

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* jsdom measures nothing */ }
        unobserve() { /* jsdom measures nothing */ }
        disconnect() { /* jsdom measures nothing */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

export type Row = Record<string, unknown>;

/**
 * Tables keyed by collection path; every row keyed on `id`, or on the column
 * `keys` names for its path. `failSaveOf` names a row whose save the driver
 * refuses, as a security rule or a callback would.
 */
export const db: { rows: Record<string, Row[]>; keys?: Record<string, string>; failSaveOf?: string } = { rows: {} };

/** The key column of a table. */
const keyOf = (path: string) => db.keys?.[path] ?? "id";
/** Whether a row is the one with this id. */
const isRow = (path: string, id: unknown) => (r: Row) => String(r[keyOf(path)]) === String(id);

type Filter = FilterValues<string> | undefined;
type Condition = [WhereFilterOp, unknown];

/** A field's conditions: one, or a list of them AND-ed. */
function isConditionList(condition: Condition | Condition[]): condition is Condition[] {
    return Array.isArray(condition[0]);
}

/** Whether a row passes one condition. The operators a recipe filters with; any other passes. */
function passes(value: unknown, op: WhereFilterOp, operand: unknown): boolean {
    const same = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);
    switch (op) {
        case "==": return same(value, operand);
        case "!=": return !same(value, operand);
        case "in": return Array.isArray(operand) && operand.some(o => same(value, o));
        case "not-in": return Array.isArray(operand) && !operand.some(o => same(value, o));
        default: return true;
    }
}

/** A table's rows that match `filter`, as a real data source selects them. */
function matching(path: string, filter: Filter): Row[] {
    const conditions = Object.entries(filter ?? {}).flatMap(([field, condition]) => {
        if (!condition) return [];
        return (isConditionList(condition) ? condition : [condition]).map(([op, operand]) => ({ field, op, operand }));
    });
    return (db.rows[path] ?? []).filter(row => conditions.every(c => passes(row[c.field], c.op, c.operand)));
}

/** `count` and `sum` over a table's matching rows, grouped, sorted and paged, the way the SQL driver answers them. */
function aggregate(path: string, { aggregates, groupBy = [], filter, orderBy = [], limit, offset = 0 }: {
    aggregates: { fn: string; field?: string; alias: string }[];
    groupBy?: string[];
    filter?: Filter;
    orderBy?: OrderByTuple[];
    limit?: number;
    offset?: number;
}): Record<string, unknown>[] {
    const sorted = computeGroups(path, aggregates, groupBy, filter).sort((a, b) => {
        for (const [key, direction] of orderBy) {
            const [x, y] = [a[key], b[key]];
            if (x === y) continue;
            const before = x === null || x === undefined ? 1 : y === null || y === undefined ? -1 : x < y ? -1 : 1;
            return direction === "desc" ? -before : before;
        }
        return 0;
    });
    return sorted.slice(offset, limit !== undefined ? offset + limit : undefined);
}

function computeGroups(path: string, aggregates: { fn: string; field?: string; alias: string }[], groupBy: string[], filter: Filter): Row[] {
    const groups = new Map<string, { keys: unknown[]; rows: Row[] }>();
    for (const row of matching(path, filter)) {
        const keys = groupBy.map(field => row[field] ?? null);
        const id = JSON.stringify(keys);
        groups.set(id, { keys, rows: [...(groups.get(id)?.rows ?? []), row] });
    }
    if (groupBy.length === 0 && groups.size === 0) groups.set("[]", { keys: [], rows: [] });
    return [...groups.values()].map(({ keys, rows }) => {
        const out: Row = Object.fromEntries(groupBy.map((field, i) => [field, keys[i]]));
        for (const { fn, field, alias } of aggregates) {
            out[alias] = fn === "sum"
                ? rows.reduce((sum, row) => sum + Number(row[field ?? ""] ?? 0), 0)
                : rows.filter(row => field === undefined || row[field] !== undefined && row[field] !== null).length;
        }
        return out;
    });
}

export const memoryDriver: DataDriver = {
    key: "memory",
    // A page is at most `limit` rows, as a real data source serves it.
    fetchCollection: async ({ path, filter, limit }) => matching(path, filter).slice(0, limit ?? undefined),
    fetchOne: async ({ path, id }) => (db.rows[path] ?? []).find(isRow(path, id)),
    // The read path the SQL driver serves, so the flat row hooks and
    // aggregates run here as they do over Postgres.
    restFetchService: {
        fetchCollectionForRest: async (path, options) =>
            matching(path, options?.filter).slice(options?.offset ?? 0, options?.limit !== undefined ? (options.offset ?? 0) + options.limit : undefined),
        fetchOneForRest: async (path, id) => (db.rows[path] ?? []).find(isRow(path, id)) ?? null,
        aggregate: async (path, options) => aggregate(path, options)
    },
    save: async ({ path, values, id: savedId }) => {
        const key = keyOf(path);
        const id = savedId ?? values[key] ?? `${path}-${(db.rows[path] ?? []).length + 1}`;
        if (db.failSaveOf !== undefined && String(id) === db.failSaveOf) throw new Error(`Saving ${String(id)} was refused`);
        const saved = { ...(db.rows[path] ?? []).find(isRow(path, id)), ...values, [key]: id };
        db.rows[path] = [...(db.rows[path] ?? []).filter(r => !isRow(path, id)(r)), saved];
        return saved;
    },
    delete: async ({ row }) => {
        db.rows[row.path] = (db.rows[row.path] ?? []).filter(r => !isRow(row.path, row.id)(r));
    },
    count: async ({ path, filter }) => matching(path, filter).length,
    checkUniqueField: async () => true
};

export function userWith(uid: string, roles: string[] = ["admin"]): User {
    return { uid, email: `${uid}@example.com`, displayName: uid, photoURL: null, providerId: "password", isAnonymous: false, roles };
}

export function authControllerFor(user: User | null, extra: Record<string, unknown> = {}) {
    return {
        user,
        initialLoading: false,
        authLoading: false,
        loginSkipped: false,
        getAuthToken: async () => "token",
        signOut: async () => undefined,
        extra: null,
        setExtra: () => undefined,
        ...extra
    };
}

export function InRebase({ children, user = userWith("ada"), auth, components, collectionViews }: {
    children: React.ReactNode;
    user?: User | null;
    auth?: ReturnType<typeof authControllerFor>;
    components?: ComponentOverrideMap;
    collectionViews?: CollectionCustomView[];
}) {
    return (
        <Rebase authController={(auth ?? authControllerFor(user)) as never}
            storageSource={{} as never}
            dataSources={[{ key: "(default)", engine: "postgres", driver: memoryDriver }]}
            components={components}
            collectionViews={collectionViews as never}>
            <BrowserRouter>{children}</BrowserRouter>
        </Rebase>
    );
}
