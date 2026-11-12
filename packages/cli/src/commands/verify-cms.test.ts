/**
 * `rebase verify`, step "CMS customizations": `frontend/src/cms` held to the
 * tables it customizes, read without running the modules.
 *
 * The customization files are written as a project writes them — importing
 * `@rebasepro/cms`, React components and the table's type — which a temporary
 * directory cannot resolve. That is the point: the step must answer without
 * importing any of it.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { col, defineTable, rel, type AnyTableDef } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";

import { runVerify, type VerifyReport } from "./verify";
import { checkCmsCustomizations, type CmsFinding } from "./verify-cms";
import { TYPES_SOURCE, scaffoldProject, workspaceModuleAliases, writeTableModules } from "../../test/helpers/project";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = path.resolve(HERE, "..", "..");
const REPO = path.resolve(PACKAGE_ROOT, "..", "..");
const ALIASES = workspaceModuleAliases();

let root: string;

const RLS = [{ operation: "select", access: "public" }, { operations: ["insert", "update", "delete"], roles: ["admin"] }] as const;

const authors = defineTable("authors", {
    columns: { id: col.uuid().primaryKey().defaultRandom(), name: col.text() },
    rls: RLS
});

const posts = defineTable("posts", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        title: col.text().notNull(),
        slug: col.text().notNull(),
        status: col.text().notNull().default("draft"),
        reviewer: col.text(),
        createdAt: col.timestamptz().onCreateNow(),
        publishDate: col.timestamptz()
    },
    relations: { author: rel.belongsTo(() => authors, { notNull: true }) },
    rls: RLS
});

beforeEach(() => {
    root = fs.mkdtempSync(path.join(PACKAGE_ROOT, ".tmp-verify-cms-"));
    scaffoldProject({ root, backendDependencies: false });
    // The builders by absolute path: the schema loads with no package resolution.
    writeTableModules(path.join(root, "backend", "schema"), [authors, posts], undefined, TYPES_SOURCE);
});

afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

function cms(file: string, source: string): void {
    const full = path.join(root, "frontend", "src", "cms", file);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, source);
}

/** A customization module as a project writes it. */
function customization(slug: string, body: string, name = "postsCms"): string {
    return [
        "import { customizeTable } from \"@rebasepro/cms\";",
        "import type { posts } from \"../../../backend/schema/posts\";",
        "import { MarkdownField } from \"../components/MarkdownField\";",
        "",
        `export const ${name} = customizeTable<typeof posts>(${JSON.stringify(slug)}, {`,
        body,
        "});",
        ""
    ].join("\n");
}

function verify(): Promise<VerifyReport> {
    return runVerify({ projectRoot: root, schemaDir: path.join(root, "backend", "schema"), backendDir: null, live: false, moduleAliases: ALIASES });
}

const cmsFindings = (report: VerifyReport) => report.findings.filter(f => f.step === "cms");
const cmsStep = (report: VerifyReport) => report.steps.find(s => s.id === "cms");

/** The step alone, against the tables compiled in memory. */
async function check(tables: readonly AnyTableDef[] = [authors, posts]): Promise<CmsFinding[]> {
    return (await checkCmsCustomizations(root, compileTables(tables))).findings;
}

