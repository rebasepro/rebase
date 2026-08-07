import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, describe, expect, it } from "vitest";
import { assertBuiltForPath, foldableApps, staticBuildEnv } from "./fold-static";

describe("choosing which frontends to serve from the backend", () => {
    it("folds the single static app", () => {
        const { apps, skipped } = foldableApps({
            apps: {
                backend: { type: "backend" },
                web: { type: "static",
build: "pnpm build",
output: "frontend/dist" }
            }
        });
        expect(skipped).toEqual([]);
        expect(apps).toHaveLength(1);
        expect(apps[0]).toMatchObject({ name: "web",
output: "frontend/dist",
path: "/",
spa: true });
    });

    it("folds every static app rather than picking one", () => {
        // Folding used to refuse when it found two, so a project with a site and
        // an admin panel deployed with neither.
        const { apps } = foldableApps({
            apps: {
                site: { type: "static",
output: "a/dist" },
                admin: { type: "static",
output: "b/dist",
path: "/admin" }
            }
        });
        expect(apps.map(a => a.name).sort()).toEqual(["admin", "site"]);
    });

    it("orders longest path first, with the root app last", () => {
        // The "/"-rooted app's catch-all claims everything registered after it.
        const { apps } = foldableApps({
            apps: {
                site: { type: "static",
output: "a/dist",
path: "/" },
                admin: { type: "static",
output: "b/dist",
path: "/admin" },
                docs: { type: "static",
output: "c/dist",
path: "/docs/api" }
            }
        });
        expect(apps.map(a => a.path)).toEqual(["/docs/api", "/admin", "/"]);
    });

    it("says nothing at all for a backend-only project", () => {
        // The common case. It is not a problem and must not be reported as one.
        const { apps, skipped } = foldableApps({ apps: { backend: { type: "backend" } } });
        expect(apps).toEqual([]);
        expect(skipped).toEqual([]);
    });

    it("explains a static app that declares no output", () => {
        const { apps, skipped } = foldableApps({ apps: { web: { type: "static",
build: "x" } } });
        expect(apps).toEqual([]);
        expect(skipped[0].reason).toMatch(/no output directory/i);
    });
});

describe("assertBuiltForPath", () => {
    // An app mounted at /admin but built with base "/" serves index.html fine
    // and 404s every asset: a blank page, no server error, nothing in the logs.
    const withAssets = (src: string): string =>
        `<!doctype html><html><head><script type="module" src="${src}"></script></head><body></body></html>`;

    it("passes when the assets carry the declared prefix", () => {
        expect(() => assertBuiltForPath(withAssets("/admin/assets/x.js"), "/admin", "admin"))
            .not.toThrow();
    });

    it("fails, naming the offending reference, when they do not", () => {
        expect(() => assertBuiltForPath(withAssets("/assets/x.js"), "/admin", "admin"))
            .toThrow(/declared at \/admin.*\/assets\/x\.js/s);
    });

    it("says nothing for a root-mounted app, where any absolute path is right", () => {
        expect(() => assertBuiltForPath(withAssets("/assets/x.js"), "/", "site")).not.toThrow();
    });

    it("ignores relative references, which a sub-path build may legitimately emit", () => {
        expect(() => assertBuiltForPath(withAssets("./assets/x.js"), "/admin", "admin"))
            .not.toThrow();
    });

    it("does not flag author-written anchors — only script/link references", () => {
        const html = '<!doctype html><html><body><a href="/">home</a></body></html>';
        expect(() => assertBuiltForPath(html, "/admin", "admin")).not.toThrow();
    });
});

