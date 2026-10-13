import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hono } from "hono";
import type { DownloadConfig, StorageListResult, UploadFileProps, UploadFileResult } from "@rebasepro/types";

import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { LocalStorageController } from "../src/storage/LocalStorageController";
import { createStorageRoutes } from "../src/storage/routes";
import { configureJwt } from "../src/auth/jwt";
import { logger } from "../src/utils/logger";
import type { StorageController, StoredObjectInfo, StoredObjectStream } from "../src/storage/types";

/**
 * Image renditions when the optional `sharp` package is not installed.
 *
 * A scaffolded project does not depend on it, so this is every fresh project:
 * the admin asks for `?width=200&format=webp` thumbnails, and each one answered
 * a 500 — which the browser blocked as an opaque JSON body under an `<img>` —
 * while the backend logged an ERROR with a forty-line stack on every page
 * load. A rendition is an optimisation of an image the caller may already
 * read, so a missing optional dependency serves that image, and says so once.
 */
jest.mock("sharp", () => {
    throw new Error("Cannot find module 'sharp'");
});

/** A 1×1 PNG, written by hand: the encoder is the thing this file is without. */
const PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64"
);

/** An object store held in memory, with the streamed reads S3 and GCS have. */
class MemoryStorageController implements StorageController {
    private readonly objects = new Map<string, { bytes: Uint8Array; contentType: string; lastModified: number }>();

    async putObject(props: UploadFileProps): Promise<UploadFileResult> {
        const bytes = new Uint8Array(await props.file.arrayBuffer());
        this.objects.set(props.key, { bytes, contentType: props.file.type, lastModified: 1_700_000_000_000 });
        return { key: props.key, bucket: "default", storageUrl: `memory://default/${props.key}` };
    }

    async getSignedUrl(): Promise<DownloadConfig> {
        return { url: null };
    }

    async getObject(key: string): Promise<File | null> {
        const object = this.objects.get(key);
        return object ? new File([object.bytes], path.basename(key), { type: object.contentType, lastModified: object.lastModified }) : null;
    }

    async statObject(key: string): Promise<StoredObjectInfo | null> {
        const object = this.objects.get(key);
        return object ? { size: object.bytes.byteLength, contentType: object.contentType, lastModified: object.lastModified } : null;
    }

    async getObjectStream(key: string): Promise<StoredObjectStream | null> {
        const object = this.objects.get(key);
        if (!object) return null;
        return {
            size: object.bytes.byteLength,
            contentType: object.contentType,
            lastModified: object.lastModified,
            stream: new Blob([object.bytes]).stream()
        };
    }

    async deleteObject(key: string): Promise<void> {
        this.objects.delete(key);
    }

    async listObjects(): Promise<StorageListResult> {
        return { items: [], prefixes: [] };
    }

    getType(): string {
        return "memory";
    }
}

describe("an image rendition with `sharp` missing", () => {
    let tempDir: string;
    const errors: string[] = [];
    // Across the whole file, not per test: "once per process" is the claim.
    const warnings: string[] = [];

    beforeEach(async () => {
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-no-sharp-"));
        errors.length = 0;
        jest.spyOn(logger, "error").mockImplementation((message: string) => { errors.push(message); });
        jest.spyOn(logger, "warn").mockImplementation((message: string) => { warnings.push(message); });
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        await fs.promises.rm(tempDir, { recursive: true, force: true });
    });

    const routerFor = (controller: StorageController): Hono<HonoEnv> => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({ controller, requireAuth: false, publicRead: true }));
        return app;
    };

    const store = async (controller: StorageController, key: string): Promise<void> => {
        await controller.putObject({ file: new File([PNG], path.basename(key), { type: "image/png" }), key });
    };

    for (const [name, make] of [
        ["on local disk", () => new LocalStorageController({ type: "local", basePath: tempDir })],
        ["in an object store", () => new MemoryStorageController()]
    ] as const) {
        it(`serves the original image ${name}, not a 500`, async () => {
            const controller = make();
            await store(controller, "author_pictures/ada.png");
            const app = routerFor(controller);

            const response = await app.request("/api/storage/file/author_pictures/ada.png?width=200&format=webp");

            expect(response.status).toBe(200);
            expect(response.headers.get("Content-Type")).toBe("image/png");
            expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
            expect(errors).toEqual([]);
        });
    }

    it("warns once per process, naming the install command, however many thumbnails are asked for", async () => {
        const controller = new LocalStorageController({ type: "local", basePath: tempDir });
        await store(controller, "a.png");
        await store(controller, "b.png");
        const app = routerFor(controller);

        for (const key of ["a.png", "b.png", "a.png"]) {
            expect((await app.request(`/api/storage/file/${key}?width=96&format=webp`)).status).toBe(200);
        }

        const said = warnings.filter(message => message.includes("sharp"));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain("pnpm add sharp");
        expect(errors).toEqual([]);
    });
});
