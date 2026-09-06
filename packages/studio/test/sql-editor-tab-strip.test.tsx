/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { en } from "../../app/src/locales/en";

/**
 * The SQL console's tab strip, and a DOM the browser will not build.
 *
 * The close ✕ was an `<IconButton>` rendered inside `<Tab>`, which is a Radix
 * `TabsTrigger` — itself a `<button>`. Opening a second query tab logged *"In
 * HTML, `<button>` cannot be a descendant of `<button>`. This will cause a
 * hydration error"* and carried on, so nothing failed and nobody saw it. The
 * inner button also had no accessible name at all.
 *
 * `test/setupTests.ts` turns that message into a failure, and the tab-strip
 * mock in `__mocks__/rebasepro-ui.js` renders `Tab` as the `<button>` it really
 * is, so the nesting is reproducible from here rather than only in a browser.
 */

const executeSql = jest.fn(async () => ({ rows: [] }));
const databaseAdmin = {
    executeSql,
    fetchAvailableDatabases: async () => [],
    fetchCurrentDatabase: async () => "postgres"
};

const translation = {
    t: (key: string, options?: Record<string, unknown>) => {
        const value = (en as unknown as Record<string, string>)[key] ?? key;
        return options
            ? value.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => String(options[k] ?? ""))
            : value;
    },
    i18n: { language: "en" }
};

// Listed rather than proxied onto the real module: `@rebasepro/app`'s barrel
// pulls in react-router, which this package's jest has no ESM transform for.
jest.mock("@rebasepro/app", () => ({
    useTranslation: () => translation,
    useRebaseContext: () => ({ databaseAdmin }),
    useStudioCollectionRegistry: () => ({ collections: [], getCollection: () => undefined }),
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    IconForView: () => null,
    ErrorView: () => null,
    ConfirmationDialog: () => null
}));

import { SQLEditor } from "../src/components/SQLEditor/SQLEditor";

/** An `en` string, refused rather than searched for as `undefined`. */
function label(key: keyof typeof en): string {
    const value = en[key];
    if (typeof value !== "string") throw new Error(`en.${String(key)} is not a string`);
    return value;
}

beforeEach(() => {
    executeSql.mockClear();
    localStorage.clear();
});

/**
 * The query tabs, not the sidebar's.
 *
 * The sidebar (Schema / Snippets / History) is a tab strip too, so a bare
 * `getAllByRole("tab")` counts four before a single query tab is added.
 */
function queryTabs(): HTMLElement[] {
    return screen.getAllByRole("tab").filter(tab => /^Query \d+$/.test((tab.textContent ?? "").trim()));
}

describe("the SQL console's query tabs", () => {

    it("opens a second tab without rendering a button inside a button", async () => {
        render(<SQLEditor/>);

        const add = await screen.findByLabelText(label("studio_sql_new_tab"));
        fireEvent.click(add);

        // Two tabs, each with its own close control — which is where the
        // nesting used to appear. The setup fails the test on the message, so
        // reaching this assertion is most of the point.
        await waitFor(() => expect(queryTabs().length).toBe(2));
        expect(screen.getAllByLabelText(label("studio_sql_close_tab")).length).toBe(2);
    });

    it("closes one again", async () => {
        render(<SQLEditor/>);

        fireEvent.click(await screen.findByLabelText(label("studio_sql_new_tab")));
        await waitFor(() => expect(queryTabs().length).toBe(2));

        fireEvent.click(screen.getAllByLabelText(label("studio_sql_close_tab"))[0]);

        await waitFor(() => expect(queryTabs().length).toBe(1));
        // One tab left, and nothing to close it with: closing the last one
        // would leave the console with no editor at all.
        expect(screen.queryByLabelText(label("studio_sql_close_tab"))).toBeNull();
    });
});
