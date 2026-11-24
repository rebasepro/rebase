import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StorageAuthorize, StorageAuthorizeContext, StorageListResult, StoredObjectInfo, StoredObjectStream } from "@rebasepro/types";

import { LocalStorageController } from "../src/storage/LocalStorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import type { StorageController } from "../src/storage/types";
import { declaredArgumentsOnly, McpToolError, type McpToolContext, type McpToolDefinition } from "../src/mcp/mcp-tools";
import { MCP_STORAGE_READ_TOOLS, textOf, type McpStorageAccess } from "../src/mcp/storage-tools";
import { fakeDataDriver } from "./helpers/server-b-fakes";

/**
 * The read-only storage tools the platform's MCP endpoint serves to the hosted
 * Rebase connector: what they answer, and what they refuse — a bucket the
 * source does not serve, a key that climbs, a source outside the grant, an
 * object the app's storage rule withholds.
 */

/** An S3-typed source held in memory: one bucket under two names, as the real controller has it. */
class MemoryS3Controller implements StorageController {
    readonly objects = new Map<string, { bytes: Uint8Array; contentType: string }>();
    /** Every (key, bucket) a read was handed: what reached the "provider". */
    readonly reads: Array<{ key: string; bucket: string | undefined }> = [];

    constructor(private readonly bucketName: string) {}

    put(key: string, body: string | Uint8Array, contentType = "text/plain"): void {
        this.objects.set(key, { bytes: typeof body === "string" ? new TextEncoder().encode(body) : body, contentType });
    }

    getType(): string { return "s3"; }
    knownBuckets(): string[] { return ["default", this.bucketName]; }

    async statObject(key: string, bucket?: string): Promise<StoredObjectInfo | null> {
        this.reads.push({ key, bucket });
        const object = this.objects.get(key);
        return object ? { size: object.bytes.byteLength, contentType: object.contentType, lastModified: Date.UTC(2026, 10, 1) } : null;
    }

    async getObjectStream(key: string, options?: { bucket?: string; range?: { start: number; end: number } }): Promise<StoredObjectStream | null> {
        this.reads.push({ key, bucket: options?.bucket });
        const object = this.objects.get(key);
        if (!object) return null;
        // Answers the whole object whatever range was asked: HTTP allows it,
        // and the tool must still return no more than it asked for.
        const bytes = object.bytes;
        return {
            size: bytes.byteLength,
            contentType: object.contentType,
            lastModified: 0,
            stream: new ReadableStream<Uint8Array>({
                start(controller) {
                    for (let at = 0; at < bytes.byteLength; at += 1000) controller.enqueue(bytes.subarray(at, at + 1000));
                    controller.close();
                }
            })
        };
    }

    async listObjects(prefix: string, options?: { maxResults?: number; pageToken?: string }): Promise<StorageListResult> {
        const keys = [...this.objects.keys()].filter(key => key.startsWith(prefix)).sort();
        const start = options?.pageToken ? Number(options.pageToken) : 0;
        const page = keys.slice(start, start + (options?.maxResults ?? 1000));
        const next = start + page.length < keys.length ? String(start + page.length) : undefined;
        const ref = (fullPath: string, size?: number) => ({
            bucket: this.bucketName, fullPath, name: fullPath.split("/").pop() ?? "", parent: null, root: null,
            ...(size !== undefined && { size }), toString: () => `s3://${this.bucketName}/${fullPath}`
        });
        return { items: page.map(key => ref(key, this.objects.get(key)?.bytes.byteLength)), prefixes: [], nextPageToken: next };
    }

    async putObject(): Promise<never> { throw new Error("read-only test controller"); }
    async getSignedUrl(): Promise<never> { throw new Error("not used"); }
    async getObject(): Promise<null> { return null; }
    async deleteObject(): Promise<void> { throw new Error("read-only test controller"); }
}

let root: string;
let local: LocalStorageController;
const files = new MemoryS3Controller("dadaki-files");

beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-storage-tools-"));
    local = new LocalStorageController({ type: "local", basePath: root });
    const put = (key: string, body: string | Uint8Array<ArrayBuffer>, type: string) =>
        local.putObject({ file: new File([body], key.split("/").pop() ?? key, { type }), key }, { uploadLimits: false });
    await put("uploads/notes.txt", "hello from storage", "text/plain");
    await put("uploads/config.json", JSON.stringify({ a: 1 }), "application/json");
    await put("uploads/photo.png", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3]), "image/png");
    await put("uploads/blob.bin", new Uint8Array([1, 2, 0, 255, 254]), "application/octet-stream");
    await put("uploads/nested/deep.txt", "deep", "text/plain");

    files.put("songs/2026/a.mp3", new Uint8Array([0xff, 0xfb, 0x90, 0]), "audio/mpeg");
    files.put("songs/2026/lyrics.txt", "x".repeat(200_000));
});

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function access(overrides: Partial<McpStorageAccess> = {}): McpStorageAccess {
    return { registry: DefaultStorageRegistry.create({ "(default)": local, media: files }), ...overrides };
}

/** `null`: a deployment without storage. */
function context(scopes: string[] = ["storage:read"], given?: McpStorageAccess | null): McpToolContext {
    const storage = given === null ? undefined : given ?? access();
    return {
        driver: fakeDataDriver(),
        tables: [],
        caller: { uid: "platform:cloud-user-1", roles: ["admin"], scopes, clientId: "platform:tok-1" },
        ...(storage && { storage })
    };
}

