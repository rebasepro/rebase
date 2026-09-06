import { describe, expect, it, beforeEach, afterEach } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";

import { loadCollectionsFromDirectory, applyCollectionDefaults } from "../src/collections/loader";

/**
 * This loader is the single definition of "the collections" — the runtime, the
 * drizzle-schema generator, the policy generator and the doctor all go through
 * it. If it disagreed with itself between callers, the API would serve one set
 * of collections while `db push` deployed policies for another.
 */

let dir: string;

const collectionFile = (slug: string, extra = "") => `
export default {
    name: "${slug}",
    slug: "${slug}",
    table: "${slug}",
    schema: "public",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }${extra ? "," + extra : ""}
};
`;

beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-collections-"));
});

afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
});

describe("loadCollectionsFromDirectory", () => {
    it("loads every collection file", async () => {
        fs.writeFileSync(path.join(dir, "posts.ts"), collectionFile("posts"));
        fs.writeFileSync(path.join(dir, "authors.ts"), collectionFile("authors"));

        const collections = await loadCollectionsFromDirectory(dir);

        expect(collections.map((c) => c.slug).sort()).toEqual(["authors", "posts"]);
    });

    it("ignores index, tests and declarations", async () => {
        fs.writeFileSync(path.join(dir, "posts.ts"), collectionFile("posts"));
        fs.writeFileSync(path.join(dir, "index.ts"), "export const collections = [];");
        fs.writeFileSync(path.join(dir, "posts.test.ts"), "export default { slug: 'nope' };");
        fs.writeFileSync(path.join(dir, "types.d.ts"), "export {};");

        const collections = await loadCollectionsFromDirectory(dir);

        expect(collections.map((c) => c.slug)).toEqual(["posts"]);
    });

    it("applies defaultSecurityRules from the directory's index", async () => {
        // The whole point: db push generates policies from these files, so a
        // default has to live here to reach the database.
        fs.writeFileSync(path.join(dir, "posts.ts"), collectionFile("posts"));
        fs.writeFileSync(path.join(dir, "index.ts"), `
export const defaultSecurityRules = [
    { operation: "select", access: "public" },
    { operations: ["insert", "update", "delete"], roles: ["admin"] }
];
`);

        const [posts] = await loadCollectionsFromDirectory(dir);

        expect(posts.securityRules).toHaveLength(2);
        expect(posts.securityRules?.[0]).toMatchObject({ operation: "select", access: "public" });
    });

    it("never overrides a collection's own rules", async () => {
        fs.writeFileSync(path.join(dir, "posts.ts"), collectionFile("posts", `
    securityRules: [{ operation: "all", roles: ["admin"] }]`));
        fs.writeFileSync(path.join(dir, "index.ts"), `
export const defaultSecurityRules = [{ operation: "select", access: "public" }];
`);

        const [posts] = await loadCollectionsFromDirectory(dir);

        expect(posts.securityRules).toEqual([{ operation: "all", roles: ["admin"] }]);
    });

    it("leaves rules unset with no defaults, which the generator locks down", async () => {
        fs.writeFileSync(path.join(dir, "posts.ts"), collectionFile("posts"));

        const [posts] = await loadCollectionsFromDirectory(dir);

        expect(posts.securityRules).toBeUndefined();
    });

    it("throws on a file that cannot be imported, rather than serving a partial API", async () => {
        // Silently skipping is how a broken file becomes a missing route and a
        // missing policy, with a successful exit code.
        fs.writeFileSync(path.join(dir, "posts.ts"), collectionFile("posts"));
        fs.writeFileSync(path.join(dir, "broken.ts"), "export default { slug: 'broken' ");

        await expect(loadCollectionsFromDirectory(dir)).rejects.toThrow(/broken\.ts/);
    });

    it("throws when the index exists and cannot be imported", async () => {
        // The index declares `defaultSecurityRules`. Swallowing the failure
        // returned no defaults, every collection fell back to
        // locked-by-default, and the boot announced success while serving a
        // different authorization model than the project declares.
        fs.writeFileSync(path.join(dir, "posts.ts"), collectionFile("posts"));
        fs.writeFileSync(path.join(dir, "index.ts"), "export const broken = {{{ ;");

        await expect(loadCollectionsFromDirectory(dir)).rejects.toThrow(/index\.ts/);
        await expect(loadCollectionsFromDirectory(dir)).rejects.toThrow(/defaultSecurityRules/);
    });

    it("throws on a file with no default export", async () => {
        fs.writeFileSync(path.join(dir, "stray.ts"), "export const notDefault = 1;");

        await expect(loadCollectionsFromDirectory(dir)).rejects.toThrow(/no default export/);
    });

    it("returns nothing for a path that does not exist", async () => {
        expect(await loadCollectionsFromDirectory(path.join(dir, "nope"))).toEqual([]);
    });

    it("loads a single module exporting collections, with its defaults", async () => {
        // The generators accept a file as well as a directory.
        const file = path.join(dir, "all.ts");
        fs.writeFileSync(file, `
export const collections = [{
    name: "posts", slug: "posts", table: "posts", schema: "public",
    properties: { id: { name: "ID", type: "string", isId: "uuid" } }
}];
export const defaultSecurityRules = [{ operation: "select", access: "public" }];
`);

        const collections = await loadCollectionsFromDirectory(file);

        expect(collections.map((c) => c.slug)).toEqual(["posts"]);
        expect(collections[0].securityRules).toEqual([{ operation: "select", access: "public" }]);
    });
});

describe("applyCollectionDefaults", () => {
    const bare = () => ({ slug: "x", table: "x", schema: "public", properties: {} }) as never;

    it("is a no-op without defaults", () => {
        const collections = [bare()];
        expect(applyCollectionDefaults(collections, {})).toBe(collections);
        expect((collections[0] as { securityRules?: unknown[] }).securityRules).toBeUndefined();
    });

    it("is a no-op for an empty defaults array", () => {
        const collections = [bare()];
        applyCollectionDefaults(collections, { defaultSecurityRules: [] });
        expect((collections[0] as { securityRules?: unknown[] }).securityRules).toBeUndefined();
    });
});
