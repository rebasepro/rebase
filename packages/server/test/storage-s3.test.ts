import { describe, it, expect, beforeEach, afterEach, jest as vi } from "@jest/globals";
import { S3StorageController } from "../src/storage/S3StorageController";

// Mock the AWS SDK before importing the controller
vi.mock("@aws-sdk/client-s3", () => ({
    S3Client: vi.fn().mockImplementation(function() {
        return { send: vi.fn() };
    }),
    PutObjectCommand: vi.fn(),
    GetObjectCommand: vi.fn(),
    DeleteObjectCommand: vi.fn(),
    ListObjectsV2Command: vi.fn(),
    HeadObjectCommand: vi.fn()
}));

vi.mock("@aws-sdk/s3-request-presigner", () => ({
    getSignedUrl: vi.fn().mockResolvedValue("https://presigned-url.example.com")
}));

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

describe("S3StorageController", () => {
    let controller: S3StorageController;
    let mockSend: vi.Mock;

    const defaultConfig = {
        bucket: "test-bucket",
        region: "us-east-1",
        accessKeyId: "test-access-key",
        secretAccessKey: "test-secret-key"
    };

    beforeEach(() => {
        vi.clearAllMocks();
        mockSend = vi.fn();
        vi.mocked(S3Client).mockImplementation(function() {
            return { send: mockSend };
        } as any);
        controller = new S3StorageController(defaultConfig);
    });

    describe("client initialization", () => {
        // The S3 client is created lazily on first use, not in the constructor.
        it("should initialize S3 client with credentials on first use", async () => {
            mockSend.mockResolvedValueOnce({});
            await controller.deleteObject("uploads/test.txt");

            expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({
                region: "us-east-1",
                credentials: {
                    accessKeyId: "test-access-key",
                    secretAccessKey: "test-secret-key"
                }
            }));
        });

        it("should initialize with endpoint for S3-compatible services", async () => {
            vi.clearAllMocks();
            const minioController = new S3StorageController({
                ...defaultConfig,
                endpoint: "https://minio.example.com",
                forcePathStyle: true
            });
            mockSend.mockResolvedValueOnce({});
            await minioController.deleteObject("uploads/test.txt");

            expect(S3Client).toHaveBeenCalledWith(expect.objectContaining({
                endpoint: "https://minio.example.com",
                forcePathStyle: true
            }));
        });

        it("should return 's3' as type", () => {
            expect(controller.getType()).toBe("s3");
        });
    });

    describe("putObject", () => {
        it("should upload file using PutObjectCommand", async () => {
            const content = Buffer.from("Test content");
            const file = new File([content], "test.txt", { type: "text/plain" });

            mockSend.mockResolvedValueOnce({});

            const result = await controller.putObject({
                file,
                key: "uploads/test.txt"
            });

            expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
                Bucket: "test-bucket",
                Key: "uploads/test.txt",
                ContentType: "text/plain"
            }));
            expect(mockSend).toHaveBeenCalled();
            expect(result.key).toBe("uploads/test.txt");
        });

        it("should include metadata in upload", async () => {
            const file = new File(["content"], "test.txt", { type: "text/plain" });

            mockSend.mockResolvedValueOnce({});

            await controller.putObject({
                file,
                key: "uploads/test.txt",
                metadata: { customKey: "customValue" }
            });

            expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
                Metadata: expect.objectContaining({
                    customKey: "customValue" // Keys are passed as-is, S3 handles casing
                })
            }));
        });

        it("should use custom bucket when specified", async () => {
            const file = new File(["content"], "test.txt", { type: "text/plain" });

            mockSend.mockResolvedValueOnce({});

            await controller.putObject({
                file,
                key: "uploads/test.txt",
                bucket: "custom-bucket"
            });

            expect(PutObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
                Bucket: "custom-bucket"
            }));
        });
    });

    describe("getSignedUrl", () => {
        it("should generate presigned URL", async () => {
            // `result.url` is the constant the presigner mock was told to return,
            // so asserting it only proves the mock works. What the controller
            // decides is *what it signs* — which object, in which bucket, for how
            // long — and none of that was checked: a presigner call naming the
            // wrong key, or omitting the expiry so the URL never dies, passed.
            mockSend.mockResolvedValueOnce({
                ContentType: "text/plain",
                ContentLength: 100,
                LastModified: new Date(),
                Metadata: {}
            });

            const result = await controller.getSignedUrl("uploads/test.txt");

            expect(GetObjectCommand).toHaveBeenCalledWith({
                Bucket: "test-bucket",
                Key: "uploads/test.txt"
            });
            expect(getSignedUrl).toHaveBeenCalledTimes(1);
            expect(getSignedUrl).toHaveBeenCalledWith(
                expect.anything(),
                expect.any(GetObjectCommand),
                { expiresIn: 3600 }
            );
            expect(result.url).toBe("https://presigned-url.example.com");
            expect(result.metadata?.bucket).toBe("test-bucket");
            expect(result.metadata?.fullPath).toBe("uploads/test.txt");
        });

        it("honours a configured signed-URL expiry and an s3:// bucket override", async () => {
            const scoped = new S3StorageController({ ...defaultConfig,
signedUrlExpiration: 60 });
            mockSend.mockResolvedValueOnce({
                ContentType: "text/plain",
                ContentLength: 1,
                LastModified: new Date(),
                Metadata: {}
            });

            await scoped.getSignedUrl("s3://other-bucket/deep/key.txt");

            expect(GetObjectCommand).toHaveBeenCalledWith({
                Bucket: "other-bucket",
                Key: "deep/key.txt"
            });
            expect(getSignedUrl).toHaveBeenCalledWith(
                expect.anything(),
                expect.any(GetObjectCommand),
                { expiresIn: 60 }
            );
        });

        it("should include metadata in download config", async () => {
            const lastModified = new Date("2024-01-15T10:00:00Z");
            mockSend.mockResolvedValueOnce({
                ContentType: "image/png",
                ContentLength: 5000,
                LastModified: lastModified,
                Metadata: { originalName: "photo.png" }
            });

            const result = await controller.getSignedUrl("images/photo.png");

            expect(result.metadata).toBeDefined();
            expect(result.metadata?.contentType).toBe("image/png");
        });
    });

    describe("getObject", () => {
        it("should return null for non-existent file", async () => {
            const error = new Error("NoSuchKey");
            (error as any).name = "NoSuchKey";
            mockSend.mockRejectedValueOnce(error);

            const result = await controller.getObject("nonexistent.txt");

            expect(result).toBeNull();
        });
    });

    describe("deleteObject", () => {
        it("should delete file from S3", async () => {
            mockSend.mockResolvedValueOnce({});

            await controller.deleteObject("uploads/test.txt");

            expect(DeleteObjectCommand).toHaveBeenCalledWith(expect.objectContaining({
                Bucket: "test-bucket",
                Key: "uploads/test.txt"
            }));
        });

        it("should not throw for non-existent file", async () => {
            // The mock used to resolve, so nothing could throw and the test said
            // nothing about the controller. A backend that raises NoSuchKey is
            // the case worth pinning: `deleteObject` had no catch at all, so a
            // stale reference surfaced as a 500 on MinIO/Ceph and as a 200 on
            // AWS. It is a 200 either way now, matching LocalStorageController.
            const error = new Error("NoSuchKey");
            (error as any).name = "NoSuchKey";
            mockSend.mockRejectedValueOnce(error);

            await expect(controller.deleteObject("nonexistent.txt")).resolves.toBeUndefined();
        });

        it("should propagate errors that are not a missing key", async () => {
            // Swallowing everything would turn a denied delete into a silent
            // success, which is worse than the 500 this replaced.
            const error = new Error("AccessDenied");
            (error as any).name = "AccessDenied";
            (error as any).$metadata = { httpStatusCode: 403 };
            mockSend.mockRejectedValueOnce(error);

            await expect(controller.deleteObject("uploads/test.txt")).rejects.toThrow("AccessDenied");
        });
    });

    describe("list", () => {
        it("should list objects in S3 bucket", async () => {
            mockSend.mockResolvedValueOnce({
                Contents: [
                    { Key: "uploads/file1.txt",
Size: 100,
LastModified: new Date() },
                    { Key: "uploads/file2.txt",
Size: 200,
LastModified: new Date() }
                ],
                CommonPrefixes: [],
                IsTruncated: false
            });

            const result = await controller.listObjects("uploads");

            expect(ListObjectsV2Command).toHaveBeenCalledWith(expect.objectContaining({
                Bucket: "test-bucket",
                // With a trailing slash, always. Under `Delimiter: "/"`,
                // `Prefix: "uploads"` matches `uploads.txt` and
                // `uploadsomething/` and returns nothing from inside
                // `uploads/` — so the same call answered one thing against
                // local dev and another against the bucket.
                Prefix: "uploads/"
            }));
            expect(result.items).toHaveLength(2);
        });

        it("should handle pagination with maxResults", async () => {
            mockSend.mockResolvedValueOnce({
                Contents: [
                    { Key: "uploads/file1.txt",
Size: 100,
LastModified: new Date() }
                ],
                CommonPrefixes: [],
                IsTruncated: true,
                NextContinuationToken: "token123"
            });

            const result = await controller.listObjects("uploads", { maxResults: 1 });

            expect(ListObjectsV2Command).toHaveBeenCalledWith(expect.objectContaining({
                MaxKeys: 1
            }));
            expect(result.nextPageToken).toBe("token123");
        });

        it("should include common prefixes as subdirectories", async () => {
            mockSend.mockResolvedValueOnce({
                Contents: [],
                CommonPrefixes: [
                    { Prefix: "uploads/images/" },
                    { Prefix: "uploads/documents/" }
                ],
                IsTruncated: false
            });

            const result = await controller.listObjects("uploads");

            expect(result.prefixes).toHaveLength(2);
        });

        it("should use pageToken for continuation", async () => {
            mockSend.mockResolvedValueOnce({
                Contents: [],
                CommonPrefixes: [],
                IsTruncated: false
            });

            await controller.listObjects("uploads", { pageToken: "continue-token" });

            expect(ListObjectsV2Command).toHaveBeenCalledWith(expect.objectContaining({
                ContinuationToken: "continue-token"
            }));
        });
    });

    describe("validateFile", () => {
        it("should accept valid file", () => {
            const file = new File(["content"], "valid.txt", { type: "text/plain" });

            expect(() => {
                (controller as any).validateFile(file);
            }).not.toThrow();
        });

        it("should reject file exceeding max size", () => {
            const smallController = new S3StorageController({
                ...defaultConfig,
                maxFileSize: 10 // 10 bytes
            });

            const largeContent = Buffer.alloc(100);
            const file = new File([largeContent], "large.txt", { type: "text/plain" });

            expect(() => {
                (smallController as any).validateFile(file);
            }).toThrow(/exceeds/i);
        });
    });

    describe("flattenMetadata", () => {
        it("should flatten nested metadata to strings", () => {
            const metadata = {
                simple: "value",
                number: 42,
                nested: { key: "value" }
            };

            const flattened = (controller as any).flattenMetadata(metadata);

            expect(flattened.simple).toBe("value");
            expect(flattened.number).toBe("42");
            expect(typeof flattened.nested).toBe("string");
        });
    });
});
