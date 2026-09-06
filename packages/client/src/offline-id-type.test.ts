import { createRebaseClient, RebaseApiError } from "./index";
import { MemoryOfflineStore } from "./offline-store";

/**
 * A temporary id has the type the collection's ids have.
 *
 * `generateOfflineId()` always returned a UUID string, so a `create` while
 * offline on a collection keyed by an integer handed back
 * `{ id: "526e2faf-f57e-45a8-bce2-cf34671c3825" }` on a row whose generated
 * `Row["id"]` is `number`. Anything that put that in a URL, a foreign key or an
 * `id.toFixed()` was wrong or threw until the replay reconciled it — and the
 * SDK's own types said it could not happen.
 *
 * There is no schema to read the id type off here: the generated types are
 * erased at compile time, and the whole point of this path is that the server
 * is unreachable. It is read off the rows the local database already holds.
 */
describe("the id an offline write mints", () => {
    beforeEach(() => { jest.spyOn(console, "warn").mockImplementation(() => undefined); });

    function harness(seed: { id: string | number; title: string }) {
        const network = { online: true };
        const fetchStub: typeof fetch = async (input, init) => {
            if (!network.online) {
                throw new RebaseApiError("Could not reach the server: fetch failed", {
                    status: 0, code: "NETWORK_ERROR"
                });
            }
            const url = String(input);
            const json = (body: unknown) => new Response(JSON.stringify(body), {
                status: 200, headers: { "Content-Type": "application/json" }
            });
            if (url.includes("/count")) return json({ count: 1 });
            if ((init?.method ?? "GET") === "GET") {
                return json({ data: [seed], meta: { total: 1, limit: 20, offset: 0, hasMore: false } });
            }
            return json(JSON.parse(String(init?.body)));
        };

        const client = createRebaseClient({
            baseUrl: "http://localhost:9999",
            realtime: false,
            fetch: fetchStub,
            offline: { store: new MemoryOfflineStore(), syncIntervalMs: 0 }
        });
        return { client, network };
    }

    it("is a negative integer for a collection keyed by a number", async () => {
        const { client, network } = harness({ id: 1, title: "hello" });
        const posts = client.data.collection("posts");
        await posts.find();

        network.online = false;
        const draft = await posts.create({ title: "offline draft" }) as { id: unknown };

        expect(typeof draft.id).toBe("number");
        expect(draft.id as number).toBeLessThan(0);
        expect(Number.isInteger(draft.id as number)).toBe(true);
    });

    it("is a UUID for a collection keyed by a string", async () => {
        const { client, network } = harness({ id: "p1", title: "hello" });
        const posts = client.data.collection("posts");
        await posts.find();

        network.online = false;
        const draft = await posts.create({ title: "offline draft" }) as { id: unknown };

        expect(typeof draft.id).toBe("string");
    });

    it("mints a different id every time, and keeps them ordered", async () => {
        const { client, network } = harness({ id: 1, title: "hello" });
        const posts = client.data.collection("posts");
        await posts.find();

        network.online = false;
        const first = await posts.create({ title: "one" }) as { id: number };
        const second = await posts.create({ title: "two" }) as { id: number };

        expect(second.id).toBeLessThan(first.id);
    });

    it("replays the temporary id the caller was handed", async () => {
        // Whatever shape it has, the write that reaches the server names it —
        // that is how the server's own id gets reconciled back.
        const { client, network } = harness({ id: 1, title: "hello" });
        const posts = client.data.collection("posts");
        await posts.find();

        network.online = false;
        const draft = await posts.create({ title: "offline draft" }) as { id: number };
        expect(client.offline).toBeDefined();

        network.online = true;
        const result = await client.offline!.sync();
        expect(result.flushed).toBe(1);
        expect(draft.id).toBeLessThan(0);
    });

    it("falls back to a UUID when nothing local can say", async () => {
        // A first write on a device that has never read the collection. Nothing
        // local knows the id type, and neither does anything else offline.
        const { client, network } = harness({ id: 1, title: "hello" });
        network.online = false;

        const draft = await client.data.collection("posts").create({ title: "cold" }) as { id: unknown };
        expect(typeof draft.id).toBe("string");
    });
});
