/**
 * `rebase apps add admin` leaves a headless project as `rebase init` with the
 * admin would have.
 *
 * Adding the admin to a headless project meant scaffolding a second project
 * and copying its `frontend/`, the workspace entries, the `admin` app in
 * `rebase.json` and the backend build script across by hand. These run the
 * command against real scaffolds and against a minimal ported project, and
 * compare what it writes with what `rebase init` writes.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appsCommand } from "./apps";
import { addPnpmWorkspacePackage } from "./apps-add";
import { createRebaseApp, templatesPath } from "./init";

class Exit extends Error {
    constructor(readonly code: number | undefined) {
        super(`process.exit(${code})`);
    }
}

let tmp: string;
let cwd: string;
let argv: string[];
let out: string[];
let err: string[];

beforeEach(() => {
    cwd = process.cwd();
    argv = process.argv;
    tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-apps-add-")));
    // The release probe asks npm whether this version is published; the
    // scaffolds under test do not need the answer.
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
    process.argv = argv;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    fs.rmSync(tmp, { recursive: true, force: true });
});

// eslint-disable-next-line no-control-regex
const plain = (text: string): string => text.replace(/\u001b\[[0-9;]*m/g, "");

/** `rebase init <name> --yes …` inside `parent`, which is created. */
async function scaffold(parent: string, name: string, flags: string[]): Promise<string> {
    const dir = path.join(tmp, parent);
    fs.mkdirSync(dir, { recursive: true });
    // A lockfile, so every scaffold and every `apps add` picks the same package manager.
    fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    process.chdir(dir);
    await createRebaseApp(["node", "rebase", "init", name, "--yes", ...flags]);
    const project = path.join(dir, name);
    fs.writeFileSync(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    return project;
}

/** Run `rebase apps add …` in `project`. */
async function add(project: string, args: string[]): Promise<void> {
    process.chdir(project);
    const line = ["node", "rebase", "apps", "add", ...args];
    process.argv = line;
    await appsCommand("add", line);
}

/** Run it expecting a refusal; returns the exit code. */
async function refused(project: string, args: string[]): Promise<number | undefined> {
    try {
        await add(project, args);
    } catch (error) {
        if (error instanceof Exit) return error.code;
        throw error;
    }
    throw new Error("rebase apps add did not refuse");
}

/** Every file under `dir`, by relative path, with its content. */
function tree(dir: string): Record<string, string> {
    const files: Record<string, string> = {};
    const walk = (current: string): void => {
        for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
            if (entry.name === "node_modules") continue;
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) walk(full);
            else files[path.relative(dir, full)] = fs.readFileSync(full, "utf8");
        }
    };
    walk(dir);
    return files;
}

const readJson = (file: string) => JSON.parse(fs.readFileSync(file, "utf8"));

