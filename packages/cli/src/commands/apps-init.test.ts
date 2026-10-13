/**
 * `rebase apps init` writes down what this project already resolves to.
 *
 * Run with `--force` on a fresh scaffold it used to write a different manifest
 * from the one the scaffold ships: the `admin` app renamed `web`, its
 * `"cms": "/"` dropped, an npm build command in a pnpm project, and `spa` and
 * `functions` restating their defaults. A rename is not cosmetic — an app's
 * name is its identity on a deployed project — and the CMS address is a fact
 * no inference can observe, so a re-inference that drops it loses it for good.
 *
 * It also accepted `rebase apps init <name>` and ignored the name, so a reader
 * who believed it registered one app got a whole inferred manifest instead.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsCommand } from "./apps";
import { createRebaseApp } from "./init";

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

let tmp: string;
let cwd: string;
let out: string[];
let err: string[];

beforeEach(() => {
    cwd = process.cwd();
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-apps-init-")));
    // The release probe asks npm whether this version is published; the
    // scaffold under test does not need the answer.
    vi.stubEnv("REBASE_E2E", "1");
    out = [];
    err = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => { out.push(args.map(String).join(" ")); });
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => { err.push(args.map(String).join(" ")); });
    vi.spyOn(process, "exit").mockImplementation((code?: string | number | null) => {
        throw new Exit(typeof code === "number" ? code : undefined);
    });
});

afterEach(() => {
    process.chdir(cwd);
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
});

// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "");

async function scaffold(name: string, flags: string[]): Promise<string> {
    process.chdir(tmp);
    await createRebaseApp(["node", "rebase", "init", name, "--yes", ...flags]);
    return path.join(tmp, name);
}

async function reinfer(project: string): Promise<string> {
    process.chdir(project);
    await appsCommand("init", ["node", "rebase", "apps", "init", "--force"]);
    return fs.readFileSync(path.join(project, "rebase.json"), "utf8");
}

describe("rebase apps init --force on a fresh scaffold", () => {
    it("writes back the rebase.json the scaffold ships, byte for byte", async () => {
        const project = await scaffold("cms-app", ["--template", "blank"]);
        const shipped = fs.readFileSync(path.join(project, "rebase.json"), "utf8");

        expect(await reinfer(project)).toBe(shipped);
    }, 60_000);

    it("does so for an npm project too, whose build command npm spells", async () => {
        // `init` picks npm when the directory it runs in says npm, and the
        // install that follows writes the project's own lockfile.
        fs.writeFileSync(path.join(tmp, "package-lock.json"), "{}\n");
        const project = await scaffold("npm-app", ["--template", "blank"]);
        fs.writeFileSync(path.join(project, "package-lock.json"), "{}\n");
        const shipped = fs.readFileSync(path.join(project, "rebase.json"), "utf8");
        expect(JSON.parse(shipped).apps.admin.build).toMatch(/^npm /);

        expect(await reinfer(project)).toBe(shipped);
    }, 60_000);

    it("does so for a headless scaffold", async () => {
        const project = await scaffold("api-app", ["--headless"]);
        const shipped = fs.readFileSync(path.join(project, "rebase.json"), "utf8");

        expect(await reinfer(project)).toBe(shipped);
    }, 60_000);

    it("keeps an app's name, address and CMS route, which nothing in the project can show", async () => {
        const project = await scaffold("custom-app", ["--template", "blank"]);
        const manifestFile = path.join(project, "rebase.json");
        const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        manifest.apps.site = manifest.apps.admin;
        delete manifest.apps.admin;
        manifest.apps.site.path = "https://shop.example.com";
        manifest.apps.site.cms = "/admin";
        manifest.apps.server = manifest.apps.backend;
        delete manifest.apps.backend;
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 4) + "\n");

        const written = JSON.parse(await reinfer(project));

        expect(plain(out.join("\n")), "the declaration it re-infers over is valid").not.toMatch(/invalid/);
        expect(Object.keys(written.apps).sort()).toEqual(["server", "site"]);
        expect(written.apps.site).toMatchObject({ root: "frontend", path: "https://shop.example.com", cms: "/admin" });
        expect(written.apps.server).toEqual({ type: "backend", runtime: "managed" });
    }, 60_000);

    it("names an app it no longer finds, instead of dropping it without a word", async () => {
        const project = await scaffold("gone-app", ["--template", "blank"]);
        const manifestFile = path.join(project, "rebase.json");
        const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
        manifest.apps.docs = { type: "static", root: "docs", output: "docs/dist", path: "/docs" };
        fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 4) + "\n");

        const written = JSON.parse(await reinfer(project));

        expect(written.apps).not.toHaveProperty("docs");
        expect(plain(out.join("\n"))).toMatch(/docs.*not found in this project.*removed/);
    }, 60_000);
});

describe("rebase apps init <name>", () => {
    it("refuses a name rather than ignoring it", async () => {
        fs.writeFileSync(path.join(tmp, "package.json"), JSON.stringify({ name: "app", private: true, workspaces: ["backend"] }));
        fs.mkdirSync(path.join(tmp, "backend"));
        process.chdir(tmp);

        await expect(appsCommand("init", ["node", "rebase", "apps", "init", "admin"]))
            .rejects.toThrow("process.exit(1)");

        expect(plain(err.join("\n"))).toMatch(/takes no app name/);
        expect(fs.existsSync(path.join(tmp, "rebase.json"))).toBe(false);
    });
});
