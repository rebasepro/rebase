/**
 * What a bundle deploy uploads as the project's source, and what it never does.
 *
 * The source is what a platform upgrade rebuilds a managed project from, so it
 * has to be the project as the developer sees it — `.gitignore` honoured, a
 * linked sibling package included — and it must never carry a secret, whatever
 * got committed. And none of it may cost the deploy: every failure here is a
 * warning.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    collectBuildEnv,
    listSourceFiles,
    MAX_SOURCE_UPLOAD_BYTES,
    neverUploaded,
    packSource,
    prepareRebuildSource,
    staticAppRoots,
    uploadRebuildSource,
    type SourceListing
} from "./rebuild-source";
import type { RebaseProjectManifest } from "@rebasepro/types";

let scratch: string;

beforeEach(() => {
    scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-rebuild-src-")));
});

afterEach(() => {
    vi.unstubAllGlobals();
    fs.rmSync(scratch, { recursive: true, force: true });
});

function write(relative: string, content = "x"): void {
    const file = path.join(scratch, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
}

function git(cwd: string, ...args: string[]): void {
    execFileSync("git", ["-c", "init.defaultBranch=main", ...args], { cwd, stdio: "ignore" });
}

const notARepository = (): string => {
    throw new Error("fatal: not a git repository");
};

describe("neverUploaded", () => {
    it.each([
        ".env",
        ".env.local",
        ".env.production",
        ".env.production.local",
        "backend/.env",
        "frontend/.env.development",
        ".envrc",
        "node_modules/hono/index.js",
        "frontend/node_modules/react/index.js",
        ".git/config",
        "sub/.git/HEAD",
        "dist-bundle/manifest.json",
        "dist-bundle-admin/index.html",
        // A database dump carries every row, password hashes included.
        "backups/prod-2026.dump",
        "exports/nightly.dump",
        // The CLI's own per-machine state: the development database lives in
        // `.rebase/`, and `.rebase-dev-secrets.json` is the dev signing keys.
        ".rebase/pgdata/base/1/1259",
        ".rebase/cloud.json",
        ".rebase-dev-secrets.json",
        "backend/.rebase-dev-secrets.json",
        ".rebase-dev-url",
        ".rebase-dev-port"
    ])("never uploads %s", (relative) => {
        expect(neverUploaded(relative)).toBe(true);
    });

    it.each([
        ".env.example",
        ".env.sample",
        ".env.template",
        "backend/.env.example",
        "backend/src/index.ts",
        "dist/app.js",
        "frontend/src/env.ts",
        "docs/.environment.md",
        ".github/workflows/ci.yml",
        "src/features/backups/BackupList.tsx",
        "docs/dump-format.md",
        ".rebaserc"
    ])("uploads %s", (relative) => {
        expect(neverUploaded(relative)).toBe(false);
    });
});

describe("listSourceFiles outside a repository", () => {
    it("walks the project, skipping what is never source", () => {
        for (const file of [
            "rebase.json",
            "backend/src/index.ts",
            "frontend/src/main.tsx",
            ".env.example",
            ".github/workflows/ci.yml",
            // Never:
            ".env",
            "frontend/.env.production",
            "node_modules/hono/index.js",
            "dist/app.js",
            "dist-bundle/manifest.json",
            ".rebase/cloud.json",
            ".turbo/cache",
            ".next/build",
            "coverage/lcov.info",
            ".git/HEAD"
        ]) write(file);

        const listing = listSourceFiles(scratch, notARepository);

        expect(listing).toEqual({
            root: scratch,
            projectPath: "",
            fromGit: false,
            files: [
                ".env.example",
                ".github/workflows/ci.yml",
                "backend/src/index.ts",
                "frontend/src/main.tsx",
                "rebase.json"
            ]
        });
    });
});

/**
 * A scaffold made without `git init` — `rebase init --yes` makes one — still
 * carries the stock `.gitignore`, and that file is the only statement of what is
 * not source. The walk used to read none of it, so `backups/*.dump` (every row,
 * password hashes included), `uploads/` and the dev secrets all went up.
 */
