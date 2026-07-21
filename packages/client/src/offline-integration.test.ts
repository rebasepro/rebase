import { createRebaseClient, RebaseApiError } from "./index";
import { MemoryOfflineStore } from "./offline-store";

/**
 * End-to-end wiring test: a real client (real transport, real collection
 * client, real offline manager) against a fetch stub, proving the `offline`
 * option actually threads through `createRebaseClient` — the unit suite in
 * offline.test.ts covers the manager against fakes, not this plumbing.
 */
describe("createRebaseClient({ offline })", () => {
    function jsonResponse(body: unknown): Response {
        return new Response(JSON.stringify(body), {
            status: 200,
            headers: { "Content-Type": "application/json" }
        });
    }

    function createHarness(offline: boolean | { store: MemoryOfflineStore; syncIntervalMs: number } =
        { store: new MemoryOfflineStore(), syncIntervalMs: 0 }) {
        const network = { online: true, serverError: false };
        const requests: { method: string; url: string; body?: unknown }[] = [];
        const fetchStub: typeof fetch = async (input, init) => {
            const url = String(input);
            if (!network.online) throw new TypeError("fetch failed");
            if (network.serverError) {
                return new Response(JSON.stringify({ error: { message: "boom", code: "internal" } }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                });
            }
            requests.push({
                method: init?.method ?? "GET",
                url,
                body: init?.body ? JSON.parse(String(init.body)) : undefined
            });
            if (url.includes("/data/posts/count")) return jsonResponse({ count: 1 });
            if (url.includes("/data/posts") && (init?.method ?? "GET") === "GET") {
                return jsonResponse({
                    data: [{ id: "p1", title: "hello" }],
                    meta: { total: 1, limit: 20, offset: 0, hasMore: false }
                });
            }
            if (url.includes("/data/posts") && init?.method === "POST") {
                return jsonResponse(JSON.parse(String(init?.body)));
            }
            return jsonResponse({});
        };

        const client = createRebaseClient({
            baseUrl: "http://localhost:9999",
            realtime: false,
            fetch: fetchStub,
            offline
        });
        return { client, network, requests };
    }

    it("exposes client.offline only when enabled", () => {
        const { client } = createHarness();
        expect(client.offline).toBeDefined();

        const plain = createRebaseClient({
            baseUrl: "http://localhost:9999",
            realtime: false
        });
        expect(plain.offline).toBeUndefined();
    });

    it("serves cached reads and queues writes through the data proxy, then syncs", async () => {
        const { client, network, requests } = createHarness();
        const posts = client.data.collection("posts");

        const online = await posts.find();
        expect(online.data).toEqual([{ id: "p1", title: "hello" }]);

        network.online = false;
        const cached = await posts.find();
        expect(cached.data).toEqual([{ id: "p1", title: "hello" }]);

        const draft = await posts.create({ title: "offline draft" });
        expect(draft.title).toBe("offline draft");
        expect(await client.offline!.pending()).toHaveLength(1);

        // The pending create is visible in the cached, filterless find.
        const overlaid = await posts.find();
        expect(overlaid.data.map((r) => r.title)).toEqual(["hello", "offline draft"]);
        expect(overlaid.meta.total).toBe(2);

        network.online = true;
        const result = await client.offline!.sync();
        expect(result).toEqual({ flushed: 1, remaining: 0 });

        const replayed = requests.find((r) => r.method === "POST" && r.url.endsWith("/data/posts"));
        expect(replayed?.body).toMatchObject({ title: "offline draft", id: draft.id });
    });

    it("offline: true works in Node via the in-memory fallback store", async () => {
        const { client, network } = createHarness(true);
        const posts = client.data.collection("posts");

        await posts.find();
        network.online = false;
        expect((await posts.find()).data).toEqual([{ id: "p1", title: "hello" }]);

        await posts.create({ title: "queued" });
        expect(await client.offline!.pending()).toHaveLength(1);
    });

    it("routes fluent-builder queries through the cache", async () => {
        const { client, network, requests } = createHarness();
        const posts = client.data.collection("posts");

        const online = await posts.where("title", "==", "hello").find();
        expect(online.data).toHaveLength(1);
        // The filter must actually reach the wire — otherwise this test would
        // pass by caching an unfiltered query.
        expect(requests.some((r) => r.url.includes("title="))).toBe(true);

        network.online = false;
        const cached = await posts.where("title", "==", "hello").find();
        expect(cached.data).toEqual(online.data);
        // A different filter is a different cache key, so it must miss.
        await expect(posts.where("title", "==", "other").find()).rejects.toThrow(TypeError);
    });

    it("does not serve cache on a server error — only on network failure", async () => {
        const { client, network } = createHarness();
        const posts = client.data.collection("posts");
        await posts.find();

        network.serverError = true;
        await expect(posts.find()).rejects.toThrow(RebaseApiError);
    });
});
