/**
 * `rebase apps list`, one app per line.
 *
 * The line is where a developer checks where each app will be served, so it
 * has to print the address the platform will route — for an app declared at a
 * URL, the whole URL, and the CMS on that app's hostname rather than as a bare
 * path that reads as the project's own root.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsCommand, describeApp } from "./apps";

// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "");

describe("describeApp", () => {
    it("prints a path-mounted app the way it always has", () => {
        expect(plain(describeApp("web", { type: "static", root: "frontend", output: "frontend/dist", path: "/", cms: "/admin" })))
            .toBe("frontend → frontend/dist @ /  CMS at /admin");
    });

    it("prints an app on its own hostname at its URL, and its CMS there", () => {
        expect(plain(describeApp("admin", {
            type: "static",
            root: "admin",
            output: "admin/dist",
            path: "https://Admin.Dadaki.com",
            cms: "/"
        }))).toBe("admin → admin/dist @ https://admin.dadaki.com  CMS at https://admin.dadaki.com");
    });

    it("keeps the path part of a URL, for the app and for a CMS route under it", () => {
        expect(plain(describeApp("admin", {
            type: "static",
            root: "admin",
            output: "admin/dist",
            path: "https://admin.dadaki.com/cms",
            cms: "/cms/panel"
        }))).toBe("admin → admin/dist @ https://admin.dadaki.com/cms  CMS at https://admin.dadaki.com/cms/panel");
    });
});

/**
 * `rebase apps config <app>` prints a VITE_API_URL that is right for the app.
 *
 * On a stock scaffold it printed `VITE_API_URL=http://localhost:3401` for the
 * admin, read from a `.rebase/state.json` a `rebase dev` long since stopped
 * had left behind — for an app `rebase build` folds into the backend bundle and
 * serves on the API's own origin, where the right value is empty, and the
 * value the scaffold's `.env` warns "will follow the bundle into production".
 */
describe("rebase apps config", () => {
    let root: string;
    let cwd: string;
    let out: string[];

    beforeEach(() => {
        cwd = process.cwd();
        root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-apps-config-")));
        process.chdir(root);
        out = [];
        vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { out.push(args.map(String).join(" ")); });
    });
    afterEach(() => {
        process.chdir(cwd);
        fs.rmSync(root, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    const manifest = (apps: Record<string, unknown>) =>
        fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({ rebase: "^1", apps }));
    const devState = (pid: number) => {
        fs.mkdirSync(path.join(root, ".rebase"), { recursive: true });
        fs.writeFileSync(path.join(root, ".rebase", "state.json"), JSON.stringify({ port: 3401, baseUrl: "http://localhost:3401", pid }));
    };
    const json = async (app: string) => {
        await appsCommand("config", ["node", "rebase", "apps", "config", app, "--json"]);
        return JSON.parse(out.join("\n"));
    };

    it("leaves the API URL empty for an app the backend bundle serves, whatever dev left behind", async () => {
        manifest({
            backend: { type: "backend", runtime: "managed" },
            admin: { type: "static", root: "frontend", path: "/", build: "true", output: "frontend/dist" }
        });
        devState(process.pid);
        const config = await json("admin");
        expect(config.apiUrl).toBe("");
        expect(config.sameOrigin).toBe(true);
    });

    it("says why the line is empty, in the human output", async () => {
        manifest({
            backend: { type: "backend", runtime: "managed" },
            admin: { type: "static", root: "frontend", path: "/", build: "true", output: "frontend/dist" }
        });
        await appsCommand("config", ["node", "rebase", "apps", "config", "admin"]);
        const text = plain(out.join("\n"));
        expect(text).toMatch(/^VITE_API_URL=$/m);
        expect(text).toMatch(/same origin/i);
    });

    it("ignores the address of a dev server that is no longer running", async () => {
        manifest({ backend: { type: "backend", runtime: "custom", dockerfile: "Dockerfile" }, web: { type: "static", root: "web", path: "/", output: "web/dist" } });
        // A pid nothing is running as: far above any real pid_max.
        devState(2 ** 30);
        expect((await json("web")).apiUrl).toBeNull();
    });

    it("uses the address of the dev server that is running", async () => {
        manifest({ backend: { type: "backend", runtime: "custom", dockerfile: "Dockerfile" }, web: { type: "static", root: "web", path: "/", output: "web/dist" } });
        devState(process.pid);
        expect((await json("web")).apiUrl).toBe("http://localhost:3401");
    });
});
