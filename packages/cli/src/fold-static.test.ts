import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import { selectFoldableApp } from "./fold-static";

describe("choosing which frontend to serve from the backend", () => {
    it("folds the single static app", () => {
        const { app, reason } = selectFoldableApp({
            apps: {
                backend: { type: "backend" },
                web: { type: "static", build: "pnpm build", output: "frontend/dist" }
            }
        });
        expect(reason).toBeUndefined();
        expect(app?.name).toBe("web");
        expect(app?.output).toBe("frontend/dist");
    });

    it("declines rather than silently picking between two websites", () => {
        const { app, reason } = selectFoldableApp({
            apps: {
                web: { type: "static", output: "a/dist" },
                marketing: { type: "static", output: "b/dist" }
            }
        });
        expect(app).toBeUndefined();
        expect(reason).toMatch(/2 static apps/);
        expect(reason).toMatch(/web/);
        expect(reason).toMatch(/marketing/);
    });

    it("says nothing at all for a backend-only project", () => {
        // The common case. It is not a problem and must not be reported as one.
        const { app, reason } = selectFoldableApp({ apps: { backend: { type: "backend" } } });
        expect(app).toBeUndefined();
        expect(reason).toBeUndefined();
    });

    it("explains a static app that declares no output", () => {
        const { app, reason } = selectFoldableApp({ apps: { web: { type: "static", build: "x" } } });
        expect(app).toBeUndefined();
        expect(reason).toMatch(/no output directory/i);
    });

    it("ignores admin and custom apps when choosing", () => {
        const { app } = selectFoldableApp({
            apps: {
                admin: { type: "admin", output: "admin/dist" },
                legacy: { type: "custom" },
                web: { type: "static", output: "frontend/dist" }
            }
        });
        expect(app?.name).toBe("web");
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
