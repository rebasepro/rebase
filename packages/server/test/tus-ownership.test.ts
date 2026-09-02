import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import { errorHandler } from "../src/api/errors";
import { TusHandler } from "../src/storage/tus-handler";
import type { StorageController } from "../src/storage/storage-controller";

/**
 * A resumable upload is authorized once, at creation, and then finished on
 * later requests — sometimes much later ones. Until now the only thing those
 * later requests checked was the upload id, which made the id a bearer token:
 * it travels in a `Location` header, proxies log it, and the client holds it
 * for the life of the transfer. Anyone who came by one could read the progress
 * of someone else's upload, finish it with their own bytes under the key its
 * owner had been authorized for, or cancel it outright.
 */
describe("who may continue a resumable upload", () => {
    let scratch: string;

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tus-own-"));
    });
    afterEach(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    const controller = () => {
        const stored: Array<{ key: string }> = [];
        const ctrl = {
            putObject: async ({ key }: { key: string }) => {
                stored.push({ key });
                return { key };
            }
        } as unknown as StorageController;
        return { ctrl, stored };
    };

    /**
     * The routes, with a middleware that plays whichever principal the request
     * asks for — the storage router's auth middleware, reduced to the one thing
     * this is about.
     */
    function app(handler: TusHandler) {
        const a = new Hono();
        a.onError(errorHandler);
        a.use("/*", async (c, next) => {
            const as = c.req.header("X-Test-User");
            if (as) c.set("user", JSON.parse(as));
            await next();
        });
        a.post("/tus", (c) => handler.create(c));
        a.get("/tus/:id", (c) => handler.head(c, c.req.param("id")));
        a.patch("/tus/:id", (c) => handler.patch(c, c.req.param("id")));
        a.delete("/tus/:id", (c) => handler.delete(c, c.req.param("id")));
        return a;
    }

    const as = (user: Record<string, unknown> | null) =>
        user ? { "X-Test-User": JSON.stringify(user) } : {};

    async function create(a: Hono, owner: Record<string, unknown> | null, body = "hello") {
        const res = await a.request("/tus", {
            method: "POST",
            headers: {
                "Upload-Length": String(Buffer.byteLength(body)),
                "Upload-Metadata": `key ${Buffer.from("alice/note.txt").toString("base64")}`,
                ...as(owner)
            }
        });
        return res.headers.get("Location")!.split("/").pop()!;
    }

    it("refuses a stranger the progress of someone else's upload", async () => {
        const { ctrl } = controller();
        const a = app(new TusHandler(scratch, ctrl));
        const id = await create(a, { uid: "alice" });

        const res = await a.request(`/tus/${id}`, { headers: as({ uid: "mallory" }) });

        // 404, not 403: whether an id exists is not a stranger's to learn.
        expect(res.status).toBe(404);
    });

    it("refuses a stranger finishing the upload under the owner's key", async () => {
        const { ctrl, stored } = controller();
        const a = app(new TusHandler(scratch, ctrl));
        const id = await create(a, { uid: "alice" });

        const res = await a.request(`/tus/${id}`, {
            method: "PATCH",
            headers: {
                "Upload-Offset": "0",
                "Content-Type": "application/offset+octet-stream",
                ...as({ uid: "mallory" })
            },
            body: "hello"
        });

        expect(res.status).toBe(404);
        expect(stored).toEqual([]);
    });

    it("refuses a stranger cancelling it", async () => {
        const { ctrl } = controller();
        const a = app(new TusHandler(scratch, ctrl));
        const id = await create(a, { uid: "alice" });

        expect((await a.request(`/tus/${id}`, {
            method: "DELETE", headers: as({ uid: "mallory" })
        })).status).toBe(404);

        // Still there for its owner.
        expect((await a.request(`/tus/${id}`, { headers: as({ uid: "alice" }) })).status).toBe(200);
    });

    it("lets the owner finish their own upload", async () => {
        const { ctrl, stored } = controller();
        const a = app(new TusHandler(scratch, ctrl));
        const id = await create(a, { uid: "alice" });

        const res = await a.request(`/tus/${id}`, {
            method: "PATCH",
            headers: {
                "Upload-Offset": "0",
                "Content-Type": "application/offset+octet-stream",
                ...as({ uid: "alice" })
            },
            body: "hello"
        });

        expect(res.status).toBe(204);
        expect(stored.map(s => s.key)).toEqual(["alice/note.txt"]);
    });

    it("lets an administrator cancel a stuck upload", async () => {
        const { ctrl } = controller();
        const a = app(new TusHandler(scratch, ctrl));
        const id = await create(a, { uid: "alice" });

        const res = await a.request(`/tus/${id}`, {
            method: "DELETE",
            headers: as({ uid: "ops", roles: ["admin"] })
        });

        expect(res.status).toBe(204);
    });

    /**
     * An anonymous deployment (`requireAuth: false`) has no owner to compare
     * against, and narrowing here would break the resumable path on public
     * sites while changing nothing about the rest of storage.
     */
    it("leaves an ownerless upload reachable", async () => {
        const { ctrl } = controller();
        const a = app(new TusHandler(scratch, ctrl));
        const id = await create(a, null);

        expect((await a.request(`/tus/${id}`)).status).toBe(200);
    });
});

describe("the size a resumable upload may declare", () => {
    let scratch: string;

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-tus-size-"));
    });
    afterEach(() => {
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    function app(handler: TusHandler) {
        const a = new Hono();
        a.onError(errorHandler);
        a.post("/tus", (c) => handler.create(c));
        return a;
    }

    const ctrl = { putObject: async ({ key }: { key: string }) => ({ key }) } as unknown as StorageController;

    /**
     * The per-upload ceiling was 5 GB whatever the deployment had configured,
     * and the controller's own check only ran at finalize — after every byte
     * had been received and written to the temp directory.
     */
    it("refuses at creation a length above the configured maximum", async () => {
        const a = app(new TusHandler(scratch, ctrl, undefined, undefined, undefined, 1024));

        const res = await a.request("/tus", {
            method: "POST",
            headers: {
                "Upload-Length": "4096",
                "Upload-Metadata": `key ${Buffer.from("big.bin").toString("base64")}`
            }
        });

        expect(res.status).toBe(413);
        expect(fs.existsSync(path.join(scratch, ".tus-uploads"))
            ? fs.readdirSync(path.join(scratch, ".tus-uploads"))
            : []).toEqual([]);
    });

    it("accepts one at the maximum", async () => {
        const a = app(new TusHandler(scratch, ctrl, undefined, undefined, undefined, 1024));

        const res = await a.request("/tus", {
            method: "POST",
            headers: {
                "Upload-Length": "1024",
                "Upload-Metadata": `key ${Buffer.from("ok.bin").toString("base64")}`
            }
        });

        expect(res.status).toBe(201);
    });
});
