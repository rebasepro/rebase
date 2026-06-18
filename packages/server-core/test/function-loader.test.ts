import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { Hono } from "hono";
import { loadFunctionsFromDirectory } from "../src/functions/function-loader";
import { createFunctionRoutes } from "../src/functions/function-routes";

describe("Function Loader & Routes", () => {
    let tempDir: string;

    beforeAll(() => {
        // Create temporary directory in OS temp folder
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-functions-test-"));

        // 1. Write a valid Hono app default export using CommonJS
        fs.writeFileSync(
            path.join(tempDir, "valid-app.js"),
            `
            const { Hono } = require("hono");
            const app = new Hono();
            app.get("/hello", (c) => c.text("hello from valid-app"));
            module.exports = app;
            `
        );

        // 2. Write a valid Hono app factory default export using CommonJS
        fs.writeFileSync(
            path.join(tempDir, "valid-factory.js"),
            `
            const { Hono } = require("hono");
            module.exports = () => {
                const app = new Hono();
                app.post("/hello", (c) => c.text("hello from valid-factory"));
                return app;
            };
            `
        );

        // 3. Write an invalid default export
        fs.writeFileSync(
            path.join(tempDir, "invalid-export.js"),
            `
            module.exports = { foo: "bar" };
            `
        );

        // 4. Write a file with no default export (exports is an object but no module.exports default value)
        fs.writeFileSync(
            path.join(tempDir, "no-default.js"),
            `
            exports.other = "value";
            `
        );

        // 5. Write an ignored non-js/ts file
        fs.writeFileSync(
            path.join(tempDir, "ignored.txt"),
            "some random text"
        );
    });

    afterAll(() => {
        // Clean up temp directory
        if (tempDir && fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true,
force: true });
        }
    });

    describe("loadFunctionsFromDirectory", () => {
        it("should return empty array if directory does not exist", async () => {
            const result = await loadFunctionsFromDirectory(path.join(tempDir, "non-existent-folder"));
            expect(result).toEqual([]);
        });

        it("should load valid apps and factories while ignoring invalid files", async () => {
            const loaded = await loadFunctionsFromDirectory(tempDir);

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
            const loaded = await loadFunctionsFromDirectory(tempDir);
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
