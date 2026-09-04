import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { AstSchemaEditor, nestAdminKeys } from "../src/api/ast-schema-editor";

/**
 * The schema editor is the one place the *backend* writes admin config.
 *
 * The admin panel works with a flat view model — presentation merged onto the
 * collection — so what reaches `saveCollection` has `icon` and `listProperties` at
 * the top level, while on disk they belong inside `admin`. Getting that wrong is
 * silent in the worst way: the file still parses, the backend still boots and
 * ignores the stray keys, and the panel simply never reads the edit back. It looks
 * like the save button not working.
 *
 * Round-trips through generated config are also where this codebase has been bitten
 * before — the policy parser's `sqlToPolicy` output had to be proven to survive
 * re-emission — so the round trip is asserted here, not just the one-way write.
 */

/**
 * `saveCollection` builds a ts-morph Project — the TypeScript compiler plus a
 * tsconfig resolution, seconds rather than milliseconds. Jest's 5s default fits
 * on an idle machine and not on a loaded one, so this suite failed whenever it
 * shared a machine with a build. The work is genuinely slow; the timeout was the
 * wrong number.
 */
jest.setTimeout(30_000);

describe("nestAdminKeys", () => {
    it("moves presentation keys into the block and leaves the contract alone", () => {
        const result = nestAdminKeys({
            slug: "posts",
            table: "posts",
            properties: { title: { name: "Title", type: "string" } },
            securityRules: [{ ownerField: "author_id" }],
            icon: "FileText",
            listProperties: ["title"],
            defaultViewMode: "table"
        });

        expect(result.slug).toBe("posts");
        expect(result.table).toBe("posts");
        expect(result.securityRules).toEqual([{ ownerField: "author_id" }]);
        expect(result.admin).toEqual({
            icon: "FileText",
            listProperties: ["title"],
            defaultViewMode: "table"
        });
        expect("icon" in result).toBe(false);
        expect("listProperties" in result).toBe(false);
    });

    it("emits no block when the collection has no presentation at all", () => {
        const result = nestAdminKeys({ slug: "tags", table: "tags", properties: {} });
        expect("admin" in result).toBe(false);
    });

    it("prefers the flattened value over the block it was loaded with", () => {
        // A collection that went through the panel carries both: the block it was
        // loaded with, and the flat copy the forms bind to. The flat one is the
        // edit — `setFieldValue("icon", …)` writes there and never touches
        // `values.admin` — so preferring the block resolved every presentation
        // edit in favour of the value the user had just changed away from, and
        // the panel snapped back on reload.
        const result = nestAdminKeys({
            slug: "posts",
            icon: "Edited",
            admin: { icon: "Loaded" }
        });
        expect((result.admin as Record<string, unknown>).icon).toBe("Edited");
    });

    it("keeps a block key the flat copy does not carry", () => {
        const result = nestAdminKeys({
            slug: "posts",
            icon: "Edited",
            admin: { icon: "Loaded", group: "Content" }
        });
        expect(result.admin).toEqual({ icon: "Edited", group: "Content" });
    });

    it("merges a flat key that the block does not already have", () => {
        const result = nestAdminKeys({
            slug: "posts",
            listProperties: ["title"],
            admin: { icon: "FileText" }
        });
        expect(result.admin).toEqual({ icon: "FileText", listProperties: ["title"] });
    });
});

describe("AstSchemaEditor writes presentation into the admin block", () => {
    let dir: string;

    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ast-admin-"));
    });

    afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it("nests presentation when creating a new collection file", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: { title: { name: "Title", type: "string" } },
            icon: "FileText",
            listProperties: ["title"]
        });

        const written = fs.readFileSync(path.join(dir, "posts.ts"), "utf8");
        expect(written).toContain("admin:");
        expect(written).toContain('icon: "FileText"');
        // The presentation keys must not also be at the top level. Matching on the
        // indentation is what distinguishes "inside admin" from "next to it".
        expect(written).not.toMatch(/^ {4}icon:/m);
        expect(written).toMatch(/^ {4}table: "posts"/m);
    });

    it("updates presentation inside an existing block rather than beside it", async () => {
        fs.writeFileSync(path.join(dir, "posts.ts"), `import { CollectionConfig } from "@rebasepro/types";

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string" }
    },
    admin: {
        icon: "FileText"
    }
};

export default postsCollection;
`);

        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: { title: { name: "Title", type: "string" } },
            listProperties: ["title"]
        });

        const written = fs.readFileSync(path.join(dir, "posts.ts"), "utf8");
        expect(written).not.toMatch(/^ {4}listProperties:/m);
        expect(written).toContain("listProperties");
        // Exactly one block, not a second one appended.
        expect(written.match(/admin:/g)).toHaveLength(1);
    });

    /**
     * Both callback blocks are functions, which JSON cannot carry, so neither
     * reaches `saveCollection` in the payload — the editor has to preserve them
     * from the file it is rewriting or they are deleted on the first save from
     * the panel. `callbacks` was already on the preserve list; `browserCallbacks`
     * is the panel's own block and had to join it.
     */
    it("preserves both callback blocks through a save that never mentions them", async () => {
        fs.writeFileSync(path.join(dir, "posts.ts"), `import { CollectionConfig } from "@rebasepro/types";

const postsCollection: CollectionConfig = {
    slug: "posts",
    name: "Posts",
    table: "posts",
    properties: {
        title: { name: "Title", type: "string" }
    },
    callbacks: {
        beforeSave: async ({ values }) => ({ ...values, slug: slugify(values.title) })
    },
    admin: {
        browserCallbacks: {
            afterRead: ({ row }) => ({ ...row, label: row.title })
        }
    }
};

export default postsCollection;
`);

        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: { title: { name: "Title", type: "string" } },
            icon: "FileText"
        });

        const written = fs.readFileSync(path.join(dir, "posts.ts"), "utf8");
        expect(written).toContain("slugify(values.title)");
        expect(written).toContain("afterRead: ({ row }) => ({ ...row, label: row.title })");
    });

    it("leaves securityRules and callbacks at the top level", async () => {
        const editor = new AstSchemaEditor(dir);
        await editor.saveCollection("posts", {
            slug: "posts",
            name: "Posts",
            table: "posts",
            properties: {},
            securityRules: [{ ownerField: "author_id" }],
            strictWrites: true,
            icon: "FileText"
        });

        const written = fs.readFileSync(path.join(dir, "posts.ts"), "utf8");
        expect(written).toMatch(/^ {4}securityRules:/m);
        expect(written).toMatch(/^ {4}strictWrites: true/m);
        expect(written).toMatch(/^ {4}admin:/m);
    });
});
