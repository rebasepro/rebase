import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hono } from "hono";
import type { StorageSourceDefinition } from "@rebasepro/types";

import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { BundleError } from "../src/boot/bundle";
import { graphToStorageSources } from "../src/boot/resource-adapters";
import { resolveStorageSources, type EnvBag } from "../src/boot/sources";
import { initializeStorage } from "../src/init/storage";
import { createStorageRoutes } from "../src/storage/routes";
import { logger } from "../src/utils/logger";

/**
 * Declaring a named bucket never moves the default storage source.
 *
 * The default source is where every upload that names no `storageSource`
 * goes, and the scaffold's properties all name none. Its files sit in
 * `./uploads` (or the bucket `S3_BUCKET` names), and nothing about adding a
 * second bucket says they should move. They did: adding
 * `bucket("media", { engine: "s3" })` to `config/resources.ts` re-pointed the
 * default at media's directory, `uploads__media`, so every file already in
 * `./uploads` vanished from the API and the two sources shared one directory.
 *
 * Each test walks the path a scaffolded project boots through: declarations
 * evaluated into the graph, the graph read back as storage definitions, the
 * environment resolved against `<project>/uploads` (what `bootFromBundle`
 * passes), and the result initialised into the registry the routes serve.
 */
describe("the default storage source, when a named bucket is declared", () => {
    let root: string;

    beforeEach(async () => {
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-default-stays-"));
    });

    afterEach(async () => {
        const { resetDeclaredResources } = await import("@rebasepro/types");
        resetDeclaredResources();
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    /** What `config/resources.ts` declares, evaluated the way boot evaluates it. */
    const declare = async (body: (types: typeof import("@rebasepro/types")) => void): Promise<StorageSourceDefinition[] | undefined> => {
        const types = await import("@rebasepro/types");
        types.resetDeclaredResources();
        body(types);
        const defs = graphToStorageSources(types.buildResourceGraph());
        return defs.length > 0 ? defs : undefined;
    };

    /** `bootFromBundle`'s storage step and `createRebaseBackend`'s, in order. */
    const boot = async (defs: StorageSourceDefinition[] | undefined, env: EnvBag = {}, production = false) => {
        const configs = resolveStorageSources(env, defs, path.join(root, "uploads"), { production });
        const { storageRegistry } = await initializeStorage(configs, production);
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: storageRegistry!.getDefault(),
            registry: storageRegistry,
            sources: defs,
            requireAuth: false,
            publicRead: true
        }));
        return { app, configs: configs! };
    };

    const upload = (app: Hono<HonoEnv>, key: string, storageId?: string): Promise<Response> => {
        const form = new FormData();
        form.append("file", new File(["bytes"], path.basename(key), { type: "text/plain" }), path.basename(key));
        form.append("key", key);
        const query = storageId ? `?storageId=${encodeURIComponent(storageId)}` : "";
        return Promise.resolve(app.fetch(new Request(`http://localhost/api/storage/upload${query}`, { method: "POST", body: form })));
    };

    const listed = async (app: Hono<HonoEnv>, prefix: string, storageId?: string): Promise<string[]> => {
        const query = `prefix=${encodeURIComponent(prefix)}${storageId ? `&storageId=${encodeURIComponent(storageId)}` : ""}`;
        const res = await app.fetch(new Request(`http://localhost/api/storage/list?${query}`));
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { items: { fullPath: string }[] } };
        return body.data.items.map(item => item.fullPath);
    };

    it("keeps serving the files already in ./uploads after `bucket(\"media\", { engine: \"s3\" })` is added", async () => {
        // Day one: nothing declared, an author picture uploaded.
        const before = await boot(await declare(() => undefined));
        expect((await upload(before.app, "author_pictures/ada.txt")).status).toBe(201);

        // Day two: the line the scaffold's own comment suggests, and dev reloads.
        const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
        const after = await boot(defs);

        expect(after.configs["(default)"]).toMatchObject({ type: "local", basePath: path.join(root, "uploads") });
        expect(await listed(after.app, "author_pictures/")).toEqual(["author_pictures/ada.txt"]);
    });

    it("gives the named bucket a directory of its own, which the default does not see", async () => {
        const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
        const { app, configs } = await boot(defs);

        expect(configs.media).toMatchObject({ type: "local", basePath: path.join(root, "uploads__media"), standsInFor: "s3" });
        expect((await upload(app, "covers/one.txt", "media")).status).toBe(201);

        expect(await listed(app, "covers/", "media")).toEqual(["covers/one.txt"]);
        expect(await listed(app, "covers/")).toEqual([]);
    });

    it("does not promote the named bucket, and says nothing about it", async () => {
        const warned: string[] = [];
        const spy = jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        try {
            const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
            const { configs } = await boot(defs);
            expect(configs["(default)"]).not.toBe(configs.media);
        } finally {
            spy.mockRestore();
        }
        expect(warned.join("\n")).not.toContain("none of them is the default bucket");
    });

    it("keeps reading the default's own variables in production", async () => {
        const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
        const configs = resolveStorageSources({
            STORAGE_TYPE: "s3",
            S3_BUCKET: "app-uploads",
            S3_ACCESS_KEY_ID: "AKIA",
            S3_SECRET_ACCESS_KEY: "SECRET",
            S3_BUCKET__MEDIA: "app-media",
            S3_ACCESS_KEY_ID__MEDIA: "AKIA2",
            S3_SECRET_ACCESS_KEY__MEDIA: "SECRET2"
        }, defs, path.join(root, "uploads"), { production: true })!;

        expect(configs["(default)"]).toMatchObject({ type: "s3", bucket: "app-uploads" });
        expect(configs.media).toMatchObject({ type: "s3", bucket: "app-media" });
    });

    it("leaves an unbound default unbound in production rather than handing it the named bucket", async () => {
        const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
        const configs = resolveStorageSources({
            S3_BUCKET__MEDIA: "app-media",
            S3_ACCESS_KEY_ID__MEDIA: "AKIA",
            S3_SECRET_ACCESS_KEY__MEDIA: "SECRET"
        }, defs, path.join(root, "uploads"), { production: true })!;

        // The same verdict the default had before media was declared: nothing
        // asked for it, so production drops it and its uploads answer 501.
        expect(configs["(default)"]).toMatchObject({ type: "local", implicit: true });
        expect(configs.media).toMatchObject({ type: "s3", bucket: "app-media" });
    });

    it("says once, at boot, that only the default is unbound and how to bind or mark it", async () => {
        const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
        const configs = resolveStorageSources({
            S3_BUCKET__MEDIA: "app-media",
            S3_ACCESS_KEY_ID__MEDIA: "AKIA",
            S3_SECRET_ACCESS_KEY__MEDIA: "SECRET"
        }, defs, path.join(root, "uploads"), { production: true });

        const warned: string[] = [];
        const errored: string[] = [];
        const warn = jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        const error = jest.spyOn(logger, "error").mockImplementation((message: string) => { errored.push(message); });
        let result: Awaited<ReturnType<typeof initializeStorage>>;
        try {
            result = await initializeStorage(configs, true);
        } finally {
            warn.mockRestore();
            error.mockRestore();
        }

        expect(result.storageRegistry?.list()).toEqual(["media"]);
        expect(result.storageController).toBeUndefined();
        const said = warned.filter(m => m.includes("default storage source"));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain("S3_BUCKET");
        expect(said[0]).toContain('bucket("media", { default: true })');
        expect(errored.filter(m => /storage/i.test(m))).toEqual([]);
    });

    it("still lets the author point the default at a named bucket with `default: true`", async () => {
        const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3", default: true }); });
        const { configs } = await boot(defs);
        expect(configs["(default)"]).toBe(configs.media);
    });

    describe("refuses to boot when two sources would share one location", () => {
        it("a named directory that is the default's", async () => {
            const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
            const uploads = path.join(root, "uploads");
            const resolve = () => resolveStorageSources({ STORAGE_PATH__MEDIA: uploads }, defs, uploads, { production: false });

            expect(resolve).toThrow(/"media" and "\(default\)" would both store files in/);
            let refusal: unknown;
            try { resolve(); } catch (err) { refusal = err; }
            if (!(refusal instanceof BundleError)) throw new Error(`expected a BundleError, got ${String(refusal)}`);
            // The hint names the one variable to change, and the flag for the
            // author who meant the default to be media all along.
            expect(refusal.hint).toContain("STORAGE_PATH__MEDIA");
            expect(refusal.hint).toContain('bucket("media", { default: true })');
        });

        // It said both "would store files in …/uploads/media", one of which
        // stores them in …/uploads, and to set the variable that had just been
        // set.
        it("a named directory inside the default's, said as one inside the other", async () => {
            const defs = await declare(({ bucket }) => { bucket("media", { engine: "local" }); });
            const uploads = path.join(root, "uploads");
            const media = path.join(uploads, "media");
            let refusal: unknown;
            try {
                resolveStorageSources({ STORAGE_PATH__MEDIA: media }, defs, uploads, { production: false });
            } catch (err) {
                refusal = err;
            }
            if (!(refusal instanceof BundleError)) throw new Error(`expected a BundleError, got ${String(refusal)}`);
            expect(refusal.message).toBe(
                `Storage source "media" would store its files in ${media}, which is inside ${uploads}, where "(default)" ` +
                "stores its own, so each would list, serve and delete the other's files."
            );
            expect(refusal.message).not.toContain("would both store files in");
            expect(refusal.hint).toContain(`Give "media" a directory outside ${uploads} with STORAGE_PATH__MEDIA (it is ${media} now).`);
        });

        it("the default's directory inside a named one, said the other way round", async () => {
            const defs = await declare(({ bucket }) => { bucket("media", { engine: "local" }); });
            const uploads = path.join(root, "files", "uploads");
            const files = path.join(root, "files");
            expect(() => resolveStorageSources({ STORAGE_PATH__MEDIA: files }, defs, uploads, { production: false }))
                .toThrow(`Storage source "media" would store its files in ${files}, which holds ${uploads}, where "(default)" stores its own`);
        });

        it("two sources on one object-store bucket", async () => {
            const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
            expect(() => resolveStorageSources({
                STORAGE_TYPE: "s3",
                S3_BUCKET: "shared",
                S3_ACCESS_KEY_ID: "AKIA",
                S3_SECRET_ACCESS_KEY: "SECRET",
                S3_BUCKET__MEDIA: "shared",
                S3_ACCESS_KEY_ID__MEDIA: "AKIA",
                S3_SECRET_ACCESS_KEY__MEDIA: "SECRET"
            }, defs, path.join(root, "uploads"), { production: true })).toThrow(/would both store files in s3 bucket "shared"/);
        });

        it("but not one bucket on two providers", async () => {
            const defs = await declare(({ bucket }) => { bucket("media", { engine: "s3" }); });
            expect(() => resolveStorageSources({
                STORAGE_TYPE: "s3",
                S3_BUCKET: "uploads",
                S3_ACCESS_KEY_ID: "AKIA",
                S3_SECRET_ACCESS_KEY: "SECRET",
                S3_BUCKET__MEDIA: "uploads",
                S3_ENDPOINT__MEDIA: "https://r2.example.com",
                S3_ACCESS_KEY_ID__MEDIA: "AKIA2",
                S3_SECRET_ACCESS_KEY__MEDIA: "SECRET2"
            }, defs, path.join(root, "uploads"), { production: true })).not.toThrow();
        });
    });
});
