import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo, Socket } from "node:net";
import { createNodePost, type OutboundPost } from "../src/services/outbound-post";
import { blockedAddressReason, BlockedUrlError } from "../src/services/outbound-url-guard";
import { WebhookDispatcher } from "../src/services/webhook-service";
import { PermanentJobError } from "../src/jobs/job-queue";

/**
 * The webhook transport on Node, over real sockets: the destination guard
 * judges the address each connection is made to, inside the connection's own
 * `lookup`.
 *
 * It used to be validate-then-fetch: a `dns.lookup` per delivery attempt — 100
 * deliveries, 100 lookups on the libuv threadpool, each up to a dozen kube-dns
 * queries under `ndots:5` — and then `fetch` resolved the name again, where the
 * guard could not see. A TTL-0 name answering a public address to the first
 * lookup and a private one to the second got through.
 *
 * Receivers here listen on loopback, which the guard refuses; the tests that
 * need one to answer judge with {@link loopbackIsPublic}, and every other
 * address as the guard does.
 */

const loopbackIsPublic = (address: string): string | null =>
    address === "127.0.0.1" ? null : blockedAddressReason(address);

interface Receiver {
    port: number;
    requests: number;
    connections: number;
    close(): Promise<void>;
}

async function receiver(handle: (req: IncomingMessage, res: ServerResponse) => void = (_req, res) => res.end("ok")): Promise<Receiver> {
    const state = { requests: 0, connections: 0 };
    const sockets = new Set<Socket>();
    const server: Server = createServer((req, res) => {
        state.requests++;
        req.resume();
        req.on("end", () => handle(req, res));
    });
    server.on("connection", (socket) => {
        state.connections++;
        sockets.add(socket);
        socket.on("close", () => sockets.delete(socket));
    });
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", () => resolve()));
    return {
        port: (server.address() as AddressInfo).port,
        get requests() { return state.requests; },
        get connections() { return state.connections; },
        close: () => new Promise<void>((resolve) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => resolve());
        })
    };
}

async function post(send: OutboundPost, url: string, timeoutMs = 5_000): Promise<{ status: number; body: string }> {
    const response = await send(url, {
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(timeoutMs)
    });
    return { status: response.status, body: await response.text() };
}

let receivers: Receiver[] = [];
afterEach(async () => {
    await Promise.all(receivers.map(r => r.close()));
    receivers = [];
});
async function listening(handle?: (req: IncomingMessage, res: ServerResponse) => void): Promise<Receiver> {
    const r = await receiver(handle);
    receivers.push(r);
    return r;
}

