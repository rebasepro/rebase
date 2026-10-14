import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { Hono } from "hono";
import {
    BUNDLE_FORMAT_VERSION,
    RUNTIME_CONTRACT_VERSION,
    type StorageSourceDefinition
} from "@rebasepro/types";

import type { HonoEnv } from "../api/types";
import { errorHandler } from "../api/errors";
import { initializeStorage } from "../init/storage";
import { createStorageRoutes } from "../storage/routes";
import { logger } from "../utils/logger";
import { resolveBootStorage } from "./boot";
import { createSourceBundle, loadBundle, type LoadedBundle } from "./bundle";
import { graphToStorageSources } from "./resource-adapters";
import type { EnvBag } from "./sources";

/**
 * Where local uploads land when `STORAGE_PATH` names no directory.
 *
 * `rebase dev` boots a view over the project's source, so its uploads were in
 * `<project>/uploads`. `rebase start` boots `<project>/dist-bundle`, and its
 * uploads were in `dist-bundle/uploads`: a file uploaded under dev answered 404
 * under start, on the same database, and a file uploaded under start was
 * deleted by the next `rebase build`, which writes `dist-bundle/` afresh, while
 * the row naming it stayed.
 *
 * Each test drives the storage step `bootFromBundle` runs and serves the result
 * through the real storage routes.
 */
