import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { initializeStorage, assertStorageAccessControlConfigured } from "../src/init/storage";

describe("initializeStorage", () => {
    let tempDir: string;
    const originalForce = process.env.FORCE_LOCAL_STORAGE;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-init-storage-"));
        delete process.env.FORCE_LOCAL_STORAGE;
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        if (originalForce === undefined) delete process.env.FORCE_LOCAL_STORAGE;
        else process.env.FORCE_LOCAL_STORAGE = originalForce;
    });

    const local = () => ({ type: "local" as const, basePath: tempDir });

    it("disables local storage in production", async () => {
        // The whole point: on a managed platform "local" is the pod's
        // ephemeral disk, so this config loses every uploaded file at the next
        // restart. No controller is registered, which leaves the app serving
        // and the upload routes answering 501 rather than accepting files it
        // is about to destroy.
        const { storageController, storageRegistry } = await initializeStorage(local(), true);

        expect(storageController).toBeUndefined();
        expect(storageRegistry).toBeUndefined();
    });

    it("allows local storage in production when explicitly forced", async () => {
        // A durable volume mounted at the storage path is a legitimate setup;
        // it just has to be stated rather than assumed.
        process.env.FORCE_LOCAL_STORAGE = "true";

        const { storageController } = await initializeStorage(local(), true);

        expect(storageController?.getType()).toBe("local");
    });

    it("allows local storage outside production", async () => {
        const { storageController } = await initializeStorage(local(), false);

        expect(storageController?.getType()).toBe("local");
    });

    it("drops a local entry hiding in a multi-backend map", async () => {
        // The named-backend form takes the same path, so the guard cannot be
        // sidestepped by declaring more than one backend.
        const { storageController } = await initializeStorage({ uploads: local() }, true);

        expect(storageController).toBeUndefined();
    });

    it("keeps the durable backends when only one entry is local", async () => {
        // Dropping the ephemeral entry must not take the rest of the map with
        // it: a project with a real bucket plus a stray local entry keeps the
        // real bucket.
        const s3 = {
            type: "s3" as const,
            bucket: "media",
            region: "auto",
            accessKeyId: "key",
            secretAccessKey: "secret"
        };

        const { storageRegistry } = await initializeStorage(
            { scratch: local(), media: s3 },
            true
        );

        expect(storageRegistry?.list()).toContain("media");
        expect(storageRegistry?.has("scratch")).toBe(false);
    });

    it("promotes nothing into a missing default, and says which bucket to name", async () => {
        // The survivor is NOT made the default. That promotion is what made a
        // project with `bucket("media")` write to local disk in development —
        // where the synthesized local default survives — and into the media
        // bucket in production, where it is dropped. Uploads that name no
        // source are refused instead, and the rest of the app keeps serving.
        const errors: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { errors.push(String(args[0])); };
        let result;
        try {
            result = await initializeStorage(
                {
                    scratch: local(),
                    media: {
                        type: "s3" as const,
                        bucket: "media",
                        region: "auto",
                        accessKeyId: "key",
                        secretAccessKey: "secret"
                    }
                },
                true
            );
        } finally {
            console.error = original;
        }

        expect(result.storageController).toBeUndefined();
        expect(result.storageRegistry?.list()).toEqual(["media"]);
        expect(errors.join("\n")).toContain('bucket("media", { default: true })');
        expect(errors.join("\n")).toContain("export const uploads = bucket();");
    });

    it("leaves a pre-built controller alone", async () => {
        // A custom StorageController is the caller's own object; it is not a
        // config to be second-guessed.
        const { LocalStorageController } = await import("../src/storage/LocalStorageController");
        const controller = new LocalStorageController({ basePath: tempDir });

        const { storageController } = await initializeStorage(controller, true);

        expect(storageController).toBe(controller);
    });
});

describe("assertStorageAccessControlConfigured", () => {
    const none = { hasAuthorize: false, publicRead: false, allowAnyAuthenticated: false };

    it("refuses to boot in production with no access-control model", () => {
        // The default-config hole: no hook, keys in one flat namespace, so any
        // authenticated user can enumerate and touch anyone's files.
        expect(() => assertStorageAccessControlConfigured(none, true)).toThrow(
            /WITHOUT any access-control model/
        );
    });

    it("does not throw in production when an authorize hook is configured", () => {
        expect(() =>
            assertStorageAccessControlConfigured({ ...none, hasAuthorize: true }, true)
        ).not.toThrow();
    });

    it("does not throw in production when reads are explicitly public", () => {
        expect(() =>
            assertStorageAccessControlConfigured({ ...none, publicRead: true }, true)
        ).not.toThrow();
    });

    it("does not throw in production with the explicit insecure opt-out", () => {
        expect(() =>
            assertStorageAccessControlConfigured({ ...none, allowAnyAuthenticated: true }, true)
        ).not.toThrow();
    });

    it("only warns (never throws) outside production, even with no model", () => {
        // Local development must not be blocked; the warning is the nudge.
        expect(() => assertStorageAccessControlConfigured(none, false)).not.toThrow();
    });
});
