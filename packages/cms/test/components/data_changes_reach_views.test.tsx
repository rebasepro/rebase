/**
 * @jest-environment jsdom
 */
/**
 * A page that composes the admin's blocks with the row hooks sees one set of
 * rows, on a data source that cannot subscribe (an in-memory driver, the MCP
 * tool driver): a record form's save refreshes the `useRows` beside it, a
 * write through `useRowWrites` refreshes the collection view, and a change the
 * driver announces refreshes both.
 */
import React from "react";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BrowserRouter } from "react-router";
import type { DataDriver } from "@rebasepro/types";
import type { AdminCollection } from "@rebasepro/cms-types";
import { Rebase, useRows, useRowWrites, type UseRowWritesResult } from "@rebasepro/app";
import { CollectionPanel, RecordForm } from "@rebasepro/cms";

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

const tasks: AdminCollection = {
    slug: "tasks",
    name: "Tasks",
    singularName: "Task",
    table: "tasks",
    properties: {
        id: { type: "string", name: "Id", isId: true },
        title: { type: "string", name: "Title" }
    }
} as AdminCollection;

type Row = Record<string, unknown>;
let rows: Row[];
let announce: ((path: string) => void) | undefined;

const driver: DataDriver = {
    key: "memory",
    fetchCollection: async () => rows.map(row => ({ ...row })),
    fetchOne: async ({ id }) => rows.find(row => String(row.id) === String(id)),
    save: async ({ id, values }) => {
        const key = String(id ?? values.id ?? `t${rows.length + 1}`);
        const saved = { ...rows.find(row => row.id === key), ...values, id: key };
        rows = [...rows.filter(row => row.id !== key), saved];
        return saved;
    },
    delete: async ({ row }) => {
        rows = rows.filter(candidate => String(candidate.id) !== String(row.id));
    },
    count: async () => rows.length,
    checkUniqueField: async () => true,
    subscribeToExternalChanges: (onExternalChange) => {
        announce = onExternalChange;
        return () => {
            announce = undefined;
        };
    }
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
            <BrowserRouter>{children}</BrowserRouter>
        </Rebase>
    );
}

/** The titles `useRows` reads, in a list of its own. */
function Titles() {
    const { rows: read } = useRows("tasks");
    return <ul aria-label={"Titles"}>{read.map(row => <li key={String(row.id)}>{`row: ${String(row.title)}`}</li>)}</ul>;
}

let writes: UseRowWritesResult | undefined;
function Writes() {
    writes = useRowWrites();
    return null;
}

beforeEach(() => {
    rows = [{ id: "t1", title: "Write the plan" }];
    writes = undefined;
    window.history.replaceState(null, "", "/my-page");
});

describe("one set of rows across the admin's blocks and the row hooks", () => {
    it("a record form's save refreshes the useRows beside it", async () => {
        render(<Page>
            <Titles/>
            <RecordForm collection={tasks} id={"t1"}/>
        </Page>);
        expect(await screen.findByText("row: Write the plan")).toBeTruthy();

        const title = await screen.findByDisplayValue("Write the plan");
        await act(async () => {
            fireEvent.change(title, { target: { value: "Ship the plan" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        expect(await screen.findByText("row: Ship the plan")).toBeTruthy();
    });

    it("a write through useRowWrites refreshes the collection view", async () => {
        render(<Page>
            <Writes/>
            <CollectionPanel collection={tasks} viewMode={"table"}/>
        </Page>);
        expect(await screen.findByText("Write the plan")).toBeTruthy();

        await act(async () => {
            await writes!.create("tasks", { title: "Review it" }, "t2");
        });
        expect(await screen.findByText("Review it")).toBeTruthy();

        await act(async () => {
            await writes!.remove("tasks", "t1");
        });
        await waitFor(() => expect(screen.queryByText("Write the plan")).toBeNull());
    });

    it("a change the driver announces refreshes the collection view and useRows", async () => {
        render(<Page>
            <Titles/>
            <CollectionPanel collection={tasks} viewMode={"table"}/>
        </Page>);
        expect(await screen.findByText("row: Write the plan")).toBeTruthy();
        expect(await screen.findByText("Write the plan")).toBeTruthy();

        // Written by someone else: the driver hears of it, and says so.
        rows = [...rows, { id: "t2", title: "Made by the model" }];
        await act(async () => {
            announce?.("tasks");
        });

        expect(await screen.findByText("row: Made by the model")).toBeTruthy();
        expect(await screen.findByText("Made by the model")).toBeTruthy();
    });
});
