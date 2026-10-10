import { uploadResumable, type ResumableUploadResponse, type ResumableUploadSend } from "../src/util/resumable-upload";

/**
 * The resumable (TUS) upload the SDK and the admin panel use for large files,
 * against an in-memory stand-in for the server's endpoint.
 */

const RESULT = { key: "videos/clip.mp4", bucket: "default", storageUrl: "local://default/videos/clip.mp4" };

interface FakeServer {
    send: ResumableUploadSend;
    requests: string[];
    /** The bytes the server holds for the upload. */
    received(): Uint8Array;
    finalized: number;
    /** Make the next requests of a kind answer something else. */
    script: { method: string; status?: number; drop?: boolean; afterWrite?: boolean }[];
}

function fakeServer(options: { marker?: boolean; createStatus?: number } = {}): FakeServer {
    let size = 0;
    let bytes = new Uint8Array(0);
    let exists = false;
    const server: FakeServer = {
        requests: [],
        finalized: 0,
        script: [],
        received: () => bytes,
        send: async (method, path, headers, body) => {
            server.requests.push(`${method} ${path}${headers["Upload-Offset"] !== undefined ? ` @${headers["Upload-Offset"]}` : ""}`);
            const respond = (status: number, values: Record<string, string> = {}): ResumableUploadResponse => ({
                status,
                header: (name) => values[name] ?? null,
                ...(status >= 400 ? { error: Object.assign(new Error(`status ${status}`), { status }) } : {})
            });
            const scripted = server.script.findIndex(entry => entry.method === method);
            const step = scripted >= 0 ? server.script.splice(scripted, 1)[0] : undefined;

            if (method === "POST") {
                if (options.createStatus) return respond(options.createStatus);
                size = Number(headers["Upload-Length"]);
                exists = true;
                return respond(201, {
                    Location: "/api/storage/tus/0f0e0d0c-0b0a-4908-8706-050403020100",
                    ...(options.marker === false ? {} : { "Rebase-Upload-Result": "on-complete" })
                });
            }
            if (!exists) return respond(404);
            if (method === "DELETE") {
                exists = false;
                return respond(204);
            }
            if (method === "HEAD") return respond(200, { "Upload-Offset": String(bytes.length) });

            // PATCH
            if (step?.status && !step.afterWrite) return respond(step.status);
            const offset = Number(headers["Upload-Offset"]);
            if (offset !== bytes.length) return respond(409);
            const chunk = new Uint8Array(await body!.arrayBuffer());
            const next = new Uint8Array(offset + chunk.length);
            next.set(bytes.subarray(0, offset));
            next.set(chunk, offset);
            bytes = next;
            if (step?.drop) throw Object.assign(new Error("socket hang up"), { status: 0 });
            if (step?.status) return respond(step.status);
            if (bytes.length >= size) {
                server.finalized++;
                exists = false;
                return respond(204, { "Upload-Offset": String(bytes.length), "Rebase-Upload-Result": encodeURIComponent(JSON.stringify(RESULT)) });
            }
            return respond(204, { "Upload-Offset": String(bytes.length) });
        }
    };
    return server;
}

/** A file of `n` bytes, each its index mod 251, so a misplaced chunk shows. */
function fileOf(n: number): Blob {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) bytes[i] = i % 251;
    return new Blob([bytes], { type: "video/mp4" });
}

const upload = (server: FakeServer, file: Blob) => uploadResumable({
    file,
    metadata: { key: "videos/clip.mp4", filetype: "video/mp4", metadata_caption: "Ünïcode, with a comma" },
    send: server.send,
    chunkSize: 1_000,
    retryDelaysMs: [0, 0, 0]
});

