import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import { generateSdkCommand } from "./generate_sdk";
import * as sdkGen from "@rebasepro/sdk-generator";

vi.mock("@rebasepro/sdk-generator", () => ({
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

        // Verify generator was called with loaded collections
        expect(sdkGen.generateSDK).toHaveBeenCalled();
    });
});
