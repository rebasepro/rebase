/**
 * A content hash Vite writes is read as one, whatever characters it holds.
 *
 * Vite names a chunk `[name]-[hash]`, eight characters of base64url, an
 * alphabet with `-` and `_` in it: about one hash in eight holds a `-`
 * (`index-C-WpENHZ.js`). The rule took the text after the last `-` as the
 * hash, found six characters, and called the file unhashed, so in a blank
 * scaffold's build 11 of 149 assets, the 250 KB entry chunk among them, got no
 * `.br`/`.gz` and were served `no-cache`, compressed on every request.
 *
 * The names below are a real Vite build's, made here, so the test reads what
 * the bundler emits rather than what it is assumed to.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { build } from "vite";

import { precompressStaticAssets } from "./precompress";

/** Chunk names from the build in the report: a `-` inside each hash. */
const REPORTED = [
    "index-C-WpENHZ.js",
    "vendor-react-router-Cb-YeB-k.js",
    "vendor-dnd-DPj-kjvL.js",
    "history-CLPR-BZd.js"
];

let root: string;
let emitted: string[];

beforeAll(async () => {
    // Real path: Vite refuses an input it reaches through the /var symlink.
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-vite-hashes-")));
    // Enough lazily imported modules that some of their hashes hold a `-`,
    // each over the 1 KB below which nothing is precompressed.
    const modules = Array.from({ length: 48 }, (_, index) => `page${index}`);
    for (const name of modules) {
        fs.writeFileSync(path.join(root, `${name}.js`), `export const ${name} = ${JSON.stringify(`${name} `.repeat(250))};\n`);
    }
    fs.writeFileSync(path.join(root, "main.js"), modules.map(name => `import("./${name}.js");`).join("\n"));
    fs.writeFileSync(path.join(root, "index.html"), "<!doctype html><script type=\"module\" src=\"/main.js\"></script>\n");
    await build({ root, logLevel: "silent", configFile: false, build: { outDir: "dist", minify: false } });
    emitted = fs.readdirSync(path.join(root, "dist", "assets"));
}, 120_000);

afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe("the content hash in a Vite build's file names", () => {
    it("is found in every chunk Vite emitted, a `-` inside the hash or not", () => {
        const chunks = emitted.filter(name => name.endsWith(".js"));
        expect(chunks.length).toBeGreaterThan(40);
        // The case this is about is in the build.
        expect(chunks.some(name => name.slice(-11, -3).includes("-"))).toBe(true);

        const dir = path.join(root, "dist");
        precompressStaticAssets(dir);
        const withoutBrotli = chunks.filter(name => !fs.existsSync(path.join(dir, "assets", `${name}.br`)));
        expect(withoutBrotli).toEqual([]);
    });

    it("is found in the names the report quotes", () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-reported-hashes-"));
        try {
            fs.mkdirSync(path.join(dir, "assets"));
            for (const name of REPORTED) fs.writeFileSync(path.join(dir, "assets", name), "export const value = 1;\n".repeat(200));
            precompressStaticAssets(dir);
            expect(REPORTED.filter(name => !fs.existsSync(path.join(dir, "assets", `${name}.br`)))).toEqual([]);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