describe("local uploads, under rebase dev and rebase start", () => {
    let scratch: string;
    let project: string;

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-boot-uploads-"));
        project = path.join(scratch, "my-app");
        fs.mkdirSync(project);
        fs.writeFileSync(path.join(project, "rebase.json"), "{}\n");
    });

    afterEach(async () => {
        const { resetDeclaredResources } = await import("@rebasepro/types");
        resetDeclaredResources();
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    /** A backend bundle's directory, written the way `rebase build` writes it: removed first. */
    const writeBundle = (dir: string): LoadedBundle => {
        fs.rmSync(dir, { recursive: true, force: true });
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
            bundleFormat: BUNDLE_FORMAT_VERSION,
            runtime: { range: "^1", builtAgainst: "1.0.0", contract: RUNTIME_CONTRACT_VERSION },
            schemaVersion: "",
            app: "backend",
            kind: "backend",
            entry: {},
            hooks: { native: false },
            deps: { declared: {} },
            build: { cli: "test", node: "22", createdAt: "2026-10-14T00:00:00Z" }
        }));
        return loadBundle(dir);
    };

    /** `rebase build`, then the bundle `rebase start` boots. */
    const build = (): LoadedBundle => writeBundle(path.join(project, "dist-bundle"));

    /** The bundle `rebase dev` boots. */
    const dev = (): LoadedBundle => createSourceBundle({ projectRoot: project });

    /** What `config/resources.ts` declares, evaluated the way boot evaluates it. */
    const declare = async (body: (types: typeof import("@rebasepro/types")) => void): Promise<StorageSourceDefinition[]> => {
        const types = await import("@rebasepro/types");
        types.resetDeclaredResources();
        body(types);
        return graphToStorageSources(types.buildResourceGraph());
    };

    const serve = async (bundle: LoadedBundle, env: EnvBag = {}, definitions?: StorageSourceDefinition[]) => {
        const configs = resolveBootStorage(bundle, env, definitions, false);
        const { storageRegistry } = await initializeStorage(configs, false);
        const app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: storageRegistry!.getDefault(),
            registry: storageRegistry,
            sources: definitions,
            requireAuth: false,
            publicRead: true
        }));
        return { app, configs: configs! };
    };

    const upload = async (app: Hono<HonoEnv>, key: string, storageId?: string): Promise<number> => {
        const form = new FormData();
        form.append("file", new File(["bytes"], path.basename(key), { type: "text/plain" }), path.basename(key));
        form.append("key", key);
        const query = storageId ? `?storageId=${encodeURIComponent(storageId)}` : "";
        const res = await app.fetch(new Request(`http://localhost/api/storage/upload${query}`, { method: "POST", body: form }));
        return res.status;
    };

    const listed = async (app: Hono<HonoEnv>, prefix: string): Promise<string[]> => {
        const res = await app.fetch(new Request(`http://localhost/api/storage/list?prefix=${encodeURIComponent(prefix)}`));
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { items: { fullPath: string }[] } };
        return body.data.items.map(item => item.fullPath);
    };

    it("serves under rebase start what rebase dev stored, and both survive the next build", async () => {
        const underDev = await serve(dev());
        expect(await upload(underDev.app, "author_pictures/ada.txt")).toBe(201);

        const underStart = await serve(build());
        expect(underStart.configs["(default)"]).toMatchObject({ type: "local", basePath: path.join(project, "uploads") });
        expect(await listed(underStart.app, "author_pictures/")).toEqual(["author_pictures/ada.txt"]);
        expect(await upload(underStart.app, "docs/hello.txt")).toBe(201);

        const afterRebuild = await serve(build());
        expect(await listed(afterRebuild.app, "author_pictures/")).toEqual(["author_pictures/ada.txt"]);
        expect(await listed(afterRebuild.app, "docs/")).toEqual(["docs/hello.txt"]);
        expect(fs.readdirSync(path.join(project, "dist-bundle"))).toEqual(["manifest.json"]);
    });

    it("keeps a named local bucket beside the project's uploads/ too, as rebase dev does", async () => {
        const definitions = await declare(({ bucket }) => { bucket("media", { engine: "local" }); });

        const underDev = await serve(dev(), {}, definitions);
        const underStart = await serve(build(), {}, definitions);
        expect(underStart.configs.media).toMatchObject({ type: "local", basePath: path.join(project, "uploads__media") });
        expect(underStart.configs.media).toEqual(underDev.configs.media);
    });

    it("stores inside a bundle with no project around it, as the runtime image's /bundle", async () => {
        const bundle = writeBundle(path.join(scratch, "bundle"));
        const { configs } = await serve(bundle);
        expect(configs["(default)"]).toMatchObject({ type: "local", basePath: path.join(scratch, "bundle", "uploads") });
    });

    it("lets STORAGE_PATH decide over both, as the compose files set it", async () => {
        const volume = path.join(scratch, "storage", "uploads");
        expect((await serve(build(), { STORAGE_PATH: volume })).configs["(default)"])
            .toMatchObject({ type: "local", basePath: volume });
        expect((await serve(writeBundle(path.join(scratch, "bundle")), { STORAGE_PATH: volume })).configs["(default)"])
            .toMatchObject({ type: "local", basePath: volume });
    });

    it("names the files an earlier rebase start left inside the bundle, which the next build deletes", async () => {
        const bundle = build();
        const left = path.join(bundle.dir, "uploads", "default", "docs");
        fs.mkdirSync(left, { recursive: true });
        fs.writeFileSync(path.join(left, "hello.txt"), "bytes");

        const warned: string[] = [];
        const spy = jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        try {
            resolveBootStorage(bundle, {}, undefined, false);
        } finally {
            spy.mockRestore();
        }

        const said = warned.filter(message => message.includes(path.join(bundle.dir, "uploads")));
        expect(said).toHaveLength(1);
        expect(said[0]).toContain(path.join(project, "uploads"));
        expect(said[0]).toContain("STORAGE_PATH");
    });

    it("says nothing about a bundle that holds no uploads", async () => {
        const warned: string[] = [];
        const spy = jest.spyOn(logger, "warn").mockImplementation((message: string) => { warned.push(message); });
        try {
            resolveBootStorage(build(), {}, undefined, false);
            resolveBootStorage(writeBundle(path.join(scratch, "bundle")), {}, undefined, false);
        } finally {
            spy.mockRestore();
        }
        expect(warned).toEqual([]);
    });
});
