import { describe, it, expect, beforeEach } from "@jest/globals";
/**
 * Platform storage: what the controller does that the shared contract
 * (storage-controller-contract.test.ts, which runs it beside local, S3 and
 * GCS) cannot see — the broker in between. Reads surviving a broker outage,
 * URLs re-signed when they expire or are revoked, the broker's refusals as
 * the errors a route answers with, multipart uploads cleaned up on failure,
 * references from before a migration, and how the type is chosen at boot.
 */
import { PlatformStorageController } from "../src/storage/PlatformStorageController";
import { createStorageController } from "../src/storage";
import { resolveStorageBackend } from "../src/boot/sources";
import { createPlatformWorld, PLATFORM_BROKER, PLATFORM_KEY, PLATFORM_PROJECT, type PlatformWorld } from "./helpers/fake-platform-store";

let world: PlatformWorld;
let controller: PlatformStorageController;
const make = (overrides: { serviceKey?: string; source?: string } = {}) => new PlatformStorageController(
    { type: "platform",
brokerUrl: PLATFORM_BROKER,
projectId: PLATFORM_PROJECT,
serviceKey: overrides.serviceKey ?? PLATFORM_KEY,
source: overrides.source ?? "(default)" },
    { fetch: world.fetch,
now: world.now,
sleep: async () => undefined }
);
const text = (name: string, body: string, type = "text/plain") => new File([Buffer.from(body)], name, { type });
const readText = async (key: string) => {
    const file = await controller.getObject(key);
    return file ? Buffer.from(await file.arrayBuffer()).toString() : null;
};

beforeEach(() => {
    world = createPlatformWorld();
    controller = make();
});

describe("platform storage: where the bytes go", () => {
    it("writes under the project's prefix, and the store sees nothing else", async () => {
        await controller.putObject({ file: text("a.txt", "hi"),
key: "docs/a.txt" });
        expect([...world.objects.keys()]).toEqual([`p/${PLATFORM_PROJECT}/_/docs/a.txt`]);
        expect(world.brokerCalls).toEqual([["put"]]);
    });

    it("answers an upload with s3://default/<key>, which every client already reads as the key", async () => {
        const result = await controller.putObject({ file: text("a.txt", "hi"),
key: "docs/a.txt" });
        expect(result).toEqual({ key: "docs/a.txt",
bucket: "default",
storageUrl: "s3://default/docs/a.txt" });
        expect(await readText(result.storageUrl)).toBe("hi");
    });

    it("reads a reference written while the files were in the project's own bucket", async () => {
        await controller.putObject({ file: text("a.txt", "migrated"),
key: "uploads/a.txt" });
        expect(await readText("s3://rebase-578f2-tenant-0123456789ab/uploads/a.txt")).toBe("migrated");
        expect(await readText("gs://some-old-bucket/uploads/a.txt")).toBe("migrated");
        await controller.deleteObject("s3://rebase-578f2-tenant-0123456789ab/uploads/a.txt");
        expect(await readText("uploads/a.txt")).toBeNull();
    });

    it("drops anything a listing returns outside the prefix", async () => {
        await controller.putObject({ file: text("a.txt", "a"),
key: "l/a.txt" });
        world.objects.set(`p/${PLATFORM_PROJECT}/_/l/b.txt`, { body: Buffer.from("b"),
type: "text/plain",
meta: {},
modified: 0 });
        const listing = await controller.listObjects("l");
        expect(listing.items.map((i) => i.fullPath)).toEqual(["l/a.txt", "l/b.txt"]);
        expect(listing.items.every((i) => !i.fullPath.startsWith("p/"))).toBe(true);
    });

    it("percent-encodes metadata a header cannot carry", async () => {
        await controller.putObject({ file: text("a.txt", "x"),
key: "m/a.txt",
metadata: { owner: "zoë",
tags: ["a", "b"] } });
        const meta = await controller.getMetadata("m/a.txt");
        expect(meta?.customMetadata).toEqual({ owner: "zo%C3%AB",
tags: "[\"a\",\"b\"]" });
    });
});

