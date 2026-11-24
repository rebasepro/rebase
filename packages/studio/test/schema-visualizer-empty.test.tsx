/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { afterEach, describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { TableDescriptorsState } from "@rebasepro/app";
import { failedTables, LOADING_TABLES, NO_TABLES, unavailableTables } from "./helpers/tableDescriptors";

/**
 * Still loading, nothing declared and nothing served are different answers.
 * The Schema Visualizer once rendered "Loading schema…" for all of them, so a
 * project that declares no tables — a fresh scaffold, a backend someone opened
 * the console against — sat on a spinner forever waiting for something that
 * was never coming. And a tenant whose runtime predates `GET
 * /api/schema/tables` must be told to upgrade, not shown an empty schema.
 */

let tables: TableDescriptorsState = LOADING_TABLES;

/** The English text of a key the catalogue declares optional; a missing one fails the test by name. */
function english(key: keyof typeof en): string {
    const text = en[key];
    if (text === undefined) throw new Error(`en.ts has no "${key}"`);
    return text;
}

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => en[key as keyof typeof en] ?? key,
        i18n: { language: "en" }
    }),
    useNavigationGroupLabel: () => (group: string) => group,
    useTableDescriptors: () => tables,
    useStudioSidePanelController: () => ({ open: jest.fn(), replace: jest.fn(), close: jest.fn() }),
    useStudioCapabilities: () => ({ codebase: false }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ apiUrl: "http://api.test", apiPath: "/api", getAuthToken: async () => null }),
    useAuthController: () => ({ getAuthToken: async () => null }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useRebaseContext: () => ({}),
    useRebaseClient: () => ({}),
    ErrorView: ({ title, error, onRetry }: { title: string; error: string; onRetry?: () => void }) => (
        <div role="alert">
            <span>{title}</span>
            <span>{error}</span>
            {onRetry && <button onClick={onRetry}>Retry</button>}
        </div>
    )
}));

import { SchemaDiagramView } from "../src/components/SchemaVisualizer/SchemaDiagramView";

/** The diagram's own page, on a backend without the catalog route: what every tenant runtime today is. */
const SchemaVisualizer = () => <SchemaDiagramView linksToTables={false}/>;

const originalFetch = globalThis.fetch;

beforeEach(() => {
    tables = LOADING_TABLES;
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async () => ({ ok: false, status: 404, statusText: "Not Found", text: async () => "{}" })
    });
});

afterEach(() => {
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: originalFetch });
});

describe("SchemaVisualizer with nothing to draw", () => {

    it("waits while the server has not answered yet", () => {
        render(<SchemaVisualizer/>);
        expect(screen.getByText(/Loading schema/i)).toBeTruthy();
    });

    it("says nothing is declared once the server answers with no tables", async () => {
        tables = NO_TABLES;
        render(<SchemaVisualizer/>);

        expect(await screen.findByText(english("studio_schema_no_tables_declared"))).toBeTruthy();
        expect(screen.queryByText(/Loading schema/i)).toBeNull();
    });

    it("names where a table is declared, and a command that exists", async () => {
        tables = NO_TABLES;
        render(<SchemaVisualizer/>);

        expect(await screen.findByText(/rebase schema introspect/)).toBeTruthy();
        expect(screen.getByText(/backend\/schema/)).toBeTruthy();
    });
});

describe("SchemaVisualizer when the server serves no schema", () => {

    it("tells a console user to upgrade a runtime that predates the route — and does not crash", async () => {
        tables = unavailableTables("predates-route");
        render(<SchemaVisualizer/>);

        expect(await screen.findByText(english("studio_schema_outdated_title"))).toBeTruthy();
        expect(screen.getByText(english("studio_schema_outdated_body"))).toBeTruthy();
        expect(screen.queryByText(english("studio_schema_no_tables_declared"))).toBeNull();
    });

    it("says so when the backend has no auth to describe its tables to", async () => {
        tables = unavailableTables("no-auth");
        render(<SchemaVisualizer/>);

        expect(await screen.findByText(english("studio_schema_no_auth_title"))).toBeTruthy();
    });

    it("reports a failed request with a retry", async () => {
        const retry = jest.fn();
        tables = failedTables(new Error("Bad gateway"), retry);
        render(<SchemaVisualizer/>);

        expect((await screen.findByRole("alert")).textContent).toContain("Bad gateway");
        screen.getByRole("button", { name: "Retry" }).click();
        expect(retry).toHaveBeenCalled();
    });
});
