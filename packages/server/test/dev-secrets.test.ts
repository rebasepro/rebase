import { describe, it, expect, beforeEach, afterEach } from "@jest/globals";
/**
 * Development secrets that survive a restart.
 *
 * The behaviour being fixed: `loadEnv` generated `JWT_SECRET` and
 * `REBASE_SERVICE_KEY` freshly on every boot outside production, so restarting
 * the dev server logged you out of your own app and invalidated any API key you
 * had just made.
 *
 * Two properties matter more than the convenience:
 *
 *  - **production is untouched.** Nothing here may make a generated secret
 *    usable in production, and `loadEnv` must still refuse that boot.
 *  - **it fails soft.** A read-only filesystem is a reason to go back to
 *    ephemeral secrets, never a reason a development server will not start.
 */
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
    openDevSecretStore,
    resolveDevSecretsFile,
    shouldCacheDevSecrets,
    detectTestRunner,
    TEST_RUNNER_DETECTED,
    DEV_SECRETS_FILENAME
} from "../src/dev-secrets";

describe("resolveDevSecretsFile", () => {
    it("uses the conventional name in the working directory", () => {
        expect(resolveDevSecretsFile({})).toBe(path.join(process.cwd(), DEV_SECRETS_FILENAME));
    });

    it("honours REBASE_DEV_SECRETS_FILE, resolved to an absolute path", () => {
        const resolved = resolveDevSecretsFile({ REBASE_DEV_SECRETS_FILE: "sub/dir/secrets.json" });
        expect(path.isAbsolute(resolved)).toBe(true);
        expect(resolved.endsWith(path.join("sub", "dir", "secrets.json"))).toBe(true);
    });

    it("ignores a blank override rather than resolving the empty string", () => {
        expect(resolveDevSecretsFile({ REBASE_DEV_SECRETS_FILE: "   " }))
            .toBe(path.join(process.cwd(), DEV_SECRETS_FILENAME));
    });

    it("sits beside the other dev-state files, which are gitignored together", () => {
        expect(DEV_SECRETS_FILENAME.startsWith(".rebase-dev-")).toBe(true);
    });
});

describe("openDevSecretStore", () => {
    let dir: string;
    let file: string;

    beforeEach(async () => {
        dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "rebase-dev-secrets-"));
        file = path.join(dir, DEV_SECRETS_FILENAME);
    });

    afterEach(async () => {
        await fs.promises.rm(dir, { recursive: true, force: true });
    });

    it("is empty before anything is written", () => {
        expect(openDevSecretStore(file).get("JWT_SECRET")).toBeUndefined();
    });

    it("returns what a previous run stored — the whole point", () => {
        openDevSecretStore(file).set("JWT_SECRET", "abc123");
        // A separate store, as a restarted process would open.
        expect(openDevSecretStore(file).get("JWT_SECRET")).toBe("abc123");
    });

    it("keeps several secrets side by side", () => {
        const store = openDevSecretStore(file);
        store.set("JWT_SECRET", "one");
        store.set("REBASE_SERVICE_KEY", "two");

        const reopened = openDevSecretStore(file);
        expect(reopened.get("JWT_SECRET")).toBe("one");
        expect(reopened.get("REBASE_SERVICE_KEY")).toBe("two");
    });

    it("writes owner-only, because these are still secrets", () => {
        openDevSecretStore(file).set("JWT_SECRET", "abc123");
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    it("tightens the mode of a file that was created too permissively", () => {
        fs.writeFileSync(file, JSON.stringify({ JWT_SECRET: "old" }), { mode: 0o644 });
        openDevSecretStore(file).set("REBASE_SERVICE_KEY", "new");
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    });

    it("treats a malformed file as empty rather than throwing", () => {
        fs.writeFileSync(file, "{not json");
        const store = openDevSecretStore(file);
        expect(store.get("JWT_SECRET")).toBeUndefined();

        // …and recovers by rewriting it.
        store.set("JWT_SECRET", "fresh");
        expect(openDevSecretStore(file).get("JWT_SECRET")).toBe("fresh");
    });

    it("ignores a file whose JSON is not an object of strings", () => {
        fs.writeFileSync(file, JSON.stringify(["JWT_SECRET"]));
        expect(openDevSecretStore(file).get("JWT_SECRET")).toBeUndefined();
    });

    it("skips non-string values instead of handing them back", () => {
        fs.writeFileSync(file, JSON.stringify({ JWT_SECRET: 42, REBASE_SERVICE_KEY: "ok" }));
        const store = openDevSecretStore(file);
        expect(store.get("JWT_SECRET")).toBeUndefined();
        expect(store.get("REBASE_SERVICE_KEY")).toBe("ok");
    });

    it("creates the directory when the path points somewhere that does not exist", () => {
        const nested = path.join(dir, "a", "b", DEV_SECRETS_FILENAME);
        openDevSecretStore(nested).set("JWT_SECRET", "abc");
        expect(openDevSecretStore(nested).get("JWT_SECRET")).toBe("abc");
    });

    it("reports itself unusable, and does not throw, when it cannot write", () => {
        // A path whose parent is a *file*, so mkdir and write both fail.
        const blocker = path.join(dir, "blocker");
        fs.writeFileSync(blocker, "not a directory");
        const store = openDevSecretStore(path.join(blocker, DEV_SECRETS_FILENAME));

        expect(() => store.set("JWT_SECRET", "abc")).not.toThrow();
        expect(store.usable).toBe(false);
        // The value is still usable in-process for this boot; it just will not
        // survive one. That is the documented fallback, not a failure.
        expect(store.get("JWT_SECRET")).toBe("abc");
    });

    it("is usable until a write actually fails", () => {
        expect(openDevSecretStore(file).usable).toBe(true);
    });
});

describe("shouldCacheDevSecrets", () => {
    it("caches in development", () => {
        expect(shouldCacheDevSecrets({ NODE_ENV: "development" }, false)).toBe(true);
    });

    it("caches when NODE_ENV is unset — a plain `node server.js` run", () => {
        expect(shouldCacheDevSecrets({}, false)).toBe(true);
    });

    it("never caches in production", () => {
        expect(shouldCacheDevSecrets({ NODE_ENV: "production" }, false)).toBe(false);
    });

    it("never caches under a test runner, whatever NODE_ENV says", () => {
        expect(shouldCacheDevSecrets({ NODE_ENV: "development" }, true)).toBe(false);
        expect(shouldCacheDevSecrets({}, true)).toBe(false);
    });

    it("is false right now, because these tests are a test runner", () => {
        // The regression this guards: a suite that wipes process.env must still
        // not get a secrets file written into its working directory.
        expect(TEST_RUNNER_DETECTED).toBe(true);
        expect(shouldCacheDevSecrets()).toBe(false);
        expect(shouldCacheDevSecrets({})).toBe(false);
    });
});

describe("detectTestRunner", () => {
    it.each([
        ["JEST_WORKER_ID", { JEST_WORKER_ID: "1" }],
        ["VITEST", { VITEST: "true" }],
        ["VITEST_WORKER_ID", { VITEST_WORKER_ID: "2" }],
        ["NODE_ENV=test", { NODE_ENV: "test" }]
    ])("recognises %s", (_label, env) => {
        expect(detectTestRunner(env as NodeJS.ProcessEnv)).toBe(true);
    });

    it("does not mistake an ordinary development environment for one", () => {
        expect(detectTestRunner({ NODE_ENV: "development" })).toBe(false);
        expect(detectTestRunner({})).toBe(false);
    });
});
