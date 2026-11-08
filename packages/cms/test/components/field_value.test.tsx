/**
 * @jest-environment jsdom
 */
/**
 * `<FieldValue>` draws one value of a row as the server sends it — what
 * `useRows` returns — the way the admin draws it: ISO dates, enum keys and a
 * belongsTo relation under its foreign-key column, not under the property.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import { CollectionsProvider, FieldValue } from "@rebasepro/cms";

type Row = Record<string, unknown>;

const customers: AdminCollection = {
    slug: "customers",
    name: "Customers",
    table: "customers",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        name: { type: "string", name: "Name" }
    }
} as AdminCollection;

function StatusBadge({ value }: { value?: unknown }) {
    return <span data-testid={"custom-preview"}>{`custom:${String(value)}`}</span>;
}

const orders: AdminCollection = {
    slug: "orders",
    name: "Orders",
    table: "orders",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        status: {
            type: "string",
            name: "Status",
            enum: [
                { id: "paid", label: "Paid in full", color: "greenLight" },
                { id: "open", label: "Awaiting payment" }
            ]
        },
        placedAt: { type: "date", name: "Placed", mode: "date_time", timezone: "America/New_York" },
        priority: { type: "string", name: "Priority", admin: { Preview: StatusBadge } },
        customer: {
            type: "relation",
            name: "Customer",
            relation: { kind: "belongsTo", target: () => customers, localKey: "customer_id" }
        }
    }
} as AdminCollection;

const rows: Record<string, Row[]> = {
    customers: [{ id: "c1", name: "Ada Lovelace" }]
};

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async ({ path }) => rows[path] ?? [],
    fetchOne: async ({ path, id }) => (rows[path] ?? []).find(r => String(r.id) === String(id)),
    save: async ({ values }) => values,
    delete: async () => undefined,
    count: async ({ path }) => (rows[path] ?? []).length,
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

function Page({ children }: { children: React.ReactNode }) {
    return (
        <Rebase authController={authController} storageSource={{} as never}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
            <BrowserRouter>
                <CollectionsProvider collections={[orders, customers]}>
                    {children}
                </CollectionsProvider>
            </BrowserRouter>
        </Rebase>
    );
}

// The order exactly as the server sends it: an ISO string, an enum key, and
// the customer as its foreign key under that column's wire name.
const order: Row = {
    id: "o1",
    status: "paid",
    placedAt: "2026-07-04T16:00:00.000Z",
    priority: "high",
    customerId: "c1"
};

describe("FieldValue", () => {
    it("draws an enum key as its chip", async () => {
        render(<Page><FieldValue collection={"orders"} field={"status"} value={order.status}/></Page>);
        expect(await screen.findByText("Paid in full")).toBeTruthy();
    });

    it("draws an ISO date string in the property's timezone", async () => {
        render(<Page><FieldValue collection={"orders"} field={"placedAt"} value={order.placedAt}/></Page>);
        expect(await screen.findByText(/Jul 4, 2026/)).toBeTruthy();
        expect(screen.getByText("(EDT)")).toBeTruthy();
    });

    it("draws a relation property's foreign key as the target's title", async () => {
        render(<Page><FieldValue collection={"orders"} field={"customer"} value={order.customerId}/></Page>);
        expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    });


    it("draws a foreign-key column's value as the related record's title", async () => {
        render(<Page>
            <FieldValue collection={"orders"} field={"customer_id"} value={"c1"}/>
        </Page>);
        expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    });

    it("finds the relation by the column's wire name too", async () => {
        render(<Page><FieldValue collection={"orders"} field={"customerId"} value={order.customerId}/></Page>);
        expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    });

    it("draws a property through its own Preview", async () => {
        render(<Page><FieldValue collection={"orders"} field={"priority"} value={order.priority}/></Page>);
        expect((await screen.findByTestId("custom-preview")).textContent).toBe("custom:high");
    });

    it("throws, naming the field, for a field the collection does not have", async () => {
        const consoleError = jest.spyOn(console, "error").mockImplementation(() => undefined);
        class Boundary extends React.Component<{ children: React.ReactNode }, { error?: Error }> {
            state: { error?: Error } = {};
            static getDerivedStateFromError(error: Error) {
                return { error };
            }
            render() {
                return this.state.error ? <p>{this.state.error.message}</p> : this.props.children;
            }
        }
        render(<Page><Boundary><FieldValue collection={"orders"} field={"total"} value={1}/></Boundary></Page>);
        expect(await screen.findByText(/the collection has no property or foreign key "total"/)).toBeTruthy();
        consoleError.mockRestore();
    });
});
