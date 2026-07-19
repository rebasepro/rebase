import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { initializeStorage } from "../src/init/storage";

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

    it("refuses local storage in production", async () => {
        // The whole point: on a managed platform "local" is the pod's
        // ephemeral disk, so this config loses every uploaded file at the next
        // restart. A warning here was not enough — nothing failed until the
        // data was already gone.
        await expect(initializeStorage(local(), true)).rejects.toThrow(/local.*production/is);
    });

    it("names the way out in the error", async () => {
        await expect(initializeStorage(local(), true)).rejects.toThrow(/FORCE_LOCAL_STORAGE/);
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

    it("refuses a local entry hiding in a multi-backend map", async () => {
        // The named-backend form takes the same path, so the guard cannot be
        // sidestepped by declaring more than one backend.
        await expect(
            initializeStorage({ uploads: local() }, true)
        ).rejects.toThrow(/uploads/);
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
