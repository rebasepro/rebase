import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { createCron } from "./cron";
import type { Transport } from "./transport";
import { createMockTransport as createSharedMockTransport, type RequestAnswer } from "../test/support/fake-transport";

// ─── Mock Transport ─────────────────────────────────────────────────

const createMockTransport = () => createSharedMockTransport({ baseUrl: "http://test" });

// ─── Tests ──────────────────────────────────────────────────────────

describe("createCron", () => {
    let transport: Transport;
    let mockRequest: jest.Mock<RequestAnswer>;

    beforeEach(() => {
        ({ transport, mockRequest } = createMockTransport());
    });

    describe("listJobs", () => {
        it("calls GET /cron", async () => {
            mockRequest.mockResolvedValue({ jobs: [] });
            const cron = createCron(transport);

            const result = await cron.listJobs();

            expect(mockRequest).toHaveBeenCalledWith("/admin/cron", { method: "GET" });
            expect(result).toEqual({ jobs: [] });
        });
    });

    describe("getJob", () => {
        it("calls GET /cron/:id with encoded ID", async () => {
            mockRequest.mockResolvedValue({ job: { id: "my-job" } });
            const cron = createCron(transport);

            await cron.getJob("my-job");

            expect(mockRequest).toHaveBeenCalledWith("/admin/cron/my-job", { method: "GET" });
        });

        it("encodes special characters in job ID", async () => {
            mockRequest.mockResolvedValue({ job: {} });
            const cron = createCron(transport);

            await cron.getJob("job with spaces");

            expect(mockRequest).toHaveBeenCalledWith(
                "/admin/cron/job%20with%20spaces",
                { method: "GET" }
            );
        });
    });

    describe("triggerJob", () => {
        it("calls POST /cron/:id/trigger", async () => {
            mockRequest.mockResolvedValue({ log: {},
job: {} });
            const cron = createCron(transport);

            await cron.triggerJob("my-job");

            expect(mockRequest).toHaveBeenCalledWith(
                "/admin/cron/my-job/trigger",
                { method: "POST" }
            );
        });

        it("{ async: true } asks for ?async=1 and answers with the start", async () => {
            mockRequest.mockResolvedValue({ accepted: true, startedAt: "2026-10-13T00:00:00.000Z", job: {} });
            const cron = createCron(transport);

            const started = await cron.triggerJob("my job", { async: true });

            expect(mockRequest).toHaveBeenCalledWith(
                "/admin/cron/my%20job/trigger?async=1",
                { method: "POST" }
            );
            expect(started.startedAt).toBe("2026-10-13T00:00:00.000Z");
        });

        it("{ async: false } is the synchronous call", async () => {
            mockRequest.mockResolvedValue({ log: {}, job: {} });
            const cron = createCron(transport);

            await cron.triggerJob("my-job", { async: false });

            expect(mockRequest).toHaveBeenCalledWith("/admin/cron/my-job/trigger", { method: "POST" });
        });
    });

    describe("getJobLogs", () => {
        it("calls GET /cron/:id/logs without limit", async () => {
            mockRequest.mockResolvedValue({ logs: [] });
            const cron = createCron(transport);

            await cron.getJobLogs("my-job");

            expect(mockRequest).toHaveBeenCalledWith(
                "/admin/cron/my-job/logs",
                { method: "GET" }
            );
        });

        it("appends limit query param when provided", async () => {
            mockRequest.mockResolvedValue({ logs: [] });
            const cron = createCron(transport);

            await cron.getJobLogs("my-job", { limit: 5 });

            expect(mockRequest).toHaveBeenCalledWith(
                "/admin/cron/my-job/logs?limit=5",
                { method: "GET" }
            );
        });
    });

    describe("toggleJob", () => {
        it("calls PUT /cron/:id with enabled=true", async () => {
            mockRequest.mockResolvedValue({ job: {} });
            const cron = createCron(transport);

            await cron.toggleJob("my-job", true);

            expect(mockRequest).toHaveBeenCalledWith(
                "/admin/cron/my-job",
                {
                    method: "PUT",
                    body: JSON.stringify({ enabled: true })
                }
            );
        });

        it("calls PUT /cron/:id with enabled=false", async () => {
            mockRequest.mockResolvedValue({ job: {} });
            const cron = createCron(transport);

            await cron.toggleJob("my-job", false);

            expect(mockRequest).toHaveBeenCalledWith(
                "/admin/cron/my-job",
                {
                    method: "PUT",
                    body: JSON.stringify({ enabled: false })
                }
            );
        });
    });

    describe("custom cronPath", () => {
        it("uses custom path prefix", async () => {
            mockRequest.mockResolvedValue({ jobs: [] });
            const cron = createCron(transport, { cronPath: "/admin/scheduled" });

            await cron.listJobs();

            expect(mockRequest).toHaveBeenCalledWith(
                "/admin/scheduled",
                { method: "GET" }
            );
        });

        it("custom path applies to all methods", async () => {
            mockRequest.mockResolvedValue({});
            const cron = createCron(transport, { cronPath: "/v2/cron" });

            await cron.getJob("x");
            expect(mockRequest).toHaveBeenCalledWith("/v2/cron/x", { method: "GET" });

            await cron.triggerJob("x");
            expect(mockRequest).toHaveBeenCalledWith("/v2/cron/x/trigger", { method: "POST" });
        });
    });
});