describe("listSourceFiles outside a repository, with ignore files", () => {
    const scaffoldGitignore = path.resolve(__dirname, "../../../templates/template/gitignore");

    it("leaves out everything the scaffold's .gitignore names", () => {
        write(".gitignore", fs.readFileSync(scaffoldGitignore, "utf8"));
        for (const file of [
            "rebase.json",
            "backend/src/index.ts",
            "frontend/src/main.tsx",
            // Ignored by the scaffold's .gitignore:
            "backups/prod-2026.dump",
            "backups/prod-2026.globals.sql",
            "uploads/avatar.png",
            "generated/sdk.ts",
            "build/out.js",
            ".idea/workspace.xml",
            "drizzle/meta/_journal.json",
            ".rebase-dev-url"
        ]) write(file);

        const listing = listSourceFiles(scratch);

        expect(listing).toEqual({
            root: scratch,
            projectPath: "",
            fromGit: false,
            files: [".gitignore", "backend/src/index.ts", "frontend/src/main.tsx", "rebase.json"]
        });
    });

    it("reads a nested .gitignore and a negation the way git does", () => {
        write(".gitignore", "*.log\n!keep.log\n");
        write("backend/.gitignore", "fixtures/\n");
        for (const file of ["a.log", "keep.log", "backend/src/index.ts", "backend/fixtures/customers.csv", "frontend/fixtures/ok.json"]) write(file);

        expect(listSourceFiles(scratch).files).toEqual([
            ".gitignore",
            "backend/.gitignore",
            "backend/src/index.ts",
            "frontend/fixtures/ok.json",
            "keep.log"
        ]);
    });

    it("still skips what is never source when nothing is ignored", () => {
        for (const file of ["src/index.ts", "node_modules/hono/index.js", "dist/app.js", "coverage/lcov.info", ".env"]) write(file);
        expect(listSourceFiles(scratch).files).toEqual(["src/index.ts"]);
    });

    it("carries a repository nested in the walked directory", () => {
        write("src/index.ts");
        const nested = path.join(scratch, "frontend");
        fs.mkdirSync(nested);
        git(nested, "init", "-q");
        write("frontend/.gitignore", "dist/\n");
        write("frontend/src/main.tsx");
        write("frontend/dist/app.js");

        expect(listSourceFiles(scratch).files).toEqual([
            "frontend/.gitignore",
            "frontend/src/main.tsx",
            "src/index.ts"
        ]);
    });

    it("refuses to walk past an ignore file it has no git to read", () => {
        write(".gitignore", "uploads/\n");
        write("uploads/avatar.png");
        write("src/index.ts");

        expect(() => listSourceFiles(scratch, notARepository)).toThrow(/\.gitignore.*git/);
    });
});

/**
 * A project inside a repository that ignores it, with no repository of its own:
 * `~/work/company-repo/tmp/my-app` where the company repository ignores `tmp/`.
 * Git's listing of that repository holds none of the project, and uploading it
 * sent the company's files under a project path absent from the archive.
 */
describe("listSourceFiles in a repository that ignores the project", () => {
    beforeEach(() => {
        git(scratch, "init", "-q");
        write(".gitignore", "tmp/\n");
        write("src/internal.ts", "export const secret = 1;");
        git(scratch, "add", "-A");
        write("tmp/my-app/rebase.json", "{}");
        write("tmp/my-app/backend/src/index.ts");
        write("tmp/my-app/.gitignore", "uploads/\n");
        write("tmp/my-app/uploads/avatar.png");
    });

    it("lists the project, walked with its own ignores, and none of the repository around it", () => {
        const project = path.join(scratch, "tmp", "my-app");

        expect(listSourceFiles(project)).toEqual({
            root: project,
            projectPath: "",
            fromGit: false,
            files: [".gitignore", "backend/src/index.ts", "rebase.json"]
        });
    });
});

