/**
 * The duplicate collapse runs on every boot, not only after an install.
 *
 * `dedupeRuntimePackages` used to be called from `installBundleDependencies`,
 * which returns early whenever the bundle already carries `node_modules`. Three
 * of the four ways a bundle reaches boot take that early return — a bundle that
 * vendored its dependencies at build time, a pod restarting onto a tree it
 * installed on an earlier start, and the fallback that serves an on-disk bundle
 * after a failed fetch — so on all three the bundle's own copy of a runtime
 * package stayed live beside the image's.
 *
 * That is not a wasted megabyte. Two copies of `@rebasepro/types` each run
 * `registerResourceKind` against one process-wide registry, and the second
 * throws if the specs differ at all. Prospector's bundle vendored
 * `@rebasepro/types@0.16.1-canary` while its image shipped 0.17.x, which had
 * gained one `optionKeys` entry on the `database` kind — so importing the
 * database driver threw at boot and the pod crash-looped, reporting a driver
 * that was installed the whole time.
 *
 * These tests assert the placement rather than the mechanism: that boot dedupes
 * a bundle nothing installed, and that it does so BEFORE it reads anything out
 * of that bundle. `fetch-bundle.test.ts` covers what the dedupe itself does.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { bootFromBundle } from "./boot";
import { RUNTIME_MODULES_ENV } from "./fetch-bundle";

let scratch: string;
const savedModulesEnv = process.env[RUNTIME_MODULES_ENV];

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "boot-dedupe-"));
});

afterEach(() => {
    if (savedModulesEnv === undefined) delete process.env[RUNTIME_MODULES_ENV];
    else process.env[RUNTIME_MODULES_ENV] = savedModulesEnv;
    fs.rmSync(scratch, { recursive: true, force: true });
});

/** An image `node_modules` holding the runtime's own copy of a package. */
function imageWith(pkg: string, version: string): string {
    const image = path.join(scratch, "image-modules");
    fs.mkdirSync(path.join(image, pkg), { recursive: true });
    fs.writeFileSync(
        path.join(image, pkg, "package.json"),
        JSON.stringify({ name: pkg, version })
    );
    process.env[RUNTIME_MODULES_ENV] = image;
    return image;
}

/**
 * A bundle shaped like prospector's: `node_modules` vendored at build time,
 * carrying its own older copy of a package the image also supplies.
 *
 * Deliberately carries no manifest. Boot rejects on that, which is what makes
 * the assertion meaningful — the dedupe has to have happened before boot got
 * far enough to read the bundle at all.
 */
function vendoredBundle(pkg: string, version: string): { dir: string; duplicate: string } {
    const dir = path.join(scratch, "dist-bundle");
    const duplicate = path.join(dir, "node_modules", pkg);
    fs.mkdirSync(duplicate, { recursive: true });
    fs.writeFileSync(
        path.join(duplicate, "package.json"),
        JSON.stringify({ name: pkg, version })
    );
    return { dir, duplicate };
}

describe("bootFromBundle collapses duplicated runtime packages", () => {
    it("dedupes a bundle that vendored node_modules, which no install ever touches", async () => {
        const image = imageWith("@rebasepro/types", "0.17.3");
        const { dir, duplicate } = vendoredBundle("@rebasepro/types", "0.16.1-canary.g7f4dd11");

        // Rejects on the absent manifest — after the dedupe, which is the point.
        await expect(bootFromBundle({ bundleDir: dir })).rejects.toThrow();

        expect(fs.lstatSync(duplicate).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(duplicate))
            .toBe(fs.realpathSync(path.join(image, "@rebasepro/types")));
        // The version the process will actually see is the image's, which is the
        // whole reason the two must not coexist.
        const pkg = JSON.parse(fs.readFileSync(path.join(duplicate, "package.json"), "utf8"));
        expect(pkg.version).toBe("0.17.3");
    });

    it("links a runtime package into a bundle that carries none", async () => {
        imageWith("@rebasepro/server", "0.17.3");
        const dir = path.join(scratch, "dist-bundle");
        fs.mkdirSync(dir, { recursive: true });

        await expect(bootFromBundle({ bundleDir: dir })).rejects.toThrow();

        const linked = path.join(dir, "node_modules", "@rebasepro", "server");
        expect(fs.lstatSync(linked).isSymbolicLink()).toBe(true);
    });

    /**
     * Boot dedupes before it reads the bundle, so it must not be able to create
     * one. Without the existence guard the symlink's `recursive: true` mkdir
     * conjures `<path>/node_modules` into being, and `loadBundle` then reports a
     * missing manifest rather than the missing directory the reader typed.
     */
    it("does not conjure a node_modules into a bundle directory that does not exist", async () => {
        imageWith("@rebasepro/server", "0.17.3");
        const missing = path.join(scratch, "not-here");

        await expect(bootFromBundle({ bundleDir: missing }))
            .rejects.toThrow(/Bundle directory not found/);

        expect(fs.existsSync(missing)).toBe(false);
    });

    it("does nothing outside a container, where there is no image copy to collapse onto", async () => {
        delete process.env[RUNTIME_MODULES_ENV];
        const { dir, duplicate } = vendoredBundle("@rebasepro/types", "0.16.1-canary.g7f4dd11");

        await expect(bootFromBundle({ bundleDir: dir })).rejects.toThrow();

        // Untouched: a local `rebase start` against a project's own dist-bundle
        // has one copy of everything and nothing to rewrite.
        expect(fs.lstatSync(duplicate).isSymbolicLink()).toBe(false);
    });
});
