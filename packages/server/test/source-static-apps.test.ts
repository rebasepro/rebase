/**
 * `rebase dev` serves a static app with no build step from its sources.
 *
 * A no-build site declared in `rebase.json` (`root` and `output` the same
 * directory, no `build`) was served by `rebase build && rebase start` and by
 * nothing under `rebase dev`: `/app.html` answered 404.
 */
import { describe, it, expect, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import { sourceStaticApps } from "../src/boot/bundle";

const dirs: string[] = [];
function project(apps: Record<string, unknown>, files: string[] = []): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-source-static-"));
    dirs.push(root);
    fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({ rebase: "^1", apps }));
    for (const file of files) {
        fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), "<!doctype html>");
    }
    return root;
}

afterEach(() => {
    for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("sourceStaticApps", () => {
    it("serves a no-build app from its directory, at its path, keeping spa: false", () => {
        const root = project({ web: { type: "static", root: "web", output: "web", path: "/", spa: false } }, ["web/index.html", "web/app.html"]);
        expect(sourceStaticApps(root)).toEqual([{ path: "/", dir: path.join(root, "web"), spa: false }]);
    });

    it("leaves a built app to Vite, and an app with no index.html out", () => {
        const root = project({
            admin: { type: "static", root: "frontend", output: "frontend/dist", path: "/admin" },
            scripted: { type: "static", root: "site", output: "site", build: "node build.mjs" },
            empty: { type: "static", root: "empty", output: "empty", path: "/empty" }
        }, ["frontend/index.html", "site/index.html"]);
        expect(sourceStaticApps(root)).toEqual([]);
    });

    it("serves nothing for a project with no rebase.json", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-source-static-"));
        dirs.push(root);
        expect(sourceStaticApps(root)).toEqual([]);
    });

    it("carries redirects and cleanUrls, as a bundle would", () => {
        const root = project({
            site: {
                type: "static", root: "site", output: "site", path: "https://www.example.com", cleanUrls: true,
                redirects: [{ from: "/old", to: "/new", status: 301, extra: true }]
            }
        }, ["site/index.html"]);
        expect(sourceStaticApps(root)).toEqual([{
            path: "/",
            host: "www.example.com",
            dir: path.join(root, "site"),
            spa: true,
            redirects: [{ from: "/old", to: "/new", status: 301 }],
            cleanUrls: true
        }]);
    });

    it("serves an app that only redirects, with no index.html", () => {
        const root = project({
            apex: {
                type: "static", root: "apex", output: "apex", path: "https://example.com",
                redirects: [{ from: "/:path*", to: "https://www.example.com/:path*" }]
            }
        }, ["apex/.keep"]);
        expect(sourceStaticApps(root)).toEqual([{
            path: "/",
            host: "example.com",
            dir: path.join(root, "apex"),
            spa: true,
            redirects: [{ from: "/:path*", to: "https://www.example.com/:path*" }]
        }]);
    });

    it("leaves out an app whose redirect the CLI would refuse", () => {
        const root = project({
            site: { type: "static", root: "site", output: "site", redirects: [{ from: "/:path*", to: "/new/:path*" }] }
        }, ["site/index.html"]);
        expect(sourceStaticApps(root)).toEqual([]);
    });
});
