import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * The parts of the TUS protocol a client relies on when the network is bad —
 * which is the whole reason anyone uses resumable uploads.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";

const b64 = (s: string) => Buffer.from(s).toString("base64");

/** A body that arrives `delayMs` late, as a chunk on a stalled connection does. */
const slowBody = (text: string, delayMs: number) => new ReadableStream<Uint8Array>({
    async start(controller) {
        await new Promise(resolve => setTimeout(resolve, delayMs));
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
    }
});

describe("TUS", () => {
    let root: string;
    let app: Hono<HonoEnv>;

    beforeEach(() => {
        root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tus-protocol-"));
        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: new LocalStorageController({ type: "local", basePath: root }),
            requireAuth: false
        }));
    });

    afterEach(() => {
        fs.rmSync(root, { recursive: true, force: true });
    });

    const create = async (key: string, length: number) => {
        const res = await app.request("http://api.example.com/api/storage/tus", {
            method: "POST",
            headers: {
                "Tus-Resumable": "1.0.0",
                "Upload-Length": String(length),
                "Upload-Metadata": `key ${b64(key)},filetype ${b64("text/plain")}`
            }
        });
        expect(res.status).toBe(201);
        return res.headers.get("Location")!.split("/").pop()!;
    };

    const patch = (id: string, offset: number, body: BodyInit) => app.request(`http://api.example.com/api/storage/tus/${id}`, {
        method: "PATCH",
        headers: {
            "Tus-Resumable": "1.0.0",
            "Upload-Offset": String(offset),
            "Content-Type": "application/offset+octet-stream"
        },
        body,
        duplex: "half"
    } as RequestInit);

    describe("the upload URL behind a TLS-terminating proxy", () => {
        it("resolves to the scheme and host the client used, not the one the socket saw", async () => {
            // `@hono/node-server` takes the scheme from the socket, so behind
            // Cloud Run, an ingress or a load balancer the server sees `http`.
            // An absolute `http://` Location sends every PATCH from an HTTPS
            // page to a mixed-content URL the browser blocks.
            const res = await app.request("http://api.example.com/api/storage/tus", {
                method: "POST",
                headers: { "Tus-Resumable": "1.0.0", "Upload-Length": "4" }
            });
            expect(res.status).toBe(201);
            const location = res.headers.get("Location")!;
            const id = location.split("/").pop()!;

            expect(location.startsWith("http:")).toBe(false);
            // What a TUS client does with it: resolve it against the endpoint it called.
            expect(new URL(location, "https://api.example.com/api/storage/tus").href)
                .toBe(`https://api.example.com/api/storage/tus/${id}`);

            const head = await app.request(`http://api.example.com${new URL(location, "http://x").pathname}`, { method: "HEAD" });
            expect(head.status).toBe(200);
        });
    });

    describe("two PATCHes at the same offset — a client retrying a stalled chunk", () => {
        it("stores the chunk once, and refuses the second while the first is in flight", async () => {
            const id = await create("docs/report.txt", 10);

            const [first, second] = await Promise.all([
                patch(id, 0, slowBody("hello", 100)),
                patch(id, 0, slowBody("hello", 100))
            ]);

            const statuses = [first.status, second.status].sort();
            // 423 Locked is what tusd answers and what tus-js-client retries.
            expect(statuses).toEqual([204, 423]);
            const accepted = first.status === 204 ? first : second;
            expect(accepted.headers.get("Upload-Offset")).toBe("5");

            const head = await app.request(`http://api.example.com/api/storage/tus/${id}`, { method: "HEAD" });
            expect(head.headers.get("Upload-Offset")).toBe("5");

            // The rest of the file, at the offset the server reports.
            expect((await patch(id, 5, "world")).status).toBe(204);
            expect(fs.readFileSync(path.join(root, "default/docs/report.txt"), "utf-8")).toBe("helloworld");
        });

        it("does not let a stale offset append after the lock is released", async () => {
            const id = await create("docs/stale.txt", 10);
            expect((await patch(id, 0, "hello")).status).toBe(204);

            // The retry of the chunk that already landed.
            const retry = await patch(id, 0, "hello");
            expect(retry.status).toBe(409);

            expect((await patch(id, 5, "world")).status).toBe(204);
            expect(fs.readFileSync(path.join(root, "default/docs/stale.txt"), "utf-8")).toBe("helloworld");
        });
    });
});
