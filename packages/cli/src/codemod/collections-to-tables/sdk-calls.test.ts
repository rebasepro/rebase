/**
 * The SDK-call rewrite on a fixture project (`__fixtures__/sdk-calls`): every
 * rule, a receiver recognised by type, receivers left alone, generated files
 * skipped, and a second run that finds nothing to do.
 *
 * `REBASE_WRITE_CODEMOD_FIXTURES=1` rewrites the expected tree.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

import { rewriteSdkCalls } from "./sdk-calls";

const FIXTURE = path.join(__dirname, "__fixtures__", "sdk-calls");
const REPO = path.resolve(__dirname, "..", "..", "..", "..", "..");
const UPDATE = process.env.REBASE_WRITE_CODEMOD_FIXTURES === "1";

function workspaceAliases(): Record<string, string> {
    const aliases: Record<string, string> = {};
    for (const name of fs.readdirSync(path.join(REPO, "packages"))) {
        const source = path.join(REPO, "packages", name, "src", "index.ts");
        if (fs.existsSync(source)) aliases[`@rebasepro/${name}`] = source;
    }
    return aliases;
}

const scratch: string[] = [];
afterAll(() => {
    for (const dir of scratch) fs.rmSync(dir, { recursive: true, force: true });
});

function materialize(): string {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codemod-sdk-")));
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

const run = (dir: string) => rewriteSdkCalls(dir, {
    aliases: workspaceAliases(),
    schemaDir: path.join(dir, "backend", "schema"),
    collectionsDir: path.join(dir, "config", "collections")
});

describe("rebase migrate sdk-calls", () => {
    it("rewrites every rule, as recorded, and leaves what is not the SDK", async () => {
        const dir = materialize();
        const { files, report } = await run(dir);
        for (const [file, content] of files) fs.writeFileSync(file, content);
        const written = [...files.keys()].map(file => path.relative(dir, file).split(path.sep).join("/")).sort();
        const contract = `${JSON.stringify({ ...report, files: report.files }, null, 2)}\n`;
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
            for (const file of written) expect(fs.readFileSync(path.join(dir, file), "utf8"), file).toBe(fs.readFileSync(path.join(expectedDir, `${file}.txt`), "utf8"));
        }

        const client = fs.readFileSync(path.join(dir, "frontend/src/client.ts"), "utf8");
        expect(client).toContain(`client.data.table(name)`);
        expect(client).toContain(`client.table("posts")`);
        expect(client).toContain(`data.table<{ id: string }>("tags")`);
        expect(client).toContain(`tablesDictionary: {}`);
        expect(client).toContain(`maxCachedRowsPerTable`);
        expect(client).toContain(`import type { TableName, TablesDictionary }`);
        expect(client).toContain(`"UNKNOWN_TABLE"`);
        expect(client).toContain(`{ op: "create", table: "posts"`);
        expect(client).toContain(`client.data.postsTable`);
        expect(client).toContain(`ReturnType<typeof client.data.table>`);
        expect(client).toContain(`String(client).toString()`);
        // A receiver the list does not name, recognised by its type.
        const typedUse = fs.readFileSync(path.join(dir, "typed/src/use.ts"), "utf8");
        expect(typedUse).toContain(`surface.table("posts")`);
        // Spelled like a listed receiver, typed as the project's own interface: the type decides.
        expect(typedUse).toContain(`client.data.collection("posts")`);
        expect(report.typeAware).toBe(true);
        // Firestore's own collection() and a method of the project's own are left as written.
        const firestore = fs.readFileSync(path.join(dir, "frontend/src/firestore.ts"), "utf8");
        expect(firestore).toContain(`collection(db, "events")`);
        expect(firestore).toContain(`registry.collection("events")`);
        // A script the checker throws on: no answer by type, not on the list, so left and listed — the run goes on.
        expect(fs.readFileSync(path.join(dir, "typed/web/feed.js"), "utf8")).toContain(`e.data.collection("posts")`);
        expect(report.left.map(left => `${left.file}:${left.line}`)).toEqual(["frontend/src/firestore.ts:8", "typed/src/use.ts:6", "typed/web/feed.js:5"]);
        // A minified bundle (a vendored build of the client) is never edited: its own option names are not the project's calls.
        expect(fs.readFileSync(path.join(dir, "typed/web/vendor/client.min.js"), "utf8")).toContain("e.maxCachedQueriesPerCollection");
        expect(written).not.toContain("typed/web/vendor/client.min.js");
        const bundleStep = report.manualSteps.find(step => step.file === "typed/web/vendor/client.min.js");
        expect(bundleStep?.title).toBe("Replace the bundled file typed/web/vendor/client.min.js");
        // Hooks: the method renamed, the props adapted, the type renamed.
        const hooks = fs.readFileSync(path.join(dir, "backend/hooks.ts"), "utf8");
        expect(hooks).toContain(`backend.setTableHooks("posts", hooks)`);
        expect(hooks).toContain(`afterRead: ({ values: row }) => row`);
        expect(hooks).toContain(`props.table.slug`);
        expect(hooks).toContain(`props.context.data.table("audit")`);
        expect(hooks).toContain(`import type { TableHooks } from "@rebasepro/types";`);
        expect(fs.readFileSync(path.join(dir, "backend/storage.ts"), "utf8")).toContain(`({ table: collection, operation }`);
        // The provable boot option is rewritten; the rest is a manual step.
        expect(fs.readFileSync(path.join(dir, "backend/src/index.ts"), "utf8")).toContain(`schemaDir: path.join(__dirname, "../schema")`);
        expect(report.manualSteps.map(step => step.title)).toContain("Update the backend options in backend/src/index.ts");
        // Rule sources name their table with `table`: existsIn (call and literal) and a membership source.
        const rules = fs.readFileSync(path.join(dir, "backend/lib/rules.ts"), "utf8");
        expect(rules).toContain(`policy.existsIn({ table: "team_members"`);
        expect(rules).toContain(`{ kind: "existsIn", table: collection, where`);
        expect(rules).toContain(`condition: { kind: "existsIn", table: "team_members"`);
        expect(rules).toContain(`membership: { table: "memberships", userField`);
        // An object that is not a rule source keeps its `collection`.
        expect(rules).toContain(`{ collection: "posts", kind: "other" }`);
        expect(rules).toContain(`record({ collection: "posts" })`);
        expect(report.counts["rule-vocabulary"]).toBe(4);
        // Generated SDK files are regenerated, not rewritten.
        expect(report.generated).toEqual(["frontend/src/generated/sdk/database.types.ts"]);
        // A file the project's own generator marks "do not edit" is the project's code, not SDK output: rewritten, never "regenerate the SDK".
        expect(fs.readFileSync(path.join(dir, "frontend/src/pages.ts"), "utf8")).toContain(`client.data.table("pages")`);
        expect(fs.readFileSync(path.join(dir, "frontend/src/generated/sdk/database.types.ts"), "utf8")).toContain("CollectionName");

        // Idempotent: a second run has nothing to rewrite.
        const second = await run(dir);
        expect(second.files.size).toBe(0);
    }, 180_000);
});
