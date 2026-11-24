/**
 * A bundle's imports of drizzle-orm and pg load the image's copies only when
 * both are versions the bundle could have installed. The version rule is pinned
 * here directly; what an import actually loads is checked in a real Node
 * process (jest's module sandbox has no loader to hook), over a fixture bundle
 * with fake copies that each say which copy they are.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { pathToFileURL } from "url";
import { isCaretCompatible, shareCompatiblePackages } from "./shared-packages";

let scratch: string;

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shared-packages-")));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function write(relative: string, contents: string): void {
    const file = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
}

/** A fake package at `dir` whose modules report `copy`, as ESM and as CJS, with a `./sub` subpath. */
function fakePackage(dir: string, name: string, version: string, copy: string): void {
    write(`${dir}/package.json`, JSON.stringify({
        name,
        version,
        type: "module",
        exports: {
            ".": { import: "./index.js", require: "./index.cjs" },
            "./sub": { import: "./sub/index.js", require: "./sub/index.cjs" }
        }
    }));
    write(`${dir}/index.js`, `export const copy = ${JSON.stringify(copy)};`);
    write(`${dir}/index.cjs`, `exports.copy = ${JSON.stringify(copy)};`);
    write(`${dir}/sub/index.js`, `export const copy = ${JSON.stringify(copy)};`);
    write(`${dir}/sub/index.cjs`, `exports.copy = ${JSON.stringify(copy)};`);
}

interface Versions {
    drizzle?: string;
    pg?: string;
}

/**
 * An image and a bundle shaped like a pod's: the bundle's driver and app import
 * drizzle-orm and pg, one bundle package carries its own nested drizzle-orm,
 * and a project outside the bundle carries another.
 */
function writePod(bundle: Versions, image: Versions): void {
    if (image.drizzle) fakePackage("image/node_modules/drizzle-orm", "drizzle-orm", image.drizzle, "image");
    if (image.pg) fakePackage("image/node_modules/pg", "pg", image.pg, "image");
    if (bundle.drizzle) fakePackage("bundle/node_modules/drizzle-orm", "drizzle-orm", bundle.drizzle, "bundle");
    if (bundle.pg) fakePackage("bundle/node_modules/pg", "pg", bundle.pg, "bundle");
    fakePackage("bundle/node_modules/legacy/node_modules/drizzle-orm", "drizzle-orm", "0.30.0", "nested");
    fakePackage("elsewhere/node_modules/drizzle-orm", "drizzle-orm", "0.45.2", "elsewhere");

    write("bundle/node_modules/driver/package.json", JSON.stringify({ name: "driver", type: "module", exports: "./index.js" }));
    write("bundle/node_modules/driver/index.js", [
        "import { copy } from \"drizzle-orm\";",
        "import { copy as sub } from \"drizzle-orm/sub\";",
        "export const driver = [copy, sub].join(\"+\");"
    ].join("\n"));
    write("bundle/node_modules/legacy/package.json", JSON.stringify({ name: "legacy", type: "module", exports: "./index.js" }));
    write("bundle/node_modules/legacy/index.js", "export { copy as legacy } from \"drizzle-orm\";");
    write("bundle/backend/functions/require.cjs", [
        "exports.required = require(\"drizzle-orm\").copy;",
        "exports.pgRequired = require(\"pg\").copy;"
    ].join("\n"));
    write("bundle/backend/schema.js", [
        "import { createRequire } from \"node:module\";",
        "import { copy } from \"drizzle-orm/sub\";",
        "import { copy as pg } from \"pg\";",
        "import { driver } from \"driver\";",
        "import { legacy } from \"legacy\";",
        "const { required, pgRequired } = createRequire(import.meta.url)(\"./functions/require.cjs\");",
        "export const loaded = { schema: copy, pg, driver, legacy, required, pgRequired };"
    ].join("\n"));
    write("elsewhere/index.js", "export { copy as elsewhere } from \"drizzle-orm\";");
}

interface PodLoaded {
    schema: string;
    pg: string;
    driver: string;
    legacy: string;
    required: string;
    pgRequired: string;
}

interface PodRun<Loaded> {
    decisions: { package: string; bundle: string; runtime: string | null; shared: boolean }[];
    loaded: Loaded;
    elsewhere: string;
}

/** Boot the fixture in a real Node process: decide, then load the bundle. */
function runPod<Loaded = PodLoaded>(): PodRun<Loaded> {
    const moduleUrl = pathToFileURL(path.join(__dirname, "shared-packages.ts")).href;
    const script = `
        const { shareCompatiblePackages } = await import(${JSON.stringify(moduleUrl)});
        const decisions = shareCompatiblePackages(${JSON.stringify(path.join(scratch, "bundle"))}, ${JSON.stringify(path.join(scratch, "image/node_modules"))});
        const { loaded } = await import(${JSON.stringify(pathToFileURL(path.join(scratch, "bundle/backend/schema.js")).href)});
        const { elsewhere } = await import(${JSON.stringify(pathToFileURL(path.join(scratch, "elsewhere/index.js")).href)});
        process.stdout.write(JSON.stringify({ decisions, loaded, elsewhere }));
    `;
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        cwd: scratch,
        encoding: "utf8",
        env: { ...process.env, NODE_OPTIONS: "" }
    });
    return JSON.parse(out);
}

