/**
 * @jest-environment jsdom
 */
import React from "react";
import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEnTranslation } from "./en-translation";

/**
 * The Database view over a stubbed `/api/admin/db/insights` and `/catalog`:
 * the overview header, the advisors landing and its link into the SQL editor,
 * the activity list's five-second refresh and its pause, and a terminate that
 * is confirmed against the SQL the server previews.
 */

const snackbarOpen = jest.fn();
const mockNavigate = jest.fn();
let mockSearch = "";

jest.mock("react-router", () => {
    const { useState } = jest.requireActual<typeof import("react")>("react");
    return {
        useNavigate: () => mockNavigate,
        // The view keeps its open section in `?section=`; a router of its own
        // is all the test needs of one.
        useSearchParams: () => {
            const [params, setParams] = useState(() => new URLSearchParams(mockSearch));
            const update = (next: URLSearchParams | ((previous: URLSearchParams) => URLSearchParams)) =>
                setParams(previous => typeof next === "function" ? next(previous) : next);
            return [params, update];
        }
    };
});

jest.mock("@rebasepro/app", () => ({
    useApiBase: () => "/api",
    useApiConfig: () => ({ apiUrl: "http://localhost:3000", getAuthToken: async () => "test-token" }),
    useAuthController: () => ({ getAuthToken: async () => "test-token" }),
    useSnackbarController: () => ({ open: snackbarOpen }),
    useTranslation: () => useEnTranslation()
}));

import { DatabaseView } from "../src/components/Database/DatabaseView";
import { ACTIVITY_REFRESH_MS } from "../src/components/Database/ActivitySection";
import { sqlDraftLink, tableLink } from "../src/components/Database/links";

interface Call { method: string; path: string; body: unknown }

let calls: Call[] = [];
let routes: Partial<Record<string, (body: unknown) => unknown>> = {};
const originalFetch = globalThis.fetch;

const OVERVIEW = {
    engine: "postgres",
    serverVersion: "18.1",
    database: "app",
    sizeBytes: 12 * 1024 * 1024,
    connections: { used: 7, max: 100, byState: { active: 2, idle: 5 } }
};

const ADVISORS = {
    findings: [
        {
            id: "rls-disabled:public.notes::0",
            check: "rls-disabled",
            category: "security",
            severity: "high",
            title: "public.notes has RLS disabled",
            detail: "Every row is readable by the request role.",
            table: "public.notes",
            remediationSql: "ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;"
        },
        {
            id: "fk-without-index:public.books:books_author_id_fkey",
            check: "fk-without-index",
            category: "performance",
            severity: "low",
            title: "Foreign key books_author_id_fkey on public.books (author_id) has no index",
            detail: "Joins read the whole table.",
            table: "public.books",
            remediationSql: "CREATE INDEX ON \"public\".\"books\" (\"author_id\");"
        }
    ],
    errors: [],
    degraded: []
};

const SESSION = {
    pid: 4242,
    username: "app",
    applicationName: "worker",
    state: "active",
    waitEventType: "Lock",
    waitEvent: "relation",
    query: "UPDATE accounts SET balance = balance - 1",
    durationMs: 12_500,
    blockedBy: [4100]
};

function renderAt(search: string) {
    mockSearch = search;
    return render(<DatabaseView/>);
}

beforeEach(() => {
    calls = [];
    snackbarOpen.mockReset();
    mockNavigate.mockReset();
    routes = {
        "GET /api/admin/db/insights/overview": () => OVERVIEW,
        "GET /api/admin/db/insights/advisors": () => ADVISORS,
        "GET /api/admin/db/insights/activity": () => ({ sessions: [SESSION] }),
        "POST /api/admin/db/insights/activity/4242/terminate": (body) =>
            ({ dryRun: (body as { dryRun?: boolean }).dryRun === true, statements: ["SELECT pg_terminate_backend(4242);"], signalled: true }),
        "GET /api/admin/db/insights/queries?sort=total": () => ({ status: "not_installed", available: true, sort: "total", queries: [] })
    };
    Object.defineProperty(globalThis, "fetch", {
        configurable: true,
        writable: true,
        value: async (input: RequestInfo | URL, init?: RequestInit) => {
            const url = new URL(String(input), "http://localhost");
            const method = init?.method ?? "GET";
            const path = `${url.pathname}${url.search}`;
            const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
            calls.push({ method, path, body });
            const handler = routes[`${method} ${path}`];
            const payload = handler ? handler(body) : { error: { message: `no route for ${method} ${path}` } };
            const status = handler ? 200 : 404;
            return { ok: status === 200, status, statusText: "", text: async () => JSON.stringify(payload) };
        }
    });
});

afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(globalThis, "fetch", { configurable: true, writable: true, value: originalFetch });
});

describe("the Database view's links into other Studio tools", () => {
    it("opens SQL as an editor draft and a table in the Tables view", () => {
        expect(sqlDraftLink("SELECT 1 & 2;")).toBe("/sql?sqlDraft=SELECT%201%20%26%202%3B");
        expect(tableLink("public.posts")).toBe("/tables?table=public.posts");
    });
});

