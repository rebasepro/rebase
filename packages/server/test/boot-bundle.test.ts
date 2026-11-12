import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, LEGACY_LAYOUT_REMEDY, RUNTIME_CONTRACT_VERSION, type RebaseBundleEntrypoints } from "@rebasepro/types";
import { BundleError, createSourceBundle, loadBundle, loadBundleProjectExports, readBundleManifest, type LoadedBundle } from "../src/boot/bundle";
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
            runtime: { range: "^2", builtAgainst: "0.31.0", contract: RUNTIME_CONTRACT_VERSION },
            schemaVersion: "v2:0000000000000000",
            app: "backend",
            kind: "backend",
            entry: {},
            hooks: { native: false },
            deps: { declared: {} },
            build: { cli: "0.11.0", node: "22", createdAt: new Date().toISOString() },
            ...overrides
        })
    );
}

/** A loaded backend bundle in `scratch` whose manifest declares `entry`. */
function loadedBundle(entry: RebaseBundleEntrypoints, modules: Partial<Pick<LoadedBundle, "tablesDir" | "storageModule" | "hooksModule">> = {}): LoadedBundle {
    return {
        dir: scratch,
        manifest: {
            bundleFormat: BUNDLE_FORMAT_VERSION,
            runtime: { range: "^2", builtAgainst: "0.31.0", contract: RUNTIME_CONTRACT_VERSION },
            schemaVersion: "v2:0000000000000000",
            app: "backend",
            kind: "backend",
            entry,
            hooks: { native: false },
            deps: { declared: {} },
            build: { cli: "0.11.0", node: "22", createdAt: new Date().toISOString() }
        },
        ...modules,
        functionsDir: undefined,
        cronsDir: undefined,
        staticApps: [],
        isSource: false
    };
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

    it("refuses an older bundle format with the codemod — it carries config/collections", () => {
        // Formats 1 and 2 hold `defineCollection` files this runtime does not
        // read; booting one would introspect instead of serving its tables.
        writeManifest({ bundleFormat: 2, entry: { config: "config" } });
        expect(() => readBundleManifest(scratch)).toThrow(BundleError);
        try {
            readBundleManifest(scratch);
        } catch (error) {
            if (!(error instanceof BundleError)) throw error;
            expect(error.hint).toContain(LEGACY_LAYOUT_REMEDY);
        }
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
        fs.mkdirSync(path.join(scratch, "backend", "schema"), { recursive: true });
        fs.mkdirSync(path.join(scratch, "backend", "functions"), { recursive: true });
        writeManifest({ entry: { tables: "backend/schema", functions: "backend/functions" } });

        const bundle = loadBundle(scratch);

        expect(bundle.tablesDir).toBe(path.join(scratch, "backend", "schema"));
        expect(bundle.functionsDir).toBe(path.join(scratch, "backend", "functions"));
    });

    it("resolves a module entry to the file that exists, compiled or source", () => {
        fs.mkdirSync(path.join(scratch, "backend"), { recursive: true });
        fs.writeFileSync(path.join(scratch, "backend", "storage.js"), "");
        fs.writeFileSync(path.join(scratch, "backend", "hooks.ts"), "");
        writeManifest({ entry: { storage: "backend/storage", hooks: "backend/hooks", resources: "backend/resources" } });

        const bundle = loadBundle(scratch);

        expect(bundle.storageModule).toBe(path.join(scratch, "backend", "storage.js"));
        expect(bundle.hooksModule).toBe(path.join(scratch, "backend", "hooks.ts"));
        // Declared, missing: skipped with a warning, never a crash.
        expect(bundle.resourcesModule).toBeUndefined();
    });

    it("drops a declared directory that does not exist instead of failing the boot", () => {
        // An empty `functions/` is an ordinary project; refusing to start over
        // one would be the runtime inventing a requirement.
        writeManifest({ entry: { functions: "backend/functions" } });
        expect(loadBundle(scratch).functionsDir).toBeUndefined();
    });

    it("refuses an entry that points outside the bundle", () => {
        writeManifest({ entry: { tables: "../../etc" } });
        expect(() => loadBundle(scratch)).toThrow(/outside the bundle/);
    });

    it("explains a missing bundle directory", () => {
        expect(() => loadBundle(path.join(scratch, "nope"))).toThrow(/not found/);
    });

    it("is not a source tree, whatever the manifest says it was built against", () => {
        // `boot.ts` decides whether the schema editor may rewrite collection
        // files from this flag. A manifest is written by a builder and can say
        // anything; the flag says which of the two loaders produced the bundle.
        writeManifest({ runtime: { range: "^2",
builtAgainst: "source",
contract: RUNTIME_CONTRACT_VERSION } });

        expect(loadBundle(scratch).isSource).toBe(false);
    });
});

