/**
 * The runtime re-checks where a static app may sit.
 *
 * The CLI and the control plane refuse a static app at a backend-owned path
 * (`/api`, `/health`, …). A bundle written by anything else reached the
 * runtime unchecked, and the app was mounted under the API, which answered
 * first: an app nobody could reach, booted without a word. And the CLI checks
 * the default `/api` only — the runtime is the one place that knows
 * `REBASE_BASE_PATH`, so an app at `/v1` with the API moved there was never
 * caught anywhere.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { BUNDLE_FORMAT_VERSION, RUNTIME_CONTRACT_VERSION } from "@rebasepro/types";
import { BundleError, loadBundle, type LoadedStaticApp } from "./bundle";
import { staticAppsShadowedByApi } from "./static-routing";

let scratch: string;
beforeEach(() => { scratch = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-reserved-apps-")); });
afterEach(() => { fs.rmSync(scratch, { recursive: true, force: true }); });

function writeBundle(entries: Array<{ path: string; dir: string; name?: string }>): string {
    const dir = fs.mkdtempSync(path.join(scratch, "bundle-"));
    for (const entry of entries) {
        fs.mkdirSync(path.join(dir, entry.dir), { recursive: true });
        fs.writeFileSync(path.join(dir, entry.dir, "index.html"), entry.dir);
    }
    fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({
        bundleFormat: BUNDLE_FORMAT_VERSION,
        runtime: { range: "^1", builtAgainst: "1.0.0", contract: RUNTIME_CONTRACT_VERSION },
        schemaVersion: "",
        app: "web",
        kind: "static",
        entry: { static: entries.map(entry => ({ ...entry, spa: true })) },
        hooks: { native: false },
        deps: { declared: {} }
    }));
    return dir;
}

describe("loading a bundle with an app at a backend-owned path", () => {
    it.each(["/api", "/api/docs", "/health", "/metrics/"])("refuses an app at %s, naming it", (appPath) => {
        const dir = writeBundle([
            { path: "/", dir: "static/web", name: "web" },
            { path: appPath, dir: "static/docs", name: "docs" }
        ]);

        expect(() => loadBundle(dir)).toThrow(BundleError);
        expect(() => loadBundle(dir)).toThrow(/Static app "docs"/);
    });

    it("accepts a lookalike path", () => {
        const dir = writeBundle([{ path: "/apidocs", dir: "static/docs", name: "docs" }]);

        expect(loadBundle(dir).staticApps.map(app => app.path)).toEqual(["/apidocs"]);
    });
});

describe("staticAppsShadowedByApi", () => {
    const app = (appPath: string): LoadedStaticApp => ({ path: appPath, dir: `/b${appPath}`, spa: true });

    it("names an app under a moved API base path", () => {
        const apps = [app("/v1/docs"), app("/v1"), app("/"), app("/v10")];

        expect(staticAppsShadowedByApi(apps, "/v1").map(a => a.path)).toEqual(["/v1/docs", "/v1"]);
    });

    it("tolerates a trailing slash on the base path", () => {
        expect(staticAppsShadowedByApi([app("/v1")], "/v1/").map(a => a.path)).toEqual(["/v1"]);
    });

    it("names nothing for the default layout", () => {
        expect(staticAppsShadowedByApi([app("/"), app("/admin")], "/api")).toEqual([]);
    });
});
