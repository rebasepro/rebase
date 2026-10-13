/**
 * Rewriting a collection whose source is not on this machine.
 *
 * This is the piece that kept live schema editing local-only. Not
 * authentication and not the Git Data API — both worked — but the AST editor
 * needing a *file to open*, which a bundle deployment does not have.
 *
 * The tests below use a real temp directory and a fake repository, because the
 * thing worth pinning is the handoff: what gets fetched, what the editor is
 * given, what comes back, and what is left behind.
 */
import { describe, expect, it, jest } from "@jest/globals";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";

import { rewriteRemoteCollection } from "../src/schema-edit/remote-source";
import type { SchemaEditRepository } from "../src/schema-edit/apply-schema-change";

/** A repository holding whatever the test says it holds. */
function repositoryWith(files: Record<string, string>): SchemaEditRepository & {
    reads: string[];
} {
    const reads: string[] = [];
    return {
        reads,
        root: "owner/repo",
        currentBranch: async () => "main",
        dirtyPaths: async () => [],
        writeFiles: async () => {},
        commit: async () => "abc123",
        readFile: async (p: string) => { reads.push(p); return files[p]; }
    };
}

/** Stands in for the AST editor: writes the file the way it would. */
const writesFile = (contents: string) =>
    jest.fn(async (dir: string, id: string) => {
        await fsp.writeFile(path.join(dir, `${id}.ts`), contents, "utf8");
    }) as never;

describe("rewriting a remote collection", () => {
    it("fetches the existing source and returns what the editor wrote", async () => {
        const repository = repositoryWith({
            "config/collections/posts.ts": "export const posts = { name: 'Posts' };\n"
        });
        const edit = writesFile("export const posts = { name: 'Posts', extra: 1 };\n");

        const files = await rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit },
            "posts",
            { name: "Posts" }
        );

        expect(repository.reads).toEqual(["config/collections/posts.ts"]);
        expect(files).toEqual([{
            path: "config/collections/posts.ts",
            contents: "export const posts = { name: 'Posts', extra: 1 };\n"
        }]);
    });

    it("gives the editor the file it fetched, not an empty directory", async () => {
        // The editor rewrites in place and preserves what is around the change.
        // Handed nothing, it would recreate the file from the payload and drop
        // every import and comment the collection had.
        const original = "// keep me\nexport const posts = { name: 'Posts' };\n";
        const repository = repositoryWith({ "config/collections/posts.ts": original });

        let seen: string | undefined;
        const edit = jest.fn(async (dir: string, id: string) => {
            seen = await fsp.readFile(path.join(dir, `${id}.ts`), "utf8");
            await fsp.writeFile(path.join(dir, `${id}.ts`), original, "utf8");
        }) as never;

        await rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit },
            "posts",
            {}
        );
        expect(seen).toBe(original);
    });

    it("handles a collection that does not exist yet", async () => {
        // A new collection has no source. That is the same state the editor
        // sees locally when somebody adds one, so it is not an error.
        const repository = repositoryWith({});
        const edit = writesFile("export const fresh = {};\n");

        const files = await rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit },
            "fresh",
            {}
        );
        expect(files[0]).toMatchObject({ path: "config/collections/fresh.ts" });
    });

    it("respects a project in a subdirectory", async () => {
        const repository = repositoryWith({});
        await rewriteRemoteCollection(
            { repository, collectionsPath: "app/config/collections", edit: writesFile("x") },
            "posts",
            {}
        );
        expect(repository.reads).toEqual(["app/config/collections/posts.ts"]);
    });

    it("tolerates a trailing slash on the configured path", async () => {
        const repository = repositoryWith({});
        await rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections/", edit: writesFile("x") },
            "posts",
            {}
        );
        expect(repository.reads).toEqual(["config/collections/posts.ts"]);
    });

    it("leaves no scratch directory behind, even when the edit throws", async () => {
        // It holds a copy of the customer's collection source, and a server that
        // accumulates those is a slow leak of exactly the thing worth not
        // leaking.
        const repository = repositoryWith({ "config/collections/posts.ts": "x" });
        const before = fs.readdirSync(require("node:os").tmpdir())
            .filter(n => n.startsWith("rebase-remote-source-")).length;

        await expect(rewriteRemoteCollection(
            {
                repository,
                collectionsPath: "config/collections",
                edit: (async () => { throw new Error("ts-morph refused it"); }) as never
            },
            "posts",
            {}
        )).rejects.toThrow("ts-morph refused it");

        const after = fs.readdirSync(require("node:os").tmpdir())
            .filter(n => n.startsWith("rebase-remote-source-")).length;
        expect(after).toBe(before);
    });

    it("refuses a repository that cannot read, rather than rewriting from nothing", async () => {
        // Silently treating "cannot read" as "empty file" would have the editor
        // recreate the collection from the payload and the commit delete
        // everything else in it.
        const repository = repositoryWith({});
        delete (repository as { readFile?: unknown }).readFile;

        await expect(rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit: writesFile("x") },
            "posts",
            {}
        )).rejects.toThrow(/cannot read a file/);
    });
});

/**
 * The whole collections directory, not one file.
 *
 * The scratch directory used to hold only the collection being edited. The
 * editor reads its siblings for two things — a relation picked by slug imports
 * the target's file, and a deletion refuses while another file imports the
 * one going and edits `index.ts` — so in a bundle deployment adding a
 * relation threw "no file for it in <tmp>" and deleting a collection was
 * refused outright. With a repository that can list a directory, every
 * collection file is brought over, and what comes back is exactly what the
 * editor changed: edited files, new files, and deletions.
 */