const IMAGE_ALL = { schema: "image", pg: "image", driver: "image+image", legacy: "nested", required: "image", pgRequired: "image" };
const BUNDLE_ALL = { schema: "bundle", pg: "bundle", driver: "bundle+bundle", legacy: "nested", required: "bundle", pgRequired: "bundle" };

describe("isCaretCompatible", () => {
    it.each([
        ["0.45.2", "0.45.2", true],
        ["0.45.2", "0.45.4", true],
        ["0.45.4", "0.45.2", false],
        ["0.45.4", "0.46.0", false],
        ["0.45.4", "0.44.9", false],
        ["0.45.4", "1.0.0", false],
        ["8.22.0", "8.23.1", true],
        ["8.23.1", "8.22.0", false],
        ["8.23.1", "9.0.0", false],
        ["0.0.3", "0.0.4", false],
        ["1.0.0-beta.2", "1.0.0-beta.2", true],
        ["1.0.0-beta.2", "1.0.0-beta.3", false],
        ["1.0.0-beta.2", "1.0.0", false],
        ["0.45.2", "not-a-version", false]
    ])("a bundle at %s, an image at %s: %s", (installed, offered, expected) => {
        expect(isCaretCompatible(installed, offered)).toBe(expected);
    });
});

describe("shareCompatiblePackages", () => {
    it("does nothing without an image, or with a bundle that has no copies", () => {
        writePod({}, { drizzle: "0.45.4", pg: "8.23.1" });
        expect(shareCompatiblePackages(path.join(scratch, "bundle"), undefined)).toEqual([]);
        expect(shareCompatiblePackages(path.join(scratch, "bundle"), path.join(scratch, "image/node_modules"))).toEqual([]);
    });

    it("does nothing under --preserve-symlinks, where parent URLs are not real paths", () => {
        writePod({ drizzle: "0.45.2", pg: "8.22.0" }, { drizzle: "0.45.4", pg: "8.23.1" });
        expect(shareCompatiblePackages(path.join(scratch, "bundle"), path.join(scratch, "image/node_modules"), true)).toEqual([]);
    });
});

describe("in a real Node process", () => {
    it("loads the image's copies for every import and require that would have reached the bundle's own", () => {
        writePod({ drizzle: "0.45.2", pg: "8.22.0" }, { drizzle: "0.45.4", pg: "8.23.1" });
        const run = runPod();
        expect(run.decisions).toEqual([
            { package: "drizzle-orm", bundle: "0.45.2", runtime: "0.45.4", shared: true },
            { package: "pg", bundle: "8.22.0", runtime: "8.23.1", shared: true }
        ]);
        expect(run.loaded).toEqual(IMAGE_ALL);
        expect(run.elsewhere).toBe("elsewhere");
    });

    it("keeps the bundle's own copies when the image moved drizzle to another minor", () => {
        writePod({ drizzle: "0.45.4", pg: "8.22.0" }, { drizzle: "0.46.0", pg: "8.23.1" });
        const run = runPod();
        expect(run.decisions.map(d => d.shared)).toEqual([false, false]);
        expect(run.loaded).toEqual(BUNDLE_ALL);
    });

    it("shares neither when only pg is not compatible, so drizzle never parses with another pg", () => {
        writePod({ drizzle: "0.45.2", pg: "8.23.1" }, { drizzle: "0.45.4", pg: "8.22.0" });
        const run = runPod();
        expect(run.decisions.map(d => d.shared)).toEqual([false, false]);
        expect(run.loaded).toEqual(BUNDLE_ALL);
    });

    it("shares neither when the image has no pg for the bundle's", () => {
        writePod({ drizzle: "0.45.2", pg: "8.22.0" }, { drizzle: "0.45.4" });
        const run = runPod();
        expect(run.decisions).toEqual([
            { package: "drizzle-orm", bundle: "0.45.2", runtime: "0.45.4", shared: false },
            { package: "pg", bundle: "8.22.0", runtime: null, shared: false }
        ]);
        expect(run.loaded).toEqual(BUNDLE_ALL);
    });

    it("keeps the bundle's own copies when the image's drizzle is an older patch", () => {
        writePod({ drizzle: "0.45.4", pg: "8.22.0" }, { drizzle: "0.45.2", pg: "8.23.1" });
        expect(runPod().loaded).toEqual(BUNDLE_ALL);
    });

    it("falls back to the bundle's own copy for a subpath the image's copy does not export", () => {
        writePod({ drizzle: "0.45.2", pg: "8.22.0" }, { drizzle: "0.45.4", pg: "8.23.1" });
        const manifestPath = path.join(scratch, "bundle/node_modules/drizzle-orm/package.json");
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        manifest.exports["./extra"] = "./extra.js";
        fs.writeFileSync(manifestPath, JSON.stringify(manifest));
        write("bundle/node_modules/drizzle-orm/extra.js", "export const copy = \"bundle-extra\";");
        write("bundle/backend/schema.js", "export { copy as loaded } from \"drizzle-orm/extra\";");
        expect(runPod<string>().loaded).toBe("bundle-extra");
    });

    it("leaves the bundle's files untouched", () => {
        writePod({ drizzle: "0.45.2", pg: "8.22.0" }, { drizzle: "0.45.4", pg: "8.23.1" });
        runPod();
        const own = path.join(scratch, "bundle/node_modules/drizzle-orm");
        expect(fs.lstatSync(own).isSymbolicLink()).toBe(false);
        expect(JSON.parse(fs.readFileSync(path.join(own, "package.json"), "utf8")).version).toBe("0.45.2");
    });
});
