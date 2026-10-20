/**
 * @jest-environment jsdom
 */
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import * as app from "@rebasepro/app";
import * as cms from "@rebasepro/cms";
import * as ui from "@rebasepro/ui";

/**
 * The recipes are written the way a user's project would write them.
 *
 * `packages/cms/recipes` ships in the npm package so an agent in a user's
 * project can read customizations that match the installed version. That only
 * holds if a recipe can be copied out and compile there: it may import package
 * entry points and React, never a relative path into `src` or a deep import a
 * consumer cannot resolve. And a recipe nobody runs is a recipe that rots, so
 * each one has a test of its own and a line in the README that indexes them.
 */
const RECIPES = path.resolve(__dirname, "../../recipes");
const TESTS = __dirname;

const ALLOWED = new Set([
    "react",
    "react-router",
    "@rebasepro/app",
    "@rebasepro/cms",
    "@rebasepro/cms-types",
    "@rebasepro/types",
    "@rebasepro/ui"
]);

function recipeFiles(): string[] {
    return fs.readdirSync(RECIPES).filter(f => f.endsWith(".tsx")).sort();
}

function importsOf(file: string): string[] {
    const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const specifiers: string[] = [];
    const visit = (node: ts.Node) => {
        if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
            && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
            specifiers.push(node.moduleSpecifier.text);
        }
        if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
            && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) {
            specifiers.push(node.arguments[0].text);
        }
        ts.forEachChild(node, visit);
    };
    visit(source);
    return specifiers;
}

describe("admin recipes", () => {
    it("exist", () => {
        expect(recipeFiles().length).toBeGreaterThanOrEqual(6);
    });

    it.each(recipeFiles())("%s imports only package entry points and React", (file) => {
        const outside = importsOf(path.join(RECIPES, file)).filter(s => !ALLOWED.has(s));
        expect(outside).toEqual([]);
    });

    it.each(recipeFiles())("%s has a test", (file) => {
        expect(fs.existsSync(path.join(TESTS, file.replace(/\.tsx$/, ".test.tsx")))).toBe(true);
    });

    it.each(recipeFiles())("%s is in the README", (file) => {
        expect(fs.readFileSync(path.join(RECIPES, "README.md"), "utf8")).toContain(`(${file})`);
    });
});

/**
 * The README is the page an agent reads before customizing. Every building
 * block and hook it names is a real export of the package it says, and every
 * override name it lists is one `<Rebase components>` accepts — so a rename
 * fails here, not in someone's project.
 */
describe("the recipes README", () => {
    const readme = fs.readFileSync(path.join(RECIPES, "README.md"), "utf8");
    const packages: Record<string, Record<string, unknown>> = {
        "@rebasepro/app": app,
        "@rebasepro/cms": cms,
        "@rebasepro/ui": ui
    };
    const rows = [...readme.matchAll(/^\| `([A-Za-z]+)` \| `(@rebasepro\/[a-z-]+)` \|/gm)].map(m => [m[1], m[2]] as const);

    it("lists the building blocks and hooks", () => {
        expect(rows.length).toBeGreaterThanOrEqual(15);
    });

    it.each(rows)("%s is exported by %s", (name, pkg) => {
        expect(packages[pkg]).toBeDefined();
        expect(packages[pkg][name]).toBeDefined();
    });

    it("lists only override names that exist", () => {
        const overrides = fs.readFileSync(path.resolve(__dirname, "../../../cms-types/src/types/component_overrides.ts"), "utf8");
        const declared = new Set([...overrides.matchAll(/\|\s*"([A-Za-z.]+)"/g)].map(m => m[1]));
        const section = readme.slice(readme.indexOf("The override names are"));
        const named = [...section.matchAll(/`([A-Z][A-Za-z]*\.[A-Za-z.]+|HomePage)`/g)].map(m => m[1]);
        expect(named.length).toBeGreaterThan(10);
        expect(named.filter(n => !declared.has(n))).toEqual([]);
    });
});
