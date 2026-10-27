import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { Hono } from "hono";
import type { CollectionConfig, DataDriver, FetchCollectionProps } from "@rebasepro/types";
import { storageReference } from "@rebasepro/types";

import { LocalStorageController } from "../src/storage/LocalStorageController";
import { DefaultStorageRegistry } from "../src/storage/storage-registry";
import { findOrphans, keysNamedBy, moveObjects, verifyMove, walkObjects } from "../src/storage/maintenance";
import { createStorageMaintenanceRoutes } from "../src/storage/maintenance-routes";
import { errorHandler } from "../src/api/errors";
import type { HonoEnv } from "../src/api/types";

/**
 * `rebase storage orphans` and `rebase storage move`.
 *
 * Nothing deletes a stored file when its field is cleared or its row deleted,
 * and changing a property's source leaves its files behind in the old one.
 * These find the files no row names, and copy a folder of files across.
 */

const HOUR = 3_600_000;

/** A driver over fixed rows, paged by `startAfter` as the Postgres driver pages. */
function driverOver(rows: Record<string, unknown>[], fail?: string): DataDriver {
    return {
        async fetchCollection(props: FetchCollectionProps) {
            if (fail) throw new Error(fail);
            const visible = props.withDeleted ? rows : rows.filter(row => !row.deleted_at);
            const start = props.startAfter ? visible.indexOf(props.startAfter as Record<string, unknown>) + 1 : 0;
            return visible.slice(start, start + (props.limit ?? visible.length));
        }
    } as unknown as DataDriver;
}

const collection = (slug: string): CollectionConfig => ({ slug, name: slug, table: slug, properties: {} } as unknown as CollectionConfig);

async function put(controller: LocalStorageController, key: string, content = "x"): Promise<void> {
    await controller.putObject({ file: new File([content], key.split("/").pop() ?? "f", { type: "text/plain" }), key });
}

/** Ages a stored file, as a listing will report it. */
async function age(root: string, key: string, hours: number): Promise<void> {
    const when = new Date(Date.now() - hours * HOUR);
    await fs.promises.utimes(path.join(root, "default", key), when, when);
}

describe("the keys a stored string names", () => {
    it("reads every spelling a file field or a text stores", () => {
        expect(keysNamedBy("posts/a.png")).toContain("posts/a.png");
        expect(keysNamedBy("local://default/posts/a.png")).toContain("posts/a.png");
        expect(keysNamedBy("s3://acme-media/posts/a.png")).toContain("posts/a.png");
        expect(keysNamedBy("gs://acme/posts/a.png")).toContain("posts/a.png");
        expect(keysNamedBy("https://api.example.com/api/storage/file/posts/My%20Photo.png?token=x")).toContain("posts/My Photo.png");
        expect(keysNamedBy(`# Post\n\n![a](${storageReference("posts/in text.png")})`)).toContain("posts/in text.png");
        expect(keysNamedBy("default/posts/a.png")).toContain("posts/a.png");
    });
});

