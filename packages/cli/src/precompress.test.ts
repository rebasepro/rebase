/**
 * `rebase build` writes `.br` and `.gz` beside a static app's hashed assets.
 *
 * Without them the runtime gzips each chunk on the fly — once per process for
 * a hashed one, so the first visitor after every deploy pays for it — and never
 * sends brotli. The runtime already serves a sibling where the build has one.
 */
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { afterEach, describe, expect, it } from "vitest";
import { buildStaticBundle, foldStaticIntoBundle } from "./bundle";
import { isContentHashedName, precompressStaticAssets } from "./precompress";

const CHUNK = "export const value = 1;\n".repeat(200);

const made: string[] = [];
function dirWith(files: Record<string, string | Buffer>): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-precompress-"));
    made.push(dir);
    for (const [name, contents] of Object.entries(files)) {
        const full = path.join(dir, name);
        fs.mkdirSync(path.dirname(full), { recursive: true });
        fs.writeFileSync(full, contents);
    }
    return dir;
}

afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("precompressStaticAssets", () => {
    it("writes both siblings beside a hashed chunk, and they decode to it", () => {
        const dir = dirWith({ "assets/index-vgugiqRO.js": CHUNK });
        const outcome = precompressStaticAssets(dir);

        const file = path.join(dir, "assets/index-vgugiqRO.js");
        expect(zlib.brotliDecompressSync(fs.readFileSync(`${file}.br`)).toString()).toBe(CHUNK);
        expect(zlib.gunzipSync(fs.readFileSync(`${file}.gz`)).toString()).toBe(CHUNK);
        expect(outcome.files).toBe(1);
        expect(outcome.brotliBytes).toBeLessThan(outcome.gzipBytes);
    });

    it("leaves alone what the runtime does not cache forever, what is too small and what does not compress", () => {
        const dir = dirWith({
            "index.html": `<html>${CHUNK}</html>`,
            "assets/vendor-analytics.js": CHUNK,
            "assets/tiny-AbCd1234.js": "export const x = 1;",
            "assets/logo-AbCd1234.png": Buffer.alloc(4096, 7),
            "assets/index-vgugiqRO.js.map": CHUNK
        });
        expect(precompressStaticAssets(dir).files).toBe(0);
        const written = fs.readdirSync(dir, { recursive: true }).map(String).filter(name => /\.(?:br|gz)$/.test(name));
        expect(written).toEqual([]);
    });

    it("keeps a sibling the build already emitted", () => {
        const dir = dirWith({ "assets/index-vgugiqRO.js": CHUNK, "assets/index-vgugiqRO.js.gz": "the build's own" });
        precompressStaticAssets(dir);
        expect(fs.readFileSync(path.join(dir, "assets/index-vgugiqRO.js.gz"), "utf8")).toBe("the build's own");
        expect(fs.existsSync(path.join(dir, "assets/index-vgugiqRO.js.br"))).toBe(true);
    });

    it("reads a content hash by the runtime's rule", () => {
        expect(isContentHashedName("index-vgugiqRO.js")).toBe(true);
        expect(isContentHashedName("rebase-admin-DTJBWfJW.css")).toBe(true);
        expect(isContentHashedName("vendor-analytics.js")).toBe(false);
        expect(isContentHashedName("index.js")).toBe(false);
        expect(isContentHashedName("index-abc.js")).toBe(false);
    });
});

describe("a folded static app", () => {
    it("carries the siblings in the bundle, not in the app's own build, and counts only the app's files", () => {
        const bundleDir = dirWith({ "manifest.json": JSON.stringify({ bundleFormat: 1, entry: {} }) });
        const assetsDir = dirWith({ "index.html": "<html></html>", "assets/index-vgugiqRO.js": CHUNK });

        const { fileCount } = foldStaticIntoBundle({ bundleDir, assetsDir, appName: "web", path: "/", spa: true });

        expect(fileCount).toBe(2);
        expect(fs.existsSync(path.join(bundleDir, "static/web/assets/index-vgugiqRO.js.br"))).toBe(true);
        expect(fs.existsSync(path.join(bundleDir, "static/web/assets/index-vgugiqRO.js.gz"))).toBe(true);
        expect(fs.existsSync(path.join(assetsDir, "assets/index-vgugiqRO.js.br"))).toBe(false);
    });

    it("and so does a standalone static bundle", () => {
        const projectRoot = dirWith({ "package.json": "{}" });
        const assetsDir = dirWith({ "index.html": "<html></html>", "assets/index-vgugiqRO.js": CHUNK });
        const outDir = path.join(projectRoot, "dist-bundle-web");

        const { fileCount } = buildStaticBundle({ projectRoot, appName: "web", assetsDir, outDir, runtimeRange: "*" });

        expect(fileCount).toBe(2);
        expect(fs.existsSync(path.join(outDir, "static/assets/index-vgugiqRO.js.br"))).toBe(true);
    });
});
