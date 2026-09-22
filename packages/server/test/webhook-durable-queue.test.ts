import { afterEach, describe, expect, it, jest } from "@jest/globals";
import { WebhookDispatcher, WEBHOOK_DELIVERY_TASK } from "../src/services/webhook-service";
import { createJobQueue } from "../src/jobs";
import type { JobContext, JobQueueClient, JobRecord, JobStore } from "../src/jobs";
import { setAmbientTransactionResolver } from "../src/db/ambient-transaction";

/**
 * Webhook deliveries as rows rather than as an array in one process's heap.
 *
 * `enqueueEntityChange` exists so a delivery does not happen inside the
 * transaction that wrote the row — which is right, and which is why its own
 * docblock had to admit that "a crash or a deploy between the enqueue and the
 * delivery drops the event". Nothing recorded that it had ever been queued.
 *
 * With a queue configured the delivery is a row, so the crash is survivable.
 * Three things have to hold, and each is a way this could look finished and not
 * be:
 *
 *  - the *reference* is queued, not the webhook. Embedding it would write the
 *    signing secret into `rebase.jobs` in cleartext, where retention keeps it
 *    for a month;
 *  - the queued path does not also run the in-process retries, or three
 *    attempts become nine;
 *  - an enqueue that fails still delivers. A durable path that loses the event
 *    when the database hiccups is worse than the memory one it replaced.
 */

const WEBHOOK = {
    id: "wh-1",
    url: "https://example.test/hook",
    secret: "shhh-this-is-the-signing-secret",
    events: ["INSERT"],
    table: "orders",
    enabled: true
};

/** A real worker over an in-memory store, running deliveries the documented way. */
function deliveryQueue(dispatcher: WebhookDispatcher) {
    const jobs: JobRecord[] = [];
    const store: JobStore & { jobs: JobRecord[] } = {
        jobs,
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
        async claim(limit, _workerId, tasks) {
            const claimed = jobs
                .filter(j => j.status === "pending" && Date.parse(j.runAt) <= Date.now())
                .filter(j => tasks === undefined || tasks.includes(j.task))
                .slice(0, limit);
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
            if (retryAt) job.runAt = retryAt.toISOString();
        },
        reapExpired: async () => 0,
        fetch: async (id) => jobs.find(j => j.id === id) ?? null
    };
    const queue = createJobQueue(store, {
        backoff: () => 0,
        tasks: {
            [WEBHOOK_DELIVERY_TASK]: (ctx: JobContext<{ webhookId: string; event: string; payload: Record<string, unknown> }>) =>
                dispatcher.deliverQueuedJob(ctx.payload)
        }
    });
    return { store, queue };
}

function fakeQueue() {
    const enqueued: { task: string; payload: unknown }[] = [];
    const queue: JobQueueClient & { enqueued: typeof enqueued; fail: boolean } = {
        enqueued,
        fail: false,
        async enqueue(task, payload) {
            if (queue.fail) throw new Error("database is down");
            enqueued.push({ task, payload });
            return String(enqueued.length);
        }
    };
    return queue;
}

