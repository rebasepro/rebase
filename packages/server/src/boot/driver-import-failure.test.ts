/**
 * Telling "the driver isn't installed" apart from "the driver threw".
 *
 * `importDriver` used to wrap every import failure in one sentence ending
 * "Install it alongside the runtime". For a driver that is genuinely absent
 * that is the right advice. For one that resolved, ran, and threw, it is a
 * false lead that sends the reader to `npm install` a package already sitting
 * on disk — which is exactly how prospector's crash-loop read in the container
 * logs: two log lines blaming a missing `@rebasepro/server-postgres`, while the
 * real fault was a duplicated `@rebasepro/types` throwing out of
 * `registerResourceKind` before the driver exported anything.
 *
 * The two cases want opposite responses, so the message has to distinguish
 * them. It is decided on the error's `code`, not its text.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { initializeDataSource } from "./driver";
import type { ResolvedDataSourceConfig } from "./sources";

let scratch: string;

beforeEach(() => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "driver-import-"));
});

afterEach(() => {
    fs.rmSync(scratch, { recursive: true, force: true });
});

/**
 * Install a fake driver package whose module body runs `body` on import.
 *
 * CommonJS, because Jest's module registry serves this `import()` and cannot
 * load ESM off disk on Node below 24.9. That costs nothing here: what is under
 * test is how an import *failure* is classified, and the classification reads
 * the error's `code`, which is the same either way (`MODULE_NOT_FOUND` from the
 * CJS resolver, `ERR_MODULE_NOT_FOUND` from the ESM one — both listed).
 */
function installDriver(name: string, body: string): void {
    const dir = path.join(scratch, "node_modules", name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
        path.join(dir, "package.json"),
        JSON.stringify({ name, version: "1.2.3", main: "index.js" })
    );
    fs.writeFileSync(path.join(dir, "index.js"), body);
}

function source(driverPackage: string): ResolvedDataSourceConfig {
    return {
        key: "(default)",
        engine: "postgres",
        driverPackage,
        connectionString: "postgres://localhost/none",
        isDefault: true
    };
}

describe("a driver that fails to import", () => {
    it("is not reported as missing when it is present and threw", async () => {
        // The shape of the real failure: a second copy of a runtime package
        // throwing at module scope, before any export exists.
        installDriver(
            "throwing-driver",
            'throw new Error(\'Resource kind "database" is already registered with a '
            + "different definition. Two packages cannot define the same kind.');\n"
        );

        const failure = await initializeDataSource(source("throwing-driver"), undefined, [scratch])
            .then(() => undefined, (error: Error) => error);

        expect(failure).toBeDefined();
        expect(failure!.message).toMatch(/failed while loading/);
        // The original error survives, both in the message and as the cause —
        // it names the actual conflict, which no wrapper can reconstruct.
        expect(failure!.message).toMatch(/already registered with a different definition/);
        expect((failure!.cause as Error).message).toMatch(/already registered/);

        const hint = (failure as unknown as { hint?: string }).hint ?? "";
        expect(hint).toMatch(/is installed/);
        expect(hint).toContain(path.join(scratch, "node_modules", "throwing-driver"));
        // The advice that sent the last reader down the wrong path.
        expect(hint).not.toMatch(/npm install/);
    });

    it("still says to install a driver that really is absent", async () => {
        const failure = await initializeDataSource(
            source("@rebasepro/definitely-not-a-real-driver"),
            undefined,
            [scratch]
        ).then(() => undefined, (error: Error) => error);

        expect(failure).toBeDefined();
        expect(failure!.message).toMatch(/Could not load the database driver/);
        const hint = (failure as unknown as { hint?: string }).hint ?? "";
        expect(hint).toMatch(/npm install @rebasepro\/definitely-not-a-real-driver/);
    });

    /**
     * A driver present but importing something that is not.
     *
     * Genuinely a missing dependency, just one level down, so the install advice
     * is right — and this is the case that would regress if the predicate read
     * the message instead of walking the `cause` chain for a code.
     */
    it("treats a driver whose own dependency is missing as a missing install", async () => {
        installDriver("incomplete-driver", 'require("no-such-package-anywhere");\n');

        const failure = await initializeDataSource(source("incomplete-driver"), undefined, [scratch])
            .then(() => undefined, (error: Error) => error);

        expect(failure).toBeDefined();
        expect(failure!.message).toMatch(/Could not load the database driver/);
    });

    it("rejects a driver that imports cleanly but exports the wrong shape", async () => {
        installDriver("not-a-driver", "module.exports = { hello: 1 };\n");

        const failure = await initializeDataSource(source("not-a-driver"), undefined, [scratch])
            .then(() => undefined, (error: Error) => error);

        expect(failure).toBeDefined();
        expect(failure!.message).toMatch(/does not look like a Rebase database driver/);
    });
});