describe("storage orphans", () => {
    let root: string;
    let storage: LocalStorageController;

    beforeEach(async () => {
        root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-orphans-"));
        storage = new LocalStorageController({ type: "local", basePath: root });
        for (const key of ["avatars/kept.png", "avatars/old.png", "posts/inline.png", "posts/deep/legacy.png", "fresh.png", "soft.png"]) {
            await put(storage, key);
        }
        for (const key of ["avatars/kept.png", "avatars/old.png", "posts/inline.png", "posts/deep/legacy.png", "soft.png"]) {
            await age(root, key, 48);
        }
        // An internal rendition is never an app's file.
        await storage.putObject({ file: new File(["r"], "r.webp"), key: "_rebase/renditions/abc.webp" });
    });

    afterEach(async () => {
        await fs.promises.rm(root, { recursive: true, force: true });
    });

    const rows = () => ({
        users: [{ id: "1", avatar: "avatars/kept.png" }],
        posts: [
            { id: "1", body: `Hello ![x](${storageReference("posts/inline.png")})`, meta: { gallery: ["https://api.example.com/api/storage/file/posts/deep/legacy.png?token=a.b.c"] } },
            // Soft-deleted: a restore brings its file back.
            { id: "2", cover: "soft.png", deleted_at: "2026-01-01" }
        ]
    });

    it("are the old files no row names, anywhere in any row", async () => {
        const data = rows();
        const report = await findOrphans({
            controller: storage,
            collections: [collection("users"), collection("posts")],
            driverFor: (c) => driverOver(data[c.slug as keyof typeof data]),
            olderThanMs: 24 * HOUR
        });

        expect(report.orphans.map(o => o.key)).toEqual(["avatars/old.png"]);
        // Unnamed but written an hour ago: the row may not be saved yet.
        expect(report.recent).toBe(1);
        expect(report.objects).toBe(6);
        expect(report.unscanned).toEqual([]);
    });

    it("reads every page of a collection", async () => {
        const many = Array.from({ length: 1200 }, (_, i) => ({ id: String(i), avatar: i === 1199 ? "avatars/old.png" : "x" }));
        const report = await findOrphans({
            controller: storage,
            collections: [collection("users")],
            driverFor: () => driverOver(many),
            olderThanMs: 24 * HOUR
        });
        expect(report.orphans.map(o => o.key)).not.toContain("avatars/old.png");
    });

    it("reads rows as stored when the driver can, and never through a read hook otherwise", async () => {
        const data = rows();
        // The documented `beforeQuery`: a scan has no user, so it would see no row.
        const hooked = {
            ...collection("users"),
            callbacks: { beforeQuery: () => ({ filter: { owner_id: ["==", null] } }) }
        } as unknown as CollectionConfig;
        const fetchOnly = driverOver([]);
        const scanning = {
            ...driverOver([]),
            async *scanStoredRows() { yield data.users; }
        } as unknown as DataDriver;

        const refused = await findOrphans({
            controller: storage, collections: [hooked], driverFor: () => fetchOnly, olderThanMs: 24 * HOUR
        });
        expect(refused.unscanned.map(u => u.collection)).toEqual(["users"]);

        // A global hook applies to every collection.
        const global = await findOrphans({
            controller: storage, collections: [collection("users")], driverFor: () => fetchOnly, olderThanMs: 24 * HOUR,
            globalCallbacks: { afterRead: ({ row }) => row }
        });
        expect(global.unscanned.map(u => u.collection)).toEqual(["users"]);

        const scanned = await findOrphans({
            controller: storage, collections: [hooked], driverFor: () => scanning, olderThanMs: 24 * HOUR
        });
        expect(scanned.unscanned).toEqual([]);
        expect(scanned.orphans.map(o => o.key)).not.toContain("avatars/kept.png");
    });

    it("counts a file a history entry names as in use, and history it cannot read as unread", async () => {
        const data = rows();
        const kept = await findOrphans({
            controller: storage,
            collections: [collection("users"), collection("posts")],
            driverFor: (c) => driverOver(data[c.slug as keyof typeof data]),
            history: { async *scanStoredValues() { yield [[{ avatar: "avatars/kept.png" }, { avatar: "avatars/old.png" }]]; } },
            olderThanMs: 24 * HOUR
        });
        expect(kept.orphans).toEqual([]);
        expect(kept.scanned).toContain("(row history)");

        const unread = await findOrphans({
            controller: storage,
            collections: [collection("users"), collection("posts")],
            driverFor: (c) => driverOver(data[c.slug as keyof typeof data]),
            history: {},
            olderThanMs: 24 * HOUR
        });
        expect(unread.unscanned.map(u => u.collection)).toEqual(["(row history)"]);
    });

    describe("through the admin route", () => {
        const app = (fail?: string) => {
            const data = rows();
            const hono = new Hono<HonoEnv>();
            hono.onError(errorHandler);
            hono.route("/admin/storage", createStorageMaintenanceRoutes({
                registry: DefaultStorageRegistry.create({ "(default)": storage }),
                collections: () => [collection("users"), collection("posts")],
                driverFor: (c) => driverOver(data[c.slug as keyof typeof data], c.slug === "posts" ? fail : undefined)
            }));
            return hono;
        };

        it("lists them, and deletes only them", async () => {
            const listed = await app().request("/admin/storage/orphans");
            expect(listed.status).toBe(200);
            expect((await listed.json()).data.orphans.map((o: { key: string }) => o.key)).toEqual(["avatars/old.png"]);

            const deleted = await app().request("/admin/storage/orphans", { method: "DELETE" });
            expect(deleted.status).toBe(200);
            expect((await deleted.json()).data.deleted).toEqual(["avatars/old.png"]);
            expect(await storage.statObject("avatars/old.png")).toBeNull();
            for (const key of ["avatars/kept.png", "posts/inline.png", "posts/deep/legacy.png", "fresh.png", "soft.png"]) {
                expect(await storage.statObject(key)).not.toBeNull();
            }
        });

        it("deletes nothing when a collection could not be read", async () => {
            const refused = await app("connection refused").request("/admin/storage/orphans", { method: "DELETE" });
            expect(refused.status).toBe(409);
            expect((await refused.json()).error.code).toBe("STORAGE_SCAN_INCOMPLETE");
            expect(await storage.statObject("posts/inline.png")).not.toBeNull();
        });

        it("names the sources it serves when asked for another", async () => {
            const unknown = await app().request("/admin/storage/orphans?storageId=media");
            expect(unknown.status).toBe(404);
            expect((await unknown.json()).error.code).toBe("UNKNOWN_STORAGE_SOURCE");
        });
    });
});