describe("rewriting a remote collection with its siblings", () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { AstSchemaEditor } = require("../src/api/ast-schema-editor") as typeof import("../src/api/ast-schema-editor");

    const collectionFile = (slug: string, extra = "", imports = "") => [
        "import { defineCollection } from \"@rebasepro/cms-types\";",
        imports,
        `const ${slug}Collection = defineCollection({`,
        `    name: "${slug}",`,
        `    slug: "${slug}",`,
        `    table: "${slug}",`,
        "    properties: {",
        `        name: { name: "Name", type: "string" }${extra}`,
        "    }",
        "});",
        "",
        `export default ${slug}Collection;`,
        ""
    ].join("\n");

    const INDEX = [
        "import postsCollection from \"./posts\";",
        "import authorsCollection from \"./authors\";",
        "import tagsCollection from \"./tags\";",
        "",
        "export const collections = [postsCollection, authorsCollection, tagsCollection];",
        ""
    ].join("\n");

    /** A repository that can list a directory, as the GitHub one can. */
    function listingRepository(files: Record<string, string>) {
        const repository = repositoryWith(files);
        const listed: string[] = [];
        return Object.assign(repository, {
            listed,
            listFiles: async (dir: string) => {
                listed.push(dir);
                return Object.keys(files).filter(p => p.startsWith(`${dir}/`));
            }
        });
    }

    const PROJECT = {
        "config/collections/posts.ts": collectionFile("posts"),
        "config/collections/authors.ts": collectionFile("authors"),
        "config/collections/tags.ts": collectionFile("tags"),
        "config/collections/index.ts": INDEX,
        "config/other.ts": "export const unrelated = 1;\n"
    };

    /** What `init.ts` hands over: the real editor, removal included. */
    const realEditor = async (
        dir: string,
        id: string,
        change: { patch?: never[]; remove?: boolean } | Record<string, unknown>
    ) => {
        const editor = new AstSchemaEditor(dir);
        if ((change as { remove?: boolean }).remove) {
            await editor.deleteCollection(id);
            return;
        }
        await editor.applyPatch(id, (change as { patch: never[] }).patch);
    };

    it("links a relation to another collection picked by its slug", async () => {
        const repository = listingRepository(PROJECT);
        const files = await rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit: realEditor as never },
            "posts",
            {
                patch: [{
                    op: "set",
                    path: ["properties", "author"],
                    value: { name: "Author", type: "relation", relation: { kind: "belongsTo", target: "authors" } }
                }]
            }
        );

        expect(repository.listed).toEqual(["config/collections"]);
        // Only the edited file: the siblings were read, not rewritten.
        expect(files.map(f => f.path)).toEqual(["config/collections/posts.ts"]);
        expect(files[0].contents).toContain("import authorsCollection from \"./authors.js\";");
        expect(files[0].contents).toContain("target: () => authorsCollection");
    });

    it("deletes a collection, taking it out of index.ts in the same change", async () => {
        const repository = listingRepository(PROJECT);
        const files = await rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit: realEditor as never },
            "tags",
            { remove: true }
        );

        const byPath = Object.fromEntries(files.map(f => [f.path, f]));
        expect(Object.keys(byPath).sort()).toEqual([
            "config/collections/index.ts",
            "config/collections/tags.ts"
        ]);
        expect(byPath["config/collections/tags.ts"]).toMatchObject({ contents: "", deleted: true });
        expect(byPath["config/collections/index.ts"].contents).not.toMatch(/tags/i);
        expect(byPath["config/collections/index.ts"].contents).toContain("postsCollection, authorsCollection");
    });

    it("refuses to delete a collection another one imports, naming it", async () => {
        const repository = listingRepository({
            ...PROJECT,
            "config/collections/posts.ts": collectionFile(
                "posts",
                ",\n        tags: { name: \"Tags\", type: \"relation\", relation: { kind: \"manyToMany\", target: () => tagsCollection } }",
                "import tagsCollection from \"./tags.js\";"
            )
        });
        await expect(rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit: realEditor as never },
            "tags",
            { remove: true }
        )).rejects.toThrow(/Cannot delete "tags": posts\.ts imports it/);
    });

    it("refuses a deletion when it can only see the one file", async () => {
        // Without the siblings, nothing can tell whether another collection
        // imports this one, and index.ts cannot be edited: committing the
        // deletion alone is the change that stops every collection loading.
        const repository = repositoryWith({ "config/collections/tags.ts": collectionFile("tags") });
        await expect(rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit: realEditor as never },
            "tags",
            { remove: true }
        )).rejects.toThrow(/list/);
    });

    it("never writes a listed path outside the scratch directory", async () => {
        const repository = repositoryWith({
            "config/collections/posts.ts": collectionFile("posts"),
            "config/collections/../../escape.ts": "export const x = 1;\n"
        });
        Object.assign(repository, {
            listFiles: async () => ["config/collections/posts.ts", "config/collections/../../escape.ts"]
        });
        await expect(rewriteRemoteCollection(
            { repository, collectionsPath: "config/collections", edit: writesFile("x") },
            "posts",
            {}
        )).rejects.toThrow(/outside/);
    });
});
