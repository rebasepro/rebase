/**
 * @jest-environment jsdom
 */
/**
 * `EntityViewPanel`: one record, read-only, in a page of the host app. It
 * fetches by id, draws through the record grid, and leaves out what the form
 * leaves out — a field a dynamic condition hides, one the user may not read.
 */
import React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import { CollectionsProvider, EntityViewPanel } from "@rebasepro/cms";

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

type Row = Record<string, unknown>;

const invoices: AdminCollection = {
    slug: "invoices",
    name: "Invoices",
    table: "invoices",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        number: { type: "string", name: "Invoice number" },
        kind: {
            type: "string",
            name: "Kind",
            enum: [
                { id: "business", label: "Business" },
                { id: "personal", label: "Personal" }
            ]
        },
        vat: {
            type: "string",
            name: "VAT number",
            conditions: { hidden: { "==": [{ var: "values.kind" }, "personal"] } }
        },
        margin: { type: "number", name: "Margin", access: { read: ["finance"] } },
        notes: { type: "string", name: "Notes" }
    }
} as AdminCollection;

let rows: Record<string, Row[]>;

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async ({ path }) => rows[path] ?? [],
    fetchOne: async ({ path, id }) => (rows[path] ?? []).find(r => String(r.id) === String(id)),
    save: async ({ values }) => values,
    delete: async () => undefined,
    count: async ({ path }) => (rows[path] ?? []).length,
    checkUniqueField: async () => true
};

function authAs(roles: string[]) {
    return {
        user: { uid: "u1", email: "u1@rebase.pro", displayName: "u1", photoURL: null, providerId: "password", isAnonymous: false, roles },
        initialLoading: false,
        authLoading: false,
        loginSkipped: false,
        getAuthToken: async () => "t",
        signOut: async () => undefined,
        extra: null,
        setExtra: () => undefined
    } as never;
}

function Page({ children, roles = ["editor"] }: { children: React.ReactNode, roles?: string[] }) {
    return (
        <Rebase authController={authAs(roles)} storageSource={{} as never}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
            <BrowserRouter>
                <main>{children}</main>
            </BrowserRouter>
        </Rebase>
    );
}

function shownFields(): (string | null)[] {
    return Array.from(document.querySelectorAll("[data-form-field]")).map(el => el.getAttribute("data-form-field"));
}

beforeEach(() => {
    rows = {
        invoices: [
            { id: "i1", number: "INV-001", kind: "business", vat: "IT123", margin: 12, notes: "Net 30" },
            { id: "i2", number: "INV-002", kind: "personal", vat: "IT999", margin: 7, notes: "Paid" }
        ]
    };
});

describe("EntityViewPanel", () => {
    it("fetches the record and shows its values under their labels", async () => {
        render(<Page><EntityViewPanel collection={invoices} id={"i1"}/></Page>);

        expect(await screen.findByText("INV-001")).toBeTruthy();
        expect(screen.getByText("Invoice number")).toBeTruthy();
        expect(screen.getByText("Business")).toBeTruthy();
        expect(screen.getByText("Net 30")).toBeTruthy();
        // Read-only: values, not inputs.
        expect(screen.queryByDisplayValue("INV-001")).toBeNull();
    });

    it("shows only its fields, in their order", async () => {
        render(<Page><EntityViewPanel collection={invoices} id={"i1"} fields={["notes", "number"]}/></Page>);

        await screen.findByText("INV-001");
        expect(shownFields()).toEqual(["notes", "number"]);
    });

    it("hides a field a dynamic condition hides for this record", async () => {
        render(<Page>
            <EntityViewPanel collection={invoices} id={"i1"}/>
            <EntityViewPanel collection={invoices} id={"i2"}/>
        </Page>);

        await screen.findByText("INV-001");
        await screen.findByText("INV-002");
        // The business invoice shows its VAT number; the personal one does not.
        expect(screen.getByText("IT123")).toBeTruthy();
        expect(screen.queryByText("IT999")).toBeNull();
        expect(screen.getAllByText("VAT number")).toHaveLength(1);
    });

    it("hides a field the user may not read, and shows it to one who may", async () => {
        const { unmount } = render(<Page roles={["editor"]}><EntityViewPanel collection={invoices} id={"i1"}/></Page>);
        await screen.findByText("INV-001");
        expect(screen.queryByText("Margin")).toBeNull();
        expect(shownFields()).not.toContain("margin");
        unmount();

        render(<Page roles={["finance"]}><EntityViewPanel collection={invoices} id={"i1"}/></Page>);
        await screen.findByText("INV-001");
        expect(screen.getByText("Margin")).toBeTruthy();
    });

    it("applies its overrides to a collection the scope registers", async () => {
        render(<Page>
            <CollectionsProvider collections={[invoices]}>
                <EntityViewPanel collection={invoices} id={"i1"}
                    collectionOverrides={{ properties: { ...invoices.properties, number: { type: "string", name: "Reference" } } }}/>
            </CollectionsProvider>
        </Page>);

        expect(await screen.findByText("Reference")).toBeTruthy();
        expect(screen.queryByText("Invoice number")).toBeNull();
    });

    it("takes the collection by path, from the scope that registers it", async () => {
        render(<Page>
            <CollectionsProvider collections={[invoices]}>
                <EntityViewPanel path={"invoices"} id={"i1"} fields={["number", "notes"]}/>
            </CollectionsProvider>
        </Page>);

        expect(await screen.findByText("INV-001")).toBeTruthy();
        expect(shownFields()).toEqual(["number", "notes"]);
    });

    it("says so when no scope registers the path it names", async () => {
        render(<Page><EntityViewPanel path={"nowhere"} id={"i1"}/></Page>);
        await waitFor(() => expect(screen.getByText("Entity not found")).toBeTruthy());
    });

    it("says so when no record has the id", async () => {
        render(<Page><EntityViewPanel collection={invoices} id={"missing"}/></Page>);
        await waitFor(() => expect(screen.getByText("Entity not found")).toBeTruthy());
    });
});