describe("createSourceBundle declares only what the project has", () => {
    /**
     * A project with no tables (it introspects) and no generated schema, both
     * by design, must not boot telling its author a file "does not exist" and
     * that no tables will be created.
     */
    it("omits a schema directory that is not there", () => {
        const bundle = createSourceBundle({ projectRoot: scratch });

        expect(bundle.manifest.entry?.tables).toBeUndefined();
        expect(bundle.tablesDir).toBeUndefined();
        expect(bundle.manifest.entry?.hooks).toBeUndefined();
        expect(bundle.manifest.entry?.storage).toBeUndefined();
        expect(bundle.manifest.entry?.resources).toBeUndefined();
    });

    it("omits a schema file that is not there", () => {
        const bundle = createSourceBundle({
            projectRoot: scratch,
            schema: "backend/src/schema.generated.ts"
        });
        expect(bundle.manifest.entry?.schema).toBeUndefined();
    });

    it("still declares what IS there, at the backend/ defaults", () => {
        const tables = path.join(scratch, "backend", "schema");
        fs.mkdirSync(tables, { recursive: true });
        fs.writeFileSync(path.join(tables, "index.ts"), "export {};");
        fs.writeFileSync(path.join(scratch, "backend", "resources.ts"), "export {};");
        fs.writeFileSync(path.join(scratch, "backend", "storage.ts"), "export {};");
        fs.writeFileSync(path.join(scratch, "backend", "hooks.ts"), "export {};");
        const generated = path.join(scratch, "backend", "src");
        fs.mkdirSync(generated, { recursive: true });
        fs.writeFileSync(path.join(generated, "schema.generated.ts"), "export const tables = {};");

        const bundle = createSourceBundle({
            projectRoot: scratch,
            schema: "backend/src/schema.generated.ts"
        });

        expect(bundle.manifest.entry).toMatchObject({
            tables: "backend/schema",
            resources: "backend/resources",
            storage: "backend/storage",
            hooks: "backend/hooks",
            schema: "backend/src/schema.generated.ts"
        });
        expect(bundle.tablesDir).toBe(tables);
        expect(bundle.resourcesModule).toBe(path.join(scratch, "backend", "resources.ts"));
        expect(bundle.storageModule).toBe(path.join(scratch, "backend", "storage.ts"));
        expect(bundle.hooksModule).toBe(path.join(scratch, "backend", "hooks.ts"));
    });

    it("says it is source, which is what makes the schema editor writable", () => {
        // `rebase dev` boots through here. `boot.ts` passed `schemaEditor:
        // false` unconditionally on the ground that "a bundle holds compiled
        // output" — true of the other loader, false of this one.
        expect(createSourceBundle({ projectRoot: scratch }).isSource).toBe(true);
    });
});

describe("warnOnUnusableBundleShape", () => {
    it("says nothing about a project that declares no tables", () => {
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        warnOnUnusableBundleShape(loadedBundle({ hooks: "backend/hooks" }));
        expect(warn).not.toHaveBeenCalled();
        warn.mockRestore();
    });

    it("still warns when a declared tables directory did not resolve", () => {
        // The case it exists for: the build lost them. Distinguishable only
        // because the manifest declares what the project HAS.
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        warnOnUnusableBundleShape(loadedBundle({ tables: "backend/schema" }));
        expect(warn).toHaveBeenCalled();
        warn.mockRestore();
    });
});

/**
 * The managed runtime reads `storageAuthorize` from backend/storage and
 * `hooks` from backend/hooks. Every docs page that shows an
 * `initializeRebaseBackend` option tempts a reader to export it from one of
 * them — and the export was dropped in silence.
 */
describe("project module exports", () => {
    /** Write backend/storage.js exporting the given names, and load it. */
    async function storageExporting(names: string[], file = "storage.js") {
        const dir = path.join(scratch, "backend");
        fs.mkdirSync(dir, { recursive: true });
        // CommonJS, because jest resolves the runtime's dynamic `import()`
        // through `require`. What matters is the shape of the namespace object.
        const literal = (name: string) => name === "storageAuthorize" ? "() => true" : name === "hooks" ? "{ afterRead: (p) => p.values }" : "{}";
        fs.writeFileSync(
            path.join(dir, file),
            names.map(name => `exports.${name} = ${literal(name)};`).join("\n")
        );
        const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
        const exported = await loadBundleProjectExports(loadedBundle({}, file.startsWith("hooks")
            ? { hooksModule: path.join(dir, file) }
            : { storageModule: path.join(dir, file) }));
        const messages = warn.mock.calls.map(call => String(call[0])).join("\n");
        warn.mockRestore();
        return { messages, exported };
    }

    it("reads storageAuthorize from backend/storage and hooks from backend/hooks", async () => {
        expect(typeof (await storageExporting(["storageAuthorize"])).exported.storageAuthorize).toBe("function");
        expect(typeof (await storageExporting(["hooks"], "hooks.js")).exported.hooks?.afterRead).toBe("function");
    });

    it("names an option with no managed route, and what to do instead", async () => {
        const { messages } = await storageExporting(["storagePolicies"]);
        expect(messages).toContain("storagePolicies");
        expect(messages).toContain("storageAuthorize");
    });

    it("lists every unread option in one message", async () => {
        const { messages } = await storageExporting(["jobs", "rateLimit", "webhooks"]);
        for (const name of ["jobs", "rateLimit", "webhooks"]) {
            expect(messages).toContain(name);
        }
    });

    it("says nothing about the exports it does read", async () => {
        expect((await storageExporting(["storageAuthorize"])).messages).toBe("");
    });

    it("refuses a module still exporting a replaced resource key, by name", async () => {
        await expect(storageExporting(["dataSources"])).rejects.toThrow(/`dataSources` is no longer read/);
    });

    it("says nothing about a project's own helpers", async () => {
        expect((await storageExporting(["TAX_RATE", "formatMoney"])).messages).toBe("");
    });
});
