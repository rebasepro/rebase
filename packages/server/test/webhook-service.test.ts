import { WebhookDispatcher, WebhookConfig } from "../src/services/webhook-service";
import { createHmac } from "crypto";

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
    mockFetch.mockReset();
});

/**
 * Responses are real `Response` objects, not `{ status, text }` literals: the
 * dispatcher reads the body through `response.body` so it can stop at 64 KB,
 * and a literal has no such stream. A double that cannot exercise the code
 * under test is how a body-size cap gets "tested" without ever running.
 */
function respond(status: number, body: string | null = "OK", headers: Record<string, string> = {}) {
    return new Response(body, { status,
headers });
}

/**
 * Every dispatcher in this suite gets a stub resolver. The destination guard
 * resolves the hostname before it connects, and a unit suite must not ask a
 * DNS server anything — `example.com` here answers with a public address.
 */
function makeDispatcher(overrides: ConstructorParameters<typeof WebhookDispatcher>[0] = {}) {
    return new WebhookDispatcher({ lookup: async () => ["93.184.216.34"],
...overrides });
}

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
        it("filters out disabled webhooks", async () => {
            // This test had no `expect` at all: it registered three webhooks,
            // primed `fetch`, and ended on a comment describing the assertion it
            // never made. `enabled` is how an operator switches a delivery off —
            // often because the endpoint is gone or compromised — so what has to
            // be checked is that the disabled one receives nothing.
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([
                makeWebhook({ id: "wh_1",
url: "https://example.com/one",
enabled: true }),
                makeWebhook({ id: "wh_2",
url: "https://example.com/disabled",
enabled: false }),
                makeWebhook({ id: "wh_3",
url: "https://example.com/three",
enabled: true })
            ]);

            mockFetch.mockImplementation(async () => respond(200));

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            expect(results.map(r => r.webhookId)).toEqual(["wh_1", "wh_3"]);
            expect(mockFetch).toHaveBeenCalledTimes(2);
            const calledUrls = mockFetch.mock.calls.map((call: unknown[]) => call[0]);
            expect(calledUrls).toEqual(["https://example.com/one", "https://example.com/three"]);
        });
    });

    describe("onEntityChange", () => {
        it("returns empty array when no webhooks match", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook({ table: "posts" })]);

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1",
name: "Test" }
            );
            expect(results).toEqual([]);
        });

        it("matches webhooks by table AND event", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook({ table: "users",
events: ["INSERT"] })]);

            mockFetch.mockImplementation(async () => respond(200));

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );
            expect(results).toHaveLength(1);
            expect(results[0].success).toBe(true);
        });

        it("does not match different table", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook({ table: "users" })]);

            const results = await dispatcher.onEntityChange(
                "posts", "INSERT", "id_1", { id: "id_1" }
            );
            expect(results).toEqual([]);
        });

        it("does not match different event", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook({ events: ["INSERT"] })]);

            const results = await dispatcher.onEntityChange(
                "users", "DELETE", "id_1", { id: "id_1" }
            );
            expect(results).toEqual([]);
        });

        it("includes HMAC signature when webhook has secret", async () => {
            const secret = "my-webhook-secret";
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook({ secret })]);

            mockFetch.mockImplementation(async () => respond(200));

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
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook({ secret: undefined })]);

            mockFetch.mockImplementation(async () => respond(200));

            await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            const [, options] = mockFetch.mock.calls[0];
            const headers = options.headers as Record<string, string>;
            expect(headers["X-Webhook-Signature"]).toBeUndefined();
        });

        it("payload includes type, table, record, and timestamp", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            mockFetch.mockImplementation(async () => respond(200));

            const entity = { id: "id_1",
name: "Test User" };
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
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            mockFetch.mockImplementation(async () => respond(200));

            const entity = { id: "id_1",
name: "Updated" };
            const previous = { id: "id_1",
name: "Original" };
            await dispatcher.onEntityChange("users", "UPDATE", "id_1", entity, previous);

            const [, options] = mockFetch.mock.calls[0];
            const payload = JSON.parse(options.body as string);
            expect(payload.old_record).toEqual(previous);
        });

        it("returns success: false on fetch failure", async () => {
            const dispatcher = makeDispatcher();
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
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            mockFetch.mockImplementation(async () => respond(500, "Internal Server Error"));

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            expect(results).toHaveLength(1);
            expect(results[0].success).toBe(false);
            expect(results[0].statusCode).toBe(500);
        }, 30000);

        it("includes custom headers from webhook config", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([
                makeWebhook({
                    headers: { "X-Custom": "my-value",
"Authorization": "Bearer token" }
                })
            ]);

            mockFetch.mockImplementation(async () => respond(200));

            await dispatcher.onEntityChange("users", "INSERT", "id_1", { id: "id_1" });

            const [, options] = mockFetch.mock.calls[0];
            const headers = options.headers as Record<string, string>;
            expect(headers["X-Custom"]).toBe("my-value");
            expect(headers["Authorization"]).toBe("Bearer token");
        });

        it("dispatches to multiple matching webhooks", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([
                makeWebhook({ id: "wh_1",
url: "https://a.com/hook" }),
                makeWebhook({ id: "wh_2",
url: "https://b.com/hook" })
            ]);

            mockFetch.mockImplementation(async () => respond(200));

            const results = await dispatcher.onEntityChange(
                "users", "INSERT", "id_1", { id: "id_1" }
            );

            expect(results).toHaveLength(2);
            expect(results[0].webhookId).toBe("wh_1");
            expect(results[1].webhookId).toBe("wh_2");
        });
    });

    // The destination is a string out of a config, and configs get loaded from
    // databases. Without these, `fetch` is a read primitive pointed at whatever
    // the caller typed — the response comes back in `responseBody`.
    describe("destination guard (SSRF)", () => {
        async function deliverTo(url: string, overrides = {}) {
            const dispatcher = makeDispatcher(overrides);
            dispatcher.setWebhooks([makeWebhook({ url })]);
            mockFetch.mockImplementation(async () => respond(200));
            const results = await dispatcher.onEntityChange("users", "INSERT", "id_1", { id: "id_1" });
            return results[0];
        }

        it.each([
            ["http://169.254.169.254/latest/meta-data/", "link-local"],
            ["http://[fd00::1]/", "unique local"],
            ["http://[::1]:8080/hook", "loopback"],
            ["http://[::ffff:127.0.0.1]/hook", "loopback"],
            ["http://10.0.0.5/hook", "private"],
            ["http://172.16.4.4/hook", "private"],
            ["http://192.168.1.1/hook", "private"],
            ["http://127.0.0.1:5432/", "loopback"],
            ["http://0.0.0.0/", "this network"],
            ["http://100.64.1.1/", "carrier-grade NAT"]
        ])("refuses to POST to %s", async (url, reason) => {
            const result = await deliverTo(url);
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.success).toBe(false);
            expect(result.responseBody).toContain(reason);
        });

        it("refuses a public name that resolves to the metadata address", async () => {
            const result = await deliverTo("https://metadata.attacker.example/", {
                lookup: async () => ["169.254.169.254"]
            });
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.responseBody).toContain("link-local");
        });

        it("refuses a name that answers with one public and one private address", async () => {
            // Rebinding shape: taking the first answer would let this through.
            const result = await deliverTo("https://split.example.com/", {
                lookup: async () => ["93.184.216.34", "127.0.0.1"]
            });
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.responseBody).toContain("loopback");
        });

        it.each([
            "http://localhost:3000/hook",
            "http://metadata.google.internal/computeMetadata/v1/",
            "http://postgres-rw.rebase-saas.svc.cluster.local:5432/"
        ])("refuses the internal name %s without resolving it", async (url) => {
            const lookup = jest.fn(async () => ["93.184.216.34"]);
            const result = await deliverTo(url, { lookup });
            expect(lookup).not.toHaveBeenCalled();
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.responseBody).toContain("internal name");
        });

        it.each([
            "file:///etc/passwd",
            "gopher://127.0.0.1:11211/",
            "data:text/plain,hi"
        ])("refuses the non-http(s) scheme %s", async (url) => {
            const result = await deliverTo(url);
            expect(mockFetch).not.toHaveBeenCalled();
            expect(result.responseBody).toContain("must be http(s)");
        });

        it("does not retry a blocked destination", async () => {
            // Three attempts against a refusal is 6 seconds of sleeping to
            // reach the same answer — and, per the recipe, 6 seconds of
            // somebody's Postgres transaction.
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook({ url: "http://169.254.169.254/" })]);
            const started = Date.now();
            const results = await dispatcher.onEntityChange("users", "INSERT", "id_1", { id: "id_1" });
            expect(results[0].attemptNumber).toBe(1);
            expect(Date.now() - started).toBeLessThan(1000);
        });

        it("delivers to a public address", async () => {
            const result = await deliverTo("https://example.com/webhook");
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(true);
        });

        it("delivers to a private address when allowPrivateNetworks is set", async () => {
            const result = await deliverTo("http://127.0.0.1:9000/hook", { allowPrivateNetworks: true });
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(result.success).toBe(true);
        });
    });

    describe("redirects", () => {
        it("does not follow a redirect, and says so", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);
            mockFetch.mockImplementation(async () =>
                respond(307, null, { location: "http://169.254.169.254/latest/meta-data/" }));

            const results = await dispatcher.onEntityChange("users", "INSERT", "id_1", { id: "id_1" });

            // A followed 307 replays the POST — body, signature and all — at an
            // address the guard never saw.
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(results[0].success).toBe(false);
            expect(results[0].statusCode).toBe(307);
            expect(results[0].responseBody).toContain("must not redirect");
        });

        it("asks fetch not to follow redirects itself", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);
            mockFetch.mockImplementation(async () => respond(200));

            await dispatcher.onEntityChange("users", "INSERT", "id_1", { id: "id_1" });

            const [, options] = mockFetch.mock.calls[0];
            expect(options.redirect).toBe("manual");
        });
    });

    describe("timeouts and response bodies", () => {
        it("keeps the deadline armed across the body read", async () => {
            // The receiver answers 200 immediately and then trickles the body.
            // With the timer cleared at the headers, this delivery never ends.
            const dispatcher = makeDispatcher({ timeoutMs: 50 });
            dispatcher.setWebhooks([makeWebhook()]);
            mockFetch.mockImplementation(async (_url: string, init: RequestInit) => {
                const stream = new ReadableStream<Uint8Array>({
                    start(controller) {
                        controller.enqueue(new TextEncoder().encode("droplet"));
                        init.signal?.addEventListener("abort", () =>
                            controller.error(new Error("The operation was aborted")));
                        // …and never closes.
                    }
                });
                return new Response(stream, { status: 200 });
            });

            let hung: NodeJS.Timeout | undefined;
            const results = await Promise.race([
                dispatcher.onEntityChange("users", "INSERT", "id_1", { id: "id_1" }),
                new Promise<never>((_, reject) => {
                    hung = setTimeout(() => reject(new Error("hung")), 15000);
                })
            ]).finally(() => clearTimeout(hung));

            expect(results[0].statusCode).toBe(200);
            expect(results[0].responseBody).toBe("droplet");
        }, 20000);

        it("stops reading a huge body instead of buffering it", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            let enqueued = 0;
            mockFetch.mockImplementation(async () => {
                const chunk = new TextEncoder().encode("x".repeat(8 * 1024));
                const stream = new ReadableStream<Uint8Array>({
                    pull(controller) {
                        // 8 MB if anyone reads it all.
                        if (enqueued >= 1024) {
                            controller.close();
                            return;
                        }
                        enqueued++;
                        controller.enqueue(chunk);
                    }
                });
                return new Response(stream, { status: 200 });
            });

            const results = await dispatcher.onEntityChange("users", "INSERT", "id_1", { id: "id_1" });

            expect(results[0].success).toBe(true);
            expect(results[0].responseBody).toHaveLength(1000);
            // 64 KB cap over 8 KB chunks, plus whatever the stream queued
            // ahead — nowhere near the 1024 on offer.
            expect(enqueued).toBeLessThanOrEqual(12);
        });
    });

    describe("enqueueEntityChange", () => {
        it("returns before the delivery runs", async () => {
            // The point of the method: `afterSave` is awaited inside the write's
            // transaction, so a delivery awaited there is transaction time.
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);

            let release: () => void = () => undefined;
            const inFlight = new Promise<void>(resolve => {
                release = resolve;
            });
            mockFetch.mockImplementation(async () => {
                await inFlight;
                return respond(200);
            });

            // No promise comes back, so a callback cannot hold its transaction
            // open on this even by accident.
            const returned: void = dispatcher.enqueueEntityChange("users", "INSERT", "id_1", { id: "id_1" });
            expect(returned).toBeUndefined();

            let flushed = false;
            const flushing = dispatcher.flush().then(() => {
                flushed = true;
            });
            await new Promise(r => setTimeout(r, 20));

            // The POST is open, and the caller is long gone.
            expect(mockFetch).toHaveBeenCalledTimes(1);
            expect(flushed).toBe(false);

            release();
            await flushing;
            expect(flushed).toBe(true);
        });

        it("reports queued results through onDelivery", async () => {
            const delivered: string[] = [];
            const dispatcher = makeDispatcher({ onDelivery: r => delivered.push(`${r.webhookId}:${r.success}`) });
            dispatcher.setWebhooks([makeWebhook()]);
            mockFetch.mockImplementation(async () => respond(200));

            dispatcher.enqueueEntityChange("users", "INSERT", "id_1", { id: "id_1" });
            expect(delivered).toEqual([]);

            await dispatcher.flush();
            expect(delivered).toEqual(["wh_1:true"]);
        });

        it("drains everything queued while a delivery was in flight", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook()]);
            mockFetch.mockImplementation(async () => respond(200));

            dispatcher.enqueueEntityChange("users", "INSERT", "id_1", { id: "id_1" });
            dispatcher.enqueueEntityChange("users", "UPDATE", "id_2", { id: "id_2" });
            dispatcher.enqueueEntityChange("users", "DELETE", "id_3", null);

            await dispatcher.flush();
            expect(mockFetch).toHaveBeenCalledTimes(3);
        });

        it("does not reject when every attempt fails", async () => {
            const dispatcher = makeDispatcher();
            dispatcher.setWebhooks([makeWebhook({ url: "http://127.0.0.1/hook" })]);

            dispatcher.enqueueEntityChange("users", "INSERT", "id_1", { id: "id_1" });
            await expect(dispatcher.flush()).resolves.toBeUndefined();
        });
    });
});