describe("storage move", () => {
    let fromRoot: string;
    let toRoot: string;
    let from: LocalStorageController;
    let to: LocalStorageController;

    beforeEach(async () => {
        fromRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-move-from-"));
        toRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-move-to-"));
        from = new LocalStorageController({ type: "local", basePath: fromRoot });
        to = new LocalStorageController({ type: "local", basePath: toRoot });
        for (let i = 0; i < 7; i++) await put(from, `avatars/${i}.png`, `avatar ${i}`);
        await put(from, "avatars/nested/deep.png", "deep");
        await put(from, "posts/elsewhere.png");
    });

    afterEach(async () => {
        await fs.promises.rm(fromRoot, { recursive: true, force: true });
        await fs.promises.rm(toRoot, { recursive: true, force: true });
    });

    it("copies a folder under the same keys, a page at a time, and resumes", async () => {
        const seen: string[] = [];
        let cursor: string | undefined;
        let calls = 0;
        do {
            const page = await moveObjects({ from, to, prefix: "avatars/", cursor, limit: 3 });
            seen.push(...page.moved.map(m => `${m.key}:${m.outcome}`));
            cursor = page.cursor;
            calls++;
        } while (cursor);

        expect(calls).toBeGreaterThan(2);
        expect(seen.sort()).toEqual([...Array.from({ length: 7 }, (_, i) => `avatars/${i}.png:copied`), "avatars/nested/deep.png:copied"].sort());
        const copied = await to.getObject("avatars/nested/deep.png");
        expect(await copied?.text()).toBe("deep");
        expect(await to.statObject("posts/elsewhere.png")).toBeNull();
        // The source keeps its copies unless asked.
        expect(await from.statObject("avatars/0.png")).not.toBeNull();

        // Run again: everything is there already.
        const again = await moveObjects({ from, to, prefix: "avatars", limit: 100 });
        expect(again.moved.every(m => m.outcome === "exists")).toBe(true);
    });

    it("deletes the source's copy only once the target holds one", async () => {
        const result = await moveObjects({ from, to, prefix: "posts", deleteSource: true });
        expect(result.moved).toEqual([{ key: "posts/elsewhere.png", outcome: "copied", deleted: true }]);
        expect(await from.statObject("posts/elsewhere.png")).toBeNull();
        expect(await to.statObject("posts/elsewhere.png")).not.toBeNull();
    });

    it("moves every file of a local folder over many pages, deleting as it goes", async () => {
        // Each page deletes what it moved, and the local page token used to be
        // an index into the folder: the next page started that many entries
        // into the shrunken folder, and half the files were never moved.
        for (let i = 0; i < 60; i++) await put(from, `bulk/${String(i).padStart(3, "0")}.txt`, `file ${i}`);
        const counts = { copied: 0, deleted: 0, other: 0 };
        let cursor: string | undefined;
        do {
            const page = await moveObjects({ from, to, prefix: "bulk", cursor, limit: 25, deleteSource: true });
            for (const m of page.moved) {
                if (m.outcome === "copied") counts.copied++;
                else counts.other++;
                if (m.deleted) counts.deleted++;
            }
            cursor = page.cursor;
        } while (cursor);

        expect(counts).toEqual({ copied: 60, deleted: 60, other: 0 });
        expect((await from.listObjects("bulk")).items).toEqual([]);
        expect((await to.listObjects("bulk")).items).toHaveLength(60);
    });

    it("finds again, after a move, every file the move left behind", async () => {
        // Defence in depth for the class of bug the local page token was: a
        // walk that skipped files reported success over the half it moved.
        await moveObjects({ from, to, prefix: "avatars", limit: 100, deleteSource: true });
        // One the walk "skipped", and one whose copy the target lost.
        await put(from, "avatars/skipped.png", "skipped");
        await put(from, "avatars/9.png", "copied once");
        await put(to, "avatars/9.png", "copied once");

        const checked: { key: string; reason: string }[] = [];
        let cursor: string | undefined;
        do {
            const page = await verifyMove({ from, to, prefix: "avatars", cursor, limit: 1, deleteSource: true });
            checked.push(...page.notMoved);
            cursor = page.cursor;
        } while (cursor);
        expect(checked.map(entry => entry.key).sort()).toEqual(["avatars/9.png", "avatars/skipped.png"]);
        expect(checked.find(entry => entry.key === "avatars/skipped.png")?.reason).toMatch(/still in the source.*no copy/);
        expect(checked.find(entry => entry.key === "avatars/9.png")?.reason).toMatch(/still in the source.*holds a copy/);

        // Without --delete-source the source keeps its files: only one the
        // target has no copy of is not moved.
        const kept = await verifyMove({ from, to, prefix: "avatars", limit: 100 });
        expect(kept.notMoved).toEqual([{ key: "avatars/skipped.png", reason: "the target has no copy" }]);
        expect(kept.checked).toBe(2);
    });

    it("keeps the source's copy when the target did not take one", async () => {
        // A target that answers every write and stores nothing.
        const leaky = Object.assign(Object.create(LocalStorageController.prototype), to, {
            putObject: async () => ({ key: "", storageUrl: "" }),
            statObject: async () => null
        }) as LocalStorageController;
        const result = await moveObjects({ from, to: leaky, prefix: "posts", deleteSource: true });
        expect(result.moved[0]).toMatchObject({ key: "posts/elsewhere.png", outcome: "failed" });
        expect(await from.statObject("posts/elsewhere.png")).not.toBeNull();
    });

    it("walks every folder, and never the internal one", async () => {
        await from.putObject({ file: new File(["r"], "r.webp"), key: "_rebase/renditions/abc.webp" });
        const keys: string[] = [];
        let cursor: string | undefined;
        do {
            const page = await walkObjects(from, { cursor, limit: 2 });
            keys.push(...page.objects.map(o => o.key));
            cursor = page.cursor;
        } while (cursor);
        expect(keys.sort()).toEqual([...Array.from({ length: 7 }, (_, i) => `avatars/${i}.png`), "avatars/nested/deep.png", "posts/elsewhere.png"].sort());
    });

    it("refuses to delete from a source that stores in the same place as the target", async () => {
        // Two sources declared over one directory (or one bucket): every
        // object is "already there" in the target — it is the same object —
        // so `--delete-source` deleted each one from both.
        const twin = new LocalStorageController({ type: "local", basePath: fromRoot });
        // A custom controller that cannot say where it stores: found out by a probe.
        const opaque = Object.assign(Object.create(LocalStorageController.prototype), twin, {
            storageLocation: undefined
        }) as LocalStorageController;
        for (const target of [twin, opaque]) {
            const hono = new Hono<HonoEnv>();
            hono.onError(errorHandler);
            hono.route("/admin/storage", createStorageMaintenanceRoutes({
                registry: DefaultStorageRegistry.create({ "(default)": from, uploads: target }),
                collections: () => [],
                driverFor: () => undefined
            }));
            const refused = await hono.request("/admin/storage/move", {
                method: "POST",
                body: JSON.stringify({ to: "uploads", prefix: "avatars", deleteSource: true })
            });
            expect(refused.status).toBe(400);
            expect((await refused.json()).error.code).toBe("STORAGE_SAME_LOCATION");
            expect(await from.statObject("avatars/0.png")).not.toBeNull();
        }
        // Nothing left behind by the probe.
        expect((await from.listObjects("_rebase/move-probe")).items).toEqual([]);

        // Two places: the move goes ahead.
        const separate = await moveObjects({ from, to, prefix: "posts", deleteSource: true });
        expect(separate.moved).toEqual([{ key: "posts/elsewhere.png", outcome: "copied", deleted: true }]);
    });

    it("refuses a move into the source it reads", async () => {
        const hono = new Hono<HonoEnv>();
        hono.onError(errorHandler);
        hono.route("/admin/storage", createStorageMaintenanceRoutes({
            registry: DefaultStorageRegistry.create({ "(default)": from, media: to }),
            collections: () => [],
            driverFor: () => undefined
        }));
        const same = await hono.request("/admin/storage/move", { method: "POST", body: JSON.stringify({ from: "media", to: "media" }) });
        expect(same.status).toBe(400);

        const moved = await hono.request("/admin/storage/move", {
            method: "POST",
            body: JSON.stringify({ to: "media", prefix: "posts" })
        });
        expect(moved.status).toBe(200);
        expect((await moved.json()).data.moved).toEqual([{ key: "posts/elsewhere.png", outcome: "copied" }]);

        // Listed again: the move left nothing behind, and a file added since is named.
        const verify = (body: Record<string, unknown>) => hono.request("/admin/storage/move/verify", { method: "POST", body: JSON.stringify(body) });
        const clean = await verify({ to: "media", prefix: "posts" });
        expect(clean.status).toBe(200);
        expect((await clean.json()).data).toMatchObject({ from: "(default)", to: "media", checked: 1, notMoved: [] });
        await put(from, "posts/late.png");
        const late = await (await verify({ to: "media", prefix: "posts" })).json();
        expect(late.data.notMoved).toEqual([{ key: "posts/late.png", reason: "the target has no copy" }]);
        expect((await verify({ from: "media", to: "media" })).status).toBe(400);
    });
});
