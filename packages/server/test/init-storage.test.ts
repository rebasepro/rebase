import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { initializeStorage, assertStorageAccessControlConfigured, localStorageForced } from "../src/init/storage";
import { DEFAULT_RESOURCE_KEY, type ResourceDeclaration } from "@rebasepro/types";
import { resourceResolver } from "../src/boot/resource-resolvers";
import { loadEnv } from "../src/env";

/**
 * What each way of writing `FORCE_LOCAL_STORAGE` must mean.
 *
 * Only an explicit yes forces. A no in any spelling, nothing at all, or a word
 * that is neither keeps the guard up, because its job is to refuse a local
 * backend in production until somebody has said a durable volume is mounted.
 *
 * The guard used to test the raw string for truthiness, so every row marked
 * `false` below except the first two registered the backend — including
 * `"false"`, the natural way to say "there is no volume here".
 */
const FORCE_SPELLINGS: [value: string | undefined, forced: boolean][] = [
    [undefined, false],
    ["", false],
    ["false", false],
    ["0", false],
    ["no", false],
    ["off", false],
    ["FALSE", false],
    ["maybe", false],
    ["true", true],
    ["1", true],
    ["yes", true],
    [" TRUE ", true]
];

/** The default bucket, as `rebase status` sees a project that declared none. */
const DEFAULT_BUCKET: ResourceDeclaration = {
    kind: "bucket",
    key: DEFAULT_RESOURCE_KEY,
    engine: "local",
    transport: "server",
    options: Object.freeze({})
};

