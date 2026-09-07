import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION } from "@rebasepro/types";
import { BundleError, createSourceBundle, loadBundle, loadBundleConfigExports, readBundleManifest } from "../src/boot/bundle";
import { warnOnUnusableBundleShape } from "../src/boot/boot";

/**
 * Reading a bundle.
 *
 * Every check here fails at boot rather than at the first request. A container
 * that refuses to start is a deploy that rolls back; a container that starts and
 * then misbehaves is an incident.
 */

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-bundle-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

function writeManifest(overrides: Record<string, unknown> = {}): void {
    fs.writeFileSync(
        path.join(scratch, "manifest.json"),
        JSON.stringify({
            bundleFormat: BUNDLE_FORMAT_VERSION,
            runtime: { range: "^1", builtAgainst: "0.11.0", contract: RUNTIME_CONTRACT_VERSION },
            schemaVersion: "v1:0000000000000000",
            app: "backend",
            mode: "cms",
            entry: {},
            hooks: { native: false },
            deps: { declared: {} },
            build: { cli: "0.11.0", node: "22", createdAt: new Date().toISOString() },
            ...overrides
        })
    );
}

describe("readBundleManifest", () => {
    it("reads a well-formed manifest", () => {
        writeManifest();
        expect(readBundleManifest(scratch).app).toBe("backend");
    });

    it("explains a missing manifest instead of throwing ENOENT", () => {
        expect(() => readBundleManifest(scratch)).toThrow(BundleError);
        expect(() => readBundleManifest(scratch)).toThrow(/manifest\.json/);
    });

    it("reports malformed JSON with the file path", () => {
        fs.writeFileSync(path.join(scratch, "manifest.json"), "{ not json");
        expect(() => readBundleManifest(scratch)).toThrow(/not valid JSON/);
    });

    it("refuses a bundle format newer than it understands", () => {
        writeManifest({ bundleFormat: BUNDLE_FORMAT_VERSION + 1 });
        expect(() => readBundleManifest(scratch)).toThrow(/understands up to/);
    });

    it("accepts an older bundle format, which is the whole point", () => {
        // A bundle built months ago has to keep booting on a patched runtime —
        // otherwise the runtime could never be upgraded underneath a project.
        writeManifest({ bundleFormat: 1 });
        expect(readBundleManifest(scratch).bundleFormat).toBe(1);
    });

    it("refuses a bundle targeting a different runtime contract major", () => {
        writeManifest({
            runtime: { range: "^2", builtAgainst: "2.0.0", contract: RUNTIME_CONTRACT_VERSION + 1 }
        });
        expect(() => readBundleManifest(scratch)).toThrow(/runtime contract/);
    });
});

describe("loadBundle", () => {
    it("resolves declared entry directories to absolute paths", () => {
        fs.mkdirSync(path.join(scratch, "config", "collections"), { recursive: true });
        fs.mkdirSync(path.join(scratch, "backend", "functions"), { recursive: true });
        writeManifest({ entry: { config: "config", functions: "backend/functions" } });

        const bundle = loadBundle(scratch);

        expect(bundle.collectionsDir).toBe(path.join(scratch, "config", "collections"));
        expect(bundle.functionsDir).toBe(path.join(scratch, "backend", "functions"));
    });

    it("derives the collections directory from the config package", () => {
        fs.mkdirSync(path.join(scratch, "config", "collections"), { recursive: true });
        writeManifest({ entry: { config: "config" } });

        expect(loadBundle(scratch).collectionsDir).toBe(
            path.join(scratch, "config", "collections")
        );
    });

    it("drops a declared directory that does not exist instead of failing the boot", () => {
        // An empty `functions/` is an ordinary project; refusing to start over
        // one would be the runtime inventing a requirement.
        writeManifest({ entry: { functions: "backend/functions" } });
        expect(loadBundle(scratch).functionsDir).toBeUndefined();
    });

    it("refuses an entry that points outside the bundle", () => {
        writeManifest({ entry: { config: "../../etc" } });
        expect(() => loadBundle(scratch)).toThrow(/outside the bundle/);
    });

    it("explains a missing bundle directory", () => {
        expect(() => loadBundle(path.join(scratch, "nope"))).toThrow(/not found/);
    });

    it("is not a source tree, whatever the manifest says it was built against", () => {
        // `boot.ts` decides whether the schema editor may rewrite collection
        // files from this flag. A manifest is written by a builder and can say
        // anything; the flag says which of the two loaders produced the bundle.
        writeManifest({ runtime: { range: "^1",
builtAgainst: "source",
contract: RUNTIME_CONTRACT_VERSION } });

        expect(loadBundle(scratch).isSource).toBe(false);
    });
});

