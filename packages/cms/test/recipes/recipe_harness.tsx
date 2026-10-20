import React from "react";
import { BrowserRouter } from "react-router";
import type { DataDriver, User } from "@rebasepro/types";
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

/** Tables keyed by collection path; every row keyed on `id`. */
export const db: { rows: Record<string, Row[]> } = { rows: {} };

export const memoryDriver: DataDriver = {
    key: "memory",
    fetchCollection: async ({ path }) => db.rows[path] ?? [],
    fetchOne: async ({ path, id }) => (db.rows[path] ?? []).find(r => String(r.id) === String(id)),
    save: async ({ path, values, id: savedId }) => {
        const id = savedId ?? values.id ?? `${path}-${(db.rows[path] ?? []).length + 1}`;
        const saved = { ...(db.rows[path] ?? []).find(r => String(r.id) === String(id)), ...values, id };
        db.rows[path] = [...(db.rows[path] ?? []).filter(r => String(r.id) !== String(id)), saved];
        return saved;
    },
    delete: async ({ row }) => {
        db.rows[row.path] = (db.rows[row.path] ?? []).filter(r => String(r.id) !== String(row.id));
    },
    count: async ({ path }) => (db.rows[path] ?? []).length,
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
