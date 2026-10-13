/**
 * Module-level handles resolve to the backend running the code.
 *
 * `rebase` (from `@rebasepro/server` or `/functions`), a topic handle's
 * `publish` and a queue handle's `enqueue` are written once, at module scope,
 * and shared by every backend in the process. Inside a backend's scope — the
 * request, cron run or job it is serving — they reach that backend; outside
 * every scope, the process default `setDefaultBackend` installed.
 */
import { afterEach, describe, expect, it } from "@jest/globals";
import {
    queue,
    resetDeclaredQueueConsumers,
    resetDeclaredResources,
    resetDeclaredSubscriptions,
    topic,
    type QueueRuntime,
    type RebaseServerClient,
    type TopicRuntime
} from "@rebasepro/types";
import { rebase } from "../src/index";
import { runInBackendScope, setDefaultBackendScope, type BackendScope } from "../src/backend/scope";
import { _resetRebaseMock } from "../src/singleton";

/** A backend as the scope sees one: a client that says its name, and runtimes that record what reached them. */
function fakeBackend(name: string): BackendScope & { published: unknown[]; enqueued: unknown[] } {
    const published: unknown[] = [];
    const enqueued: unknown[] = [];
    const topics: TopicRuntime = { publish: async (t, event) => { published.push({ t, event }); } };
    const queues: QueueRuntime = { enqueue: async (q, payload) => { enqueued.push({ q, payload }); return { id: `${name}-job` }; } };
    const client = { name } as unknown as RebaseServerClient;
    return { rebase: client, topics, queues, published, enqueued };
}

afterEach(() => {
    setDefaultBackendScope(undefined);
    _resetRebaseMock();
    resetDeclaredResources();
    resetDeclaredSubscriptions();
    resetDeclaredQueueConsumers();
});

describe("inside a backend's scope", () => {
    it("rebase is that backend's client, across awaits, and each scope is its own", async () => {
        const a = fakeBackend("A");
        const b = fakeBackend("B");
        const seen = await Promise.all([
            runInBackendScope(a, async () => {
                await new Promise((resolve) => setTimeout(resolve, 5));
                return Reflect.get(rebase, "name");
            }),
            runInBackendScope(b, async () => Reflect.get(rebase, "name"))
        ]);
        expect(seen).toEqual(["A", "B"]);
    });

    it("a topic publishes, and a queue enqueues, into that backend", async () => {
        const signups = topic<{ id: string }>("signups");
        const thumbnails = queue<{ key: string }>("thumbnails");
        const a = fakeBackend("A");
        const b = fakeBackend("B");

        await runInBackendScope(a, () => signups.publish({ id: "1" }));
        await runInBackendScope(b, () => thumbnails.enqueue({ key: "k" }));

        expect(a.published).toEqual([{ t: "signups", event: { id: "1" } }]);
        expect(b.published).toEqual([]);
        expect(b.enqueued).toEqual([{ q: "thumbnails", payload: { key: "k" } }]);
        expect(a.enqueued).toEqual([]);
    });
});

describe("outside every scope", () => {
    it("topics and queues reach the process default, and refuse by name when there is none", async () => {
        const signups = topic<{ id: string }>("signups");
        // Enter a scope once, as a served request would, so the handles route.
        await runInBackendScope(fakeBackend("X"), async () => undefined);

        await expect(signups.publish({ id: "1" })).rejects.toThrow(/declares no topics/);

        const fallback = fakeBackend("Default");
        setDefaultBackendScope(fallback);
        await signups.publish({ id: "2" });
        expect(fallback.published).toEqual([{ t: "signups", event: { id: "2" } }]);
    });
});
