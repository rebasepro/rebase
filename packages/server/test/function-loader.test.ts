import * as path from "path";
import { Hono } from "hono";
import type { HonoEnv } from "../src/api/types";
import { loadFunctionsFromDirectory, loadFunctionsWithDiagnostics } from "../src/functions/function-loader";
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

    describe("loadFunctionsFromDirectory", () => {
        it("should return empty array if directory does not exist", async () => {
            const result = await loadFunctionsFromDirectory(path.join(functionsDir, "non-existent-folder"), requireImporter);
            expect(result).toEqual([]);
        });

        it("should load valid apps and factories while ignoring invalid files", async () => {
            const loaded = await loadFunctionsFromDirectory(functionsDir, requireImporter);

            // We expect exactly 2 functions to be loaded: "valid-app" and "valid-factory"
            expect(loaded).toHaveLength(2);

            const names = loaded.map(f => f.name);
            expect(names).toContain("valid-app");
            expect(names).toContain("valid-factory");

            // Verify they both look like Hono instances
            const validApp = loaded.find(f => f.name === "valid-app")!;
            expect(typeof validApp.app.fetch).toBe("function");
            expect(Array.isArray(validApp.app.routes)).toBe(true);

            const validFactory = loaded.find(f => f.name === "valid-factory")!;
            expect(typeof validFactory.app.fetch).toBe("function");
            expect(Array.isArray(validFactory.app.routes)).toBe(true);
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
            const { functions, problems } = await loadFunctionsWithDiagnostics(
                path.resolve(__dirname, "fixtures"), requireImporter
            );

            expect(functions).toEqual([]);
            expect(problems).toEqual(expect.arrayContaining([
                expect.stringContaining("functions/ (subdirectory"),
                expect.stringContaining("crons/ (subdirectory")
            ]));
        });

        it("names files whose extension it cannot import", async () => {
            const { problems } = await loadFunctionsWithDiagnostics(functionsDir, requireImporter);

            expect(problems).toEqual(expect.arrayContaining([
                expect.stringContaining("needs-transpile.mts (unsupported extension .mts)")
            ]));
        });

        it("still reports the files it tried and could not use", async () => {
            const { problems } = await loadFunctionsWithDiagnostics(functionsDir, requireImporter);

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
            const loaded = await loadFunctionsFromDirectory(functionsDir, requireImporter);
            const routes = createFunctionRoutes(loaded);

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
