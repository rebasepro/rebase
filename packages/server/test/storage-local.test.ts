import { describe, it, expect, beforeEach, afterEach, jest as vi } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { LocalStorageController } from "../src/storage/LocalStorageController";

describe("LocalStorageController", () => {
    let controller: LocalStorageController;
    let tempDir: string;

    beforeEach(async () => {
        // Create a temporary directory for tests
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-storage-test-"));
        controller = new LocalStorageController({
            basePath: tempDir
        });
    });

    afterEach(async () => {
        // Clean up temporary directory
        await fs.promises.rm(tempDir, { recursive: true,
force: true });
    });

    describe("constructor", () => {
        it("should initialize with basePath", () => {
            expect(controller.getBasePath()).toBe(tempDir);
        });

        it("should return 'local' as type", () => {
            expect(controller.getType()).toBe("local");
        });
    });

    describe("putObject", () => {
        it("should upload a file and return metadata", async () => {
            const content = Buffer.from("Hello, World!");
            const file = new File([content], "test.txt", { type: "text/plain" });

            const result = await controller.putObject({
                file,
                key: "uploads/test.txt"
            });

            expect(result.key).toContain("uploads");
            expect(result.key).toContain("test.txt");

            // Verify file exists on disk (uses default bucket)
            const filePath = path.join(tempDir, "default", "uploads", "test.txt");
            const exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
            expect(exists).toBe(true);
        });

        it("should create nested directories", async () => {
            const content = Buffer.from("Nested content");
            const file = new File([content], "nested.txt", { type: "text/plain" });

            await controller.putObject({
                file,
                key: "level1/level2/level3/nested.txt"
            });

            const filePath = path.join(tempDir, "default", "level1", "level2", "level3", "nested.txt");
            const exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
            expect(exists).toBe(true);
        });

        it("should handle custom bucket", async () => {
            const content = Buffer.from("Bucket content");
            const file = new File([content], "bucket.txt", { type: "text/plain" });

            await controller.putObject({
                file,
                key: "files/bucket.txt",
                bucket: "custom-bucket"
            });

            const filePath = path.join(tempDir, "custom-bucket", "files", "bucket.txt");
            const exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
            expect(exists).toBe(true);
        });

        it("should store metadata alongside file", async () => {
            const content = Buffer.from("With metadata");
            const file = new File([content], "meta.txt", { type: "text/plain" });

            await controller.putObject({
                file,
                key: "uploads/meta.txt",
                metadata: { customField: "customValue" }
            });

            // Implementation uses .metadata.json extension
            const metadataPath = path.join(tempDir, "default", "uploads", "meta.txt.metadata.json");
            const exists = await fs.promises.access(metadataPath).then(() => true).catch(() => false);
            expect(exists).toBe(true);
        });
    });

    describe("getObject", () => {
        it("should retrieve an uploaded file using local:// URL format", async () => {
            const content = Buffer.from("Retrieve me");
            const file = new File([content], "retrieve.txt", { type: "text/plain" });

            const uploadResult = await controller.putObject({
                file,
                key: "uploads/retrieve.txt"
            });

            // Use the storageUrl from upload result (local:// format)
            const retrieved = await controller.getObject(uploadResult.storageUrl!);

            expect(retrieved).not.toBeNull();
            expect(retrieved?.name).toBe("retrieve.txt");
        });

        it("should return null for non-existent file", async () => {
            const result = await controller.getObject("local://default/nonexistent/file.txt");
            expect(result).toBeNull();
        });

        it("refuses to read outside the bucket via a ../ key", async () => {
            // The load-bearing traversal guard: even a key the route-level
            // sanitizer never saw (a raw `..`) cannot escape the bucket.
            await fs.promises.writeFile(path.join(tempDir, "secret.txt"), "top secret");

            await expect(controller.getObject("../secret.txt")).rejects.toThrow(/traversal/i);
        });
    });

    describe("deleteObject", () => {
        it("should delete an uploaded file using local:// URL format", async () => {
            const content = Buffer.from("Delete me");
            const file = new File([content], "delete.txt", { type: "text/plain" });

            const uploadResult = await controller.putObject({
                file,
                key: "uploads/delete.txt"
            });

            // Verify file exists
            const filePath = path.join(tempDir, "default", "uploads", "delete.txt");
            let exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
            expect(exists).toBe(true);

            // Delete the file using local:// URL format
            await controller.deleteObject(uploadResult.storageUrl!);

            // Verify file no longer exists
            exists = await fs.promises.access(filePath).then(() => true).catch(() => false);
            expect(exists).toBe(false);
        });

        it("should not throw when deleting non-existent file", async () => {
            await expect(controller.deleteObject("local://default/nonexistent/file.txt")).resolves.not.toThrow();
        });

        it("refuses to delete outside the bucket via a ../ key", async () => {
            const secretPath = path.join(tempDir, "secret.txt");
            await fs.promises.writeFile(secretPath, "top secret");

            await expect(controller.deleteObject("../secret.txt")).rejects.toThrow(/traversal/i);
            const stillThere = await fs.promises.access(secretPath).then(() => true).catch(() => false);
            expect(stillThere).toBe(true);
        });

        it("should also delete metadata file", async () => {
            const content = Buffer.from("Delete with metadata");
            const file = new File([content], "withmeta.txt", { type: "text/plain" });

            const uploadResult = await controller.putObject({
                file,
                key: "uploads/withmeta.txt",
                metadata: { key: "value" }
            });

            await controller.deleteObject(uploadResult.storageUrl!);

            const metadataPath = path.join(tempDir, "default", "uploads", "withmeta.txt.metadata.json");
            const exists = await fs.promises.access(metadataPath).then(() => true).catch(() => false);
            expect(exists).toBe(false);
        });
    });

    describe("list", () => {
        beforeEach(async () => {
            // Upload some test files
            for (let i = 1; i <= 5; i++) {
                const file = new File([`Content ${i}`], `file${i}.txt`, { type: "text/plain" });
                await controller.putObject({
                    file,
                    key: `listtest/file${i}.txt`
                });
            }
        });

        it("should list files in a directory", async () => {
            const result = await controller.listObjects("listtest", { bucket: "default" });

            // Every stored object gets a `.metadata.json` sidecar written beside
            // it, and the listing must not show them — they are this controller's
            // bookkeeping, not objects the caller put there. `length >= 5` was
            // satisfied by ten entries just as happily as by five, so the filter
            // the comment claims to cover went unmeasured.
            expect(result.items.map(i => i.name).sort()).toEqual([
                "file1.txt", "file2.txt", "file3.txt", "file4.txt", "file5.txt"
            ]);
            expect(result.items.map(i => i.fullPath).sort()).toEqual([
                "listtest/file1.txt",
                "listtest/file2.txt",
                "listtest/file3.txt",
                "listtest/file4.txt",
                "listtest/file5.txt"
            ]);
            expect(result.prefixes).toHaveLength(0);
        });

        it("should return empty list for non-existent directory", async () => {
            const result = await controller.listObjects("nonexistent", { bucket: "default" });

            expect(result.items).toHaveLength(0);
        });
    });

    describe("getSignedUrl", () => {
        it("should return download URL for existing file", async () => {
            const content = Buffer.from("Download me");
            const file = new File([content], "download.txt", { type: "text/plain" });

            const uploadResult = await controller.putObject({
                file,
                key: "uploads/download.txt"
            });

            // Use the storageUrl from upload result
            const result = await controller.getSignedUrl(uploadResult.storageUrl!);

            expect(result.url).toBeTruthy();
            expect(result.fileNotFound).toBeFalsy();
        });

        it("should return fileNotFound for non-existent file", async () => {
            const result = await controller.getSignedUrl("local://default/nonexistent/file.txt");

            expect(result.fileNotFound).toBe(true);
        });
    });

    describe("getAbsolutePath", () => {
        it("should resolve an unqualified path into the default bucket", () => {
            const absPath = controller.getAbsolutePath("uploads/test.txt");

            // Where putObject writes it. This used to resolve to the storage
            // root instead, so a bare key never found the file that a bare key
            // had just stored.
            expect(absPath).toBe(path.join(tempDir, "default", "uploads", "test.txt"));
        });

        it("should handle custom bucket", () => {
            const absPath = controller.getAbsolutePath("uploads/test.txt", "custom");

            expect(absPath).toBe(path.join(tempDir, "custom", "uploads", "test.txt"));
        });
    });

    describe("validateFile", () => {
        it("should accept valid file", () => {
            const file = new File(["content"], "valid.txt", { type: "text/plain" });

            // Should not throw
            expect(() => {
                (controller as {validateFile: (f: File) => void}).validateFile(file);
            }).not.toThrow();
        });

        it("should reject file exceeding max size", () => {
            // Create a controller with small max size
            const smallController = new LocalStorageController({
                basePath: tempDir,
                maxFileSize: 10 // 10 bytes
            });

            const largeContent = Buffer.alloc(100);
            const file = new File([largeContent], "large.txt", { type: "text/plain" });

            expect(() => {
                (smallController as {validateFile: (f: File) => void}).validateFile(file);
            }).toThrow(/exceeds/i);
        });

        it("should reject disallowed file types", () => {
            const controllerWithTypes = new LocalStorageController({
                basePath: tempDir,
                allowedMimeTypes: ["image/png", "image/jpeg"]
            });

            const file = new File(["content"], "script.js", { type: "application/javascript" });

            expect(() => {
                (controllerWithTypes as {validateFile: (f: File) => void}).validateFile(file);
            }).toThrow(/not allowed/i);
        });
    });

    describe("bucket defaulting", () => {
        /** Store a file the obvious way: no bucket named anywhere. */
        async function putBare(key: string, body = "payload") {
            return controller.putObject({
                file: new File([Buffer.from(body)], path.basename(key), { type: "text/plain" }),
                key
            });
        }

        it("round-trips a bare key through put → get", async () => {
            // putObject wrote into `default`; the read side used to resolve a
            // bare key against the storage root and return null, which reads
            // as "file missing" rather than "you and I disagree on the bucket".
            await putBare("docs/a.txt", "round trip");

            const got = await controller.getObject("docs/a.txt");

            expect(got).not.toBeNull();
            expect(await got!.text()).toBe("round trip");
        });

        it("deletes a bare key instead of silently deleting nothing", async () => {
            await putBare("docs/b.txt");

            await controller.deleteObject("docs/b.txt");

            expect(await controller.getObject("docs/b.txt")).toBeNull();
        });

        it("lists a bare prefix instead of returning an empty page", async () => {
            await putBare("docs/c.txt");

            const listed = await controller.listObjects("docs");

            expect(listed.items.map((i) => i.name)).toEqual(["c.txt"]);
        });

        it("still honours an explicit bucket", async () => {
            await controller.putObject({
                file: new File(["scoped"], "d.txt", { type: "text/plain" }),
                key: "docs/d.txt",
                bucket: "other"
            });

            expect(await controller.getObject("docs/d.txt", "other")).not.toBeNull();
            // The default bucket is a different namespace, not an alias.
            expect(await controller.getObject("docs/d.txt")).toBeNull();
        });
    });

    describe("listObjects pagination", () => {
        it("terminates when every entry has a metadata sidecar", async () => {
            // Each stored object writes a `.metadata.json` beside it, which the
            // scan skips without emitting. The cursor used to be derived from
            // the emitted count, so a page made entirely of sidecars handed
            // back the very token it was called with and `while (pageToken)`
            // spun forever.
            for (let i = 0; i < 6; i++) {
                await controller.putObject({
                    file: new File([`file ${i}`], `f${i}.txt`, { type: "text/plain" }),
                    key: `sweep/f${i}.txt`
                });
            }

            const seen: string[] = [];
            let pageToken: string | undefined;
            let pages = 0;

            do {
                const page = await controller.listObjects("sweep", { maxResults: 2, pageToken });
                seen.push(...page.items.map((i) => i.name));
                pageToken = page.nextPageToken;
                if (++pages > 50) throw new Error("listObjects did not terminate");
            } while (pageToken);

            expect(seen.sort()).toEqual(["f0.txt", "f1.txt", "f2.txt", "f3.txt", "f4.txt", "f5.txt"]);
        });

        it("never repeats a page token", async () => {
            for (let i = 0; i < 5; i++) {
                await controller.putObject({
                    file: new File([`file ${i}`], `g${i}.txt`, { type: "text/plain" }),
                    key: `pages/g${i}.txt`
                });
            }

            const tokens = new Set<string>();
            let pageToken: string | undefined;
            let guard = 0;

            do {
                const page = await controller.listObjects("pages", { maxResults: 1, pageToken });
                pageToken = page.nextPageToken;
                if (pageToken) {
                    expect(tokens.has(pageToken)).toBe(false);
                    tokens.add(pageToken);
                }
                if (++guard > 50) throw new Error("listObjects did not terminate");
            } while (pageToken);
        });
    });
});