describe("the Node webhook transport", () => {
    it("resolves a receiver's name once per connection, not once per delivery", async () => {
        const hook = await listening();
        const lookup = jest.fn(async () => ["127.0.0.1"]);
        const send = (await createNodePost({ lookup }, loopbackIsPublic))!;

        for (let i = 0; i < 10; i++) {
            expect(await post(send, `http://hooks.example.com:${hook.port}/hook`)).toEqual({ status: 200, body: "ok" });
        }

        expect(hook.requests).toBe(10);
        expect(hook.connections).toBe(1);
        expect(lookup).toHaveBeenCalledTimes(1);
    });

    it("connects to the address it judged, not to one a second lookup returns", async () => {
        // `hooks.example.com` resolves to the receiver only through the
        // guard's lookup. Anything resolving the name again would not get here.
        const hook = await listening();
        const send = (await createNodePost({ lookup: async () => ["127.0.0.1"] }, loopbackIsPublic))!;

        expect((await post(send, `http://hooks.example.com:${hook.port}/`)).status).toBe(200);
    });

    it("judges every new connection: a name that rebinds to a private address is refused", async () => {
        // The receiver closes each connection, so each delivery dials again —
        // and the name's answer flips after the first.
        const hook = await listening((_req, res) => {
            res.setHeader("Connection", "close");
            res.end("ok");
        });
        const answers = [["127.0.0.1"], ["169.254.169.254"]];
        const send = (await createNodePost({ lookup: async () => answers.shift() ?? [] }, loopbackIsPublic))!;

        expect((await post(send, `http://flip.example.com:${hook.port}/`)).status).toBe(200);
        const refused = post(send, `http://flip.example.com:${hook.port}/`);
        await expect(refused).rejects.toBeInstanceOf(BlockedUrlError);
        await expect(refused).rejects.toThrow(/169\.254\.169\.254.*link-local/);
        expect(hook.requests).toBe(1);
    });

    it.each([
        [["10.0.0.5"], "private"],
        [["169.254.169.254"], "link-local"],
        [["127.0.0.1"], "loopback"],
        [["::1"], "loopback"],
        [["::ffff:127.0.0.1"], "loopback"],
        [["fd00::1"], "unique local"],
        [["93.184.216.34", "127.0.0.1"], "loopback"]
    ])("refuses a name resolving to %j before connecting", async (addresses, reason) => {
        const hook = await listening();
        const send = (await createNodePost({ lookup: async () => addresses }))!;

        const refused = post(send, `http://hooks.example.com:${hook.port}/`);
        await expect(refused).rejects.toBeInstanceOf(BlockedUrlError);
        await expect(refused).rejects.toThrow(reason);
        expect(hook.connections).toBe(0);
    });

    it.each([
        "http://127.0.0.1:{port}/",
        "http://[::1]:{port}/",
        "http://localhost:{port}/",
        "file:///etc/passwd"
    ])("refuses %s without resolving anything", async (template) => {
        const hook = await listening();
        const lookup = jest.fn(async () => ["127.0.0.1"]);
        const send = (await createNodePost({ lookup }))!;

        await expect(post(send, template.replace("{port}", String(hook.port)))).rejects.toBeInstanceOf(BlockedUrlError);
        expect(lookup).not.toHaveBeenCalled();
        expect(hook.connections).toBe(0);
    });

    it("does not follow a redirect", async () => {
        const target = await listening();
        const hook = await listening((_req, res) => {
            res.writeHead(307, { Location: `http://hooks.example.com:${target.port}/` });
            res.end();
        });
        const send = (await createNodePost({ lookup: async () => ["127.0.0.1"] }, loopbackIsPublic))!;

        const response = await send(`http://hooks.example.com:${hook.port}/`, { headers: {}, body: "{}", signal: AbortSignal.timeout(5_000) });
        expect(response.status).toBe(307);
        expect(response.header("location")).toBe(`http://hooks.example.com:${target.port}/`);
        await response.body?.cancel();
        expect(target.requests).toBe(0);
    });

    it("errors a body that trickles past the deadline, instead of waiting on it", async () => {
        const hook = await listening((_req, res) => {
            res.writeHead(200);
            res.write("droplet");
            // …and never ends.
        });
        const send = (await createNodePost({ lookup: async () => ["127.0.0.1"] }, loopbackIsPublic))!;

        const response = await send(`http://hooks.example.com:${hook.port}/`, { headers: {}, body: "{}", signal: AbortSignal.timeout(200) });
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("droplet");
        await expect(reader.read()).rejects.toThrow();
    });

    it("reads a body only as far as it is asked to, and drops the connection on cancel", async () => {
        const hook = await listening((_req, res) => {
            res.writeHead(200);
            res.end("x".repeat(4 * 1024 * 1024));
        });
        const send = (await createNodePost({ lookup: async () => ["127.0.0.1"] }, loopbackIsPublic))!;

        const response = await send(`http://hooks.example.com:${hook.port}/`, { headers: {}, body: "{}", signal: AbortSignal.timeout(5_000) });
        const reader = response.body!.getReader();
        const first = await reader.read();
        expect(first.value!.byteLength).toBeGreaterThan(0);
        await reader.cancel();

        // The next delivery cannot reuse a connection with a body left on it.
        expect((await post(send, `http://hooks.example.com:${hook.port}/`)).status).toBe(200);
        expect(hook.connections).toBe(2);
    });

    it("gives up at the deadline, on a receiver that never answers", async () => {
        const hook = await listening(() => { /* never answers */ });
        const send = (await createNodePost({ lookup: async () => ["127.0.0.1"] }, loopbackIsPublic))!;

        await expect(post(send, `http://hooks.example.com:${hook.port}/`, 100)).rejects.toThrow(/abort|timeout/i);
    });
});

describe("a delivery to a name that resolves to a private address", () => {
    const webhook = {
        id: "wh_internal",
        url: "https://hooks.attacker.example/hook",
        events: ["INSERT"],
        table: "orders",
        enabled: true
    };

    it("is refused once, not retried", async () => {
        const dispatcher = new WebhookDispatcher({ lookup: async () => ["10.0.0.5"] });
        dispatcher.setWebhooks([webhook]);

        const [result] = await dispatcher.onEntityChange("orders", "INSERT", "1", { id: "1" });

        expect(result.success).toBe(false);
        expect(result.attemptNumber).toBe(1);
        expect(result.responseBody).toContain("private (10.0.0.0/8)");
    });

    it("is dead-lettered when it comes off the job queue", async () => {
        const dispatcher = new WebhookDispatcher({ lookup: async () => ["169.254.169.254"] });
        dispatcher.setWebhooks([webhook]);

        await expect(dispatcher.deliverQueuedJob({ webhookId: "wh_internal", event: "INSERT", payload: {} }))
            .rejects.toBeInstanceOf(PermanentJobError);
    });
});