describe("Database view", () => {
    it("shows the overview and lands on the advisors, whose fix opens in the SQL editor", async () => {
        renderAt("");

        expect(await screen.findByText("PostgreSQL 18.1")).toBeTruthy();
        expect(screen.getByText("12 MB")).toBeTruthy();
        expect(screen.getByText("7 of 100")).toBeTruthy();

        expect(await screen.findByText("public.notes has RLS disabled")).toBeTruthy();
        expect(screen.getByText("All (2)")).toBeTruthy();
        expect(screen.getByText("Security (1)")).toBeTruthy();

        fireEvent.click(screen.getAllByText("Details")[0]);
        expect(screen.getByText("Every row is readable by the request role.")).toBeTruthy();
        fireEvent.click(screen.getByText("Open in SQL editor"));
        expect(mockNavigate).toHaveBeenCalledWith(sqlDraftLink("ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;"));
    });

    it("switches every request to another database the backend serves", async () => {
        routes["GET /api/admin/db/insights/sources"] = () => ({
            sources: [{ key: "(default)", isDefault: true }, { key: "analytics", isDefault: false }]
        });
        routes["GET /api/admin/db/insights/overview?source=analytics"] = () => ({ ...OVERVIEW, database: "analytics" });
        routes["GET /api/admin/db/insights/advisors?source=analytics"] = () => ({ findings: [], errors: [], degraded: [] });
        renderAt("");
        await screen.findByText("public.notes has RLS disabled");

        const picker = await screen.findByDisplayValue("Default database");
        fireEvent.change(picker, { target: { value: "analytics" } });

        expect(await screen.findByText("No findings. Nothing here needs attention.")).toBeTruthy();
        expect(screen.queryByText("public.notes has RLS disabled")).toBeNull();
        expect(calls.some(c => c.path === "/api/admin/db/insights/overview?source=analytics")).toBe(true);
        expect(await screen.findByText("Health, advice and objects of analytics")).toBeTruthy();
    });

    it("filters the advisors by category", async () => {
        renderAt("");
        await screen.findByText("public.notes has RLS disabled");
        fireEvent.click(screen.getByText("Performance (1)"));
        expect(screen.queryByText("public.notes has RLS disabled")).toBeNull();
        expect(screen.getByText(/books_author_id_fkey/)).toBeTruthy();
    });

    it("offers to install pg_stat_statements when the server ships it", async () => {
        routes["POST /api/admin/db/catalog/extensions/pg_stat_statements"] = () => ({ dryRun: false, statements: [] });
        renderAt("section=queries");

        fireEvent.click(await screen.findByText("Install pg_stat_statements"));
        await waitFor(() => expect(calls.some(c => c.method === "POST" && c.path === "/api/admin/db/catalog/extensions/pg_stat_statements")).toBe(true));
    });

    it("refreshes the activity every five seconds until paused", async () => {
        jest.useFakeTimers();
        renderAt("section=activity");
        const reads = () => calls.filter(c => c.path === "/api/admin/db/insights/activity").length;

        expect(await screen.findByText("UPDATE accounts SET balance = balance - 1")).toBeTruthy();
        expect(screen.getByText("Blocked by 4100")).toBeTruthy();
        expect(screen.getByText("12.5 s")).toBeTruthy();
        expect(reads()).toBe(1);

        await act(async () => { jest.advanceTimersByTime(ACTIVITY_REFRESH_MS); });
        await waitFor(() => expect(reads()).toBe(2));

        fireEvent.click(screen.getByLabelText("Pause refreshing"));
        await waitFor(() => expect(screen.getByText("Paused. The list is not refreshing.")).toBeTruthy());
        const afterPause = reads();
        await act(async () => { jest.advanceTimersByTime(ACTIVITY_REFRESH_MS * 3); });
        expect(reads()).toBe(afterPause);
    });

    it("terminates a session only after showing the SQL the server will run", async () => {
        renderAt("section=activity");
        await screen.findByText("UPDATE accounts SET balance = balance - 1");

        fireEvent.click(screen.getByLabelText("Terminate session 4242"));
        expect(await screen.findByText("SELECT pg_terminate_backend(4242);")).toBeTruthy();
        const terminateCalls = () => calls.filter(c => c.path === "/api/admin/db/insights/activity/4242/terminate");
        expect(terminateCalls()).toEqual([
            { method: "POST", path: "/api/admin/db/insights/activity/4242/terminate", body: { dryRun: true } }
        ]);

        // The dialog's confirm button carries the action's own label.
        const confirms = screen.getAllByText("Terminate session");
        fireEvent.click(confirms[confirms.length - 1]);
        await waitFor(() => expect(terminateCalls()).toHaveLength(2));
        expect(terminateCalls()[1].body).toEqual({});
        await waitFor(() => expect(snackbarOpen).toHaveBeenCalledWith({ type: "success", message: "Terminated session 4242" }));
    });
});
