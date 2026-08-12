import { describe, it, expect, beforeEach } from "@jest/globals";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createStorageRoutes } from "../src/storage/routes";
import type { StorageController } from "../src/storage/types";

/**
 * `POST /folder` authorized one bucket and wrote to another.
 *
 * Every other route in the file threads the parsed `bucket` through to the
 * controller — upload, get, signed URL, delete, list. The folder route asked
 * `checkAuthorized` about `bucket` and then called `putObject({ file, key })`
 * with no bucket at all, and an S3/GCS controller reads a missing bucket as
 * `config.bucket`. So the marker object landed in the deployment's default
 * bucket while the hook had been asked about a different one — approval for one
 * destination, a write to another, which is what the two TUS fixes were about.
 *
 * Its own local branch was already right (`getAbsolutePath(resolvedPath,
 * bucket)`), so the two halves of one route disagreed.
 *
 * A recording controller rather than a real backend: what is being pinned is
 * the argument, and `LocalStorageController` would answer for the filesystem
 * instead — the local path is the half that never had the bug.
 */
describe("POST /folder writes to the bucket it was authorized for", () => {
    let app: Hono<HonoEnv>;
    let writes: Array<{ key: string; bucket?: string }>;
    let authorized: Array<{ key: string; bucket: string }>;

    beforeEach(() => {
        writes = [];
        authorized = [];

        // `getType()` decides which half of the route runs; anything but
        // "local" takes the marker-object branch.
        const controller = {
            getType: () => "s3",
            putObject: async ({ key, bucket }: { key: string; bucket?: string }) => {
                writes.push({ key, bucket });
                return { key, url: `s3://${bucket ?? "(default)"}/${key}` };
            }
        } as unknown as StorageController;

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.use("*", async (c, next) => {
            c.set("user", { uid: "u-1", roles: ["admin"] } as never);
            await next();
        });
        app.route("/api/storage", createStorageRoutes({
            controller,
            requireAuth: false,
            // The hook answers a boolean and is handed one object; a throw or
            // a false is a 403.
            authorize: async ({ key, bucket }: { key: string; bucket: string }) => {
                authorized.push({ key, bucket });
                return true;
            }
        } as never));
    });

    const createFolder = (path: string, bucket?: string) => app.request("/api/storage/folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(bucket === undefined ? { path } : { path, bucket })
    });

    it("honours the documented `bucket` body field", async () => {
        const res = await createFolder("reports", "media");

        expect(res.status).toBe(201);
        expect(writes).toEqual([{ key: "reports/", bucket: "media" }]);
    });

    it("writes to exactly the bucket the hook approved", async () => {
        // The property, not the argument: whatever the route decides to
        // authorize is what the object must land in.
        await createFolder("reports", "media");

        expect(writes).toHaveLength(1);
        expect(authorized).toHaveLength(1);
        expect(writes[0].bucket).toBe(authorized[0].bucket);
    });

    it("still marks the folder with a trailing slash", async () => {
        await createFolder("already-slashed/", "media");

        expect(writes[0].key).toBe("already-slashed/");
    });

    it("defaults to the default bucket when the body names none", async () => {
        await createFolder("reports");

        expect(writes[0].bucket).toBeUndefined();
        expect(authorized[0].bucket).toBe("default");
    });

    it("refuses a bucket name the canonicalizer rejects, rather than writing somewhere else", async () => {
        const res = await createFolder("reports", "../escape");

        expect(res.status).toBe(400);
        expect(writes).toEqual([]);
    });
});