describe("platform storage: when the broker is down", () => {
    it("keeps serving a file it has read before, from its cached URL", async () => {
        await controller.putObject({ file: text("a.txt", "cached"),
key: "c/a.txt" });
        expect(await readText("c/a.txt")).toBe("cached");
        world.brokerDown = true;
        expect(await readText("c/a.txt")).toBe("cached");
        world.advance(50 * 60_000); // still five minutes inside the hour
        expect(await readText("c/a.txt")).toBe("cached");
    });

    it("answers 503 STORAGE_UNAVAILABLE for anything it has no URL for, and for every write", async () => {
        world.brokerDown = true;
        await expect(controller.getObject("c/never-read.txt")).rejects.toMatchObject({ statusCode: 503,
code: "STORAGE_UNAVAILABLE" });
        await expect(controller.putObject({ file: text("a.txt", "x"),
key: "c/a.txt" })).rejects.toMatchObject({ statusCode: 503,
code: "STORAGE_UNAVAILABLE" });
        await expect(controller.listObjects("c")).rejects.toMatchObject({ statusCode: 503 });
    });

    it("retries once after a 503 or 429 from the broker, then gives up with a status the route can return", async () => {
        world.brokerStatus.push(503);
        await controller.putObject({ file: text("a.txt", "x"),
key: "r/a.txt" });
        world.brokerStatus.push(429, 429);
        await expect(controller.deleteObject("r/a.txt")).rejects.toMatchObject({ statusCode: 429,
code: "STORAGE_RATE_LIMITED" });
    });
});

describe("platform storage: expiry, skew and revocation", () => {
    it("re-signs a cached read URL once it is within five minutes of expiring", async () => {
        await controller.putObject({ file: text("a.txt", "x"),
key: "e/a.txt" });
        await readText("e/a.txt");
        const before = world.brokerCalls.length;
        world.advance(55 * 60_000 + 1);
        expect(await readText("e/a.txt")).toBe("x");
        expect(world.brokerCalls.length).toBe(before + 1);
    });

    it("re-signs once when the store refuses a cached URL — a key rotation, or a store clock ahead of ours", async () => {
        await controller.putObject({ file: text("a.txt", "rotated"),
key: "e/a.txt" });
        await readText("e/a.txt");
        world.advance(1000);
        world.revokedBefore = world.now();
        world.advance(1000);
        expect(await readText("e/a.txt")).toBe("rotated");
    });

    it("re-signs a multipart part refused mid-upload, and finishes the upload", async () => {
        world.storeFailures.set("multipart-part", [403]);
        const big = new File([Buffer.alloc(9 * 1024 * 1024, 7)], "big.bin");
        await controller.putObject({ file: big,
key: "mp/big.bin" }, { uploadLimits: false });
        expect(world.objects.get(`p/${PLATFORM_PROJECT}/_/mp/big.bin`)?.body.byteLength).toBe(9 * 1024 * 1024);
        expect(world.uploads.size).toBe(0);
    });
});

describe("platform storage: multipart", () => {
    it("uploads a large file in parts, each signed for its exact length", async () => {
        const big = new File([Buffer.alloc(17 * 1024 * 1024, 1)], "big.bin");
        await controller.putObject({ file: big,
key: "mp/big.bin" }, { uploadLimits: false });
        expect(world.brokerCalls.flat()).toEqual(["multipart-create", "multipart-part", "multipart-part", "multipart-part", "multipart-complete"]);
        expect(world.objects.get(`p/${PLATFORM_PROJECT}/_/mp/big.bin`)?.body.byteLength).toBe(17 * 1024 * 1024);
    });

    it("aborts the upload when a part fails, leaving no object and no parts", async () => {
        world.storeFailures.set("multipart-part", [500]);
        const big = new File([Buffer.alloc(9 * 1024 * 1024, 1)], "big.bin");
        await expect(controller.putObject({ file: big,
key: "mp/fail.bin" }, { uploadLimits: false })).rejects.toMatchObject({ statusCode: 502 });
        expect(world.brokerCalls.flat()).toContain("multipart-abort");
        expect(world.uploads.size).toBe(0);
        expect(await controller.getObject("mp/fail.bin")).toBeNull();
    });

    it("streams a short body as one PUT of its exact length", async () => {
        const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(Buffer.from("short")); c.close(); } });
        const result = await controller.putObjectStream({ stream,
key: "s/short.txt" });
        expect(result.size).toBe(5);
        expect(world.brokerCalls.flat()).toEqual(["put"]);
    });
});

