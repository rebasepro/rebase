/**
 * `useUiPreferences`: the workspace's and the user's UI preferences, from
 * `/api/admin/ui-config`, with the browser as the user's store when the
 * server keeps none.
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import type { UserConfigurationPersistence } from "@rebasepro/cms-types";
import type { UiTablePreferences } from "@rebasepro/types";

import { useUiPreferences } from "../src/hooks/useUiPreferences";
import { jsonResponse } from "../../cms/test/helpers/http";

type Call = { url: string; method: string; body?: unknown };

/** A complete `Response` (jsdom has no Fetch API), from the CMS's test helper. */
const respond = (body: unknown, status = 200): Response => jsonResponse(body, { status });

function server(answer: unknown, status = 200) {
    const calls: Call[] = [];
    global.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        calls.push({ url, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
        if ((init?.method ?? "GET") === "GET") return respond(answer, status);
        return respond({ ok: true });
    });
    return calls;
}

function localStore(): UserConfigurationPersistence & { saved: [string, UiTablePreferences][] } {
    const saved: [string, UiTablePreferences][] = [];
    return {
        saved,
        getTablePreferences: () => ({ defaultSize: "xs" }),
        saveTablePreferences: (slug, delta) => { saved.push([slug, delta]); },
        recentlyVisitedPaths: [],
        setRecentlyVisitedPaths: () => undefined,
        favouritePaths: [],
        setFavouritePaths: () => undefined,
        collapsedGroups: [],
        setCollapsedGroups: () => undefined
    };
}

const transport = { baseUrl: "https://api.example.com", apiPath: "/api" };
const ANSWER = {
    workspace: { tables: { posts: { name: "Articles" }, bad: { columns: {} } } },
    user: { tables: { posts: { defaultViewMode: "kanban" } } },
    workspaceTarget: "database",
    userTarget: "database",
    canWriteWorkspace: true
};

beforeEach(() => jest.useRealTimers());

describe("useUiPreferences", () => {
    it("reads the workspace's and the user's preferences, keeping only valid ones", async () => {
        server(ANSWER);
        const local = localStore();
        const { result } = renderHook(() => useUiPreferences({ transport, enabled: true, local, getAuthToken: async () => "t" }));
        await waitFor(() => expect(result.current.controller.loading).toBe(false));
        expect(result.current.controller.workspace).toEqual({ tables: { posts: { name: "Articles" } } });
        expect(result.current.controller.workspaceTarget).toBe("database");
        expect(result.current.controller.canWriteWorkspace).toBe(true);
        expect(result.current.userPersistence?.getTablePreferences("posts")).toEqual({ defaultViewMode: "kanban" });
        expect(jest.mocked(global.fetch).mock.calls[0][1]).toMatchObject({ headers: { Authorization: "Bearer t" } });
    });

    it("writes the workspace's preferences with PUT and shows them at once", async () => {
        const calls = server(ANSWER);
        const { result } = renderHook(() => useUiPreferences({ transport, enabled: true, local: localStore() }));
        await waitFor(() => expect(result.current.controller.loading).toBe(false));
        await act(async () => { await result.current.controller.saveWorkspace("posts", { icon: "Article" }); });
        expect(calls.find(c => c.method === "PUT")).toEqual({
            url: "https://api.example.com/api/admin/ui-config/workspace/posts",
            method: "PUT",
            body: { preferences: { icon: "Article" } }
        });
        expect(result.current.controller.workspace.tables.posts).toEqual({ name: "Articles", icon: "Article" });
    });

    it("gathers a user's writes to one table and sends them once", async () => {
        const calls = server(ANSWER);
        const { result } = renderHook(() => useUiPreferences({ transport, enabled: true, local: localStore(), debounceMs: 20 }));
        await waitFor(() => expect(result.current.controller.loading).toBe(false));
        act(() => {
            result.current.userPersistence?.saveTablePreferences("posts", { fields: { title: { columnWidth: 200 } } });
            result.current.userPersistence?.saveTablePreferences("posts", { fields: { title: { columnWidth: 240 } } });
        });
        expect(result.current.userPersistence?.getTablePreferences("posts")).toEqual({ defaultViewMode: "kanban", fields: { title: { columnWidth: 240 } } });
        await waitFor(() => expect(calls.filter(c => c.method === "PUT")).toHaveLength(1));
        expect(calls.find(c => c.method === "PUT")).toEqual({
            url: "https://api.example.com/api/admin/ui-config/user/posts",
            method: "PUT",
            body: { preferences: { fields: { title: { columnWidth: 240 } } } }
        });
    });

    it("keeps the user's preferences in the browser when the server keeps none", async () => {
        server({ ...ANSWER, userTarget: "none" });
        const local = localStore();
        const { result } = renderHook(() => useUiPreferences({ transport, enabled: true, local }));
        await waitFor(() => expect(result.current.controller.loading).toBe(false));
        expect(result.current.userPersistence).toBe(local);
    });

    it("asks nothing when disabled (signed out), and refuses workspace writes", async () => {
        const calls = server(ANSWER);
        const local = localStore();
        const { result } = renderHook(() => useUiPreferences({ transport, enabled: false, local }));
        expect(result.current.userPersistence).toBe(local);
        expect(calls).toEqual([]);
        await expect(result.current.controller.saveWorkspace("posts", { name: "x" })).rejects.toThrow(/stores no UI preferences/);
    });

    it("runs on an older backend without the routes", async () => {
        server({ error: "not found" }, 404);
        const local = localStore();
        const { result } = renderHook(() => useUiPreferences({ transport, enabled: true, local }));
        await waitFor(() => expect(result.current.controller.loading).toBe(false));
        expect(result.current.controller.workspaceTarget).toBe("none");
        expect(result.current.userPersistence).toBe(local);
    });
});
