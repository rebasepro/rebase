/**
 * @jest-environment jsdom
 */
/**
 * The record's History tab offers Revert only to someone who may edit the
 * record. It was offered to everyone, including an administrator simulating
 * access: the banner said editing was off, the form was read-only, and Revert
 * still wrote the old version back.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { DataDriver, Entity } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Rebase, RlsSimulationContext } from "@rebasepro/app";
import type { RlsSimulationController } from "@rebasepro/app";

jest.mock("../../../src/hooks/useHistory", () => ({
    useHistory: () => ({
        entries: [{
            id: "h1",
            table_name: "posts",
            entity_id: "p1",
            action: "update",
            values: { title: "Old title" },
            previous_values: { title: "Older title" },
            changed_fields: ["title"],
            updated_by: "u1",
            updated_at: "2026-10-01T10:00:00.000Z"
        }],
        total: 1,
        isLoading: false,
        hasMore: false,
        loadMore: () => undefined,
        revert: async () => ({})
    })
}));

import { EntityHistoryView } from "../../../src/components/history/EntityHistoryView";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

const posts: AdminCollection = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        title: { type: "string", name: "Title" }
    }
} as AdminCollection;

const entity: Entity<Record<string, unknown>> = { id: "p1", path: "posts", values: { title: "Current title" } };

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async () => [],
    fetchOne: async () => undefined,
    save: async ({ values }) => values,
    delete: async () => undefined,
    count: async () => 0,
    checkUniqueField: async () => true
};

const authController = {
    user: { uid: "u1", email: "u1@rebase.pro", displayName: "u1", photoURL: null, providerId: "password", isAnonymous: false, roles: ["admin"] },
    initialLoading: false,
    authLoading: false,
    loginSkipped: false,
    getAuthToken: async () => "t",
    signOut: async () => undefined,
    extra: null,
    setExtra: () => undefined
} as never;

function renderHistory(simulation: RlsSimulationController["simulation"]) {
    const controller: RlsSimulationController = {
        available: true,
        simulation,
        label: null,
        setSimulation: () => undefined
    };
    return render(
        <Rebase authController={authController} storageSource={{} as never}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
            <RlsSimulationContext.Provider value={controller}>
                <EntityHistoryView collection={posts} entity={entity}
                    formContext={{ formex: { dirty: false } } as never}/>
            </RlsSimulationContext.Provider>
        </Rebase>
    );
}

describe("the record's History tab", () => {
    it("offers Revert to someone who may edit the record", async () => {
        renderHistory(null);
        expect(await screen.findAllByRole("button", { name: /revert to this version/i })).toHaveLength(1);
    });

    it("offers no Revert while access is simulated", async () => {
        renderHistory({ role: "customer" });
        await screen.findAllByText(/title/i);
        expect(screen.queryByRole("button", { name: /revert to this version/i })).toBeNull();
    });
});