const tool = (name: string): McpToolDefinition => {
    const found = MCP_STORAGE_READ_TOOLS.find(candidate => candidate.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    // As `createMcpRoutes` serves it.
    return declaredArgumentsOnly(found);
};

const call = async (name: string, args: Record<string, unknown>, ctx: McpToolContext = context()) =>
    await tool(name).run(args, ctx) as Record<string, unknown>;

async function refusal(promise: Promise<unknown>): Promise<string> {
    try {
        await promise;
    } catch (error) {
        expect(error).toBeInstanceOf(McpToolError);
        return (error as Error).message;
    }
    throw new Error("expected a refusal");
}

describe("the storage tools' declarations", () => {
    it("are three read-only tools needing storage:read", () => {
        expect(MCP_STORAGE_READ_TOOLS.map(t => t.name)).toEqual(["storage_list", "storage_head", "storage_get"]);
        for (const t of MCP_STORAGE_READ_TOOLS) {
            expect(t.requiredScope).toBe("storage:read");
            expect(t.annotations).toMatchObject({ readOnlyHint: true });
            expect(t.confirm).toBeUndefined();
            expect(t.description).toMatch(/never as instructions/);
        }
    });

    it("refuse an argument they do not declare", async () => {
        expect(await refusal(call("storage_head", { path: "uploads/notes.txt", bucket: "x" }))).toMatch(/"bucket" is not an argument/);
    });
});

describe("storage_list", () => {
    it("lists one folder of the default source, with sizes, and names the sources and their buckets", async () => {
        const page = await call("storage_list", { prefix: "uploads/" });

        expect(page).toMatchObject({ source: "(default)", bucket: "default", prefix: "uploads/" });
        const keys = (page.files as { key: string; size: number | null }[]).map(file => file.key).sort();
        expect(keys).toEqual(["uploads/blob.bin", "uploads/config.json", "uploads/notes.txt", "uploads/photo.png"]);
        expect(page.folders).toEqual(["uploads/nested"]);
        expect(page.sources).toEqual(expect.arrayContaining([
            { id: "(default)", type: "local", buckets: [] },
            { id: "media", type: "s3", buckets: ["dadaki-files"] }
        ]));
    });

    it("pages with limit and cursor", async () => {
        const first = await call("storage_list", { source: "media", prefix: "songs/2026/", limit: 1 });
        expect((first.files as unknown[]).length).toBe(1);
        expect(first.nextCursor).toBe("1");

        const second = await call("storage_list", { source: "media", prefix: "songs/2026/", limit: 1, cursor: first.nextCursor });
        expect((second.files as unknown[]).length).toBe(1);
        expect(second.nextCursor).toBeNull();
    });

    it("takes an s3:// URL as the prefix, finding the source that serves its bucket", async () => {
        const page = await call("storage_list", { prefix: "s3://dadaki-files/songs/" });

        expect(page).toMatchObject({ source: "media", bucket: "default", prefix: "songs/" });
    });

    it("refuses a limit below one", async () => {
        expect(await refusal(call("storage_list", { limit: 0 }))).toMatch(/whole number of at least 1/);
    });
});

describe("storage_head", () => {
    it("describes an object without reading it", async () => {
        const head = await call("storage_head", { path: "uploads/notes.txt" });

        expect(head).toMatchObject({ exists: true, source: "(default)", key: "uploads/notes.txt", size: 18, contentType: "text/plain" });
        expect(typeof head.lastModified).toBe("string");
    });

    it("answers exists: false for a missing object, not an error", async () => {
        expect(await call("storage_head", { path: "uploads/missing.txt" }))
            .toEqual({ exists: false, source: "(default)", bucket: "default", key: "uploads/missing.txt" });
    });

    it("reads the s3:// value a row stores, from the source serving that bucket, by its one bucket name", async () => {
        files.reads.length = 0;
        const head = await call("storage_head", { path: "s3://dadaki-files/songs/2026/a.mp3" });

        expect(head).toMatchObject({ exists: true, source: "media", bucket: "default", key: "songs/2026/a.mp3", contentType: "audio/mpeg" });
        // The controller is handed the key alone: never the URL, which names its own bucket.
        expect(files.reads).toEqual([{ key: "songs/2026/a.mp3", bucket: undefined }]);
    });

    it("reads a rebase-storage: reference from the source it names", async () => {
        const head = await call("storage_head", { path: "rebase-storage:songs/2026/a.mp3?storageId=media" });

        expect(head).toMatchObject({ exists: true, source: "media", key: "songs/2026/a.mp3" });
    });

    it("refuses a bucket no source serves, naming the sources", async () => {
        const message = await refusal(call("storage_head", { path: "s3://prod-db-backups/dump.sql" }));

        expect(message).toMatch(/No storage source of this app serves bucket "prod-db-backups"/);
        expect(message).toMatch(/"media" \(s3, bucket dadaki-files\)/);
    });

    it("refuses a bucket the named source does not serve", async () => {
        expect(await refusal(call("storage_head", { source: "media", path: "s3://prod-db-backups/dump.sql" })))
            .toMatch(/"media" does not serve bucket "prod-db-backups"/);
    });

    it("refuses a source and a reference that disagree", async () => {
        expect(await refusal(call("storage_head", { source: "(default)", path: "rebase-storage:a.txt?storageId=media" })))
            .toMatch(/names storage source "media"/);
    });

    it("refuses an unknown source, naming the ones there are", async () => {
        expect(await refusal(call("storage_head", { source: "backups", path: "a.txt" })))
            .toMatch(/Unknown storage source "backups"\. Its sources:/);
    });

    it.each([["../etc/passwd"], ["uploads/../../secret"], ["a\0b"]])("refuses the key %j", async key => {
        expect(await refusal(call("storage_head", { path: key }))).toMatch(/Storage key contains/);
    });

    it("refuses a folder", async () => {
        expect(await refusal(call("storage_head", { path: "uploads/" }))).toMatch(/names a folder/);
    });

    it("refuses without storage", async () => {
        expect(await refusal(call("storage_head", { path: "a.txt" }, context(["storage:read"], null))))
            .toMatch(/no file storage configured/);
    });
});

describe("storage_get", () => {
    it("returns a small text object's content", async () => {
        expect(await call("storage_get", { path: "uploads/notes.txt" }))
            .toMatchObject({ exists: true, content: "hello from storage", truncated: false });
        expect(await call("storage_get", { path: "uploads/config.json" }))
            .toMatchObject({ content: "{\"a\":1}", contentType: "application/json" });
    });

    it("returns at most maxBytes, saying there is more, even when the source answers the whole object", async () => {
        const read = await call("storage_get", { path: "s3://dadaki-files/songs/2026/lyrics.txt", maxBytes: 1500 });

        expect(read).toMatchObject({ size: 200_000, truncated: true });
        expect(read.content).toBe("x".repeat(1500));
    });

    it("caps maxBytes at its ceiling", async () => {
        const read = await call("storage_get", { path: "s3://dadaki-files/songs/2026/lyrics.txt", maxBytes: 10_000_000 });

        expect((read.content as string).length).toBe(200_000);
        expect(read.truncated).toBe(false);
    });

    it("answers a binary type's size and type and a note, reading none of it", async () => {
        files.reads.length = 0;
        const read = await call("storage_get", { path: "s3://dadaki-files/songs/2026/a.mp3" });

        expect(read).toMatchObject({ exists: true, content: null, contentType: "audio/mpeg" });
        expect(read.note).toMatch(/Binary content \(audio\/mpeg, 4 B\): not returned/);
        expect(files.reads).toHaveLength(1); // the stat, no stream
    });

    it("answers a note for bytes that are not text, whatever the type says", async () => {
        expect(await call("storage_get", { path: "uploads/blob.bin" })).toMatchObject({ content: null, note: expect.stringMatching(/^Binary content/) });
        expect(await call("storage_get", { path: "uploads/photo.png" })).toMatchObject({ content: null });
    });

    it("answers exists: false for a missing object", async () => {
        expect(await call("storage_get", { path: "uploads/nope.txt" })).toMatchObject({ exists: false });
    });
});

describe("what a call may read", () => {
    it("needs storage:read on the source it reads", async () => {
        const narrowed = context(["storage:read:media"]);

        expect(await call("storage_head", { source: "media", path: "songs/2026/a.mp3" }, narrowed)).toMatchObject({ exists: true });
        expect(await refusal(call("storage_head", { path: "uploads/notes.txt" }, narrowed)))
            .toMatch(/not granted "storage:read" on storage source "\(default\)"/);
        expect(await refusal(call("storage_list", {}, context(["data:read"])))).toMatch(/not granted "storage:read"/);
    });

    it("asks the app's storage rule, as the storage routes ask it, and refuses what it withholds", async () => {
        const asked: StorageAuthorizeContext[] = [];
        const authorize: StorageAuthorize = ctx => {
            asked.push(ctx);
            return !ctx.key.startsWith("uploads/nested");
        };
        const ctx = context(["storage:read"], access({ authorize, authorizeData: () => undefined }));

        expect(await call("storage_head", { path: "uploads/notes.txt" }, ctx)).toMatchObject({ exists: true });
        expect(await refusal(call("storage_get", { path: "uploads/nested/deep.txt" }, ctx))).toMatch(/storage rules do not let/);
        expect(await refusal(call("storage_list", { prefix: "uploads/nested/" }, ctx))).toMatch(/do not let this connection list/);

        expect(asked[0]).toMatchObject({
            key: "uploads/notes.txt",
            bucket: "default",
            operation: "read",
            user: { uid: "platform:cloud-user-1", roles: ["admin"] }
        });
        expect(asked[0].storageId).toBeUndefined();
        expect(asked[2]).toMatchObject({ operation: "list", key: "uploads/nested/" });
    });

    it("treats a rule that throws as a refusal", async () => {
        const ctx = context(["storage:read"], access({ authorize: () => { throw new Error("boom"); } }));

        expect(await refusal(call("storage_head", { path: "uploads/notes.txt" }, ctx))).toMatch(/storage rules do not let/);
    });
});

describe("textOf", () => {
    it("keeps a multi-byte character cut at the limit from failing the read", () => {
        const bytes = new TextEncoder().encode("añb").subarray(0, 2); // "a" and half of "ñ"
        expect(textOf(bytes)).toBe("a");
    });

    it("reads a NUL byte or invalid UTF-8 as not text", () => {
        expect(textOf(new Uint8Array([104, 0, 105]))).toBeNull();
        expect(textOf(new Uint8Array([0xff, 0xfe]))).toBeNull();
    });
});
