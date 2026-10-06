import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * The built-in controllers write a file a chunk (S3: a part) at a time.
 *
 * Each `putObject` began with `await file.arrayBuffer()`: the whole file in
 * memory, copied again on the way to the SDK. `POST /upload` held a 50 MB file
 * three to five times over, TUS finalize twice — a disk-backed `File` read
 * whole defeats the point of it being disk-backed — and a backup dump went the
 * same way. These pin what keeps memory flat: the whole file is never read at
 * once, and an S3 upload is parts of bounded size.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { s3World, gcsWorld, multipartUploads } from "./helpers/fake-object-stores";

jest.mock("@aws-sdk/client-s3", () => {
    const actual = jest.requireActual<Record<string, unknown>>("@aws-sdk/client-s3");
    const { FakeS3Client } = jest.requireActual<typeof import("./helpers/fake-object-stores")>("./helpers/fake-object-stores");
    return { ...actual, S3Client: FakeS3Client };
});
jest.mock("@google-cloud/storage", () => ({
    Storage: jest.requireActual<typeof import("./helpers/fake-object-stores")>("./helpers/fake-object-stores").FakeGcsStorage
}));

import { S3StorageController } from "../src/storage/S3StorageController";
import { GCSStorageController } from "../src/storage/GCSStorageController";
import { LocalStorageController } from "../src/storage/LocalStorageController";

const MiB = 1024 * 1024;
const big = (bytes: number) => Buffer.alloc(bytes, 7);

let dir: string;
beforeEach(async () => {
    dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-writes-"));
    s3World.reset(["b"]);
    gcsWorld.reset(["g"]);
});
afterEach(async () => {
    jest.restoreAllMocks();
    await fs.promises.rm(dir, { recursive: true, force: true });
});

/** A file backed by disk, as TUS finalize and backups hand one over. */
async function diskFile(bytes: number): Promise<File> {
    const p = path.join(dir, "source.bin");
    await fs.promises.writeFile(p, big(bytes));
    return new File([await fs.openAsBlob(p)], "source.bin", { type: "video/mp4" });
}

describe("S3 putObject", () => {
    const s3 = () => new S3StorageController({ type: "s3", bucket: "b", accessKeyId: "x", secretAccessKey: "y", maxFileSize: 64 * MiB });

    it("uploads a large file in parts of at most 8 MiB, never reading it whole", async () => {
        const file = await diskFile(20 * MiB + 3);
        const whole = jest.spyOn(file, "arrayBuffer");
        const parts: number[] = [];
        const { FakeS3Client } = jest.requireActual<typeof import("./helpers/fake-object-stores")>("./helpers/fake-object-stores");
        const send = FakeS3Client.prototype.send;
        jest.spyOn(FakeS3Client.prototype, "send").mockImplementation(async function (this: InstanceType<typeof FakeS3Client>, command) {
            if (command.constructor.name === "UploadPartCommand") parts.push((command.input.Body as Buffer).byteLength);
            return send.call(this, command);
        });

        await s3().putObject({ file, key: "v.mp4" });

        expect(whole).not.toHaveBeenCalled();
        expect(parts).toEqual([8 * MiB, 8 * MiB, 4 * MiB + 3]);
        const stored = s3World.bucket("b")!.get("v.mp4")!;
        expect(stored.body.byteLength).toBe(20 * MiB + 3);
        expect(stored.contentType).toBe("video/mp4");
    });

    it("keeps a small file to one PutObject", async () => {
        await s3().putObject({ file: new File(["hello"], "a.txt", { type: "text/plain" }), key: "a.txt" });
        expect(Buffer.from(s3World.bucket("b")!.get("a.txt")!.body).toString()).toBe("hello");
    });

    it("aborts a multipart upload that fails, leaving no object and no parts", async () => {
        const file = await diskFile(17 * MiB);
        const { FakeS3Client } = jest.requireActual<typeof import("./helpers/fake-object-stores")>("./helpers/fake-object-stores");
        const send = FakeS3Client.prototype.send;
        const names: string[] = [];
        jest.spyOn(FakeS3Client.prototype, "send").mockImplementation(async function (this: InstanceType<typeof FakeS3Client>, command) {
            names.push(command.constructor.name);
            if (command.constructor.name === "UploadPartCommand" && command.input.PartNumber === 2) throw new Error("connection reset");
            return send.call(this, command);
        });

        await expect(s3().putObject({ file, key: "v.mp4" })).rejects.toThrow("connection reset");

        expect(names).toContain("AbortMultipartUploadCommand");
        expect(names).not.toContain("CompleteMultipartUploadCommand");
        expect(s3World.bucket("b")!.get("v.mp4")).toBeUndefined();
        expect(multipartUploads.size).toBe(0);
    });
});

describe("GCS putObject", () => {
    it("streams the file instead of reading it whole", async () => {
        const file = await diskFile(3 * MiB);
        const whole = jest.spyOn(file, "arrayBuffer");

        await new GCSStorageController({ type: "gcs", bucket: "g", maxFileSize: 64 * MiB }).putObject({ file, key: "v.mp4" });

        expect(whole).not.toHaveBeenCalled();
        expect(gcsWorld.bucket("g")!.get("v.mp4")!.body.byteLength).toBe(3 * MiB);
    });
});

describe("local putObject", () => {
    it("streams the file to disk, leaving nothing half-written behind", async () => {
        const file = await diskFile(3 * MiB);
        const whole = jest.spyOn(file, "arrayBuffer");
        const local = new LocalStorageController({ type: "local", basePath: path.join(dir, "store"), maxFileSize: 64 * MiB });

        await local.putObject({ file, key: "media/v.mp4" });

        expect(whole).not.toHaveBeenCalled();
        const written = path.join(dir, "store", "default", "media");
        expect((await fs.promises.stat(path.join(written, "v.mp4"))).size).toBe(3 * MiB);
        expect((await fs.promises.readdir(written)).sort()).toEqual(["v.mp4", "v.mp4.metadata.json"]);
    });

    it("keeps the previous object when a write fails part-way", async () => {
        const local = new LocalStorageController({ type: "local", basePath: path.join(dir, "store") });
        await local.putObject({ file: new File(["original"], "a.txt", { type: "text/plain" }), key: "a.txt" });
        const failing = new File(["x"], "a.txt", { type: "text/plain" });
        Object.defineProperty(failing, "stream", {
            value: () => new ReadableStream({ pull: (c) => c.error(new Error("disk went away")) })
        });

        await expect(local.putObject({ file: failing, key: "a.txt" })).rejects.toThrow("disk went away");

        expect(await fs.promises.readFile(path.join(dir, "store", "default", "a.txt"), "utf-8")).toBe("original");
        expect((await local.listObjects("")).items.map(i => i.name)).toEqual(["a.txt"]);
    });
});
