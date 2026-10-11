import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK, type QueuedWebhookDelivery } from "../src/services/webhook-service";
import { createJobQueue } from "../src/jobs";
import type { JobContext, JobQueueClient, JobRecord, JobStore } from "../src/jobs";

/**
 * Webhooks are at-least-once, so a receiver deduplicates — and the only thing
 * it can deduplicate on is `X-Webhook-Delivery`. That id has to be the same on
 * every attempt at one delivery, and `X-Webhook-Attempt` has to count them.
 *
 * Before: each attempt minted a fresh `X-Webhook-Delivery`, and a delivery run
 * by the job queue always said `X-Webhook-Attempt: 1` — so a retry looked, to
 * the receiver, exactly like a second event.
 */

let server: Server;
let url: string;
let seen: IncomingHttpHeaders[];
/** How many requests to answer 500 before answering 200. */
let failFirst: number;

beforeEach(async () => {
    seen = [];
    failFirst = 1;
    server = createServer((req, res) => {
        seen.push(req.headers);
        req.resume();
        req.on("end", () => {
            res.statusCode = seen.length <= failFirst ? 500 : 200;
            res.end("ok");
        });
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
});

afterEach(async () => {
    await new Promise<void>(resolve => server.close(() => resolve()));
});

function webhook() {
    return { id: "wh-1", url, secret: "s", events: ["INSERT"], table: "orders", enabled: true };
}

/** A real worker over an in-memory store, wired the way the docs wire it. */
function deliveryQueue(dispatcher: WebhookDispatcher) {
    const jobs: JobRecord[] = [];
    const store: JobStore = {
        ensureTable: async () => undefined,
        async insert(job) {
            const now = new Date().toISOString();
            jobs.push({
                id: String(jobs.length + 1), task: job.task, payload: job.payload, status: "pending",
                runAt: job.runAt.toISOString(), attempts: 0, maxAttempts: job.maxAttempts, lastError: null,
                createdAt: now, updatedAt: now
            });
            return String(jobs.length);
        },
        async claim(limit) {
            const claimed = jobs.filter(j => j.status === "pending").slice(0, limit);
            for (const job of claimed) {
                job.status = "running";
                job.attempts += 1;
            }
            return claimed.map(j => ({ ...j }));
        },
        async complete(id) {
            const job = jobs.find(j => j.id === id);
            if (job) job.status = "succeeded";
        },
        async fail(id, error, retryAt) {
            const job = jobs.find(j => j.id === id);
            if (!job) return;
            job.lastError = error;
            job.status = retryAt ? "pending" : "failed";
        },
        reapExpired: async () => 0,
        fetch: async (id) => jobs.find(j => j.id === id) ?? null
    };
    const queue = createJobQueue(store, {
        backoff: () => 0,
        tasks: {
            [WEBHOOK_DELIVERY_TASK]: (ctx: JobContext<QueuedWebhookDelivery>) =>
                dispatcher.deliverQueuedJob(ctx.payload, ctx)
        }
    });
    return { jobs, queue };
}

describe("one delivery, several attempts", () => {
    it("keeps X-Webhook-Delivery and counts X-Webhook-Attempt across the queue's retries", async () => {
        const dispatcher = new WebhookDispatcher({ allowPrivateNetworks: true });
        dispatcher.setWebhooks([webhook()]);
        const { queue } = deliveryQueue(dispatcher);
        const client: JobQueueClient = queue;
        const durable = new WebhookDispatcher({ allowPrivateNetworks: true, jobQueue: client });
        durable.setWebhooks([webhook()]);

        durable.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        // The enqueue is fire-and-forget; let it land before the worker looks.
        await new Promise(resolve => setImmediate(resolve));
        await queue.runOnce();
        await queue.runOnce();

        expect(seen).toHaveLength(2);
        expect(seen.map(h => h["x-webhook-attempt"])).toEqual(["1", "2"]);
        expect(seen[0]["x-webhook-delivery"]).toBeTruthy();
        expect(seen[1]["x-webhook-delivery"]).toBe(seen[0]["x-webhook-delivery"]);
    });

    it("gives two separate changes two different delivery ids", async () => {
        failFirst = 0;
        const dispatcher = new WebhookDispatcher({ allowPrivateNetworks: true });
        dispatcher.setWebhooks([webhook()]);

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        dispatcher.enqueueEntityChange("orders", "INSERT", "2", { id: "2" });
        await dispatcher.flush();

        expect(seen).toHaveLength(2);
        expect(seen[0]["x-webhook-delivery"]).not.toBe(seen[1]["x-webhook-delivery"]);
    });

    it("keeps X-Webhook-Delivery across the in-process retries too", async () => {
        const dispatcher = new WebhookDispatcher({ allowPrivateNetworks: true });
        dispatcher.setWebhooks([webhook()]);

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        await dispatcher.flush();

        expect(seen.map(h => h["x-webhook-attempt"])).toEqual(["1", "2"]);
        expect(seen[1]["x-webhook-delivery"]).toBe(seen[0]["x-webhook-delivery"]);
    });

    it("falls back to the job's id for a row queued before delivery ids were stored", async () => {
        failFirst = 0;
        const dispatcher = new WebhookDispatcher({ allowPrivateNetworks: true });
        dispatcher.setWebhooks([webhook()]);

        await dispatcher.deliverQueuedJob(
            { webhookId: "wh-1", event: "INSERT", payload: { type: "INSERT" } },
            { id: "job-42", attempt: 3 }
        );

        expect(seen[0]["x-webhook-delivery"]).toBe("job-42");
        expect(seen[0]["x-webhook-attempt"]).toBe("3");
    });
});
