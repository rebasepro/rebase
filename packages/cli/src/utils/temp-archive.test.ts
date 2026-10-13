/**
 * A temporary archive's directory is removed however the run ends: when it
 * returns, when it throws, and when it exits the process — which is what every
 * `fail()` inside a deploy does, and no `finally` runs after that.
 */
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { withTempArchive } from "./temp-archive";

describe("withTempArchive", () => {
    it("names the archive inside a directory of its own, removed when the run returns", async () => {
        let dir = "";
        const result = await withTempArchive("rebase-test", async (archive) => {
            dir = path.dirname(archive);
            expect(path.basename(archive)).toBe("rebase-test.tar.gz");
            expect(path.basename(dir)).toMatch(/^rebase-test-.+/);
            fs.writeFileSync(archive, "x");
            return "done";
        });
        expect(result).toBe("done");
        expect(fs.existsSync(dir)).toBe(false);
    });

    it("removes the directory when the run throws", async () => {
        let dir = "";
        await expect(withTempArchive("rebase-test", async (archive) => {
            dir = path.dirname(archive);
            fs.writeFileSync(archive, "x");
            throw new Error("upload refused");
        })).rejects.toThrow("upload refused");
        expect(fs.existsSync(dir)).toBe(false);
    });

    it("removes the directory when the process exits inside the run, and leaves no listener behind", async () => {
        const before = process.listeners("exit");
        let dir = "";
        await withTempArchive("rebase-test", async (archive) => {
            dir = path.dirname(archive);
            fs.writeFileSync(archive, "x");
            // What `process.exit` runs before it ends the process.
            const added = process.listeners("exit").filter(listener => !before.includes(listener));
            expect(added).toHaveLength(1);
            added[0](1);
            expect(fs.existsSync(dir)).toBe(false);
        });
        expect(process.listeners("exit")).toEqual(before);
    });
});
