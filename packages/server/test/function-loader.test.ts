import * as path from "path";
import { loadFunctionsFromDirectory } from "../src/functions/function-loader";
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

    describe("createFunctionRoutes", () => {
        it("should mount and route correctly", async () => {
            const loaded = await loadFunctionsFromDirectory(functionsDir, requireImporter);
            const routes = createFunctionRoutes(loaded);

            // 1. Verify GET / lists loaded functions
            const listRes = await routes.request("/");
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
