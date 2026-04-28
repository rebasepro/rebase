import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { createCron } from "./cron";
import type { Transport } from "./transport";

// ─── Mock Transport ─────────────────────────────────────────────────

function createMockTransport(): Transport & { request: jest.Mock } {
    const requestMock = jest.fn<(...args: any[]) => Promise<any>>();

    return {
        request: requestMock,
        setToken: jest.fn(),
        setAuthTokenGetter: jest.fn(),
        setOnUnauthorized: jest.fn(),
        get baseUrl() { return "http://test"; },
        get apiPath() { return "/api"; },
        get fetchFn() { return globalThis.fetch; },
        getHeaders: () => ({}),
        resolveToken: async () => null,
    };
}

// ─── Tests ──────────────────────────────────────────────────────────

describe("createCron", () => {
    let transport: ReturnType<typeof createMockTransport>;

    beforeEach(() => {
        transport = createMockTransport();
    });

    describe("listJobs", () => {
        it("calls GET /cron", async () => {
            (transport.request.mockResolvedValue as any)({ jobs: [] });
            const cron = createCron(transport);

            const result = await cron.listJobs();

            expect(transport.request).toHaveBeenCalledWith("/cron", { method: "GET" });
            expect(result).toEqual({ jobs: [] });
        });
    });

    describe("getJob", () => {
        it("calls GET /cron/:id with encoded ID", async () => {
            (transport.request.mockResolvedValue as any)({ job: { id: "my-job" } });
            const cron = createCron(transport);

            await cron.getJob("my-job");

            expect(transport.request).toHaveBeenCalledWith("/cron/my-job", { method: "GET" });
        });

        it("encodes special characters in job ID", async () => {
            (transport.request.mockResolvedValue as any)({ job: {} });
            const cron = createCron(transport);

            await cron.getJob("job with spaces");

            expect(transport.request).toHaveBeenCalledWith(
                "/cron/job%20with%20spaces",
                { method: "GET" }
            );
        });
    });

    describe("triggerJob", () => {
        it("calls POST /cron/:id/trigger", async () => {
            (transport.request.mockResolvedValue as any)({ log: {}, job: {} });
            const cron = createCron(transport);

            await cron.triggerJob("my-job");

            expect(transport.request).toHaveBeenCalledWith(
                "/cron/my-job/trigger",
                { method: "POST" }
            );
        });
    });

    describe("getJobLogs", () => {
        it("calls GET /cron/:id/logs without limit", async () => {
            (transport.request.mockResolvedValue as any)({ logs: [] });
            const cron = createCron(transport);

            await cron.getJobLogs("my-job");

            expect(transport.request).toHaveBeenCalledWith(
                "/cron/my-job/logs",
                { method: "GET" }
            );
        });

        it("appends limit query param when provided", async () => {
            (transport.request.mockResolvedValue as any)({ logs: [] });
            const cron = createCron(transport);

            await cron.getJobLogs("my-job", { limit: 5 });

            expect(transport.request).toHaveBeenCalledWith(
                "/cron/my-job/logs?limit=5",
                { method: "GET" }
            );
        });
    });

    describe("toggleJob", () => {
        it("calls PUT /cron/:id with enabled=true", async () => {
            (transport.request.mockResolvedValue as any)({ job: {} });
            const cron = createCron(transport);

            await cron.toggleJob("my-job", true);

            expect(transport.request).toHaveBeenCalledWith(
                "/cron/my-job",
                {
                    method: "PUT",
                    body: JSON.stringify({ enabled: true }),
                }
            );
        });

        it("calls PUT /cron/:id with enabled=false", async () => {
            (transport.request.mockResolvedValue as any)({ job: {} });
            const cron = createCron(transport);

            await cron.toggleJob("my-job", false);

            expect(transport.request).toHaveBeenCalledWith(
                "/cron/my-job",
                {
                    method: "PUT",
                    body: JSON.stringify({ enabled: false }),
                }
            );
        });
    });

    describe("custom cronPath", () => {
        it("uses custom path prefix", async () => {
            (transport.request.mockResolvedValue as any)({ jobs: [] });
            const cron = createCron(transport, { cronPath: "/admin/scheduled" });

            await cron.listJobs();

            expect(transport.request).toHaveBeenCalledWith(
                "/admin/scheduled",
                { method: "GET" }
            );
        });

        it("custom path applies to all methods", async () => {
            (transport.request.mockResolvedValue as any)({});
            const cron = createCron(transport, { cronPath: "/v2/cron" });

            await cron.getJob("x");
            expect(transport.request).toHaveBeenCalledWith("/v2/cron/x", { method: "GET" });

            await cron.triggerJob("x");
            expect(transport.request).toHaveBeenCalledWith("/v2/cron/x/trigger", { method: "POST" });
        });
    });
});