describe("a change with a durable queue configured", () => {
    it("queues the delivery instead of sending it in-process", async () => {
        const queue = fakeQueue();
        const dispatcher = new WebhookDispatcher({ jobQueue: queue });
        dispatcher.setWebhooks([WEBHOOK]);

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        await dispatcher.flush();

        expect(queue.enqueued).toHaveLength(1);
        expect(queue.enqueued[0].task).toBe(WEBHOOK_DELIVERY_TASK);
    });

    it("queues a reference, never the webhook's secret", async () => {
        const queue = fakeQueue();
        const dispatcher = new WebhookDispatcher({ jobQueue: queue });
        dispatcher.setWebhooks([WEBHOOK]);

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        await dispatcher.flush();

        expect(queue.enqueued[0].payload).toMatchObject({ webhookId: "wh-1", event: "INSERT" });
        // The row outlives the delivery by up to a month of retention.
        expect(JSON.stringify(queue.enqueued[0].payload)).not.toContain(WEBHOOK.secret);
    });

    it("queues one job per matching webhook", async () => {
        const queue = fakeQueue();
        const dispatcher = new WebhookDispatcher({ jobQueue: queue });
        dispatcher.setWebhooks([WEBHOOK, { ...WEBHOOK, id: "wh-2" }]);

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        await dispatcher.flush();

        expect(queue.enqueued.map(j => (j.payload as { webhookId: string }).webhookId)).toEqual(["wh-1", "wh-2"]);
    });

    it("queues nothing when no webhook matches", async () => {
        const queue = fakeQueue();
        const dispatcher = new WebhookDispatcher({ jobQueue: queue });
        dispatcher.setWebhooks([WEBHOOK]);

        dispatcher.enqueueEntityChange("customers", "INSERT", "1", { id: "1" });
        await dispatcher.flush();

        expect(queue.enqueued).toHaveLength(0);
    });

    it("falls back to in-process delivery when the enqueue itself fails", async () => {
        // The one case where the durable path could be worse than the memory
        // one. It must not be.
        const queue = fakeQueue();
        queue.fail = true;
        const delivered: unknown[] = [];
        // A blocked destination, so the in-process path fails *terminally* on
        // its first attempt. Anything retryable would take the real ladder —
        // 1s, 5s, 15s — and this test is about which path ran, not how
        // patiently it ran.
        const dispatcher = new WebhookDispatcher({
            jobQueue: queue,
            allowPrivateNetworks: false,
            onDelivery: (r) => delivered.push(r)
        });
        dispatcher.setWebhooks([{ ...WEBHOOK, url: "http://127.0.0.1:9/unreachable" }]);

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        // The enqueue rejects asynchronously, so let its catch run before the
        // in-process drain is awaited.
        await new Promise(resolve => setImmediate(resolve));
        await dispatcher.flush();

        expect(queue.enqueued).toHaveLength(0);
        expect(delivered.length).toBeGreaterThan(0);
    });
});

describe("without a queue", () => {
    it("still uses the in-memory path, unchanged", async () => {
        const delivered: unknown[] = [];
        // Blocked, for the same reason as above: one terminal attempt.
        const dispatcher = new WebhookDispatcher({
            allowPrivateNetworks: false,
            onDelivery: (r) => delivered.push(r)
        });
        dispatcher.setWebhooks([{ ...WEBHOOK, url: "http://127.0.0.1:9/unreachable" }]);

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        await dispatcher.flush();

        expect(delivered.length).toBeGreaterThan(0);
    });
});

