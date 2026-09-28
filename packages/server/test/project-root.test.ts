/**
 * Where a project's generated artifacts belong, relative to its repository.
 *
 * The failure this prevents is quiet and expensive: for a project in a
 * subdirectory, the defaults resolve against the repository root, so the commit
 * writes `backend/` beside `.git` and leaves the project's real generated
 * file untouched. A source change then lands alongside a stale
 * schema — the exact failure that committing the *whole* change exists to
 * avoid, arriving through the design itself.
 */
import { describe, expect, it, afterEach } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findProjectRoot, commitPathsFor, usesVersionedMigrations } from "../src/schema-edit/project-root";

const made: string[] = [];

/** A directory tree, with `rebase.json` wherever `marker` says. */
function tree(layout: string[], marker?: string): string {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rebase-project-root-")));
    made.push(root);
    for (const dir of layout) fs.mkdirSync(path.join(root, dir), { recursive: true });
    if (marker !== undefined) {
        fs.writeFileSync(path.join(root, marker, "rebase.json"), "{}");
    }
    return root;
}

afterEach(() => {
    for (const dir of made.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("finding the project root", () => {
    it("finds the marker in the directory itself", () => {
        const root = tree(["proj"], "proj");
        expect(findProjectRoot(path.join(root, "proj"))).toBe(path.join(root, "proj"));
    });

    it("walks up to it", () => {
        const root = tree(["proj/config/collections"], "proj");
        expect(findProjectRoot(path.join(root, "proj/config/collections")))
            .toBe(path.join(root, "proj"));
    });

    it("stops rather than climbing to the filesystem root", () => {
        // An unbounded walk from a misconfigured path reads whatever `rebase.json`
        // happens to sit above it — someone else's project, or none.
        const root = tree(["a/b/c/d/e/f/g/h"], "");
        expect(findProjectRoot(path.join(root, "a/b/c/d/e/f/g/h"), 2)).toBeUndefined();
    });

    it("answers undefined when there is no marker at all", () => {
        const root = tree(["proj/config"]);
        expect(findProjectRoot(path.join(root, "proj/config"))).toBeUndefined();
    });
});

describe("relocating the commit paths", () => {
    it("leaves them alone when the project is the repository", () => {
        // The case the defaults were written for. Returning `undefined` rather
        // than an identity prefix is what keeps every scaffolded project on
        // exactly the behaviour it already had.
        const root = tree(["config/collections"], "");
        expect(commitPathsFor(path.join(root, "config/collections"), root)).toBeUndefined();
    });

    it("prefixes them for a project in a subdirectory", () => {
        const root = tree(["app/config/collections"], "app");
        expect(commitPathsFor(path.join(root, "app/config/collections"), root)).toEqual({
            schemaFile: "app/backend/src/schema.generated.ts"
        });
    });

    it("handles a project nested more than one level down", () => {
        const root = tree(["packages/apps/shop/config/collections"], "packages/apps/shop");
        const paths = commitPathsFor(
            path.join(root, "packages/apps/shop/config/collections"),
            root
        );
        expect(paths?.schemaFile).toBe("packages/apps/shop/backend/src/schema.generated.ts");
    });

    it("leaves them alone when there is no marker", () => {
        // A project predating `rebase.json`. Guessing a root from the directory
        // shape would change where an existing deployment commits, which is a
        // worse answer than the one it already has.
        const root = tree(["app/config/collections"]);
        expect(commitPathsFor(path.join(root, "app/config/collections"), root)).toBeUndefined();
    });

    it("leaves them alone when the project sits outside the repository", () => {
        // `..` would escape. The repository's own write guard refuses a path
        // outside the tree by path; inventing a prefix here would only turn a
        // clear refusal into a confusing one.
        const outer = tree(["repo", "elsewhere/config/collections"], "elsewhere");
        expect(commitPathsFor(
            path.join(outer, "elsewhere/config/collections"),
            path.join(outer, "repo")
        )).toBeUndefined();
    });

    it("emits posix separators, because git paths are posix", () => {
        const root = tree(["app/config/collections"], "app");
        const paths = commitPathsFor(path.join(root, "app/config/collections"), root);
        for (const value of Object.values(paths ?? {})) {
            expect(value).not.toContain("\\");
        }
    });
});

/**
 * Whether the live editor has to say "run `rebase db generate`" after applying.
 *
 * Asked of the directory the migrations are really in. Every `rebase db`
 * subcommand runs the driver from the backend directory, and the driver writes
 * `drizzle/migrations/` relative to where it runs — so a scaffolded project
 * keeps them in `backend/drizzle/migrations/`, as this repository's own demo
 * does. Looking only at the project root answered "no migrations" for every
 * such project, and the warning never appeared.
 */
describe("knowing whether a project replays migrations", () => {
    const withFile = (root: string, file: string) => {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), "CREATE TABLE posts ();\n");
    };

    it("finds them beside the backend, where `rebase db generate` writes them", () => {
        const root = tree(["config/collections"], "");
        withFile(root, "backend/drizzle/migrations/0001_init.sql");
        expect(usesVersionedMigrations(path.join(root, "config/collections"))).toBe(true);
    });

    it("finds them at the project root, where the driver writes when run from there", () => {
        const root = tree(["config/collections"], "");
        withFile(root, "drizzle/migrations/0001_init.sql");
        expect(usesVersionedMigrations(path.join(root, "config/collections"))).toBe(true);
    });

    it("finds them for a project in a subdirectory of its repository", () => {
        const root = tree(["app/config/collections"], "app");
        withFile(root, "app/backend/drizzle/migrations/0001_init.sql");
        expect(usesVersionedMigrations(path.join(root, "app/config/collections"))).toBe(true);
    });

    it("says no when the directory holds no migration, only Atlas's bookkeeping", () => {
        const root = tree(["config/collections"], "");
        withFile(root, "backend/drizzle/migrations/atlas.sum");
        expect(usesVersionedMigrations(path.join(root, "config/collections"))).toBe(false);
    });

    it("says no for a project with no migrations directory at all", () => {
        const root = tree(["config/collections", "backend/src"], "");
        expect(usesVersionedMigrations(path.join(root, "config/collections"))).toBe(false);
    });
});