describe("listSourceFiles in a repository", () => {
    beforeEach(() => {
        git(scratch, "init", "-q");
        write(".gitignore", "ignored.txt\nbuild/\n");
        write("app/rebase.json", "{}");
        write("app/backend/src/index.ts");
        write("app/new-untracked.ts");
        write("app/.env", "SECRET=1");
        write("app/.env.production", "SECRET=2");
        write("app/.env.example", "SECRET=");
        write("app/node_modules/hono/index.js");
        write("app/dist-bundle/manifest.json");
        write("packages/editor/src/index.ts");
        write("ignored.txt");
        write("build/out.js");
        write("app/deleted.ts");
        git(scratch, "add", "-A");
        fs.rmSync(path.join(scratch, "app", "deleted.ts"));
        fs.symlinkSync("backend", path.join(scratch, "app", "link-to-backend"));
    });

    it("roots at the repository, so a linked sibling package travels too", () => {
        const listing = listSourceFiles(path.join(scratch, "app"));

        expect(listing.fromGit).toBe(true);
        expect(listing.root).toBe(scratch);
        expect(listing.projectPath).toBe("app");
        expect(listing.files).toEqual([
            ".gitignore",
            "app/.env.example",
            "app/backend/src/index.ts",
            "app/new-untracked.ts",
            "app/rebase.json",
            "packages/editor/src/index.ts"
        ]);
    });

    it("keeps a committed dev secret and dump out, whatever git tracks", () => {
        write("app/backend/.rebase-dev-secrets.json", "{}");
        write("app/seed.dump", "PGDMP");
        git(scratch, "add", "-A");

        const listing = listSourceFiles(path.join(scratch, "app"));
        expect(listing.files).not.toContain("app/backend/.rebase-dev-secrets.json");
        expect(listing.files).not.toContain("app/seed.dump");
    });

    it("keeps a committed .env out, whatever git tracks", () => {
        // `git add -A` above staged both env files: tracked is not the question.
        const tracked = execFileSync("git", ["ls-files"], { cwd: scratch, encoding: "utf8" });
        expect(tracked).toContain("app/.env.production");

        const listing = listSourceFiles(path.join(scratch, "app"));
        expect(listing.files.some(f => /\/\.env(\.production)?$/.test(f))).toBe(false);
    });

    it("reads the project path through realpath", () => {
        // A path spelled through a symlink must not climb out of the archive.
        const alias = path.join(os.tmpdir(), `rebase-rebuild-alias-${process.pid}`);
        fs.rmSync(alias, { force: true });
        fs.symlinkSync(scratch, alias);
        try {
            expect(listSourceFiles(path.join(alias, "app")).projectPath).toBe("app");
        } finally {
            fs.rmSync(alias, { force: true });
        }
    });

    it("is the same listing from the repository root", () => {
        const listing = listSourceFiles(scratch);
        expect(listing.projectPath).toBe("");
        expect(listing.files).toContain("app/rebase.json");
    });
});

/**
 * dadaki's shape: the Rebase project is a repository of its own, nested inside
 * the editor's repository — which ignores it — and its frontend links a package
 * that lives in the outer one. A listing of the project's repository alone gave
 * a rebuild with no `@dadaki/editor` to import.
 */
describe("listSourceFiles across a link out of the project's repository", () => {
    beforeEach(() => {
        git(scratch, "init", "-q");
        write(".gitignore", "/cloud/\n");
        write("package.json", JSON.stringify({ name: "editor-root", private: true }));
        write("pnpm-workspace.yaml", "packages:\n  - packages/*\n");
        write("pnpm-lock.yaml", "lockfileVersion: '9.0'\n");
        write("packages/editor/package.json", JSON.stringify({ name: "@dadaki/editor", exports: { ".": "./src/index.ts" } }));
        write("packages/editor/src/index.ts", "export const editor = 1;");
        write("tests/fixture.svg", "<svg/>");
        git(scratch, "add", "-A");

        const cloud = path.join(scratch, "cloud");
        fs.mkdirSync(cloud);
        git(cloud, "init", "-q");
        write("cloud/rebase.json", "{}");
        write("cloud/.env.production", "VITE_X=1");
        write("cloud/frontend/package.json", JSON.stringify({
            name: "cloud-frontend",
            dependencies: {
                "@dadaki/editor": "link:../../packages/editor",
                // A local framework checkout: never followed.
                "@rebasepro/cms": "link:../../../rebase/packages/cms"
            }
        }));
        write("cloud/frontend/src/App.tsx", "import '@dadaki/editor';");
        git(cloud, "add", "-A");
    });

    it("carries the repository the link reaches, rooted where both meet", () => {
        const listing = listSourceFiles(path.join(scratch, "cloud"));

        expect(listing.root).toBe(scratch);
        expect(listing.projectPath).toBe("cloud");
        expect(listing.files).toContain("packages/editor/src/index.ts");
        // The outer workspace's root travels with it, so its install works.
        expect(listing.files).toContain("pnpm-lock.yaml");
        expect(listing.files).toContain("cloud/frontend/src/App.tsx");
        expect(listing.files).not.toContain("cloud/.env.production");
    });

    it("never follows a link to the framework itself", () => {
        // The target exists, so only the rule keeps it out.
        const framework = path.resolve(scratch, "..", "rebase", "packages", "cms");
        fs.mkdirSync(framework, { recursive: true });
        fs.writeFileSync(path.join(framework, "package.json"), "{}");
        try {
            const listing = listSourceFiles(path.join(scratch, "cloud"));
            expect(listing.files.some(f => f.includes("rebase/packages/cms"))).toBe(false);
            expect(listing.root).toBe(scratch);
        } finally {
            fs.rmSync(path.resolve(scratch, "..", "rebase"), { recursive: true, force: true });
        }
    });

    it("stays within the project's repository when nothing links out of it", () => {
        write("cloud/frontend/package.json", JSON.stringify({ name: "cloud-frontend", dependencies: { react: "^19.0.0" } }));
        const listing = listSourceFiles(path.join(scratch, "cloud"));
        expect(listing.root).toBe(path.join(scratch, "cloud"));
        expect(listing.projectPath).toBe("");
    });
});

