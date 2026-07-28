import fs from "fs";
import os from "os";
import path from "path";
import { loadDeclaredStorageSources, resolveStorageSources } from "../src/boot/sources";

/**
 * Reading a project's storage topology from the `rebase.json` it ships.
 *
 * This is what lets a **custom** runtime — which builds its own image and its own
 * entrypoint, and so has no bundle manifest — declare its buckets in the same one
 * place a managed bundle does, instead of re-stating them in code where the two
 * would drift.
 */
let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-declared-storage-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

const writeManifest = (dir: string, manifest: unknown): void => {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "rebase.json"), JSON.stringify(manifest), "utf8");
};

describe("loadDeclaredStorageSources", () => {
    it("reads the storage block into definitions", () => {
        writeManifest(scratch, {
            rebase: "^1",
            apps: {},
            storage: { media: { engine: "s3", label: "Media" } }
        });
        expect(loadDeclaredStorageSources(scratch)).toEqual([
            { key: "media", engine: "s3", transport: "server", label: "Media" }
        ]);
    });

    it("walks up from a nested entrypoint directory", () => {
        // The scaffolded layout runs from `backend/src`, and a compiled one from
        // `backend/dist/backend/src` — a fixed relative path cannot serve both.
        writeManifest(scratch, {
            rebase: "^1",
            apps: {},
            storage: { media: { engine: "s3" } }
        });
        const nested = path.join(scratch, "backend", "dist", "backend", "src");
        fs.mkdirSync(nested, { recursive: true });
        expect(loadDeclaredStorageSources(nested).map(s => s.key)).toEqual(["media"]);
    });

    it("treats an absent rebase.json as 'declared nothing'", () => {
        // A storage declaration is optional. Failing to boot a whole backend over
        // a missing optional file would be the worse bug.
        expect(loadDeclaredStorageSources(scratch)).toEqual([]);
    });

    it("treats a manifest with no storage block as 'declared nothing'", () => {
        writeManifest(scratch, { rebase: "^1", apps: {} });
        expect(loadDeclaredStorageSources(scratch)).toEqual([]);
    });

    it("degrades to 'declared nothing' on malformed JSON rather than throwing", () => {
        fs.writeFileSync(path.join(scratch, "rebase.json"), "{ not json", "utf8");
        expect(loadDeclaredStorageSources(scratch)).toEqual([]);
    });

    it("refuses two sources that would read the same variables", () => {
        writeManifest(scratch, {
            rebase: "^1",
            apps: {},
            storage: { "media-cdn": { engine: "s3" }, media_cdn: { engine: "s3" } }
        });
        expect(() => loadDeclaredStorageSources(scratch)).toThrow(/same environment/);
    });

    it("stops walking up after the given number of levels", () => {
        writeManifest(scratch, {
            rebase: "^1",
            apps: {},
            storage: { media: { engine: "s3" } }
        });
        const deep = path.join(scratch, "a", "b", "c", "d", "e", "f", "g");
        fs.mkdirSync(deep, { recursive: true });
        expect(loadDeclaredStorageSources(deep, 2)).toEqual([]);
    });
});

describe("a custom runtime resolving what it declared", () => {
    it("configures each declared bucket from its own suffixed variables", () => {
        // The end-to-end property the eject template depends on: declare in
        // rebase.json, configure per source in the environment.
        writeManifest(scratch, {
            rebase: "^1",
            apps: {},
            storage: {
                "(default)": { engine: "s3" },
                media: { engine: "s3" }
            }
        });
        const sources = loadDeclaredStorageSources(scratch);
        const resolved = resolveStorageSources(
            {
                STORAGE_TYPE: "s3",
                S3_BUCKET: "app-uploads",
                S3_ACCESS_KEY_ID: "key",
                S3_SECRET_ACCESS_KEY: "secret",
                STORAGE_TYPE__MEDIA: "s3",
                S3_BUCKET__MEDIA: "app-media",
                S3_ACCESS_KEY_ID__MEDIA: "mkey",
                S3_SECRET_ACCESS_KEY__MEDIA: "msecret"
            },
            sources,
            "/tmp/uploads"
        );
        expect(resolved).toBeDefined();
        expect(Object.keys(resolved!).sort()).toEqual(["(default)", "media"]);
        expect(resolved!["(default)"]).toMatchObject({ type: "s3", bucket: "app-uploads" });
        expect(resolved!.media).toMatchObject({ type: "s3", bucket: "app-media" });
    });

    it("still resolves one default bucket when nothing is declared", () => {
        // Every project that predates this must deploy unchanged.
        const resolved = resolveStorageSources(
            {
                STORAGE_TYPE: "s3",
                S3_BUCKET: "app-uploads",
                S3_ACCESS_KEY_ID: "key",
                S3_SECRET_ACCESS_KEY: "secret"
            },
            loadDeclaredStorageSources(scratch),
            "/tmp/uploads"
        );
        expect(Object.keys(resolved!)).toEqual(["(default)"]);
        expect(resolved!["(default)"]).toMatchObject({ type: "s3", bucket: "app-uploads" });
    });
});
