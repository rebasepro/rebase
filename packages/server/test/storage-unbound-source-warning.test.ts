import { describe, expect, it, jest } from "@jest/globals";
import type { StorageSourceDefinition } from "@rebasepro/types";
import { Hono } from "hono";

import { logger } from "../src/utils/logger";
import { resolveStorageSources } from "../src/boot/sources";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createStorageRoutes } from "../src/storage/routes";
import { LocalStorageController } from "../src/storage/LocalStorageController";

/**
 * A production server with a declared bucket nothing binds booted without a
 * word: the source was skipped silently, and the first sign was a 501 on the
 * first upload — whose message said "the media suffixed environment
 * variables" rather than the variable to set.
 */
const source = (key: string, engine: string): StorageSourceDefinition =>
    ({ key, engine, transport: "server" }) as StorageSourceDefinition;

describe("a declared bucket nothing binds", () => {
    it("is named at boot, with the variable that binds it", () => {
        const warned: string[] = [];
        const spy = jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        try {
            resolveStorageSources(
                { S3_BUCKET: "b-default", S3_ACCESS_KEY_ID: "AKIA", S3_SECRET_ACCESS_KEY: "SECRET" },
                [source("(default)", "s3"), source("media", "s3"), source("archive", "gcs")],
                "/tmp",
                { production: true }
            );
        } finally {
            spy.mockRestore();
        }

        const said = warned.join("\n");
        expect(said).toContain('"media" is declared but not configured');
        expect(said).toContain("S3_BUCKET__MEDIA");
        expect(said).toContain("GCS_BUCKET__ARCHIVE");
    });

    it("answers a request to it with the variable to set", async () => {
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: new LocalStorageController({ type: "local", basePath: "/tmp/rebase-unbound-never-written" }),
            sources: [source("media", "s3")],
            requireAuth: false
        }));

        const res = await app.request("/api/storage/list?storageId=media");

        expect(res.status).toBe(501);
        const body = await res.json() as { error: { code: string; message: string } };
        expect(body.error.code).toBe("STORAGE_SOURCE_NOT_CONFIGURED");
        expect(body.error.message).toContain("S3_BUCKET__MEDIA");
    });
});
