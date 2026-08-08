import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { generateSdkCommand } from "./generate_sdk";
import * as sdkGen from "@rebasepro/codegen";

// Only `generateSDK` is stubbed. Everything else the command imports comes from
// the real module — a factory that returned just the one export made this file
// fail whenever the command started using another, which says nothing about the
// loader these tests are actually about. The `--from` path, the credential
// guard and the real generated output are covered unmocked in
// `generate_sdk_from.test.ts`.
vi.mock("@rebasepro/codegen", async (importOriginal) => ({
    ...(await importOriginal<typeof sdkGen>()),
    generateSDK: vi.fn(() => [
        { path: "database.types.ts",
content: "export type Database = {};" },
        { path: "index.ts",
content: "export const a = 1;" }
    ])
}));

describe("generateSdkCommand", () => {
    let tmpDir: string;
    let consoleLogSpy: any;
    let processExitSpy: any;

    beforeEach(() => {
        tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-sdk-test-"));
        vi.mocked(sdkGen.generateSDK).mockClear();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        processExitSpy = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    });

    afterEach(() => {
        fs.rmSync(tmpDir, { recursive: true,
force: true });
        consoleLogSpy.mockRestore();
        processExitSpy.mockRestore();
    });

    it("throws error if collections directory does not exist", async () => {
        const nonExistentDir = path.join(tmpDir, "does-not-exist");
        await expect(generateSdkCommand({
            collectionsDir: nonExistentDir,
            output: path.join(tmpDir, "out"),
            cwd: tmpDir
        })).rejects.toThrow("Collections directory not found");
    });

    it("orchestrates SDK generation and writes files to output directory", async () => {
        // Create collections directory
        const collectionsDir = path.join(tmpDir, "collections");
        fs.mkdirSync(collectionsDir);

        // Write a mock index.js that exports a default array of collections
        const indexFile = path.join(collectionsDir, "index.js");
        fs.writeFileSync(indexFile, `
            module.exports = [
                { slug: "posts", name: "Posts", fields: [] }
            ];
        `, "utf-8");

        const outputDir = path.join(tmpDir, "out");

        await generateSdkCommand({
            collectionsDir,
            output: outputDir,
            cwd: tmpDir
        });

        // Verify files were written
        expect(fs.existsSync(path.join(outputDir, "database.types.ts"))).toBe(true);
        expect(fs.existsSync(path.join(outputDir, "index.ts"))).toBe(true);

        const content = fs.readFileSync(path.join(outputDir, "database.types.ts"), "utf-8");
        expect(content).toBe("export type Database = {};");

        // Verify the generator was called with the collections that were loaded.
        // `toHaveBeenCalled()` alone left the loader free to regress to `[]`.
        expect(sdkGen.generateSDK).toHaveBeenCalledTimes(1);
        const [collections] = vi.mocked(sdkGen.generateSDK).mock.calls[0];
        expect(collections).toHaveLength(1);
        expect(collections[0]).toMatchObject({ slug: "posts",
name: "Posts" });
    });

    it("passes every collection through, sorted by slug for a stable SDK", async () => {
        const collectionsDir = path.join(tmpDir, "collections");
        fs.mkdirSync(collectionsDir);
        fs.writeFileSync(path.join(collectionsDir, "index.js"), `
            module.exports = [
                { slug: "posts", name: "Posts", fields: [] },
                { slug: "tags", name: "Tags", fields: [] },
                { slug: "authors", name: "Authors", fields: [] }
            ];
        `, "utf-8");

        await generateSdkCommand({
            collectionsDir,
            output: path.join(tmpDir, "out"),
            cwd: tmpDir
        });

        const [collections] = vi.mocked(sdkGen.generateSDK).mock.calls[0];
        // Declaration order is deliberately not preserved: the command sorts by
        // slug so regenerating produces the same file for the same schema.
        expect(collections.map((c) => c.slug)).toEqual(["authors", "posts", "tags"]);
    });
});
