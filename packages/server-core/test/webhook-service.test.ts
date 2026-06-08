import { WebhookDispatcher, WebhookConfig } from "../src/services/webhook-service";
import { createHmac } from "crypto";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
    mockFetch.mockReset();
});

function makeWebhook(overrides: Partial<WebhookConfig> = {}): WebhookConfig {
    return {
        id: "wh_1",
        url: "https://example.com/webhook",
        events: ["INSERT", "UPDATE", "DELETE"],
        table: "users",
        enabled: true,
        ...overrides
    };
}

describe("WebhookDispatcher", () => {
    describe("setWebhooks", () => {
        it("filters out disabled webhooks", () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([
                makeWebhook({ id: "wh_1", enabled: true }),
                makeWebhook({ id: "wh_2", enabled: false }),
                makeWebhook({ id: "wh_3", enabled: true })
            ]);

            // Disabled webhook should not trigger
            mockFetch.mockResolvedValue({
                status: 200,
                text: () => Promise.resolve("OK")
            });

            // This should only match enabled webhooks
        });
    });

    describe("onEntityChange", () => {
        it("returns empty array when no webhooks match", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook({ table: "posts" })]);

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1", name: "Test" }
            );
            expect(results).toEqual([]);
        });

        it("matches webhooks by table AND event", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook({ table: "users", events: ["INSERT"] })]);

            mockFetch.mockResolvedValue({
                status: 200,
                text: () => Promise.resolve("OK")
            });

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );
            expect(results).toHaveLength(1);
            expect(results[0].success).toBe(true);
        });

        it("does not match different table", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook({ table: "users" })]);

            const results = await dispatcher.onEntityChange(
                "posts", "INSERT", "id_1", { id: "id_1" }
            );
            expect(results).toEqual([]);
        });

        it("does not match different event", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook({ events: ["INSERT"] })]);

            const results = await dispatcher.onEntityChange(
                "users", "DELETE", "id_1", { id: "id_1" }
            );
            expect(results).toEqual([]);
        });

        it("includes HMAC signature when webhook has secret", async () => {
            const secret = "my-webhook-secret";
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook({ secret })]);

            mockFetch.mockResolvedValue({
                status: 200,
                text: () => Promise.resolve("OK")
            });

            await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            expect(mockFetch).toHaveBeenCalledTimes(1);
            const [, options] = mockFetch.mock.calls[0];
            const headers = options.headers as Record<string, string>;
            expect(headers["X-Webhook-Signature"]).toBeDefined();
            expect(headers["X-Webhook-Signature"]).toMatch(/^sha256=/);

            // Verify the signature is correct
            const body = options.body as string;
            const expectedSig = createHmac("sha256", secret).update(body).digest("hex");
            expect(headers["X-Webhook-Signature"]).toBe(`sha256=${expectedSig}`);
        });

        it("does not include signature header when no secret", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook({ secret: undefined })]);

            mockFetch.mockResolvedValue({
                status: 200,
                text: () => Promise.resolve("OK")
            });

            await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            const [, options] = mockFetch.mock.calls[0];
            const headers = options.headers as Record<string, string>;
            expect(headers["X-Webhook-Signature"]).toBeUndefined();
        });

        it("payload includes type, table, record, and timestamp", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            mockFetch.mockResolvedValue({
                status: 200,
                text: () => Promise.resolve("OK")
            });

            const entity = { id: "id_1", name: "Test User" };
            await dispatcher.onEntityChange("users", "INSERT", "id_1", entity);

            const [, options] = mockFetch.mock.calls[0];
            const payload = JSON.parse(options.body as string);
            expect(payload.type).toBe("INSERT");
            expect(payload.table).toBe("users");
            expect(payload.record).toEqual(entity);
            expect(payload.timestamp).toBeTruthy();
            expect(payload.schema).toBe("public");
        });

        it("UPDATE payload includes old_record", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            mockFetch.mockResolvedValue({
                status: 200,
                text: () => Promise.resolve("OK")
            });

            const entity = { id: "id_1", name: "Updated" };
            const previous = { id: "id_1", name: "Original" };
            await dispatcher.onEntityChange("users", "UPDATE", "id_1", entity, previous);

            const [, options] = mockFetch.mock.calls[0];
            const payload = JSON.parse(options.body as string);
            expect(payload.old_record).toEqual(previous);
        });

        it("returns success: false on fetch failure", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            mockFetch.mockRejectedValue(new Error("Network error"));

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            // After retries, last result should be failure
            expect(results).toHaveLength(1);
            expect(results[0].success).toBe(false);
            expect(results[0].responseBody).toContain("Network error");
        }, 30000);

        it("returns success: false for non-2xx status codes", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            mockFetch.mockResolvedValue({
                status: 500,
                text: () => Promise.resolve("Internal Server Error")
            });

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            expect(results).toHaveLength(1);
            expect(results[0].success).toBe(false);
            expect(results[0].statusCode).toBe(500);
        }, 30000);

        it("includes custom headers from webhook config", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([
                makeWebhook({
                    headers: { "X-Custom": "my-value", "Authorization": "Bearer token" }
                })
            ]);

            mockFetch.mockResolvedValue({
                status: 200,
                text: () => Promise.resolve("OK")
            });

            await dispatcher.onEntityChange("users", "INSERT", "id_1", { id: "id_1" });

            const [, options] = mockFetch.mock.calls[0];
            const headers = options.headers as Record<string, string>;
            expect(headers["X-Custom"]).toBe("my-value");
            expect(headers["Authorization"]).toBe("Bearer token");
        });

        it("dispatches to multiple matching webhooks", async () => {
            const dispatcher = new WebhookDispatcher();
            dispatcher.setWebhooks([
                makeWebhook({ id: "wh_1", url: "https://a.com/hook" }),
                makeWebhook({ id: "wh_2", url: "https://b.com/hook" })
            ]);

            mockFetch.mockResolvedValue({
                status: 200,
                text: () => Promise.resolve("OK")
            });

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            expect(results).toHaveLength(2);
            expect(results[0].webhookId).toBe("wh_1");
            expect(results[1].webhookId).toBe("wh_2");
        });
    });
});