describe("FORCE_LOCAL_STORAGE", () => {
    let tempDir: string;
    const originalForce = process.env.FORCE_LOCAL_STORAGE;

    beforeEach(async () => {
        tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-force-local-"));
    });

    afterEach(async () => {
        await fs.promises.rm(tempDir, { recursive: true, force: true });
        if (originalForce === undefined) delete process.env.FORCE_LOCAL_STORAGE;
        else process.env.FORCE_LOCAL_STORAGE = originalForce;
    });

    it.each(FORCE_SPELLINGS)("=%p forces local storage in production: %p — and rebase status agrees", async (value, forced) => {
        if (value === undefined) delete process.env.FORCE_LOCAL_STORAGE;
        else process.env.FORCE_LOCAL_STORAGE = value;

        // The runtime: does the backend get registered?
        const { storageController } = await initializeStorage({ type: "local", basePath: tempDir }, true);
        expect(storageController?.getType()).toBe(forced ? "local" : undefined);

        // `rebase status`: does it promise the same thing? Two readers of one
        // decision, held to one row, so neither can be fixed without the other.
        const verdict = resourceResolver("bucket")!.resolve(
            DEFAULT_BUCKET,
            value === undefined ? {} : { FORCE_LOCAL_STORAGE: value },
            { production: true, defaultBasePath: tempDir }
        );
        expect(verdict.state).toBe(forced ? "ready" : "unbound");
    });

    describe("against loadEnv's schema", () => {
        const originalEnv = { ...process.env };

        beforeEach(() => {
            process.env = {
                DATABASE_URL: "postgresql://db.example.com:5432/rebase",
                JWT_SECRET: "a-test-secret-that-is-long-enough-for-the-schema"
            };
        });

        afterEach(() => {
            process.env = { ...originalEnv };
        });

        it.each(["true", "false", "", undefined])("reads %p to the same boolean the schema parses", (value) => {
            // Every value the schema accepts, read both ways. A backend booted
            // through `loadEnv` and one assembled without it get one answer.
            if (value !== undefined) process.env.FORCE_LOCAL_STORAGE = value;
            expect(localStorageForced()).toBe(loadEnv().FORCE_LOCAL_STORAGE);
        });

        it("refuses the boot on \"0\" before storage is ever initialised", () => {
            // The schema's set is strict, so a spelling outside it never reaches
            // the guard on the boot path — and where it does, the row above
            // keeps the guard up.
            process.env.FORCE_LOCAL_STORAGE = "0";
            expect(() => loadEnv()).toThrow(/FORCE_LOCAL_STORAGE/);
        });
    });
});

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

    it("disables local storage in production", async () => {
        // The whole point: on a managed platform "local" is the pod's
        // ephemeral disk, so this config loses every uploaded file at the next
        // restart. No controller is registered, which leaves the app serving
        // and the upload routes answering 501 rather than accepting files it
        // is about to destroy.
        const { storageController, storageRegistry } = await initializeStorage(local(), true);

        expect(storageController).toBeUndefined();
        expect(storageRegistry).toBeUndefined();
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

    it("drops a local entry hiding in a multi-backend map", async () => {
        // The named-backend form takes the same path, so the guard cannot be
        // sidestepped by declaring more than one backend.
        const { storageController } = await initializeStorage({ uploads: local() }, true);

        expect(storageController).toBeUndefined();
    });

    it("keeps the durable backends when only one entry is local", async () => {
        // Dropping the ephemeral entry must not take the rest of the map with
        // it: a project with a real bucket plus a stray local entry keeps the
        // real bucket.
        const s3 = {
            type: "s3" as const,
            bucket: "media",
            region: "auto",
            accessKeyId: "key",
            secretAccessKey: "secret"
        };

        const { storageRegistry } = await initializeStorage(
            { scratch: local(), media: s3 },
            true
        );

        expect(storageRegistry?.list()).toContain("media");
        expect(storageRegistry?.has("scratch")).toBe(false);
    });

    it("promotes nothing into a missing default, and says which bucket to name", async () => {
        // The survivor is NOT made the default. That promotion is what made a
        // project with `bucket("media")` write to local disk in development —
        // where the synthesized local default survives — and into the media
        // bucket in production, where it is dropped. Uploads that name no
        // source are refused instead, and the rest of the app keeps serving.
        const errors: string[] = [];
        const original = console.error;
        console.error = (...args: unknown[]) => { errors.push(String(args[0])); };
        let result;
        try {
            result = await initializeStorage(
                {
                    scratch: local(),
                    media: {
                        type: "s3" as const,
                        bucket: "media",
                        region: "auto",
                        accessKeyId: "key",
                        secretAccessKey: "secret"
                    }
                },
                true
            );
        } finally {
            console.error = original;
        }

        expect(result.storageController).toBeUndefined();
        expect(result.storageRegistry?.list()).toEqual(["media"]);
        expect(errors.join("\n")).toContain('bucket("media", { default: true })');
        expect(errors.join("\n")).toContain("export const uploads = bucket();");
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

describe("assertStorageAccessControlConfigured", () => {
    const none = { hasAuthorize: false, publicRead: false, allowAnyAuthenticated: false };

    it("refuses to boot in production with no access-control model", () => {
        // The default-config hole: no hook, keys in one flat namespace, so any
        // authenticated user can enumerate and touch anyone's files.
        expect(() => assertStorageAccessControlConfigured(none, true)).toThrow(
            /WITHOUT any access-control model/
        );
    });

    it("does not throw in production when an authorize hook is configured", () => {
        expect(() =>
            assertStorageAccessControlConfigured({ ...none, hasAuthorize: true }, true)
        ).not.toThrow();
    });

    it("does not throw in production when reads are explicitly public", () => {
        expect(() =>
            assertStorageAccessControlConfigured({ ...none, publicRead: true }, true)
        ).not.toThrow();
    });

    it("does not throw in production with the explicit insecure opt-out", () => {
        expect(() =>
            assertStorageAccessControlConfigured({ ...none, allowAnyAuthenticated: true }, true)
        ).not.toThrow();
    });

    it("only warns (never throws) outside production, even with no model", () => {
        // Local development must not be blocked; the warning is the nudge.
        expect(() => assertStorageAccessControlConfigured(none, false)).not.toThrow();
    });
});