describe("rebase verify: CMS customizations", () => {
    it("skips a headless project (no frontend/src/cms) without a finding", async () => {
        const report = await verify();
        expect(report.findings).toEqual([]);
        expect(cmsStep(report)).toMatchObject({ status: "skipped", detail: "no frontend/src/cms" });
    });

    it("passes customizations that name real tables, columns and relations, without importing them", async () => {
        cms("posts.tsx", customization("posts", [
            "    icon: \"FileText\",",
            "    fields: {",
            "        title: { multiline: true },",
            "        status: { enumLabels: { draft: \"Draft\" } },",
            "        author: { previewAsTag: true },",
            "        createdAt: { readOnly: true },",
            "        \"publishDate\": { hiddenInForm: true },",
            "        slug: { Field: MarkdownField }",
            "    }"
        ].join("\n")));
        cms("lib/display.ts", "export const notACustomization = 1;\n");
        const report = await verify();
        expect(cmsFindings(report)).toEqual([]);
        expect(cmsStep(report)).toMatchObject({ status: "passed" });
        expect(cmsStep(report)?.detail).toContain("1 customization in frontend/src/cms");
    });

    it("reports a customization for a slug no table declares, with its file, line and a guess", async () => {
        cms("posts.tsx", customization("post", "    icon: \"FileText\""));
        const found = await check();
        expect(found.some(f => f.severity === "error")).toBe(true);
        expect(found).toEqual([expect.objectContaining({
            check: "cms-unknown-table",
            severity: "error",
            table: "post",
            file: path.join("frontend", "src", "cms", "posts.tsx"),
            line: 5,
            path: "customizeTable(\"post\")"
        })]);
        expect(found[0].fix).toContain("\"posts\"");
    });

    it("reports a fields key that is neither a column nor a relation, and names the key when the SQL name was used", async () => {
        cms("posts.tsx", customization("posts", [
            "    fields: {",
            "        titel: { multiline: true },",
            "        publish_date: { name: \"Published\" },",
            "        tags: { previewAsTag: true }",
            "    }"
        ].join("\n")));
        const found = await check();
        expect(found.map(f => [f.check, f.path, f.line])).toEqual([
            ["cms-unknown-field", "customizeTable(\"posts\").fields.titel", 7],
            ["cms-unknown-field", "customizeTable(\"posts\").fields.publish_date", 8],
            ["cms-unknown-field", "customizeTable(\"posts\").fields.tags", 9]
        ]);
        expect(found[0].fix).toContain("`title`");
        expect(found[1].message).toContain("SQL name of the column whose key is `publishDate`");
        expect(found.every(f => f.severity === "error")).toBe(true);
    });

    it("reports a required column kept off the form that nothing fills, and its relation's foreign key", async () => {
        cms("posts.tsx", customization("posts", [
            "    fields: {",
            "        slug: { hiddenInForm: true },",
            "        title: { readOnly: true, filledByServer: true },",
            "        author: { disabled: { disabledMessage: \"Set by the import\" } },",
            "        status: { hiddenInForm: true },",
            "        reviewer: { hiddenInForm: true },",
            "        createdAt: { hiddenInForm: true }",
            "    }"
        ].join("\n")));
        const found = await check();
        expect(found.map(f => [f.check, f.severity, f.path])).toEqual([
            ["cms-hidden-required", "error", "customizeTable(\"posts\").fields.slug"],
            ["cms-hidden-required", "error", "customizeTable(\"posts\").fields.author"]
        ]);
        expect(found[0].message).toContain("`hiddenInForm`");
        expect(found[0].message).toContain("creating a \"posts\" record from the panel always fails");
        expect(found[1].message).toContain("its foreign key `author_id`");
    });

    it("does not judge a field whose options it cannot read", async () => {
        cms("posts.tsx", [
            "import { customizeTable } from \"@rebasepro/cms\";",
            "import { hiddenField } from \"./lib/fields\";",
            "export const postsCms = customizeTable(\"posts\", {",
            "    fields: { slug: hiddenField, title: { ...hiddenField } }",
            "});",
            ""
        ].join("\n"));
        const found = await check();
        expect(found).toEqual([]);
    });

    it("warns, rather than fails, when a beforeSave hook may fill the column", async () => {
        const hooked = defineTable("posts", {
            columns: { id: col.uuid().primaryKey().defaultRandom(), slug: col.text().notNull() },
            rls: "admin-only",
            hooks: { beforeSave: ({ values }) => ({ ...values, slug: "x" }) }
        });
        cms("posts.tsx", customization("posts", "    fields: { slug: { hiddenInForm: true } }"));
        const found = await check([hooked]);
        expect(found.map(f => [f.check, f.severity])).toEqual([["cms-hidden-required", "warning"]]);
        expect(found.every(f => f.severity === "warning")).toBe(true);
        expect(found[0].fix).toContain("filledByServer: true");
    });

    it("reports a second customization of one table, naming the first", async () => {
        cms("posts.tsx", customization("posts", "    icon: \"FileText\""));
        cms("posts-extra.tsx", customization("posts", "    group: \"Content\"", "morePostsCms"));
        const found = await check();
        expect(found.map(f => [f.check, f.file])).toEqual([
            ["cms-duplicate-customization", path.join("frontend", "src", "cms", "posts.tsx")]
        ]);
        expect(found[0].message).toContain(`${path.join("frontend", "src", "cms", "posts-extra.tsx")}:5`);
    });

    it("follows an aliased import, a namespace import and same-file consts", async () => {
        cms("a.tsx", [
            "import { customizeTable as customize } from \"@rebasepro/cms\";",
            "const SLUG = \"posts\";",
            "const FIELDS = { titel: {} };",
            "export const a = customize(SLUG, { fields: FIELDS });",
            ""
        ].join("\n"));
        cms("b.tsx", [
            "import * as cms from \"@rebasepro/cms\";",
            "export const b = cms.customizeTable(\"autors\", {});",
            ""
        ].join("\n"));
        const found = await check();
        expect(found.map(f => [f.check, f.table])).toEqual([
            ["cms-unknown-field", "posts"],
            ["cms-unknown-table", "autors"]
        ]);
    });

    it("says what it could not read, as a warning", async () => {
        cms("posts.tsx", [
            "import { customizeTable } from \"@rebasepro/cms\";",
            "import { slugOf, shared } from \"./lib/shared\";",
            "export const a = customizeTable(slugOf(\"posts\"), {});",
            "export const b = customizeTable(\"authors\", { ...shared });",
            ""
        ].join("\n"));
        const found = await check();
        expect(found.map(f => [f.check, f.severity, f.line])).toEqual([
            ["cms-not-static", "warning", 3],
            ["cms-not-static", "warning", 4]
        ]);
        expect(found.every(f => f.severity === "warning")).toBe(true);
        expect(found[1].message).toContain("`...shared`");
    });

    it("leaves a file that does not import customizeTable from @rebasepro/cms alone", async () => {
        cms("other.tsx", "function customizeTable(a: string, b: object) { return [a, b]; }\nexport const x = customizeTable(\"nope\", {});\n");
        const found = await check();
        expect(found).toEqual([]);
    });

    it("reads the CMS of a static app rebase.json declares", async () => {
        fs.writeFileSync(path.join(root, "rebase.json"), JSON.stringify({
            rebase: "^1",
            apps: {
                backend: { type: "backend", runtime: "managed" },
                admin: { type: "static", root: "admin", output: "admin/dist" }
            }
        }));
        const file = path.join(root, "admin", "src", "cms", "posts.tsx");
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, customization("pots", ""));
        const found = await check();
        expect(found.map(f => [f.check, f.file])).toEqual([["cms-unknown-table", path.join("admin", "src", "cms", "posts.tsx")]]);
    });
});

describe("the demo app", () => {
    it("passes the CMS customization step clean", async () => {
        const app = path.join(REPO, "app");
        const report = await runVerify({ projectRoot: app, schemaDir: path.join(app, "backend", "schema"), backendDir: null, live: false, moduleAliases: ALIASES });
        expect(report.findings.filter(f => f.step === "schema" || f.step === "cms")).toEqual([]);
        expect(report.steps.find(s => s.id === "cms")?.status).toBe("passed");
    }, 60_000);
});