describe("packSource", () => {
    it("packs exactly the listed files, with spaces in their names", async () => {
        write("src/index.ts", "export {};");
        write("docs/a file with spaces.md", "# hi");
        write(".env", "SECRET=1");
        const listing: SourceListing = {
            root: scratch,
            files: ["docs/a file with spaces.md", "src/index.ts"],
            projectPath: "",
            fromGit: false
        };
        const out = path.join(os.tmpdir(), `rebase-pack-test-${process.pid}.tar.gz`);
        try {
            await packSource(listing, out);
            const entries = execFileSync("tar", ["-tzf", out], { encoding: "utf8" }).split("\n").filter(Boolean);
            expect(entries.sort()).toEqual(["docs/a file with spaces.md", "src/index.ts"]);
            // The list file tar read from is gone.
            expect(fs.existsSync(`${out}.files`)).toBe(false);
        } finally {
            fs.rmSync(out, { force: true });
        }
    });
});

describe("collectBuildEnv", () => {
    it("reads VITE_ keys the way a production Vite build does, and nothing else", () => {
        write(".env", "VITE_A=root-env\nVITE_B=root-env\nSECRET=never\nexport VITE_EXPORTED=\"quoted\" # comment\n");
        write(".env.local", "VITE_B=root-local\n");
        write(".env.production", "VITE_C=root-production\n");
        write(".env.development", "VITE_D=development-is-not-read\n");
        write("frontend/.env.production", "VITE_B=frontend-production\n");
        write("frontend/.env.production.local", "VITE_C=frontend-production-local\nDATABASE_URL=postgres://never\n");

        const env = collectBuildEnv(scratch, ["frontend"], {});

        expect(env).toEqual({
            VITE_A: "root-env",
            VITE_B: "frontend-production",
            VITE_C: "frontend-production-local",
            VITE_EXPORTED: "quoted"
        });
    });

    it("lets process.env win over every file", () => {
        write(".env.production.local", "VITE_A=file\n");
        expect(collectBuildEnv(scratch, [], { VITE_A: "shell", PATH: "/bin", VITE_E: "" }))
            .toEqual({ VITE_A: "shell", VITE_E: "" });
    });

    it("takes VITE_API_URL only from the environment, as the local build does", () => {
        // `staticBuildEnv` blanks it unless the shell sets it, so a .env value
        // never reached a deployed bundle — and must not reach a rebuilt one.
        write(".env", "VITE_API_URL=http://localhost:3001\nVITE_A=1\n");
        expect(collectBuildEnv(scratch, [], {})).toEqual({ VITE_A: "1" });
        expect(collectBuildEnv(scratch, [], { VITE_API_URL: "https://api.example.com" }))
            .toEqual({ VITE_A: "1", VITE_API_URL: "https://api.example.com" });
    });

    it("skips an app root that does not exist", () => {
        write(".env", "VITE_A=1\n");
        expect(collectBuildEnv(scratch, ["missing"], {})).toEqual({ VITE_A: "1" });
    });
});

describe("staticAppRoots", () => {
    it("lists every static app's root, in declaration order", () => {
        const manifest = {
            rebase: "^1",
            apps: {
                backend: { type: "backend", runtime: "managed" },
                site: { type: "static", root: "site", output: "site/dist" },
                admin: { type: "static", root: "frontend", output: "frontend/dist" }
            }
        } satisfies RebaseProjectManifest;
        expect(staticAppRoots(manifest)).toEqual(["site", "frontend"]);
        expect(staticAppRoots(undefined)).toEqual([]);
    });
});

