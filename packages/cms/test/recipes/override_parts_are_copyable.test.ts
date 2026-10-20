/**
 * @jest-environment jsdom
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * A built-in part that does not fit is copied into the user's project and
 * registered as its override (see recipes/README.md). The copy compiles only if
 * everything the part imports is a public export of `@rebasepro/cms` or
 * `@rebasepro/app`, which `pnpm report:override-copyability` measures.
 *
 * The parts below are copyable today. One stops being copyable the moment its
 * file imports something internal, and nothing else would notice: the part
 * still works, only a user's copy breaks. So this fails then — export the new
 * import if it is a building block a copy should reuse, or keep it out of the
 * part's file. When another part becomes copyable, add it here; the list only
 * grows.
 */
const COPYABLE = [
    "Auth.LoginView",
    "Collection.Actions",
    "Collection.Card",
    "Collection.EmptyState",
    "Collection.FilterField",
    "Collection.Table",
    "EditView.FormActions",
    "Entity.Form",
    "Entity.MissingReference",
    "Entity.SidePanel",
    "EntityPreview",
    "HomePage.CollectionCard",
    "Shell.AppBar",
    "Shell.Drawer",
    "Shell.DrawerNavigationGroup",
    "Shell.DrawerNavigationItem"
];

const ROOT = path.resolve(__dirname, "../../../..");

type Row = { name: string; component: string; file: string; internal: string[] };

describe("overridable parts", () => {
    let rows: Row[];

    beforeAll(() => {
        const out = execFileSync(process.execPath, [path.join(ROOT, "tooling/scripts/report-override-copyability.mjs"), "--json"], {
            cwd: ROOT,
            encoding: "utf8"
        });
        rows = JSON.parse(out) as Row[];
    }, 120_000);

    it("are all measured", () => {
        const overrides = fs.readFileSync(path.join(ROOT, "packages/cms-types/src/types/component_overrides.ts"), "utf8");
        const declared = [...overrides.matchAll(/\|\s*"([A-Za-z.]+)"/g)].map(m => m[1]).sort();
        expect(rows.map(r => r.name).sort()).toEqual(declared);
    });

    it.each(COPYABLE)("%s stays copyable with package imports only", (name) => {
        const row = rows.find(r => r.name === name);
        expect(row).toBeDefined();
        expect({ file: row!.file, internal: row!.internal }).toEqual({ file: row!.file, internal: [] });
    });

    it("lists every copyable part", () => {
        const copyable = rows.filter(r => r.internal.length === 0).map(r => r.name);
        expect(copyable.filter(name => !COPYABLE.includes(name))).toEqual([]);
    });

    // An agent copying a part finds its file through the customize-admin
    // skill's table; a file that moves leaves it pointing at nothing.
    it("are where the rebase-customize-admin skill says", () => {
        const skill = fs.readFileSync(path.join(ROOT, "tooling/rebase-agent-skills/skills/rebase-customize-admin/SKILL.md"), "utf8");
        const listed = [...skill.matchAll(/^\| `([A-Za-z.]+)` \| `(\w+)` \| `([^`]+)` \|$/gm)]
            .map(m => `${m[1]} ${m[2]} ${m[3]}`).sort();
        expect(listed).toEqual(rows.map(r => `${r.name} ${r.component} ${r.file}`).sort());
    });
});
