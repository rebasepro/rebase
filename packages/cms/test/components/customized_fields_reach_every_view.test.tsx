/**
 * @jest-environment jsdom
 */
/**
 * What a table's customization says about its fields holds in every view.
 *
 * - `listFields` (`listProperties`) is the table's columns as well as the
 *   list's: a customization that named its columns still showed every other
 *   one in the table, because only `fieldOrder` reached it.
 * - `hidden` (`hideFromCollection`) keeps a field off the record too: it kept
 *   the column out of the table and left it on the record page, so hiding a
 *   field took `hiddenInForm` as well.
 * - A computed column (`additionalFields`) is the table's: the record showed
 *   it again under the values it was computed from, unless the form names it.
 */
import React from "react";
import { beforeEach, describe, expect, it } from "@jest/globals";
import { render, screen, within } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Rebase } from "@rebasepro/app";
import { CollectionPanel, RecordDetail, RecordForm } from "@rebasepro/cms";
import { clearFetchCache } from "../../../app/src/hooks/data/useFetch";
import { fakeStorageSource } from "../helpers/fakes";

if (typeof globalThis.IntersectionObserver === "undefined") {
    class NoopIntersectionObserver {
        observe() { /* nothing scrolls in jsdom */ }
        unobserve() { /* nothing scrolls in jsdom */ }
        disconnect() { /* nothing scrolls in jsdom */ }
        takeRecords() { return []; }
    }
    Object.defineProperty(globalThis, "IntersectionObserver", { value: NoopIntersectionObserver, configurable: true });
}

if (typeof globalThis.ResizeObserver === "undefined") {
    class NoopResizeObserver {
        observe() { /* nothing to observe in jsdom */ }
        unobserve() { /* nothing to observe in jsdom */ }
        disconnect() { /* nothing to observe in jsdom */ }
    }
    Object.defineProperty(globalThis, "ResizeObserver", { value: NoopResizeObserver, configurable: true });
}

// jsdom measures nothing: give the table a laptop-sized viewport.
jest.mock("react-use-measure", () => {
    const mod = jest.requireActual("react-use-measure") as { default?: (o?: unknown) => unknown };
    const actual = (typeof mod === "function" ? mod : mod.default) as (o?: unknown) => unknown;
    return (options?: { offsetSize?: boolean }) => {
        const real = actual(options) as [unknown, unknown];
        if (options?.offsetSize) return [real[0], { width: 1440, height: 900, top: 0, left: 0, bottom: 0, right: 0, x: 0, y: 0 }];
        return real;
    };
});

const clients = {
    slug: "clients",
    name: "Clients",
    singularName: "Client",
    table: "clients",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        name: { type: "string", name: "Name" },
        email: { type: "string", name: "Email" },
        source: { type: "string", name: "Source" },
        consent: { type: "string", name: "Consent" }
    }
} as AdminCollection;

type Row = Record<string, unknown>;
let rows: Row[];

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async () => rows,
    fetchOne: async ({ id }) => rows.find(r => String(r.id) === String(id)),
    save: async ({ values }) => values,
    delete: async () => undefined,
    count: async () => rows.length,
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
};

function Page({ children }: { children: React.ReactNode }) {
    return (
        <Rebase authController={authController} storageSource={fakeStorageSource()}
            dataSources={[{ key: "(default)", engine: "postgres", driver }]}>
            <BrowserRouter>
                <main>{children}</main>
            </BrowserRouter>
        </Rebase>
    );
}

const HEADERS = ["Name", "Email", "Source", "Consent", "Summary"];

function tableHeaders(): string[] {
    const table = document.getElementById("virtual-table");
    if (!table) return [];
    return HEADERS
        .map(name => ({ name, node: within(table).queryAllByText(name)[0] }))
        .filter(({ node }) => Boolean(node))
        .sort((a, b) => a.node!.compareDocumentPosition(b.node!) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1)
        .map(({ name }) => name);
}

function shownFields(): (string | null)[] {
    return Array.from(document.querySelectorAll("[data-form-field]")).map(el => el.getAttribute("data-form-field"));
}

beforeEach(() => {
    clearFetchCache();
    rows = [
        { id: "c1", name: "Ada Lovelace", email: "ada@example.com", source: "Fair 2026", consent: "Signed" }
    ];
    window.history.replaceState(null, "", "/my-page");
});

describe("listFields", () => {
    it("are the table's columns, in their order, and nothing else", async () => {
        const collection = { ...clients, listProperties: ["email", "name"] } as AdminCollection;
        render(<Page><CollectionPanel collection={collection} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
        expect(tableHeaders()).toEqual(["Email", "Name"]);
        expect(screen.queryByText("Fair 2026")).toBeNull();
        expect(screen.queryByText("Signed")).toBeNull();
    });

    it("follow fieldOrder in the table when it is set", async () => {
        const collection = {
            ...clients,
            propertiesOrder: ["name", "consent", "email", "source"],
            listProperties: ["email", "name"]
        } as AdminCollection;
        render(<Page><CollectionPanel collection={collection} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
        expect(tableHeaders()).toEqual(["Name", "Email"]);
    });

    it("leave every column in the table when there are none", async () => {
        render(<Page><CollectionPanel collection={clients} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
        expect(tableHeaders()).toEqual(["Name", "Email", "Source", "Consent"]);
    });
});

describe("a hidden field", () => {
    const withHidden = {
        ...clients,
        properties: {
            ...clients.properties,
            consent: { type: "string", name: "Consent", admin: { hideFromCollection: true } }
        }
    } as AdminCollection;

    it("is not on the record's read view", async () => {
        render(<Page><RecordDetail collection={withHidden} id={"c1"}/></Page>);
        expect(await screen.findByText("ada@example.com")).toBeTruthy();
        expect(shownFields()).not.toContain("consent");
        expect(screen.queryByText("Signed")).toBeNull();
    });

    it("is not on the record's form", async () => {
        render(<Page><RecordForm collection={withHidden} id={"c1"}/></Page>);
        expect(await screen.findByDisplayValue("ada@example.com")).toBeTruthy();
        expect(shownFields()).not.toContain("consent");
        expect(screen.queryByDisplayValue("Signed")).toBeNull();
    });
});

describe("a computed column", () => {
    const withSummary = (form?: AdminCollection["form"]) => ({
        ...clients,
        additionalFields: [{ key: "summary", name: "Summary", Builder: () => <span>Computed summary</span> }],
        ...(form ? { form } : {})
    }) as AdminCollection;

    it("is a column of the table", async () => {
        render(<Page><CollectionPanel collection={withSummary()} viewMode={"table"}/></Page>);
        expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
        expect(tableHeaders()).toContain("Summary");
    });

    it("is not on the record's form", async () => {
        render(<Page><RecordForm collection={withSummary()} id={"c1"}/></Page>);
        expect(await screen.findByDisplayValue("ada@example.com")).toBeTruthy();
        expect(screen.queryByText("Computed summary")).toBeNull();
    });

    it("is on the record's form where a section names it", async () => {
        const collection = withSummary({ sections: [{ key: "main", properties: ["name", "summary"] }] });
        render(<Page><RecordForm collection={collection} id={"c1"}/></Page>);
        expect(await screen.findByDisplayValue("ada@example.com")).toBeTruthy();
        expect(await screen.findByText("Computed summary")).toBeTruthy();
    });
});
