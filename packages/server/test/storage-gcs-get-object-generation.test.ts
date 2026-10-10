import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
/**
 * `GCSStorageController.getObject` returns the bytes and the version of ONE
 * generation of the object.
 *
 * It used to download the bytes and then ask for the metadata, in two calls.
 * An overwrite landing between them answered the old bytes under the new
 * generation's `updated`, and that `lastModified` is what the routes build the
 * `ETag` and the transform cache key from — so the stale bytes, or a rendition
 * of them, were served and cached as the current version for as long as the
 * new one stood. The durable rendition cache, functions' `rebase.storage` and
 * every custom path still read through `getObject`.
 */
import { GCSStorageController } from "../src/storage/GCSStorageController";
import { gcsWorld, FakeGcsStorage } from "./helpers/fake-object-stores";

jest.mock("@google-cloud/storage", () => ({
    Storage: jest.requireActual<typeof import("./helpers/fake-object-stores")>("./helpers/fake-object-stores").FakeGcsStorage
}));

const BUCKET = "acme-gcs";
const KEY = "covers/hero.png";

/** The fake's file class, whose methods the race is staged on. */
const fileProto = Object.getPrototypeOf(new FakeGcsStorage().bucket(BUCKET).file(KEY)) as {
    download: (...args: unknown[]) => Promise<[Buffer]>;
    getMetadata: (...args: unknown[]) => Promise<unknown>;
};

const V1_AT = Date.UTC(2026, 9, 1, 12, 0, 0);
const V2_AT = V1_AT + 60_000;

function writeVersion(body: string, writtenAt: number): void {
    gcsWorld.write(BUCKET, KEY, {
        body: new TextEncoder().encode(body),
        contentType: "image/png",
        metadata: {},
        writtenAt
    });
}

async function read(controller: GCSStorageController): Promise<{ body: string; lastModified: number } | null> {
    const file = await controller.getObject(KEY);
    if (!file) return null;
    return { body: await file.text(), lastModified: file.lastModified };
}

describe("GCSStorageController.getObject reads one generation", () => {
    let controller: GCSStorageController;
    const spies: { mockRestore(): void }[] = [];

    beforeEach(() => {
        gcsWorld.reset([BUCKET]);
        writeVersion("version-one", V1_AT);
        controller = new GCSStorageController({ type: "gcs", bucket: BUCKET });
    });

    afterEach(() => {
        while (spies.length) spies.pop()!.mockRestore();
    });

    it("returns the bytes it read under the version they belong to when an overwrite follows the read", async () => {
        // The overwrite lands right after the bytes are read.
        const original = fileProto.download;
        let overwritten = false;
        spies.push(jest.spyOn(fileProto, "download").mockImplementation(async function (this: unknown, ...args: unknown[]) {
            const result = await original.apply(this, args);
            if (!overwritten) {
                overwritten = true;
                writeVersion("version-two", V2_AT);
            }
            return result;
        }));

        const got = await read(controller);

        // The bytes and the version agree — whichever version they are.
        expect(got).not.toBeNull();
        expect(got).toEqual(got!.body === "version-one"
            ? { body: "version-one", lastModified: V1_AT }
            : { body: "version-two", lastModified: V2_AT });
    });

    it("reads the newer version whole when an overwrite lands between the describe and the read", async () => {
        // The overwrite lands right after the first describe.
        const original = fileProto.getMetadata;
        let overwritten = false;
        spies.push(jest.spyOn(fileProto, "getMetadata").mockImplementation(async function (this: unknown, ...args: unknown[]) {
            const result = await original.apply(this, args);
            if (!overwritten) {
                overwritten = true;
                writeVersion("version-two", V2_AT);
            }
            return result;
        }));

        const got = await read(controller);

        expect(got).toEqual({ body: "version-two", lastModified: V2_AT });
    });

    it("answers null for an object deleted between the describe and the read", async () => {
        const original = fileProto.getMetadata;
        spies.push(jest.spyOn(fileProto, "getMetadata").mockImplementation(async function (this: unknown, ...args: unknown[]) {
            const result = await original.apply(this, args);
            gcsWorld.bucket(BUCKET)!.delete(KEY);
            return result;
        }));

        expect(await read(controller)).toBeNull();
    });

    it("reads an unchanged object as before: its bytes, type and version", async () => {
        const file = await controller.getObject(KEY);
        expect(file).not.toBeNull();
        expect(await file!.text()).toBe("version-one");
        expect(file!.type).toBe("image/png");
        expect(file!.name).toBe("hero.png");
        expect(file!.lastModified).toBe(V1_AT);
        expect(await controller.getObject("covers/missing.png")).toBeNull();
    });
});
