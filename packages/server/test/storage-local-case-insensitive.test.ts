import { describe, it, expect, beforeEach, afterEach, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { LocalStorageController } from "../src/storage/LocalStorageController";
import { initializeStorage } from "../src/init/storage";
import { logger } from "../src/utils/logger";

/**
 * On macOS (APFS, HFS+) and Windows the default file system folds case, so
 * `Avatar.png` and `avatar.png` are one local file, while S3, GCS and a Linux
 * disk keep two. A key that only works in development, or two uploads that
 * silently overwrite each other there, is found at deploy time unless the boot
 * says so.
 */
describe("local storage on a case-insensitive file system", () => {
    let dir: string;

    beforeEach(async () => {
        dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-case-"));
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.promises.rm(dir, { recursive: true, force: true });
    });

    it("reads the file system it stores on, and leaves nothing behind", async () => {
        // The answer, found independently of the controller.
        const probe = path.join(dir, "probe-case-x");
        await fs.promises.writeFile(probe, "");
        const folds = fs.existsSync(path.join(dir, "PROBE-CASE-X"));
        await fs.promises.unlink(probe);

        const controller = new LocalStorageController({ type: "local", basePath: path.join(dir, "uploads") });
        await expect(controller.isCaseInsensitive()).resolves.toBe(folds);
        expect(await fs.promises.readdir(path.join(dir, "uploads"))).toEqual([]);
    });

    it("warns at boot, naming the folder", async () => {
        jest.spyOn(LocalStorageController.prototype, "isCaseInsensitive").mockResolvedValue(true);
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        const basePath = path.join(dir, "uploads");

        await initializeStorage({ type: "local", basePath }, false);

        const messages = warn.mock.calls.map(call => String(call[0]));
        expect(messages.some(m => m.includes("case-insensitive") && m.includes(basePath))).toBe(true);
    });

    it("says nothing on a case-sensitive one", async () => {
        jest.spyOn(LocalStorageController.prototype, "isCaseInsensitive").mockResolvedValue(false);
        const warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);

        await initializeStorage({ type: "local", basePath: path.join(dir, "uploads") }, false);

        expect(warn.mock.calls.map(call => String(call[0])).some(m => m.includes("case-insensitive"))).toBe(false);
    });
});