/** A ported project: a backend on a pinned release, no admin, and whatever else is passed. */
function portedProject(name: string, options: {
    manifest?: unknown;
    version?: string;
    files?: Record<string, string>;
} = {}): string {
    const project = path.join(tmp, name);
    fs.mkdirSync(path.join(project, "backend"), { recursive: true });
    fs.writeFileSync(path.join(project, "package.json"), JSON.stringify({
        name: "trip",
        private: true,
        type: "module",
        workspaces: ["backend"],
        scripts: { dev: "rebase dev", build: "rebase build" },
        devDependencies: { "@rebasepro/cli": options.version ?? "0.30.1" }
    }, null, 2) + "\n");
    fs.writeFileSync(path.join(project, "backend", "package.json"), JSON.stringify({
        name: "trip-backend",
        type: "module",
        scripts: { build: "tsc && rebase normalize-imports dist" },
        dependencies: {
            "@rebasepro/server": options.version ?? "0.30.1",
            "@rebasepro/types": options.version ?? "0.30.1"
        }
    }, null, 2) + "\n");
    fs.writeFileSync(path.join(project, "pnpm-workspace.yaml"), "packages:\n  - backend\nlinkWorkspacePackages: true\n");
    fs.writeFileSync(path.join(project, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
    if (options.manifest !== undefined) {
        fs.writeFileSync(path.join(project, "rebase.json"), JSON.stringify(options.manifest, null, 4) + "\n");
    }
    for (const [file, content] of Object.entries(options.files ?? {})) {
        fs.mkdirSync(path.dirname(path.join(project, file)), { recursive: true });
        fs.writeFileSync(path.join(project, file), content);
    }
    return project;
}

/** Triptelier's shape: a no-build static site at `/` beside the backend. */
const SITE_AT_ROOT = {
    rebase: "^1",
    apps: {
        backend: { type: "backend", runtime: "managed" },
        site: { type: "static", root: "site", output: "site", path: "/", spa: false }
    }
};

describe("rebase apps add admin on a scaffold", () => {
    it("gives a headless scaffold the frontend, workspace and app rebase init writes", async () => {
        const full = await scaffold("full", "my-app", ["--template", "blank"]);
        const headless = await scaffold("headless", "my-app", ["--headless"]);
        const scriptsBefore = readJson(path.join(headless, "package.json")).scripts;
        const backendBefore = fs.readFileSync(path.join(headless, "backend", "package.json"), "utf8");

        await add(headless, ["admin"]);

        // The same files as init's, except the users customization: this
        // project declares no auth table for it to name the columns of.
        const expected = tree(path.join(full, "frontend"));
        delete expected[path.join("src", "cms", "users.tsx")];
        const appFile = path.join("src", "App.tsx");
        expected[appFile] = expected[appFile]
            .replace("import { usersCms } from \"./cms/users\";\n", "")
            .replace("tableCustomizations={[usersCms]}", "tableCustomizations={[]}");
        expect(tree(path.join(headless, "frontend"))).toEqual(expected);

        expect(readJson(path.join(headless, "rebase.json"))).toEqual(readJson(path.join(full, "rebase.json")));
        const pkg = readJson(path.join(headless, "package.json"));
        expect(pkg.workspaces).toEqual(readJson(path.join(full, "package.json")).workspaces);
        // No tables in code, so none of the schema scripts.
        expect(pkg.scripts).toEqual(scriptsBefore);
        expect(fs.readFileSync(path.join(headless, "backend", "package.json"), "utf8")).toBe(backendBefore);
        expect(fs.readFileSync(path.join(headless, "pnpm-workspace.yaml"), "utf8"))
            .toMatch(/^packages:\n {2}- "frontend"\n {2}- "backend"\n/);

        // Nothing staged is left behind.
        expect(fs.readdirSync(headless).filter(entry => entry.startsWith(".rebase-apps-add-"))).toEqual([]);

        const printed = plain(out.join("\n"));
        expect(printed).toContain("Added the admin panel: app \"admin\" at /");
        expect(printed).toMatch(/pnpm install\n\s+pnpm run dev/);
    }, 60_000);

    it("writes back exactly what rebase init wrote, when init's admin is taken out", async () => {
        const project = await scaffold("roundtrip", "my-app", ["--template", "blank"]);
        const frontend = tree(path.join(project, "frontend"));
        const files = ["rebase.json", "package.json", "pnpm-workspace.yaml", "backend/package.json"];
        const before = Object.fromEntries(files.map(file => [file, fs.readFileSync(path.join(project, file), "utf8")]));

        fs.rmSync(path.join(project, "frontend"), { recursive: true });
        const manifest = readJson(path.join(project, "rebase.json"));
        delete manifest.apps.admin;
        fs.writeFileSync(path.join(project, "rebase.json"), JSON.stringify(manifest, null, 4) + "\n");
        const pkg = readJson(path.join(project, "package.json"));
        pkg.workspaces = ["backend"];
        fs.writeFileSync(path.join(project, "package.json"), JSON.stringify(pkg, null, 4) + "\n");
        fs.writeFileSync(path.join(project, "pnpm-workspace.yaml"),
            before["pnpm-workspace.yaml"].replace("  - \"frontend\"\n", ""));

        await add(project, ["admin"]);

        expect(tree(path.join(project, "frontend"))).toEqual(frontend);
        for (const file of files) {
            expect(fs.readFileSync(path.join(project, file), "utf8"), file).toBe(before[file]);
        }
    }, 60_000);

    it("adds the schema scripts, the backend build and ts-morph when the tables are in code", async () => {
        const project = await scaffold("introspected", "my-app", ["--headless"]);
        fs.mkdirSync(path.join(project, "backend", "schema"));
        fs.writeFileSync(path.join(project, "backend", "schema", "index.ts"), "export { trips } from \"./trips\";\n");
        fs.writeFileSync(path.join(project, "backend", "schema", "trips.ts"), "export const trips = {};\n");

        await add(project, ["admin"]);

        const templateRoot = readJson(templatesPath("template", "package.json"));
        const templateBackend = readJson(templatesPath("template", "backend", "package.json"));
        const pkg = readJson(path.join(project, "package.json"));
        for (const script of ["db:generate", "db:push", "schema:generate"]) {
            expect(pkg.scripts[script], script).toBe(templateRoot.scripts[script]);
        }
        const backend = readJson(path.join(project, "backend", "package.json"));
        expect(backend.scripts.build).toBe(templateBackend.scripts.build);
        expect(backend.dependencies["ts-morph"]).toBe(templateBackend.dependencies["ts-morph"]);
        // No auth table declared as the template declares it: no users customization.
        expect(fs.existsSync(path.join(project, "frontend", "src", "cms", "users.tsx"))).toBe(false);
        expect(fs.readFileSync(path.join(project, "frontend", "src", "App.tsx"), "utf8")).toContain("tableCustomizations={[]}");
    }, 60_000);
});

describe("rebase apps add admin on a ported project", () => {
    it("puts the admin at /admin beside a static site at /, pinned to the project's release", async () => {
        const project = portedProject("site", { manifest: SITE_AT_ROOT, files: { "site/index.html": "<h1>trip</h1>\n" } });

        await add(project, ["admin"]);

        const manifest = readJson(path.join(project, "rebase.json"));
        expect(manifest.apps.site).toEqual(SITE_AT_ROOT.apps.site);
        expect(manifest.apps.admin).toEqual({
            type: "static",
            root: "frontend",
            build: "pnpm --filter ./frontend run build",
            output: "frontend/dist",
            path: "/admin",
            cms: "/admin"
        });

        const frontend = readJson(path.join(project, "frontend", "package.json"));
        expect(frontend.name).toBe("trip-frontend");
        const rebaseDeps = Object.entries<string>(frontend.dependencies).filter(([name]) => name.startsWith("@rebasepro/"));
        expect(rebaseDeps.length).toBeGreaterThan(3);
        for (const [name, spec] of rebaseDeps) expect(spec, name).toBe("0.30.1");
        expect(fs.readFileSync(path.join(project, "frontend", "vite.config.ts"), "utf8")).toContain("rebaseBackendGuard()");
        expect(fs.readFileSync(path.join(project, "frontend", "index.html"), "utf8")).toContain("<title>trip</title>");

        expect(readJson(path.join(project, "package.json")).workspaces).toEqual(["frontend", "backend"]);
        expect(fs.readFileSync(path.join(project, "pnpm-workspace.yaml"), "utf8"))
            .toBe("packages:\n  - frontend\n  - backend\nlinkWorkspacePackages: true\n");
        expect(plain(out.join("\n"))).toContain("@rebasepro/* pinned to 0.30.1, as @rebasepro/server in backend/package.json");
    }, 60_000);

    it("serves it where --path says, a path or a hostname", async () => {
        const atPath = portedProject("console", { manifest: SITE_AT_ROOT });
        await add(atPath, ["admin", "--path", "/console"]);
        expect(readJson(path.join(atPath, "rebase.json")).apps.admin).toMatchObject({ path: "/console", cms: "/console" });

        const atHost = portedProject("host", { manifest: SITE_AT_ROOT });
        await add(atHost, ["admin", "--path", "https://admin.example.com"]);
        expect(readJson(path.join(atHost, "rebase.json")).apps.admin).toMatchObject({ path: "https://admin.example.com", cms: "/" });
    }, 60_000);

    it("writes a rebase.json when the project has none, with the admin at /", async () => {
        const project = portedProject("no-manifest");

        await add(project, ["admin"]);

        const manifest = readJson(path.join(project, "rebase.json"));
        expect(Object.keys(manifest.apps)).toEqual(["backend", "admin"]);
        expect(manifest.apps.admin).toMatchObject({ path: "/", cms: "/" });
    }, 60_000);

    it("keeps a backend build script the project changed, and says so", async () => {
        const project = portedProject("custom-build", {
            manifest: SITE_AT_ROOT,
            files: { "backend/schema/index.ts": "export {};\n" }
        });
        const backendFile = path.join(project, "backend", "package.json");
        const backend = readJson(backendFile);
        backend.scripts.build = "tsc -p tsconfig.build.json";
        fs.writeFileSync(backendFile, JSON.stringify(backend, null, 2) + "\n");

        await add(project, ["admin"]);

        const written = readJson(backendFile);
        expect(written.scripts.build).toBe("tsc -p tsconfig.build.json");
        expect(written.dependencies["ts-morph"]).toBeDefined();
        expect(plain(out.join("\n"))).toContain("Kept your backend/package.json scripts.build");
    }, 60_000);

    it("pins this CLI's version when the project names no release", async () => {
        const project = portedProject("linked", { manifest: SITE_AT_ROOT, version: "link:../../rebase/packages/server" });

        await add(project, ["admin"]);

        const frontend = readJson(path.join(project, "frontend", "package.json"));
        const own = readJson(path.join(templatesPath(), "..", "package.json")).version;
        expect(frontend.dependencies["@rebasepro/cms"]).toBe(own);
        expect(plain(out.join("\n"))).toContain("which names no release");
    }, 60_000);

    it("answers --json with what it wrote", async () => {
        const project = portedProject("json", { manifest: SITE_AT_ROOT });

        await add(project, ["admin", "--json"]);

        const result = JSON.parse(out.join("\n"));
        expect(result).toMatchObject({
            app: "admin",
            root: "frontend",
            path: "/admin",
            cms: "/admin",
            version: "0.30.1",
            versionSource: "@rebasepro/server in backend/package.json",
            customizations: [],
            nextSteps: ["pnpm install", "pnpm run dev"]
        });
        expect(result.changed.map((entry: { file: string }) => entry.file))
            .toEqual(["frontend/", "rebase.json", "package.json", "pnpm-workspace.yaml"]);
    }, 60_000);
});

describe("rebase apps add refuses, and changes nothing", () => {
    async function expectRefusal(project: string, args: string[], message: RegExp): Promise<void> {
        const before = tree(project);
        expect(await refused(project, args)).toBe(1);
        expect(plain(err.join("\n"))).toMatch(message);
        expect(tree(project)).toEqual(before);
    }

    it("when frontend/ exists", async () => {
        const project = portedProject("has-frontend", { manifest: SITE_AT_ROOT, files: { "frontend/index.html": "<p>mine</p>\n" } });
        await expectRefusal(project, ["admin"], /frontend\/ already exists/);
    });

    it("when an app named admin is declared", async () => {
        const project = portedProject("named-admin", {
            manifest: { ...SITE_AT_ROOT, apps: { ...SITE_AT_ROOT.apps, admin: { type: "static", root: "admin-ui", output: "admin-ui/dist", path: "/admin" } } }
        });
        await expectRefusal(project, ["admin"], /already declares an app named "admin"/);
    });

    it("when another app declares the CMS", async () => {
        const project = portedProject("has-cms", {
            manifest: { ...SITE_AT_ROOT, apps: { ...SITE_AT_ROOT.apps, site: { ...SITE_AT_ROOT.apps.site, cms: "/manage" } } }
        });
        await expectRefusal(project, ["admin"], /App "site" already declares the CMS/);
    });

    it("when --path is taken or not a place an app can be served", async () => {
        const project = portedProject("bad-path", { manifest: SITE_AT_ROOT });
        await expectRefusal(project, ["admin", "--path", "/"], /cannot be served at "\/"[\s\S]*two apps cannot serve the same path/);
        err = [];
        await expectRefusal(project, ["admin", "--path", "/api"], /cannot be served at "\/api"/);
    });

    it("when it is asked for something other than the admin", async () => {
        const project = portedProject("kind", { manifest: SITE_AT_ROOT });
        await expectRefusal(project, ["site"], /cannot add "site"\. It adds: admin/);
        err = [];
        await expectRefusal(project, [], /Which app\? Usage: rebase apps add admin/);
    });

    it("with an envelope under --json", async () => {
        const project = portedProject("json-refusal", { manifest: SITE_AT_ROOT, files: { "frontend/index.html": "x\n" } });
        expect(await refused(project, ["admin", "--json"])).toBe(1);
        expect(JSON.parse(out.join("\n")).error.code).toBe("frontend_exists");
    });

    it.skipIf(process.getuid?.() === 0)("puts every file back when a write fails", async () => {
        const project = portedProject("readonly", { manifest: SITE_AT_ROOT });
        const before = tree(project);
        fs.chmodSync(path.join(project, "rebase.json"), 0o444);
        try {
            expect(await refused(project, ["admin"])).toBe(1);
        } finally {
            fs.chmodSync(path.join(project, "rebase.json"), 0o644);
        }
        expect(plain(err.join("\n"))).toMatch(/Adding the admin failed, and nothing was kept/);
        expect(tree(project)).toEqual(before);
        // No empty frontend/ and no staging directory either, which `tree` would not show.
        expect(fs.readdirSync(project).filter(entry => entry === "frontend" || entry.startsWith(".rebase-apps-add-"))).toEqual([]);
    });
});

describe("addPnpmWorkspacePackage", () => {
    it("adds the package before backend, in the list's own style", () => {
        expect(addPnpmWorkspacePackage("packages:\n  - \"backend\"\nfoo: 1\n", "frontend"))
            .toBe("packages:\n  - \"frontend\"\n  - \"backend\"\nfoo: 1\n");
        expect(addPnpmWorkspacePackage("packages:\n    - 'api'\n", "frontend"))
            .toBe("packages:\n    - 'api'\n    - 'frontend'\n");
        expect(addPnpmWorkspacePackage("packages: [\"backend\"]\n", "frontend"))
            .toBe("packages: [\"frontend\", \"backend\"]\n");
    });

    it("leaves a list that already takes it in, and answers null for one it cannot read", () => {
        expect(addPnpmWorkspacePackage("packages:\n  - \"*\"\n", "frontend")).toBe("packages:\n  - \"*\"\n");
        expect(addPnpmWorkspacePackage("packages:\n  - ./frontend/\n", "frontend")).toBe("packages:\n  - ./frontend/\n");
        expect(addPnpmWorkspacePackage("linkWorkspacePackages: true\n", "frontend")).toBeNull();
    });
});