describe("createSourceBundle declares only what the project has", () => {
    /**
     * A `--headless` project has no `config/collections` and no generated
     * schema, both by design. The manifest used to name them anyway, from the
     * conventional layout, and the runtime believed it — so a correct project
     * booted telling its author that a file "does not exist" and that no tables
     * would be created. Two warnings, both about the manifest, neither about
     * anything the author had done wrong.
     */
    it("omits a collections directory that is not there", () => {
        fs.mkdirSync(path.join(scratch, "config"), { recursive: true });
        fs.writeFileSync(path.join(scratch, "config", "index.ts"), "export default {};");

        const bundle = createSourceBundle({ projectRoot: scratch });

        expect(bundle.manifest.entry?.collections).toBeUndefined();
        expect(bundle.collectionsDir).toBeUndefined();
    });

    it("omits a schema file that is not there", () => {
        const bundle = createSourceBundle({
            projectRoot: scratch,
            schema: "backend/src/schema.generated.ts"
        });
        expect(bundle.manifest.entry?.schema).toBeUndefined();
    });

    it("still declares what IS there", () => {
        const collections = path.join(scratch, "config", "collections");
        fs.mkdirSync(collections, { recursive: true });
        fs.writeFileSync(path.join(collections, "posts.ts"), "export default {};");
        const schemaDir = path.join(scratch, "backend", "src");
        fs.mkdirSync(schemaDir, { recursive: true });
        fs.writeFileSync(path.join(schemaDir, "schema.generated.ts"), "export const tables = {};");

        const bundle = createSourceBundle({
            projectRoot: scratch,
            schema: "backend/src/schema.generated.ts"
        });

        expect(bundle.manifest.entry?.config).toBe("config");
        expect(bundle.manifest.entry?.collections).toBe(path.join("config", "collections"));
        expect(bundle.manifest.entry?.schema).toBe("backend/src/schema.generated.ts");
        expect(bundle.collectionsDir).toBe(collections);
    });

    it("says it is source, which is what makes the collection editor writable", () => {
        // `rebase dev` boots through here. `boot.ts` passed `schemaEditor:
        // false` unconditionally on the ground that "a bundle holds compiled
        // output" — true of the other loader, false of this one, and the
        // result was "Update (Read-only)" on every scaffolded dev server.
        expect(createSourceBundle({ projectRoot: scratch }).isSource).toBe(true);
    });
});

describe("warnOnUnusableBundleShape", () => {
    const bundle = (entry: Record<string, unknown>, collectionsDir?: string) => ({
        dir: scratch,
        manifest: { kind: "backend", entry },
        collectionsDir,
        functionsDir: undefined,
        cronsDir: undefined,
        staticApps: []
    }) as never;

    it("says nothing about a project that declares no collections", () => {
        // A `--headless` project has a config package — its index, its resources
        // — and deliberately no collections directory. Keying this warning on
        // `entry.config` made every headless boot report its own build as
        // broken.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        warnOnUnusableBundleShape(bundle({ config: "config" }));
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("still warns when a declared collections directory did not resolve", () => {
        // The case it exists for: the build lost them. Distinguishable only
        // because the manifest declares what the project HAS.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        warnOnUnusableBundleShape(bundle({ config: "config", collections: "config/collections" }));
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

/**
 * The managed runtime reads four names out of `config/index.ts`. Every docs page
 * that shows an `initializeRebaseBackend` option tempts a reader to export it
 * from the one file the runtime reads — and the export was dropped in silence,
 * so the feature simply did not happen and nothing said why.
 */
describe("unread config exports", () => {
    /** Write a config package whose index exports the given names. */
    async function configExporting(names: string[]) {
        const configDir = path.join(scratch, "config");
        fs.mkdirSync(configDir, { recursive: true });
        // CommonJS, because jest resolves the runtime's dynamic `import()`
        // through `require`. What matters to the code under test is the shape of
        // the namespace object, which is the same either way.
        const literal = (name: string) =>
            name === "dataSources" || name === "storageSources" ? "[]" : "{}";
        fs.writeFileSync(
            path.join(configDir, "index.js"),
            names.map(name => `exports.${name} = ${literal(name)};`).join("\n")
        );
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        await loadBundleConfigExports({
            dir: scratch,
            manifest: { entry: { config: "config" } },
            collectionsDir: undefined,
            functionsDir: undefined,
            cronsDir: undefined,
            staticApps: []
        } as never);
        const messages = warn.mock.calls.map(call => String(call[0])).join("\n");
        warn.mockRestore();
        return messages;
    }

    it("names an option with no managed route, and what to do instead", async () => {
        const messages = await configExporting(["storagePolicies"]);
        expect(messages).toContain("storagePolicies");
        expect(messages).toContain("storageAuthorize");
    });

    it("lists every unread option in one message", async () => {
        const messages = await configExporting(["jobs", "rateLimit", "webhooks"]);
        for (const name of ["jobs", "rateLimit", "webhooks"]) {
            expect(messages).toContain(name);
        }
    });

    it("says nothing about the exports it does read", async () => {
        expect(await configExporting(["dataSources", "storageSources", "callbacks", "collections"]))
            .toBe("");
    });

    it("says nothing about a project's own helpers", async () => {
        // The config module belongs to the project. A shared constant there is
        // not a mistake, and a boot that complained about one would be noise on
        // every start.
        expect(await configExporting(["TAX_RATE", "formatMoney"])).toBe("");
    });
});
