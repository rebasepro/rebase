import { afterEach, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { Hono } from "hono";
import fs from "fs";
import os from "os";
import path from "path";
import type { BackendBootstrapper, CollectionConfig, InitializedDriver } from "@rebasepro/types";

import { reportBootFailure } from "../src/boot/boot";
import { bootEnvExtension } from "../src/boot/env";
import { readCronsDirectory } from "../src/cron/cron-loader";
import { readFunctionsDirectory } from "../src/functions/function-loader";
import { initializeRebaseBackend } from "../src/index";
import { _resetRebaseMock } from "../src/singleton";
import { logger } from "../src/utils/logger";
import { requireImporter } from "./helpers/require-importer";

// A boot reads `functionsDir` / `cronsDir` through the runtime's own `import()`,
// which jest's vm cannot do deterministically — see the same mock in
// `runtime-surfaces.test.ts`. The loader logic itself is the real one.
jest.mock("../src/utils/dynamic-import", () => ({
    ...(jest.requireActual("../src/utils/dynamic-import") as Record<string, unknown>),
    nativeDynamicImport: (url: string) => require("./helpers/require-importer").requireImporter(url)
}));

/**
 * A project can ask not to be served at all rather than served without a file.
 *
 * One bad file not taking the others down is the right default, and it is what
 * let a deploy report success while every route of a project's only function
 * answered 404: the process came up, `/health` passed, and the rollout finished.
 * `requireFilesLoaded` is how a deployer waiting on a rollout gets a pod that
 * does not become ready, so the version it replaces keeps serving.
 *
 * Only a file that failed while importing counts. A helper beside the functions
 * that exports no app is skipped and reported too, and is an ordinary project.
 */

const BROKEN = "throw new Error(\"Cannot find module './lines.json'\");\n";
const HELPER = "module.exports = { helper: () => 1 };\n";
const DATA = "module.exports = { default: { lines: [] } };\n";

function collection(slug: string): CollectionConfig {
    return {
        name: slug,
        slug,
        table: slug,
        properties: { id: { name: "ID", type: "string", isId: "uuid" } }
    } as unknown as CollectionConfig;
}

function bootstrapper(): BackendBootstrapper {
    const driver = {
        fetchCollection: async () => [],
        withAuth: async () => driver,
        admin: { executeSql: async () => [] }
    };
    return {
        type: "fake",
        isDefault: true,
        async initializeDriver(): Promise<InitializedDriver> {
            return { driver, collections: undefined, internals: {} } as unknown as InitializedDriver;
        },
        async initializeAuth() {
            return { userService: {}, authRepository: {} };
        }
    } as unknown as BackendBootstrapper;
}

describe("files that failed to load", () => {
    let scratch: string;
    let functionsDir: string;
    let cronsDir: string;
    const stops: Array<() => Promise<void>> = [];

    const put = (dir: string, files: Record<string, string>): void => {
        for (const [name, source] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), source);
    };

    const boot = async (extra: Record<string, unknown>) => {
        const backend = await initializeRebaseBackend({
            app: new Hono() as never,
            server: { close: (cb: () => void) => cb() } as never,
            collections: [collection("widgets")],
            bootstrappers: [bootstrapper()],
            auth: { jwtSecret: "load-test-jwt-secret-0123456789abcdef!", serviceKey: "load-test-service-key-0123456789abcdef!" },
            cronPersistence: false,
            functionsDir,
            cronsDir,
            ...extra
        } as never);
        stops.push(() => backend.shutdown(0));
    };

    beforeEach(() => {
        scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-load-failures-"));
        functionsDir = path.join(scratch, "functions");
        cronsDir = path.join(scratch, "crons");
        fs.mkdirSync(functionsDir);
        fs.mkdirSync(cronsDir);
        jest.spyOn(logger, "warn").mockImplementation(() => undefined);
        jest.spyOn(logger, "error").mockImplementation(() => undefined);
    });

    afterEach(async () => {
        while (stops.length) await stops.pop()!();
        _resetRebaseMock();
        jest.restoreAllMocks();
        fs.rmSync(scratch, { recursive: true, force: true });
    });

    it("are told apart from files that are not functions, by the function loader", async () => {
        put(functionsDir, { "broken.js": BROKEN, "helper.js": HELPER, "data.js": DATA });
        fs.mkdirSync(path.join(functionsDir, "lib"));

        const { problems, failed } = await readFunctionsDirectory(functionsDir, requireImporter);

        expect(problems).toHaveLength(4);
        expect(failed).toEqual(["broken.js (threw: Cannot find module './lines.json')"]);
    });

    it("are told apart from files that are not jobs, by the cron loader", async () => {
        put(cronsDir, { "broken.js": BROKEN, "helper.js": HELPER, "data.js": DATA });

        const { problems, failed } = await readCronsDirectory(cronsDir, requireImporter);

        expect(problems).toHaveLength(3);
        expect(failed).toEqual(["broken.js (threw: Cannot find module './lines.json')"]);
    });

    it("stop the boot under requireFilesLoaded, naming every file and why, in one line", async () => {
        put(functionsDir, { "songs.js": BROKEN });
        put(cronsDir, { "nightly.js": BROKEN });

        const failure = await boot({ requireFilesLoaded: true }).then(() => undefined, (err: unknown) => err);

        expect(failure).toBeInstanceOf(Error);
        const { message } = failure as Error;
        expect(message).toContain("songs.js (threw: Cannot find module './lines.json')");
        expect(message).toContain("nightly.js (threw: Cannot find module './lines.json')");
        expect(message).not.toContain("\n");
    });

    it("do not stop a boot that did not ask", async () => {
        put(functionsDir, { "songs.js": BROKEN });

        await expect(boot({})).resolves.toBeUndefined();
    });

    it("do not include a helper, so a project with one boots under requireFilesLoaded", async () => {
        put(functionsDir, { "helper.js": HELPER, "data.js": DATA });
        put(cronsDir, { "helper.js": HELPER, "data.js": DATA });
        fs.mkdirSync(path.join(functionsDir, "lib"));

        await expect(boot({ requireFilesLoaded: true })).resolves.toBeUndefined();
    });

    it("reach the log as the message and nothing else, as the last thing the process says", async () => {
        put(functionsDir, { "songs.js": BROKEN });
        const failure = await boot({ requireFilesLoaded: true }).then(() => undefined, (err: unknown) => err);

        const lines: string[] = [];
        reportBootFailure(failure, {
            error: (message: string) => { lines.push(message); },
            debug: () => undefined
        }, { NODE_ENV: "production" });

        expect(lines).toEqual([(failure as Error).message]);
    });
});

describe("REBASE_REQUIRE_FILES_LOADED", () => {
    const read = (value: string | undefined) => bootEnvExtension.shape.REBASE_REQUIRE_FILES_LOADED.parse(value);

    it("reaches the backend from a bundle boot, since a variable nothing passes on does nothing", () => {
        const source = fs.readFileSync(path.join(__dirname, "../src/boot/boot.ts"), "utf8");
        const call = source.slice(source.indexOf("= await createRebaseBackend({"));
        expect(call.slice(0, call.indexOf("\n    });"))).toContain("requireFilesLoaded: env.REBASE_REQUIRE_FILES_LOADED");
    });

    it("is off unless asked for, blank included", () => {
        expect(read(undefined)).toBe(false);
        expect(read("")).toBe(false);
    });

    it("is on when set", () => {
        expect(read("true")).toBe(true);
    });
});
