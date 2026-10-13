import { renderHook, waitFor } from "@testing-library/react";

import { useLocalCollectionsConfigController } from "../../src/collection_editor/useLocalCollectionsConfigController";

/**
 * Whether collections are editable is the backend's answer, not the bundle's.
 *
 * This hook used to decide it from `process.env.NODE_ENV` — the *frontend's*
 * build mode. The routes it writes to are mounted or not by a different process
 * entirely, on its own `NODE_ENV`, its `collectionsDir`, whether its collections
 * were introspected and whether `ts-morph` is installed. Whenever those two
 * disagreed — a dev frontend against a deployed API is the everyday case — the
 * editor offered "Add collection", "Update collection" and the RLS policy
 * editor, and every save came back `404 Not Found` in a snackbar.
 */

const STATUS_URL = "https://api.example.com/api/admin/schema-editor/status";

function mockStatus(status: number, body: unknown) {
    const fetchMock = jest.fn(async (url: string) => {
        expect(url).toBe(STATUS_URL);
        return {
            ok: status >= 200 && status < 300,
            status,
            json: async () => body,
            text: async () => JSON.stringify(body)
        } as unknown as Response;
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
}

const client = { baseUrl: "https://api.example.com", apiPath: "/api" };

afterEach(() => {
    jest.restoreAllMocks();
});

describe("collection editing follows the backend, not the bundle", () => {
    it("is editable when the backend says its schema editor is on", async () => {
        mockStatus(200, { enabled: true });

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, []));

        await waitFor(() => expect(result.current.readOnly).toBe(false));
    });

    it("is read-only when the backend says it is off, and repeats its reason", async () => {
        mockStatus(200, {
            enabled: false,
            code: "SCHEMA_EDITOR_PRODUCTION",
            reason: "The schema editor is off under NODE_ENV=production."
        });

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, []));

        await waitFor(() => expect(result.current.readOnly).toBe(true));
        expect(result.current.readOnlyReason).toBe("The schema editor is off under NODE_ENV=production.");
    });

    it("is read-only when the caller is not an admin, and says so in the backend's words", async () => {
        mockStatus(403, { error: { code: "FORBIDDEN", message: "Admin role required." } });

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, []));

        await waitFor(() => expect(result.current.readOnly).toBe(true));
        expect(result.current.readOnlyReason).toBe("Admin role required.");
    });

    it("falls back to the build-mode guess against a backend too old to have the endpoint", async () => {
        // Not a regression on those backends: it is exactly what this hook did
        // before, and locking the editor for someone whose editor works would be
        // a worse answer than an imperfect guess.
        mockStatus(404, {});

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, []));

        // NODE_ENV is "test" under jest, so the guess is "not production".
        await waitFor(() => expect(result.current.readOnly).toBe(false));
    });

    it("does not ask at all when the developer has already forced read-only", async () => {
        const fetchMock = mockStatus(200, { enabled: true });

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, [], { readOnly: true }));

        expect(result.current.readOnly).toBe(true);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("respects an explicit `readOnly: false` over the backend's answer", async () => {
        mockStatus(200, { enabled: false, reason: "off" });

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, [], { readOnly: false }));

        await waitFor(() => expect(result.current.readOnly).toBe(false));
    });

    it("asks with the admin's token — the answer depends on who is asking", async () => {
        const fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ enabled: true }),
            text: async () => "{}"
        } as unknown as Response));
        global.fetch = fetchMock as unknown as typeof fetch;

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, [], {
            getAuthToken: async () => "token-123"
        }));

        await waitFor(() => expect(result.current.readOnly).toBe(false));
        expect(fetchMock).toHaveBeenCalledWith(STATUS_URL, {
            headers: { Authorization: "Bearer token-123" }
        });
    });

    it("asks the backend's own basePath, not a hardcoded /api", async () => {
        const fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ enabled: true }),
            text: async () => "{}"
        } as unknown as Response));
        global.fetch = fetchMock as unknown as typeof fetch;

        renderHook(() => useLocalCollectionsConfigController(
            { baseUrl: "https://api.example.com", apiPath: "/backend" },
            []
        ));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            "https://api.example.com/backend/admin/schema-editor/status",
            expect.anything()
        ));
    });

    it("re-asks when a different user signs in", async () => {
        const fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ enabled: true }),
            text: async () => "{}"
        } as unknown as Response));
        global.fetch = fetchMock as unknown as typeof fetch;

        // Counted per URL rather than in total: the controller now probes two
        // surfaces — the source-only editor and live schema editing — and a
        // bare call count would pass or fail on how many features exist rather
        // than on whether this one re-asks.
        const probes = () => fetchMock.mock.calls
            .filter(([url]) => String(url).endsWith("/schema-editor/status"))
            .length;

        const { rerender } = renderHook(
            ({ authKey }: { authKey: string | null }) =>
                useLocalCollectionsConfigController(client, [], { authKey }),
            { initialProps: { authKey: null as string | null } }
        );

        await waitFor(() => expect(probes()).toBe(1));

        rerender({ authKey: "user-1" });

        await waitFor(() => expect(probes()).toBe(2));
    });

    it("asks live schema editing whether it is available, too", async () => {
        const fetchMock = jest.fn(async () => ({
            ok: true,
            status: 200,
            json: async () => ({ enabled: false, canPlan: false }),
            text: async () => "{}"
        } as unknown as Response));
        global.fetch = fetchMock as unknown as typeof fetch;

        renderHook(() => useLocalCollectionsConfigController(
            { baseUrl: "https://api.example.com", apiPath: "/backend" },
            []
        ));

        await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
            "https://api.example.com/backend/admin/schema/status",
            expect.anything()
        ));
    });

    it("is editable on a bundle with live schema editing, though its source-only editor is off", async () => {
        // A bundle boots with `schemaEditor: false`, so the source-only editor
        // says SCHEMA_EDITOR_DISABLED — and with a repository configured, live
        // editing is on. Every write goes through live editing when it is, so
        // the source-only answer must not lock the editor.
        global.fetch = jest.fn(async (url: string) => {
            const body = String(url).endsWith("/schema-editor/status")
                ? { enabled: false, code: "SCHEMA_EDITOR_DISABLED", reason: "turned off for this server" }
                : { enabled: true, canPlan: true, canApply: true, repository: "acme/shop", branch: "main" };
            return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
        }) as unknown as typeof fetch;

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, []));

        // Both at once: before either answer arrives the build-mode guess
        // already says "editable", with the generic reason beside it.
        await waitFor(() => {
            expect(result.current.readOnly).toBe(false);
            expect(result.current.readOnlyReason).toBeUndefined();
        });
    });

    it("stays read-only on a bundle whose live schema editing is off too", async () => {
        global.fetch = jest.fn(async (url: string) => {
            const body = String(url).endsWith("/schema-editor/status")
                ? { enabled: false, code: "SCHEMA_EDITOR_DISABLED", reason: "turned off for this server" }
                : { enabled: false, canPlan: true, code: "SCHEMA_EDITOR_DISABLED", reason: "turned off for this server" };
            return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
        }) as unknown as typeof fetch;

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, []));

        await waitFor(() => expect(result.current.readOnly).toBe(true));
        expect(result.current.readOnlyReason).toBe("turned off for this server");
    });

    it("stays usable when the backend is unreachable", async () => {
        global.fetch = jest.fn(async () => {
            throw new TypeError("Failed to fetch");
        }) as unknown as typeof fetch;

        const { result } = renderHook(() => useLocalCollectionsConfigController(client, []));

        await waitFor(() => expect(result.current.readOnly).toBe(false));
    });
});
