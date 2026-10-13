import * as path from "path";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { functionList, loadFunctions } from "../src/functions/function-loader";
import { createFunctionRoutes } from "../src/functions/function-routes";
import { requireImporter } from "./helpers/require-importer";

// Committed fixtures directory (test/fixtures/functions). A nested
// package.json pins `"type": "commonjs"` so the `.js` fixtures load as CJS
// inside server's ESM package, and living inside the package tree lets
// them `require("hono")`. Tests inject `requireImporter` so discovery is
// deterministic — no native-import race under jest's parallel workers, no
// runtime temp-file churn. Fixtures: valid-app, valid-factory (loaded),
// invalid-export, no-default (rejected), ignored.txt (wrong extension).
describe("Function Loader & Routes", () => {
    const functionsDir = path.resolve(__dirname, "fixtures/functions");

    /** The loader's answer, plus every file it reported as skipped. */
    const load = async (dir: string) => {
        const problems: string[] = [];
        const functions = await loadFunctions(dir, { importModule: requireImporter, onSkip: p => problems.push(p) });
        return { functions, problems };
    };

    describe("loadFunctions", () => {
        it("returns an empty record if the directory does not exist", async () => {
            const result = await loadFunctions(path.join(functionsDir, "non-existent-folder"), { importModule: requireImporter });
            expect(result).toEqual({});
        });

        it("keys the valid apps and factories by file name, ignoring invalid files", async () => {
            const loaded = await loadFunctions(functionsDir, { importModule: requireImporter });

            // Exactly "valid-app" and "valid-factory" load — the record key is
            // the URL segment each one answers at.
            expect(Object.keys(loaded).sort()).toEqual(["valid-app", "valid-factory"]);

            // Verify they both look like Hono instances
            expect(typeof loaded["valid-app"].fetch).toBe("function");
            expect(Array.isArray(loaded["valid-app"].routes)).toBe(true);
            expect(typeof loaded["valid-factory"].fetch).toBe("function");
            expect(Array.isArray(loaded["valid-factory"].routes)).toBe(true);
        });
    });

    describe("what the loader refuses to serve, it reports", () => {
        /**
         * `rebase build` globs `functions/**\/*.ts` — recursive — while the
         * loader reads one directory level. A project that reorganises into
         * `functions/admin/users.ts` gets both files compiled, typechecked and
         * written into the bundle, and neither mounted: the entry did not match
         * the `.ts`/`.js` filter, so it was not even a problem, and the boot log
         * said nothing at all. The build's answer must not be wider than the
         * runtime's in silence.
         */
        it("names ignored subdirectories instead of dropping them", async () => {
            // `test/fixtures` holds only subdirectories (`functions`, `crons`).
            const { functions, problems } = await load(path.resolve(__dirname, "fixtures"));

            expect(functions).toEqual({});
            expect(problems).toEqual(expect.arrayContaining([
                expect.stringContaining("functions/ (subdirectory"),
                expect.stringContaining("crons/ (subdirectory")
            ]));
        });

        it("names files whose extension it cannot import", async () => {
            const { problems } = await load(functionsDir);

            expect(problems).toEqual(expect.arrayContaining([
                expect.stringContaining("needs-transpile.mts (unsupported extension .mts)")
            ]));
        });

        it("still reports the files it tried and could not use", async () => {
            const { problems } = await load(functionsDir);

            expect(problems).toEqual(expect.arrayContaining([
                expect.stringContaining("no-default.js"),
                expect.stringContaining("invalid-export.js")
            ]));
            // A `.txt` next to your functions is not a mistake worth a warning.
            expect(problems.join(" ")).not.toContain("ignored.txt");
        });
    });

    describe("createFunctionRoutes", () => {
        it("should mount and route correctly", async () => {
            const loaded = await loadFunctions(functionsDir, { importModule: requireImporter });
            const routes = createFunctionRoutes(functionList(loaded));

            // 1. Verify GET / lists loaded functions — to a resolved identity.
            // In the server the auth middleware runs ahead of this router and
            // sets `user` (or `driver` for an anonymous caller); stand in for it.
            const withIdentity = (identity: Record<string, unknown>) => {
                const app = new Hono<HonoEnv>();
                app.use("*", async (c, next) => {
                    for (const [key, value] of Object.entries(identity)) c.set(key as never, value as never);
                    await next();
                });
                app.route("/", routes);
                return app;
            };
            const anonymousRes = await withIdentity({ driver: {} }).request("/");
            expect(anonymousRes.status).toBe(401);

            const listRes = await withIdentity({ driver: {}, user: { uid: "u1", roles: [] } }).request("/");
            expect(listRes.status).toBe(200);

            const listData = await listRes.json();
            expect(listData).toEqual({
                functions: [
                    { name: "valid-app",
endpoint: "/functions/valid-app" },
                    { name: "valid-factory",
endpoint: "/functions/valid-factory" }
                ]
            });

            // 2. Verify routing to valid-app
            const appRes = await routes.request("/valid-app/hello");
            expect(appRes.status).toBe(200);
            expect(await appRes.text()).toBe("hello from valid-app");

            // 3. Verify routing to valid-factory
            const factoryRes = await routes.request("/valid-factory/hello", { method: "POST" });
            expect(factoryRes.status).toBe(200);
            expect(await factoryRes.text()).toBe("hello from valid-factory");
        });
    });
});
