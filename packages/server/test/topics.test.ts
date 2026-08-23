/**
 * Topic delivery: the fan-out shape, and the two silences it refuses.
 */
import {
    createTopicRuntime,
    installTopicRuntime,
    topicJobHandlers,
    topicTaskName
} from "../src/topics/runtime";
import {
    buildResourceGraph,
    declaredSubscriptions,
    resetDeclaredResources,
    resetDeclaredSubscriptions,
    topic,
    type ResourceDeclaration
} from "@rebasepro/types";

interface Enqueued { task: string; payload: unknown; maxAttempts?: number }

function fakeQueue(): { calls: Enqueued[]; enqueue: (t: string, p?: unknown, o?: { maxAttempts?: number }) => Promise<string | null> } {
    const calls: Enqueued[] = [];
    return {
        calls,
        enqueue: async (task, payload, options) => {
            calls.push({ task, payload, maxAttempts: options?.maxAttempts });
            return "job-id";
        }
    };
}

function topicsOf(): ResourceDeclaration[] {
    return buildResourceGraph().resources.filter(r => r.kind === "topic");
}

beforeEach(() => {
    resetDeclaredResources();
    resetDeclaredSubscriptions();
});

describe("fan-out", () => {
    it("writes one row per subscription, not one per event", async () => {
        // The SNS→SQS shape: each subscriber retries on its own schedule, so a
        // broken audit log does not re-deliver a welcome email that already went.
        const signups = topic<{ id: string }>("signups");
        signups.subscription("welcome", async () => undefined);
        signups.subscription("audit", async () => undefined);

        const queue = fakeQueue();
        const runtime = createTopicRuntime({ queue, topics: topicsOf() });
        await runtime.publish("signups", { id: "1" });

        expect(queue.calls.map(c => c.task)).toEqual([
            topicTaskName("signups", "welcome"),
            topicTaskName("signups", "audit")
        ]);
        expect(queue.calls.every(c => JSON.stringify(c.payload) === JSON.stringify({ id: "1" }))).toBe(true);
    });

    it("takes attempts from the subscription, then the topic, then the default", async () => {
        const t = topic("orders", { maxAttempts: 9 });
        t.subscription("strict", async () => undefined, { maxAttempts: 2 });
        t.subscription("inherits", async () => undefined);

        const queue = fakeQueue();
        await createTopicRuntime({ queue, topics: topicsOf() }).publish("orders", {});
        expect(queue.calls.map(c => c.maxAttempts)).toEqual([2, 9]);
    });

    it("uses the default when neither says", async () => {
        const t = topic("plain");
        t.subscription("s", async () => undefined);
        const queue = fakeQueue();
        await createTopicRuntime({ queue, topics: topicsOf() }).publish("plain", {});
        expect(queue.calls[0].maxAttempts).toBe(5);
    });
});

describe("refusals and warnings", () => {
    it("refuses to publish to a topic nothing declares", async () => {
        // Enqueueing anyway would write rows no worker ever handles.
        topic("known");
        const runtime = createTopicRuntime({ queue: fakeQueue(), topics: topicsOf() });
        await expect(runtime.publish("typo", {}))
            .rejects.toThrow(/nothing declares it.*Declared topics: known/s);
    });

    it("does not enqueue for a topic with no subscriptions", async () => {
        topic("nobody");
        const queue = fakeQueue();
        await createTopicRuntime({ queue, topics: topicsOf() }).publish("nobody", {});
        expect(queue.calls).toEqual([]);
    });
});

describe("handlers", () => {
    it("builds one task per subscription, passing the attempt through", async () => {
        const seen: { attempt: number; topic: string; subscription: string; payload: unknown }[] = [];
        const t = topic<{ n: number }>("events");
        t.subscription("record", async (event, ctx) => {
            seen.push({ ...ctx, payload: event });
        });

        const tasks = topicJobHandlers();
        const task = topicTaskName("events", "record");
        expect(Object.keys(tasks)).toEqual([task]);

        await (tasks[task] as unknown as (ctx: unknown) => Promise<void>)({ payload: { n: 1 }, attempt: 3 });
        expect(seen).toEqual([{ attempt: 3, topic: "events", subscription: "record", payload: { n: 1 } }]);
    });

    it("surfaces a throwing handler, because throwing is how a job fails", async () => {
        const t = topic("events");
        t.subscription("boom", async () => { throw new Error("nope"); });
        const tasks = topicJobHandlers();
        await expect(
            (tasks[topicTaskName("events", "boom")] as unknown as (ctx: unknown) => Promise<void>)({ payload: {}, attempt: 1 })
        ).rejects.toThrow("nope");
    });
});

describe("installation", () => {
    it("makes publish work through the handle, and stops working after teardown", async () => {
        const signups = topic<{ id: string }>("signups");
        signups.subscription("welcome", async () => undefined);
        const queue = fakeQueue();

        const teardown = installTopicRuntime({ queue, topics: topicsOf() });
        await signups.publish({ id: "1" });
        expect(queue.calls).toHaveLength(1);

        teardown();
        await expect(signups.publish({ id: "2" })).rejects.toThrow(/no topic runtime is installed/);
    });

    it("leaves declared subscriptions alone, which is what the worker wires", () => {
        const t = topic("events");
        t.subscription("a", async () => undefined);
        const teardown = installTopicRuntime({ queue: fakeQueue(), topics: topicsOf() });
        teardown();
        expect(declaredSubscriptions("events").map(s => s.name)).toEqual(["a"]);
    });
});
