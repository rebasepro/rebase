/**
 * The moved-symbol pass of `rebase migrate sdk-calls` on a fixture project
 * that looks like real custom code (`__fixtures__/moved-imports`): a custom
 * field and a custom view importing names that left `@rebasepro/types` /
 * `@rebasepro/common`, an aliased import, a mixed import where only some
 * names move, a type-only import, re-exports, a namespace import, a dynamic
 * import, a backend function using renamed and removed exports, and the
 * `package.json`s that gain the destination package.
 *
 * Also: the generated table agrees with the headless guard's JSON, every
 * rename lands on an export that exists, and every upgrade-guide anchor is a
 * heading of the guide.
 *
 * `REBASE_WRITE_CODEMOD_FIXTURES=1` rewrites the expected tree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { CALL_OPTION_CHANGES, CODE_SPELLINGS, EXPORT_CHANGES, REMOVED_PACKAGES, SCRIPT_SPELLINGS } from "./export-changes";
import { movedSymbol } from "./moved-imports";
import { MOVED_SYMBOLS } from "./moved-symbols.generated";
import { rewriteSdkCalls } from "./sdk-calls";

const FIXTURE = path.join(__dirname, "__fixtures__", "moved-imports");
const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const UPDATE = process.env.REBASE_WRITE_CODEMOD_FIXTURES === "1";

const scratch: string[] = [];
afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function materialize(): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codemod-moved-")));
    scratch.push(dir);
    const input = path.join(FIXTURE, "input");
    const walk = (from: string): void => {
        for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
            const source = path.join(from, entry.name);
            if (entry.isDirectory()) walk(source);
            else {
                const target = path.join(dir, path.relative(input, source)).replace(/\.txt$/, "");
                fs.mkdirSync(path.dirname(target), { recursive: true });
                fs.copyFileSync(source, target);
            }
        }
    };
    walk(input);
    return dir;
}

const read = (dir: string, file: string): string => fs.readFileSync(path.join(dir, file), "utf8");

describe("rebase migrate sdk-calls: moved, renamed and removed names", () => {
    it("rewrites the imports as recorded and lists what it leaves", async () => {
        const dir = materialize();
        const { files, report } = await rewriteSdkCalls(dir);
        for (const [file, content] of files) fs.writeFileSync(file, content);
        const written = [...files.keys()].map(file => path.relative(dir, file).split(path.sep).join("/")).sort();
        const contract = `${JSON.stringify(report, null, 2)}\n`;
        const expectedDir = path.join(FIXTURE, "expected");
        if (UPDATE) {
            fs.rmSync(expectedDir, { recursive: true, force: true });
            fs.mkdirSync(expectedDir, { recursive: true });
            fs.writeFileSync(path.join(expectedDir, "report.json.txt"), contract);
            for (const file of written) {
                fs.mkdirSync(path.dirname(path.join(expectedDir, file)), { recursive: true });
                fs.copyFileSync(path.join(dir, file), path.join(expectedDir, `${file}.txt`));
            }
        } else {
            expect(contract).toBe(fs.readFileSync(path.join(expectedDir, "report.json.txt"), "utf8"));
            for (const file of written) expect(read(dir, file), file).toBe(fs.readFileSync(path.join(expectedDir, `${file}.txt`), "utf8"));
        }

        // A mixed type-only import: the moved name leaves, the other stays.
        const field = read(dir, "frontend/src/fields/RatingField.tsx");
        expect(field).toContain(`import type { TableDescriptor } from "@rebasepro/types";`);
        expect(field).toContain(`import { normalizeEmail } from "@rebasepro/common";`);
        expect(field).toContain(`import { type ConditionContext, resolveProperty, type ResolvePropertyProps } from "@rebasepro/cms-types";`);

        // Merged into the existing import, alias kept, the emptied import deleted.
        const view = read(dir, "frontend/src/views/ReportView.tsx");
        expect(view).toContain(`import {\n    type CustomizableTable,\n    getDefaultValuesFor,\n    evaluateCondition as evalCond\n} from "@rebasepro/cms-types";`);
        expect(view).toContain(`import { buildCompositeId } from "@rebasepro/common";`);
        expect(view.match(/from "@rebasepro\/(?:common|cms-types)"/g)?.length).toBe(2);

        // Re-exports.
        const barrel = read(dir, "frontend/src/cms/index.ts");
        expect(barrel).toContain(`export { normalizeEmail } from "@rebasepro/common";`);
        expect(barrel).toContain(`export { canEditEntity, type FilterPreset } from "@rebasepro/cms-types";`);

        // `import("pkg").Name` in a type is repointed; the namespace import is not.
        const storage = read(dir, "frontend/src/lib/storage.ts");
        expect(storage).toContain(`import("@rebasepro/cms-types").FilterPreset`);
        expect(storage).toContain(`import * as K from "@rebasepro/common";`);

        // Renamed exports, with their references (a shorthand keeps its key).
        const upload = read(dir, "backend/functions/upload.ts");
        expect(upload).toContain("assertUploadWithinColumnLimits(undefined");
        expect(upload).toContain("body[UPLOAD_COLUMN_FIELD]");
        expect(upload).toContain("{ reviewSecurityRules: reviewRls }");
        expect(upload).toContain(`import { reviewRls } from "@rebasepro/plugin-review/config";`);
        expect(upload).toContain(`import { assertUploadWithinColumnLimits, UPLOAD_COLUMN_FIELD, loadCollectionsFromDirectory } from "@rebasepro/server";`);

        // The destination becomes a dependency, at the range of the other @rebasepro packages.
        expect(JSON.parse(read(dir, "frontend/package.json")).dependencies["@rebasepro/cms-types"]).toBe("^0.30.1");
        expect(JSON.parse(read(dir, "backend/package.json")).dependencies["@rebasepro/cms-types"]).toBe("0.30.1");
        expect(report.dependencies.map(added => `${added.file} ${added.name}`)).toEqual(["backend/package.json @rebasepro/cms-types", "frontend/package.json @rebasepro/cms-types"]);

        const steps = report.manualSteps.map(step => `${step.title}\n${step.detail}`).join("\n\n");
        expect(steps).toMatch(/import \* as K from "@rebasepro\/common"`[^;]*K\.resolveStorageSource/);
        expect(steps).toContain("export * from \"@rebasepro/types\";");
        expect(steps).toContain("`loadCollectionsFromDirectory` from @rebasepro/server — `compileTables` (@rebasepro/common)");
        expect(steps).toContain("`MongoDBCollectionConfig` from @rebasepro/types");
        expect(steps).toMatch(/import\("@rebasepro\/common"\)`[^;]*`evaluateCondition`/);
        expect(steps).toContain("`openRebase({ collections })`");
        expect(steps).toContain("an MCP tool named for collections (line 2)");
        expect(steps).toContain("script \"introspect\" uses schema introspect --output");
        expect(steps).toContain("#120-mongodb-is-retired");
    });

    it("changes nothing on its own output", async () => {
        const dir = materialize();
        const first = await rewriteSdkCalls(dir);
        for (const [file, content] of first.files) fs.writeFileSync(file, content);
        const second = await rewriteSdkCalls(dir);
        expect([...second.files.keys()]).toEqual([]);
        expect(second.report.counts["moved-imports"]).toBeUndefined();
    });
});

describe("the moved-symbol table", () => {
    const json = <T>(file: string): T => JSON.parse(fs.readFileSync(path.join(REPO, file), "utf8"));

    it("is what tooling/scripts/codemod/moved-symbols-table.mjs writes from the headless guard's JSON", () => {
        const { moves } = json<{ moves: { symbol: string; from: string; to: string | null; as?: string; rename?: string; instead?: string }[] }>("tooling/scripts/headless-guard/moved-symbols.json");
        const { moved } = json<{ moved: Record<string, string[]> }>("tooling/scripts/headless-guard/cms-only-symbols.json");
        const generated = new Map(MOVED_SYMBOLS.map(row => [`${row.from} ${row.symbol}`, row]));
        const stale = "is stale: run node tooling/scripts/codemod/moved-symbols-table.mjs";
        for (const move of moves) {
            const row = generated.get(`${move.from} ${move.symbol}`);
            expect(row, `${move.from} ${move.symbol} ${stale}`).toBeDefined();
            expect(row?.to, `${move.symbol} ${stale}`).toBe(move.to);
            expect(row?.as, `${move.symbol} ${stale}`).toBe(move.as ?? move.rename);
            expect(row?.instead, `${move.symbol} ${stale}`).toBe(move.instead);
        }
        const fromJson = new Set([
            ...moves.map(move => `${move.from} ${move.symbol}`),
            ...Object.entries(moved).flatMap(([to, symbols]) => symbols.map(symbol => `${to} ${symbol}`))
        ]);
        for (const row of MOVED_SYMBOLS) {
            expect(fromJson.has(`${row.from} ${row.symbol}`) || (row.to !== null && fromJson.has(`${row.to} ${row.symbol}`)), `${row.from} ${row.symbol} ${stale}`).toBe(true);
        }
        for (const [to, symbols] of Object.entries(moved)) {
            for (const symbol of symbols) expect(MOVED_SYMBOLS.some(row => row.symbol === symbol && row.to === to), `${symbol} → ${to} ${stale}`).toBe(true);
        }
    });

    it("gives the generated rows precedence over the hand-written ones", () => {
        for (const row of MOVED_SYMBOLS) expect(movedSymbol(row.from, row.symbol)).toBe(row);
    });

    it("renames only onto names the package exports today", () => {
        const exported = (pkg: string, name: string): boolean => {
            const dir = path.join(REPO, "packages", pkg.replace(/^@rebasepro\//, "").split("/")[0], "src");
            const declaration = new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function|const|class|interface|type|enum)\\s+${name}\\b`);
            const walk = (current: string): boolean => fs.readdirSync(current, { withFileTypes: true }).some(entry => {
                const full = path.join(current, entry.name);
                if (entry.isDirectory()) return walk(full);
                return /\.tsx?$/.test(entry.name) && declaration.test(fs.readFileSync(full, "utf8"));
            });
            return walk(dir);
        };
        for (const row of EXPORT_CHANGES) {
            if (row.to === null) continue;
            expect(exported(row.to, row.as ?? row.symbol), `${row.to} has no export ${row.as ?? row.symbol}`).toBe(true);
            if (row.as) expect(exported(row.from, row.symbol), `${row.from} still exports ${row.symbol}: it is not renamed`).toBe(false);
        }
    });

    it("points every manual step at a heading of the upgrade guide", () => {
        const guide = fs.readFileSync(path.join(REPO, "website/src/content/docs/docs/upgrading/0-30-to-0-31.mdx"), "utf8");
        const anchors = new Set([...guide.matchAll(/^#{2,3} (.+)$/gm)].map(match => `#${match[1].toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, "").replace(/ /g, "-")}`));
        const used = [
            ...EXPORT_CHANGES.flatMap(row => (row.guide ? [row.guide] : [])),
            ...Object.values(REMOVED_PACKAGES).map(entry => entry.guide),
            ...CALL_OPTION_CHANGES.map(change => change.guide),
            ...CODE_SPELLINGS.map(spelling => spelling.guide),
            ...SCRIPT_SPELLINGS.map(spelling => spelling.guide)
        ];
        for (const anchor of new Set(used)) expect(anchors.has(anchor), `${anchor} is not a heading of the upgrade guide`).toBe(true);
    });
});
