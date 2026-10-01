/**
 * One `AstSchemaEditor` serves every request of the source-only editor for the
 * life of the server (`createSchemaEditorRoutes`). It used to read each file
 * once, keep it in memory, and write that copy back whole on the next save —
 * so whatever reached the disk in between was overwritten: the live editor's
 * committed change (it uses a fresh editor per request), or the developer's own
 * edit in the IDE. Every edit has to apply to what is on disk *now*.
 */
import { AstSchemaEditor } from "../src/api/ast-schema-editor";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

jest.setTimeout(30_000);

const POSTS = `import { defineCollection } from "@rebasepro/cms-types";

const postsCollection = defineCollection({
    name: "Posts",
    slug: "posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string" }
    }
});

export default postsCollection;
`;

describe("AstSchemaEditor reads the file from disk on every edit", () => {
    let dir: string;
    let file: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "ast-disk-sync-"));
        file = path.join(dir, "posts.ts");
        fs.writeFileSync(file, POSTS);
    });

    afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    it("keeps an edit made on disk between two saves of one long-lived editor", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.saveProperty("posts", "body", { name: "Body", type: "string" });

        // Somebody else writes the file: the live editor's commit, or the IDE.
        const external = fs.readFileSync(file, "utf8")
            .replace("properties: {", "properties: {\n        subtitle: { name: \"Subtitle\", type: \"string\" },")
            + "// edited in the IDE\n";
        fs.writeFileSync(file, external);

        await editor.saveProperty("posts", "summary", { name: "Summary", type: "string" });

        const after = fs.readFileSync(file, "utf8");
        expect(after).toContain("subtitle");
        expect(after).toContain("// edited in the IDE");
        expect(after).toContain("summary");
        expect(after).toContain("body");
    });

    it("sees a collection file created on disk after the editor was built", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.saveProperty("posts", "body", { name: "Body", type: "string" });

        fs.writeFileSync(path.join(dir, "tags.ts"), POSTS
            .replace(/posts/g, "tags").replace("Posts", "Tags"));

        await editor.saveProperty("tags", "color", { name: "Color", type: "string" });
        expect(fs.readFileSync(path.join(dir, "tags.ts"), "utf8")).toContain("color");
    });

    it("does not resurrect a file deleted on disk", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.saveProperty("posts", "body", { name: "Body", type: "string" });

        fs.writeFileSync(path.join(dir, "tags.ts"), POSTS.replace(/posts/g, "tags"));
        await editor.saveProperty("tags", "color", { name: "Color", type: "string" });
        fs.unlinkSync(path.join(dir, "tags.ts"));

        await editor.saveProperty("posts", "summary", { name: "Summary", type: "string" });
        expect(fs.existsSync(path.join(dir, "tags.ts"))).toBe(false);
    });
});