describe("platform storage: the broker's refusals", () => {
    it.each([
        ["quota_exceeded", 413, "STORAGE_QUOTA_EXCEEDED"],
        ["invalid_key", 400, "INVALID_STORAGE_KEY"],
        ["ledger_unavailable", 503, "STORAGE_UNAVAILABLE"]
    ])("%s → %s %s", async (code, statusCode, apiCode) => {
        world.refuse.set("put", code);
        await expect(controller.putObject({ file: text("a.txt", "x"),
key: "q/a.txt" })).rejects.toMatchObject({ statusCode,
code: apiCode });
    });

    it("refuses a key the broker refuses, before anything reaches the store", async () => {
        await expect(controller.getObject("../../other/_/secret")).rejects.toMatchObject({ statusCode: 400 });
        expect(world.storeCalls).toEqual([]);
    });

    it("answers 502 STORAGE_MISCONFIGURED for a stale service key, and 501 for a source with no platform storage", async () => {
        await expect(make({ serviceKey: "rsk_old" }).getObject("a")).rejects.toMatchObject({ statusCode: 502,
code: "STORAGE_MISCONFIGURED" });
        await expect(make({ source: "media" }).getObject("a")).rejects.toMatchObject({ statusCode: 501,
code: "STORAGE_NOT_CONFIGURED" });
    });
});

describe("platform storage at boot", () => {
    const env = {
        STORAGE_TYPE: "platform",
        STORAGE_BROKER_URL: "http://cp.rebase-saas.svc.cluster.local:3003",
        STORAGE_BROKER_PROJECT: PLATFORM_PROJECT,
        REBASE_SERVICE_KEY: PLATFORM_KEY
    };

    it("resolves STORAGE_TYPE=platform into a config naming the source, and builds the controller", async () => {
        const config = resolveStorageBackend(env, "(default)", undefined, "/uploads");
        expect(config).toEqual({ type: "platform",
brokerUrl: env.STORAGE_BROKER_URL,
projectId: PLATFORM_PROJECT,
serviceKey: PLATFORM_KEY,
source: "(default)" });
        const media = resolveStorageBackend({ ...env,
STORAGE_TYPE__MEDIA: "platform" }, "media", undefined, "/uploads");
        expect(media).toMatchObject({ type: "platform",
source: "media" });
        expect((await createStorageController(config!)).getType()).toBe("platform");
    });

    it("refuses an explicit platform type missing what the platform sets, naming it", () => {
        expect(() => resolveStorageBackend({ STORAGE_TYPE: "platform",
REBASE_SERVICE_KEY: "k" }, "(default)", undefined, "/uploads"))
            .toThrow(/STORAGE_BROKER_URL, STORAGE_BROKER_PROJECT are unset/);
    });

    it("leaves the other types exactly as they were", () => {
        expect(resolveStorageBackend({ STORAGE_TYPE: "s3",
S3_BUCKET: "b",
S3_ACCESS_KEY_ID: "k",
S3_SECRET_ACCESS_KEY: "s" }, "(default)", undefined, "/uploads"))
            .toMatchObject({ type: "s3",
bucket: "b" });
        expect(resolveStorageBackend({}, "(default)", undefined, "/uploads")).toMatchObject({ type: "local",
implicit: true });
    });
});
