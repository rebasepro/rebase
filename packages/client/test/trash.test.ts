import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { createCollectionClient } from "../src/collection";
import { OfflineManager } from "../src/offline";
import { MemoryOfflineStore } from "../src/offline-store";
import { RebaseApiError, Transport } from "../src/transport";

/**
 * `client.data.<slug>.trash`: the SDK's door to what soft delete serves over
 * REST — `?deleted=only` on a listing and a count, a restore that is the update
 * setting the stamp back to `null`, and `?hard=true` on a delete.
 *
 * Every assertion is about the request the client makes, because that is the
 * seam a server capability without a client door hides behind.
 */

type Row = Record<string, unknown>;

function createMockTransport(): { transport: Transport; mockRequest: jest.Mock<Transport["request"]> } {
    const mockRequest = jest.fn() as jest.Mock<Transport["request"]>;
    const transport: Transport = {
        request: mockRequest,
        baseUrl: "http://localhost",
        apiPath: "/api",
        fetchFn: globalThis.fetch,
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        getHeaders: jest.fn().mockReturnValue({}),
        resolveToken: jest.fn().mockResolvedValue(null)
    } as unknown as Transport;
    return { transport, mockRequest };
}

const page = (data: Row[]) => ({ data, meta: { total: data.length, limit: 20, offset: 0, hasMore: false } });

describe("client.data.<slug>.trash", () => {
    let mockRequest: jest.Mock<Transport["request"]>;
    let client: ReturnType<typeof createCollectionClient>;

    beforeEach(() => {
        let transport: Transport;
        ({ transport, mockRequest } = createMockTransport());
        client = createCollectionClient(transport, "invoices");
    });

    const call = (n = 0) => mockRequest.mock.calls[n] as [string, RequestInit & { headers?: Record<string, string> }];

    it("find() lists the trashed rows with ?deleted=only, beside the find's own parameters", async () => {
        mockRequest.mockResolvedValue(page([{ id: 7 }]) as never);

        const result = await client.trash.find({ limit: 5, where: { status: ["==", "paid"] } });

        expect(result.data).toEqual([{ id: 7 }]);
        const [path, init] = call();
        expect(init.method).toBe("GET");
        expect(path.startsWith("/data/invoices?")).toBe(true);
        const qs = new URLSearchParams(path.slice(path.indexOf("?") + 1));
        expect(qs.get("deleted")).toBe("only");
        expect(qs.get("limit")).toBe("5");
        expect(qs.get("status")).toBe("eq.paid");
    });

    it("an ordinary find() never asks for deleted rows", async () => {
        mockRequest.mockResolvedValue(page([]) as never);

        await client.find({ limit: 5 });
        await client.count();

        expect(call(0)[0]).not.toContain("deleted");
        expect(call(1)[0]).not.toContain("deleted");
    });

    it("a trash find too long for a URL carries deleted in the POST body", async () => {
        mockRequest.mockResolvedValue(page([]) as never);

        await client.trash.find({ where: { ref: ["in", Array.from({ length: 900 }, (_, i) => `ref-${i}`)] } });

        const [path, init] = call();
        expect(path).toBe("/data/invoices/query");
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toMatchObject({ deleted: "only" });
    });

    it("count() counts the trash with ?deleted=only, and is never merged with a live count", async () => {
        mockRequest.mockImplementation((async (path: string) =>
            ({ count: path.includes("deleted=only") ? 2 : 40 })) as never);

        const [trashed, live] = await Promise.all([client.trash.count(), client.count()]);

        expect(trashed).toBe(2);
        expect(live).toBe(40);
        expect(call(0)[0]).toBe("/data/invoices/count?deleted=only");
    });

    it("restore() is the PATCH that sets deletedAt back to null", async () => {
        mockRequest.mockResolvedValue({ id: 7, deletedAt: null } as never);

        const row = await client.trash.restore(7, { idempotencyKey: "k1" });

        expect(row).toEqual({ id: 7, deletedAt: null });
        const [path, init] = call();
        expect(path).toBe("/data/invoices/7");
        expect(init.method).toBe("PATCH");
        expect(JSON.parse(String(init.body))).toEqual({ deletedAt: null });
        expect(init.headers).toMatchObject({ "Idempotency-Key": "k1" });
    });

    it("restore() names the collection's own soft-delete field when told it", async () => {
        mockRequest.mockResolvedValue({ id: 7 } as never);

        await client.trash.restore(7, { field: "archivedAt" });

        expect(JSON.parse(String(call()[1].body))).toEqual({ archivedAt: null });
    });

    it("restoreMany() restores every row in one bulk PATCH", async () => {
        mockRequest.mockResolvedValue({ data: [{ id: 1 }, { id: 2 }] } as never);

        const rows = await client.trash.restoreMany([1, 2]);

        expect(rows).toEqual([{ id: 1 }, { id: 2 }]);
        const [path, init] = call();
        expect(path).toBe("/data/invoices/bulk");
        expect(init.method).toBe("PATCH");
        expect(JSON.parse(String(init.body))).toEqual({
            updates: [{ id: 1, data: { deletedAt: null } }, { id: 2, data: { deletedAt: null } }]
        });
    });

    it("purge() is a DELETE with ?hard=true, carrying the write's headers", async () => {
        mockRequest.mockResolvedValue(undefined as never);

        await client.trash.purge("a/b", { ifMatch: "\"v1\"" });

        const [path, init] = call();
        expect(path).toBe("/data/invoices/a%2Fb?hard=true");
        expect(init.method).toBe("DELETE");
        expect(init.headers).toMatchObject({ "If-Match": "\"v1\"" });
    });

    it("an ordinary delete() stays a soft delete", async () => {
        mockRequest.mockResolvedValue(undefined as never);

        await client.delete(7);

        expect(call()[0]).toBe("/data/invoices/7");
    });

    it("purgeMany() is the bulk delete with ?hard=true, and sends nothing for no ids", async () => {
        mockRequest.mockResolvedValue(undefined as never);

        await client.trash.purgeMany([]);
        expect(mockRequest).not.toHaveBeenCalled();

        await client.trash.purgeMany([1, 2]);
        const [path, init] = call();
        expect(path).toBe("/data/invoices/bulk/delete?hard=true");
        expect(init.method).toBe("POST");
        expect(JSON.parse(String(init.body))).toEqual({ ids: [1, 2] });
    });
});

