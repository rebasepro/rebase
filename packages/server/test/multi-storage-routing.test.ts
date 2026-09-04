import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { HonoEnv } from "../src/api/types";
import { errorHandler } from "../src/api/errors";
import { createStorageRoutes } from "../src/storage/routes";
import { createStorageController } from "../src/storage";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import { resolveStorageSources } from "../src/boot/sources";
import { graphToStorageSources } from "../src/boot/resource-adapters";
import { configureJwt } from "../src/auth/jwt";

/**
 * Two buckets, declared and used, from a `bucket()` call to bytes on disk.
 *
 * Every seam in this path has unit tests; none of them proves that a file
 * uploaded to `media` is a file that *lands* in the media bucket and not the
 * default one. That is the only claim a customer actually cares about, and it
 * spans the declaration, the suffix rule, the resolver, the registry and the
 * upload route — so it is worth one test that crosses all of them.
 *
 * Local backends with different base paths, deliberately: the routing being
 * verified is engine-independent, and two directories make "which bucket did
 * this land in" a question the filesystem answers directly.
 */
describe("two declared buckets, end to end", () => {
    let root: string;
    let app: Hono<HonoEnv>;
    let defaultDir: string;
    let mediaDir: string;

    beforeEach(async () => {
        // `/metadata/*` mints a short-lived path-scoped download token.
        configureJwt({ secret: "test-secret-key-for-jwt-testing-1234567890" });

        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-multi-storage-"));
        defaultDir = path.join(root, "uploads");
        mediaDir = path.join(root, "media");

        // 1. The project declares its topology, exactly as a developer would —
        //    in config code, which is the only place buckets are declared.
        const { bucket, buildResourceGraph, resetDeclaredResources } =
            await import("@rebasepro/types");
        resetDeclaredResources();
        bucket({ engine: "local" });
        bucket("media", { engine: "local", label: "Media" });

        // 2. The runtime reads the graph back — the step every boot path performs.
        const declared = graphToStorageSources(buildResourceGraph());
        expect(declared.map(s => s.key).sort()).toEqual(["(default)", "media"]);

        // 3. The environment configures each source through its own suffix.
        const configs = resolveStorageSources(
            { STORAGE_PATH: defaultDir, STORAGE_PATH__MEDIA: mediaDir },
            declared,
            path.join(root, "fallback")
        );
        expect(Object.keys(configs ?? {}).sort()).toEqual(["(default)", "media"]);

        // 4. Which becomes a registry of live controllers.
        const registry = new DefaultStorageRegistry();
        for (const [key, config] of Object.entries(configs!)) {
            registry.register(key, await createStorageController(config));
        }

        app = new Hono<HonoEnv>();
        app.onError(errorHandler);
        app.route("/api/storage", createStorageRoutes({
            controller: registry.getDefault(),
            registry,
            sources: declared,
            requireAuth: false,
            publicRead: true
        }));
    });

    afterEach(async () => {
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    const upload = async (body: string, key: string, storageId?: string): Promise<Response> => {
        const form = new FormData();
        form.append("file", new File([body], "note.txt", { type: "text/plain" }), "note.txt");
        form.append("key", key);
        const url = storageId
            ? `http://localhost/api/storage/upload?storageId=${encodeURIComponent(storageId)}`
            : "http://localhost/api/storage/upload";
        return app.fetch(new Request(url, { method: "POST", body: form }));
    };

    const findFile = (dir: string, name: string): string | null => {
        if (!fs.existsSync(dir)) return null;
        for (const entry of fs.readdirSync(dir, { withFileTypes: true, recursive: true } as never) as fs.Dirent[]) {
            if (entry.isFile() && entry.name === name) return path.join(String(entry.parentPath ?? dir), entry.name);
        }
        return null;
    };

    it("routes an upload to the source it names, and only there", async () => {
        const res = await upload("media bytes", "cover.txt", "media");
        expect(res.status).toBe(201);

        // The claim: it is in the media bucket, and it is NOT in the default one.
        expect(findFile(mediaDir, "cover.txt")).not.toBeNull();
        expect(findFile(defaultDir, "cover.txt")).toBeNull();
    });

    it("routes an upload naming no source to the default bucket", async () => {
        const res = await upload("default bytes", "doc.txt");
        expect(res.status).toBe(201);

        expect(findFile(defaultDir, "doc.txt")).not.toBeNull();
        expect(findFile(mediaDir, "doc.txt")).toBeNull();
    });

    it("keeps two files of the same name in different buckets apart", async () => {
        // The failure that would otherwise be invisible: one name, two buckets,
        // and a router that quietly resolves both to the same controller.
        expect((await upload("I am default", "same.txt")).status).toBe(201);
        expect((await upload("I am media", "same.txt", "media")).status).toBe(201);

        const inDefault = findFile(defaultDir, "same.txt");
        const inMedia = findFile(mediaDir, "same.txt");
        expect(inDefault).not.toBeNull();
        expect(inMedia).not.toBeNull();
        expect(fs.readFileSync(inDefault!, "utf8")).toBe("I am default");
        expect(fs.readFileSync(inMedia!, "utf8")).toBe("I am media");
    });

    it("reads a file back from the bucket it was written to", async () => {
        await upload("round trip", "read-me.txt", "media");

        const meta = await app.fetch(new Request(
            "http://localhost/api/storage/metadata/read-me.txt?storageId=media"
        ));
        expect(meta.status).toBe(200);

        const file = await app.fetch(new Request(
            "http://localhost/api/storage/file/read-me.txt?storageId=media"
        ));
        expect(file.status).toBe(200);
        expect(await file.text()).toBe("round trip");
    });

    it("advertises both sources to the frontend", async () => {
        // How a client learns to offer "media" as an upload target at all.
        const res = await app.fetch(new Request("http://localhost/api/storage/sources"));
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { key: string; label?: string }[] };
        expect(body.data.map(s => s.key).sort()).toEqual(["(default)", "media"]);
        expect(body.data.find(s => s.key === "media")?.label).toBe("Media");
    });

    it("lists only the naming bucket's contents", async () => {
        await upload("default bytes", "a.txt");
        await upload("media bytes", "b.txt", "media");

        const res = await app.fetch(new Request(
            "http://localhost/api/storage/list?prefix=&storageId=media"
        ));
        expect(res.status).toBe(200);
        const body = await res.json() as { data: { items?: { name?: string }[] } };
        const names = JSON.stringify(body.data);
        expect(names).toContain("b.txt");
        expect(names).not.toContain("a.txt");
    });
});