describe("both commands that build a bundle fold it", () => {
    /**
     * The bug this guards. Folding was written into the `build` command, and
     * `cloud deploy` builds its own bundle — so a deploy produced a bundle with no
     * site in it, packed 164 KB where 39 MB was expected, and the managed pod
     * served the API while every page 404'd. Exactly as if folding had never been
     * written.
     *
     * Any future command that builds a bundle has to fold as well, and the cheapest
     * way to notice is to assert that every caller of `buildBundle` also calls the
     * fold.
     */
    function read(relative: string): string {
        const here = path.dirname(fileURLToPath(import.meta.url));
        return fs.readFileSync(path.join(here, relative), "utf8");
    }

    it("every command that calls buildBundle also folds the frontend", () => {
        const commands = ["commands/build.ts", "commands/cloud/deploy.ts"];
        const offenders = commands.filter(file => {
            const source = read(file);
            return source.includes("buildBundle(") && !source.includes("foldFrontendIntoBundle");
        });
        expect(offenders).toEqual([]);
    });

    it("neither keeps a private copy of the fold logic", () => {
        // Two implementations drift, and the drift is invisible until a deploy
        // ships a site-less bundle.
        for (const file of ["commands/build.ts", "commands/cloud/deploy.ts"]) {
            expect(read(file), `${file} re-implements folding`).not.toMatch(/function fold[A-Za-z]*StaticApp/);
        }
    });
});

describe("the environment every static app is built with", () => {
    const ORIGINAL = process.env.VITE_API_URL;
    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.VITE_API_URL;
        else process.env.VITE_API_URL = ORIGINAL;
    });

    it("builds in production mode", () => {
        /*
         * The scaffold's `.env` carries `NODE_ENV=development` for the dev
         * backend, and Vite's `loadEnv` promotes a NODE_ENV found in an env file
         * into the build unless the environment already sets one. So `rebase
         * build` and `rebase cloud deploy` shipped a *development* bundle —
         * `import.meta.env.DEV === true`, development React, dev-only branches
         * live — from commands whose whole purpose is to produce something
         * deployable. Vite consults the env file only when process.env has none,
         * so this line is what closes it.
         */
        delete process.env.VITE_API_URL;
        expect(staticBuildEnv("/", "web").NODE_ENV).toBe("production");
    });

    it("blanks VITE_API_URL so the bundle talks to its own origin", () => {
        // The scaffold's `.env` ships `http://localhost:3001` and
        // `frontend/vite.config.ts` reads the project root via `envDir: ".."`,
        // so a stock deploy baked the developer's laptop into every request —
        // passing every server-side health check on the way out. Empty makes
        // the client fall back to `window.location.origin`.
        delete process.env.VITE_API_URL;
        expect(staticBuildEnv("/", "web").VITE_API_URL).toBe("");
    });

    it("still lets an explicit cross-origin API through", () => {
        // Vite prioritises `process.env.VITE_*` over `.env` files, so the
        // escape hatch has to survive — it just has to be deliberate.
        process.env.VITE_API_URL = "https://api.example.com";
        expect(staticBuildEnv("/", "web").VITE_API_URL).toBe("https://api.example.com");
    });

    it("carries the declared path, with the trailing slash `base` expects", () => {
        expect(staticBuildEnv("/admin", "admin")).toMatchObject({
            REBASE_APP_PATH: "/admin",
            REBASE_APP_BASE: "/admin/",
            REBASE_APP_NAME: "admin"
        });
        expect(staticBuildEnv("/", "web").REBASE_APP_BASE).toBe("/");
    });

    it("is the only build environment either driver constructs", () => {
        /*
         * There are two drivers — `foldFrontendIntoBundle` and `buildAssetApp`
         * in build.ts — and they had already drifted: the path variables were
         * duplicated into both, so blanking VITE_API_URL in one still shipped a
         * localhost bundle from the other. A hand-rolled REBASE_APP_PATH outside
         * `staticBuildEnv` is that drift starting again.
         */
        const here = path.dirname(fileURLToPath(import.meta.url));
        for (const file of ["fold-static.ts", "commands/build.ts"]) {
            const source = fs.readFileSync(path.join(here, file), "utf8");
            const assignments = [...source.matchAll(/REBASE_APP_PATH:/g)];
            const expected = file === "fold-static.ts" ? 1 : 0;
            expect(assignments.length, `${file} builds its own env`).toBe(expected);
        }
    });
});