describe("running a queued delivery", () => {
    it("drops a job whose webhook has since been deleted or disabled", async () => {
        const dispatcher = new WebhookDispatcher({});
        dispatcher.setWebhooks([]);

        // Not a throw: the operator's most recent instruction is that this
        // endpoint should not be called, so retrying it would be wrong.
        await expect(dispatcher.deliverQueuedJob({
            webhookId: "gone",
            event: "INSERT",
            payload: { type: "INSERT" }
        })).resolves.toBeUndefined();
    });

    it("throws on a retryable failure, so the queue schedules the retry", async () => {
        const dispatcher = new WebhookDispatcher({ allowPrivateNetworks: true, timeoutMs: 500 });
        dispatcher.setWebhooks([{ ...WEBHOOK, url: "http://127.0.0.1:9/unreachable" }]);

        await expect(dispatcher.deliverQueuedJob({
            webhookId: "wh-1",
            event: "INSERT",
            payload: { type: "INSERT" }
        })).rejects.toThrow(/wh-1/);
    });

    it("fails a refused destination permanently, so it is dead-lettered and not retried", async () => {
        // A blocked destination fails identically every time. Three more
        // worker slots reach the same answer — but returning normally marked
        // the job succeeded, with no error, which is worse than retrying it.
        const dispatcher = new WebhookDispatcher({ allowPrivateNetworks: false });
        dispatcher.setWebhooks([{ ...WEBHOOK, url: "http://127.0.0.1:9/blocked" }]);
        const { store, queue } = deliveryQueue(dispatcher);

        await queue.enqueue(WEBHOOK_DELIVERY_TASK, { webhookId: "wh-1", event: "INSERT", payload: { type: "INSERT" } });
        await queue.runOnce();

        const row = store.jobs[0];
        expect(row.status).toBe("failed");
        expect(row.attempts).toBe(1);
        expect(row.lastError).toContain("wh-1");
    });

    it("fails a redirecting receiver permanently, with the reason on the row", async () => {
        const fetchSpy = jest.spyOn(globalThis, "fetch" as never).mockResolvedValue(
            new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } }) as never
        );
        try {
            const dispatcher = new WebhookDispatcher({ allowPrivateNetworks: true });
            dispatcher.setWebhooks([WEBHOOK]);
            const { store, queue } = deliveryQueue(dispatcher);

            await queue.enqueue(WEBHOOK_DELIVERY_TASK, { webhookId: "wh-1", event: "INSERT", payload: { type: "INSERT" } });
            await queue.runOnce();
            await queue.runOnce();

            const row = store.jobs[0];
            expect(row.status).toBe("failed");
            expect(row.attempts).toBe(1);
            expect(row.lastError).toContain("must not redirect");
            expect(fetchSpy).toHaveBeenCalledTimes(1);
        } finally {
            fetchSpy.mockRestore();
        }
    });

    it("makes exactly one HTTP attempt, leaving retries to the queue", async () => {
        // Keeping both retry layers would mean three attempts inside each of
        // three job attempts: nine deliveries, and about two minutes of
        // holding a worker slot.
        const fetchSpy = jest.spyOn(globalThis, "fetch" as never)
            .mockRejectedValue(new Error("connection refused") as never);

        try {
            const dispatcher = new WebhookDispatcher({ allowPrivateNetworks: true });
            dispatcher.setWebhooks([WEBHOOK]);

            await expect(dispatcher.deliverQueuedJob({
                webhookId: "wh-1",
                event: "INSERT",
                payload: { type: "INSERT" }
            })).rejects.toThrow();

            expect(fetchSpy).toHaveBeenCalledTimes(1);
        } finally {
            fetchSpy.mockRestore();
        }
    });
});

/**
 * Called from a callback, `enqueueEntityChange` is inside the write it
 * describes. It used to queue straight away, so a receiver could hear about a
 * row a few milliseconds before it committed — or about one that never did.
 * The driver publishes the write's transaction (`setAmbientTransactionResolver`);
 * deliveries wait for its commit and are dropped with its rollback.
 */
describe("a change reported from inside a write", () => {
    afterEach(() => setAmbientTransactionResolver(undefined));

    function insideAWrite() {
        const onCommit: Array<() => void> = [];
        setAmbientTransactionResolver(() => ({
            exec: async () => [],
            afterCommit: (fn) => { onCommit.push(fn); }
        }));
        return {
            commit() {
                setAmbientTransactionResolver(undefined);
                for (const fn of onCommit.splice(0)) fn();
            }
        };
    }

    it("queues nothing until the write commits", async () => {
        const queue = fakeQueue();
        const dispatcher = new WebhookDispatcher({ jobQueue: queue });
        dispatcher.setWebhooks([WEBHOOK]);
        const write = insideAWrite();

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        await dispatcher.flush();
        expect(queue.enqueued).toHaveLength(0);

        write.commit();
        await dispatcher.flush();
        expect(queue.enqueued).toHaveLength(1);
    });

    it("queues nothing at all when the write rolls back", async () => {
        const queue = fakeQueue();
        const dispatcher = new WebhookDispatcher({ jobQueue: queue });
        dispatcher.setWebhooks([WEBHOOK]);
        insideAWrite();

        dispatcher.enqueueEntityChange("orders", "INSERT", "1", { id: "1" });
        // A rollback is the commit never coming: nothing runs the hooks.
        setAmbientTransactionResolver(undefined);
        await dispatcher.flush();

        expect(queue.enqueued).toHaveLength(0);
    });
});
