/**
 * Deleting a collection leaves a project that still loads.
 *
 * `deleteCollection` unlinked `<slug>.ts` and stopped. Every scaffold's
 * `index.ts` imports every collection, so the next boot failed for the whole
 * project — "Cannot find module …/tags" — and a collection another one linked
 * to took that one down too. The confirmation called it data-free and
 * cosmetic. Now a file other collections import is refused, naming them, and
 * `index.ts` is edited along with the deletion.
 */
import { AstSchemaEditor } from "../src/api/ast-schema-editor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import ts from "typescript";

jest.setTimeout(60_000);

const collectionFile = (slug: string, extra = "", imports = "") => `import { defineCollection } from "@rebasepro/cms-types";
${imports}
const ${slug}Collection = defineCollection({
    name: "${slug}",
    slug: "${slug}",
    table: "${slug}",
    properties: {
        name: { name: "Name", type: "string" }${extra}
    }
});

export default ${slug}Collection;
`;

const INDEX = `import postsCollection from "./posts";
import tagsCollection from "./tags";
import notesCollection from "./notes.js";
import type { SecurityRule } from "@rebasepro/types";

// Every collection the backend serves.
export const collections = [postsCollection, tagsCollection, notesCollection];

export const defaultSecurityRules: SecurityRule[] = [];
`;

const parses = (text: string) =>
    (ts.createSourceFile("x.ts", text, ts.ScriptTarget.Latest, true) as unknown as { parseDiagnostics: unknown[] }).parseDiagnostics.length === 0;

describe("AstSchemaEditor.deleteCollection", () => {
    let dir: string;
    const file = (name: string) => path.join(dir, name);

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-delete-"));
        fs.writeFileSync(file("posts.ts"), collectionFile("posts",
            ",\n        tags: { name: \"Tags\", type: \"relation\", relation: { kind: \"manyToMany\", target: () => tagsCollection } }",
            "import tagsCollection from \"./tags.js\";"));
        fs.writeFileSync(file("tags.ts"), collectionFile("tags"));
        fs.writeFileSync(file("notes.ts"), collectionFile("notes"));
        fs.writeFileSync(file("index.ts"), INDEX);
    });
    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("refuses while another collection imports it, naming the importer, and changes nothing", async () => {
        await expect(new AstSchemaEditor(dir).deleteCollection("tags")).rejects.toThrow(/posts\.ts/);
        expect(fs.existsSync(file("tags.ts"))).toBe(true);
        expect(fs.readFileSync(file("index.ts"), "utf8")).toBe(INDEX);
    });

    it("removes the file and its entry in index.ts, and nothing else there", async () => {
        const result = await new AstSchemaEditor(dir).deleteCollection("notes");

        expect(fs.existsSync(file("notes.ts"))).toBe(false);
        const index = fs.readFileSync(file("index.ts"), "utf8");
        expect(index).not.toContain("notes");
        expect(index).toContain("export const collections = [postsCollection, tagsCollection];");
        expect(index).toContain("// Every collection the backend serves.");
        expect(index).toContain("export const defaultSecurityRules");
        expect(parses(index)).toBe(true);
        expect(result).toEqual({ deleted: file("notes.ts"), changed: [file("index.ts")] });
    });

    it("deletes a collection nothing imports, touching no other file", async () => {
        fs.writeFileSync(file("index.ts"), "export const collections = [];\n");
        fs.writeFileSync(file("loose.ts"), collectionFile("loose"));
        const result = await new AstSchemaEditor(dir).deleteCollection("loose");
        expect(fs.existsSync(file("loose.ts"))).toBe(false);
        expect(result.changed).toEqual([]);
    });

    it("refuses when index.ts uses it in a way that cannot be removed", async () => {
        fs.writeFileSync(file("index.ts"), INDEX + "\nexport const featured = notesCollection.slug;\n");
        await expect(new AstSchemaEditor(dir).deleteCollection("notes")).rejects.toThrow(/index\.ts/);
        expect(fs.existsSync(file("notes.ts"))).toBe(true);
    });
});

describe("committing a deleted collection", () => {
    it("records the file as deleted", async () => {
        const { execFileSync } = await import("node:child_process");
        const { createLocalGitRepository } = await import("../src/schema-edit/local-git-repository");
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ast-delete-git-"));
        try {
            const git = (...args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8" });
            git("init", "-q"); git("config", "user.name", "F"); git("config", "user.email", "f@example.com");
            fs.writeFileSync(path.join(root, "tags.ts"), "export default {};\n");
            git("add", "-A"); git("commit", "-q", "-m", "initial");
            const repository = createLocalGitRepository({ root });
            await repository.writeFiles([{ path: "tags.ts", contents: "", deleted: true }]);
            await repository.commit(["tags.ts"], "chore(schema): remove the tags collection");
            expect(git("show", "--name-status", "--format=", "HEAD").trim()).toBe("D\ttags.ts");
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });
});