describe("uploadRebuildSource", () => {
    it("posts the archive with the CLI's user agent and returns the id", async () => {
        const tar = path.join(scratch, "src.tar.gz");
        fs.writeFileSync(tar, "archive");
        const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ sourceId: "0123456789abcdef0123456789abcdef" })));
        vi.stubGlobal("fetch", fetchSpy);

        expect(await uploadRebuildSource("https://cp.example", "tok", "proj 1", tar)).toBe("0123456789abcdef0123456789abcdef");

        const [url, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
        expect(url).toBe("https://cp.example/api/functions/deploy/source/upload?projectId=proj%201");
        expect(init.method).toBe("POST");
        const headers = init.headers as Record<string, string>;
        expect(headers.Authorization).toBe("Bearer tok");
        expect(headers["Content-Type"]).toBe("application/gzip");
        expect(headers["User-Agent"]).toMatch(/^rebase-cli\//);
    });

    it("refuses an answer with no source id, and a refused upload", async () => {
        const tar = path.join(scratch, "src.tar.gz");
        fs.writeFileSync(tar, "archive");
        vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ sourceId: "nope" }))));
        await expect(uploadRebuildSource("https://cp.example", "t", "p", tar)).rejects.toThrow(/source id/);

        vi.stubGlobal("fetch", vi.fn(async () => new Response("too big", { status: 413 })));
        await expect(uploadRebuildSource("https://cp.example", "t", "p", tar)).rejects.toThrow(/413/);
    });
});

describe("prepareRebuildSource never fails the deploy", () => {
    function run(steps: Parameters<typeof prepareRebuildSource>[0]["steps"], maxBytes?: number) {
        const warnings: string[] = [];
        const result = prepareRebuildSource({
            projectRoot: scratch,
            url: "https://cp.example",
            token: "t",
            projectId: "p",
            manifest: undefined,
            progress: () => undefined,
            warn: (message, hint) => warnings.push(`${message} ${hint ?? ""}`),
            steps,
            maxBytes
        });
        return { result, warnings };
    }

    const listing: SourceListing = { root: "/", files: ["a"], projectPath: "app", fromGit: true };
    const writeArchive = (bytes: number) => async (_listing: SourceListing, out: string) => {
        fs.writeFileSync(out, Buffer.alloc(bytes));
    };

    it("returns what the trigger carries when every step works", async () => {
        write(".env.production", "VITE_TITLE=Shop\n");
        const upload = vi.fn(async () => "0123456789abcdef0123456789abcdef");
        const { result, warnings } = run({ list: () => listing, pack: writeArchive(10), upload });

        expect(await result).toEqual({
            sourceId: "0123456789abcdef0123456789abcdef",
            projectPath: "app",
            buildEnv: expect.objectContaining({ VITE_TITLE: "Shop" })
        });
        expect(warnings).toEqual([]);
    });

    it("skips an archive over the limit, says what it costs, and never uploads it", async () => {
        const upload = vi.fn(async () => "0123456789abcdef0123456789abcdef");
        const { result, warnings } = run({ list: () => listing, pack: writeArchive(2048), upload }, 1024);

        expect(await result).toBeNull();
        expect(upload).not.toHaveBeenCalled();
        expect(warnings.join("\n")).toMatch(/over the .* upload limit/);
        expect(warnings.join("\n")).toContain("Platform upgrades will not rebuild this project");
    });

    it("warns and carries on when packing fails", async () => {
        const { result, warnings } = run({
            list: () => listing,
            pack: async () => { throw new Error("tar: Cannot stat"); }
        });
        expect(await result).toBeNull();
        expect(warnings.join("\n")).toContain("tar: Cannot stat");
    });

    it("warns and carries on when the upload is refused", async () => {
        const { result, warnings } = run({
            list: () => listing,
            pack: writeArchive(10),
            upload: async () => { throw new Error("the upload was refused (500): boom"); }
        });
        expect(await result).toBeNull();
        expect(warnings.join("\n")).toContain("(500)");
    });

    it("warns and carries on when the files cannot even be listed", async () => {
        const { result, warnings } = run({ list: () => { throw new Error("EACCES"); } });
        expect(await result).toBeNull();
        expect(warnings.join("\n")).toContain("EACCES");
    });

    it("uses the control plane's 100 MB cap by default", () => {
        expect(MAX_SOURCE_UPLOAD_BYTES).toBe(100 * 1024 * 1024);
    });
});
