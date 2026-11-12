/**
 * The development loop of a presentation edit, end to end:
 *
 *   the collection editor changes a label and a column width
 *   → `splitEdit` routes them to the presentation delta (no schema edit)
 *   → the server's `/api/admin/ui-config/workspace/:slug`, on a dev server,
 *     writes `frontend/src/cms/ui-config.json` (creating it when missing)
 *   → the frontend imports that file as `<RebaseCMS uiConfig>`, and the
 *     composed collection shows the edit.
 *
 * The file is written by the server's own writer (`saveToUiConfigFile`, what
 * that route runs in development; the route itself is tested in
 * `server/test/ui-config-routes.test.ts`), over a temporary project.
 */
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { col, defineTable } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";

import { saveToUiConfigFile, UI_CONFIG_FILE } from "../../../server/src/ui-config/ui-config-routes";
import { splitEdit } from "../../src/collection_editor/split_edit";
import { composeCollections } from "../../src/hooks/navigation/compose_collections";

const tables = compileTables([defineTable("posts", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), title: col.text().notNull() },
    rls: "admin-only"
})]);

let root: string;
let file: string;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "rebase-ui-config-flow-"));
    file = path.join(root, UI_CONFIG_FILE);
});

afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

const compose = (uiConfig?: { tables?: { [slug: string]: object } }) =>
    composeCollections({ tables, tableCustomizations: [], externalCollections: [], uiConfig })[0];

describe("a presentation edit in development", () => {
    it("lands in frontend/src/cms/ui-config.json, and the composed collection shows it", async () => {
        const before = compose();
        const after = compose();
        after.name = "Articles";
        after.properties.title = { ...after.properties.title, name: "Headline", admin: { ...after.properties.title.admin, columnWidth: 320 } };

        const { schema, presentation } = splitEdit({ before, after, table: tables[0] });
        expect(schema).toEqual([]);
        expect(fs.existsSync(file)).toBe(false);

        await saveToUiConfigFile(file, "posts", presentation);

        const shipped: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
        expect(shipped).toEqual({ tables: { posts: { name: "Articles", fields: { title: { name: "Headline", columnWidth: 320 } } } } });

        // What `import uiConfig from "./cms/ui-config.json"` hands <RebaseCMS>.
        const reloaded = compose(JSON.parse(fs.readFileSync(file, "utf8")));
        expect(reloaded.name).toBe("Articles");
        expect(reloaded.properties.title).toMatchObject({ name: "Headline", admin: { columnWidth: 320 } });
    });
});