/**
 * The trash on an offline client. The local database holds live rows only, so
 * nothing in the trash is cached, read from it or queued — and what the server
 * answers about a restore or a purge reaches it.
 */
describe("client.data.<slug>.trash with offline enabled", () => {
    const networkDown = () => new RebaseApiError("Could not reach the server: fetch failed", {
        status: 0,
        code: "NETWORK_ERROR",
        cause: new TypeError("fetch failed")
    });

    function setup() {
        const { transport, mockRequest } = createMockTransport();
        const manager = new OfflineManager(
            { store: new MemoryOfflineStore(), syncIntervalMs: 0 },
            (slug) => createCollectionClient(transport, slug)
        );
        const invoices = manager.wrap("invoices", createCollectionClient<Row>(transport, "invoices"));
        return { manager, invoices, mockRequest };
    }

    it("a trash read is never kept: the live find answered offline does not show trashed rows", async () => {
        const { invoices, mockRequest } = setup();
        mockRequest.mockImplementation((async (path: string) => path.includes("deleted=only")
            ? page([{ id: 9, deletedAt: "2026-10-01T00:00:00.000Z" }])
            : page([{ id: 1 }])) as never);

        await invoices.find();
        expect((await invoices.trash.find()).data).toEqual([{ id: 9, deletedAt: "2026-10-01T00:00:00.000Z" }]);

        mockRequest.mockRejectedValue(networkDown() as never);
        const offline = await invoices.find();
        expect(offline.data.map((r) => r.id)).toEqual([1]);
        await expect(invoices.findById(9)).rejects.toMatchObject({ code: "OFFLINE" });
    });

    it("trash reads and writes refuse with OFFLINE when the server cannot be reached, and queue nothing", async () => {
        const { manager, invoices, mockRequest } = setup();
        mockRequest.mockRejectedValue(networkDown() as never);

        await expect(invoices.trash.find()).rejects.toMatchObject({ code: "OFFLINE" });
        await expect(invoices.trash.count()).rejects.toMatchObject({ code: "OFFLINE" });
        await expect(invoices.trash.restore(9)).rejects.toMatchObject({ code: "OFFLINE" });
        await expect(invoices.trash.purge(9)).rejects.toMatchObject({ code: "OFFLINE" });

        expect(await manager.api.pending()).toEqual([]);
    });

    it("a restored row joins the local database, and a purged one leaves it", async () => {
        const { invoices, mockRequest } = setup();
        mockRequest.mockImplementation((async (path: string, init?: RequestInit) => {
            if (init?.method === "PATCH") return { id: 9, ref: "INV-9", deletedAt: null };
            if (init?.method === "DELETE") return undefined;
            return page([{ id: 1 }]);
        }) as never);
        await invoices.find();

        await invoices.trash.restore(9);
        await invoices.trash.purge(1);

        mockRequest.mockRejectedValue(networkDown() as never);
        expect(await invoices.findById(9)).toEqual({ id: 9, ref: "INV-9", deletedAt: null });
        expect((await invoices.find()).data.map((r) => r.id)).not.toContain(1);
        // Purged, and the server said so: "not there" is an answer offline.
        expect(await invoices.findById(1)).toBeUndefined();
    });

    it("a purge waits for the row's queued delete instead of overtaking it", async () => {
        const { invoices, mockRequest } = setup();
        mockRequest.mockResolvedValue(page([{ id: 1 }]) as never);
        await invoices.find();

        // Deleted offline: queued.
        mockRequest.mockRejectedValue(networkDown() as never);
        await invoices.delete(1);

        const sent: string[] = [];
        mockRequest.mockImplementation((async (path: string, init?: RequestInit) => {
            sent.push(`${init?.method} ${path}`);
            return undefined;
        }) as never);
        await invoices.trash.purge(1);

        expect(sent).toEqual(["DELETE /data/invoices/1", "DELETE /data/invoices/1?hard=true"]);
    });
});