describe("uploadResumable", () => {
    it("sends the file a chunk per request and answers what the server stored", async () => {
        const server = fakeServer();
        const file = fileOf(4_500);

        const outcome = await upload(server, file);

        expect(outcome).toEqual({ stored: RESULT });
        expect(server.requests).toEqual(["POST ", "PATCH /0f0e0d0c-0b0a-4908-8706-050403020100 @0", "PATCH /0f0e0d0c-0b0a-4908-8706-050403020100 @1000",
            "PATCH /0f0e0d0c-0b0a-4908-8706-050403020100 @2000", "PATCH /0f0e0d0c-0b0a-4908-8706-050403020100 @3000",
            "PATCH /0f0e0d0c-0b0a-4908-8706-050403020100 @4000"]);
        expect(server.received()).toEqual(new Uint8Array(await file.arrayBuffer()));
    });

    it("encodes its metadata as TUS does: UTF-8, base64, comma-separated", async () => {
        let header = "";
        const server = fakeServer();
        const send: ResumableUploadSend = (method, path, headers, body) => {
            if (method === "POST") header = headers["Upload-Metadata"];
            return server.send(method, path, headers, body);
        };
        await uploadResumable({ file: fileOf(10), metadata: { key: "a b.txt", metadata_caption: "Ünïcode, with a comma" }, send });

        const decoded = Object.fromEntries(header.split(",").map(pair => {
            const [name, value] = pair.split(" ");
            return [name, new TextDecoder().decode(Uint8Array.from(atob(value), c => c.charCodeAt(0)))];
        }));
        expect(decoded).toEqual({ key: "a b.txt", metadata_caption: "Ünïcode, with a comma" });
    });

    it("resumes from the offset the server holds after a dropped connection, sending no byte twice", async () => {
        const server = fakeServer();
        // The chunk at 2,000 arrives, its answer does not.
        server.script.push({ method: "PATCH" }, { method: "PATCH" }, { method: "PATCH", drop: true });
        const file = fileOf(4_500);

        expect(await upload(server, file)).toEqual({ stored: RESULT });
        expect(server.received()).toEqual(new Uint8Array(await file.arrayBuffer()));
        expect(server.requests.filter(r => r.startsWith("HEAD"))).toHaveLength(1);
        expect(server.requests.filter(r => r.endsWith("@2000"))).toHaveLength(1);
    });

    it("retries a store that failed at the last chunk: the server still holds the bytes", async () => {
        const server = fakeServer();
        server.script.push({ method: "PATCH" }, { method: "PATCH", status: 502, afterWrite: true });

        expect(await upload(server, fileOf(1_500))).toEqual({ stored: RESULT });
        expect(server.finalized).toBe(1);
        // The retry is the empty PATCH at the end, which runs the store again.
        expect(server.requests.at(-1)).toBe("PATCH /0f0e0d0c-0b0a-4908-8706-050403020100 @1500");
    });

    it("throws a refusal as the multipart route would have", async () => {
        await expect(upload(fakeServer({ createStatus: 413 }), fileOf(10))).rejects.toMatchObject({ status: 413 });
        await expect(upload(fakeServer({ createStatus: 403 }), fileOf(10))).rejects.toMatchObject({ status: 403 });
    });

    it("gives up after its retries, with the last failure", async () => {
        const server = fakeServer();
        server.script.push(...Array.from({ length: 4 }, () => ({ method: "PATCH", status: 503 })));
        await expect(upload(server, fileOf(1_500))).rejects.toMatchObject({ status: 503 });
    });

    describe("answers unavailable, for the multipart route to carry the file", () => {
        it("on a server without the endpoint", async () => {
            for (const status of [404, 405, 501]) {
                expect(await upload(fakeServer({ createStatus: status }), fileOf(10))).toEqual({ unavailable: expect.any(String) });
            }
        });

        it("on a server that will not report the stored object, cancelling the upload it made", async () => {
            const server = fakeServer({ marker: false });
            expect(await upload(server, fileOf(10))).toEqual({ unavailable: expect.any(String) });
            expect(server.requests).toEqual(["POST ", "DELETE /0f0e0d0c-0b0a-4908-8706-050403020100"]);
        });

        it("when the upload is not known where a chunk landed — another instance", async () => {
            const server = fakeServer();
            server.script.push({ method: "PATCH" }, { method: "PATCH", status: 404 });
            expect(await upload(server, fileOf(4_500))).toEqual({ unavailable: expect.any(String) });
        });

        it("when a chunk is over the server's body limit", async () => {
            const server = fakeServer();
            server.script.push({ method: "PATCH", status: 413 });
            expect(await upload(server, fileOf(4_500))).toEqual({ unavailable: expect.any(String) });
            expect(server.requests.at(-1)).toMatch(/^DELETE /);
        });
    });
});
