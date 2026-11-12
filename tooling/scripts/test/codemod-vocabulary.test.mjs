/**
 * The collections-to-tables codemod's key table, held to the real surface.
 *
 * The codemod (`rebase migrate collections-to-tables`) routes every legacy
 * `admin` key and presentation field to a `customizeTable` option. It cannot
 * import the option lists — the CLI is a BaaS package and may not import
 * `@rebasepro/cms-types` — so it keeps its own table
 * (`packages/cli/src/codemod/collections-to-tables/vocabulary.ts`). This test
 * is what keeps that table honest, reading every side as source:
 *
 * - every destination is a key `customizeTable` accepts
 *   (`TABLE_CUSTOMIZATION_KEYS` / `FIELD_CUSTOMIZATION_KEYS`), or a path into
 *   `kanban`, whose keys `customizeTable` validates itself;
 * - every legacy `admin` key (`ADMIN_COLLECTION_KEYS` / `ADMIN_PROPERTY_KEYS`)
 *   has an entry: a destination, or `{ dropped: "why" }`;
 * - where `customizeTable` refuses a legacy name with a hint naming its new
 *   key (`propertiesOrder` → `fieldOrder`), the codemod sends it there.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** The initializer of a top-level `const` in a TypeScript file, unwrapped from `as` / `satisfies`. */
function constInitializer(file, name) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) {
        if (!ts.isVariableStatement(statement)) continue;
        for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || declaration.name.text !== name || !declaration.initializer) continue;
            let node = declaration.initializer;
            while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) node = node.expression;
            return node;
        }
    }
    throw new Error(`${file} has no top-level const ${name}`);
}

function stringArray(file, name) {
    const node = constInitializer(file, name);
    assert.ok(ts.isArrayLiteralExpression(node), `${file}: ${name} is not an array literal`);
    return node.elements.map(element => {
        assert.ok(ts.isStringLiteral(element), `${file}: ${name} has a non-string element`);
        return element.text;
    });
}

function keyOf(property) {
    const name = property.name;
    if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
    throw new Error(`computed key ${name.getText()}`);
}

/** A record of string (or `{ dropped: string }`) values, as data. */
function record(file, name) {
    const node = constInitializer(file, name);
    assert.ok(ts.isObjectLiteralExpression(node), `${file}: ${name} is not an object literal`);
    const out = {};
    for (const property of node.properties) {
        assert.ok(ts.isPropertyAssignment(property), `${file}: ${name} has a member that is not \`key: value\``);
        const value = property.initializer;
        if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) {
            out[keyOf(property)] = value.text;
        } else if (ts.isObjectLiteralExpression(value)) {
            const dropped = value.properties.find(member => ts.isPropertyAssignment(member) && keyOf(member) === "dropped");
            assert.ok(dropped && (ts.isStringLiteral(dropped.initializer) || ts.isNoSubstitutionTemplateLiteral(dropped.initializer)),
                `${file}: ${name}.${keyOf(property)} must be a destination string or { dropped: "why" }`);
            assert.ok(dropped.initializer.text.length > 0, `${file}: ${name}.${keyOf(property)} is dropped without a reason`);
            out[keyOf(property)] = { dropped: dropped.initializer.text };
        } else {
            throw new Error(`${file}: ${name}.${keyOf(property)} is neither a string nor { dropped }`);
        }
    }
    return out;
}

const VOCABULARY = "packages/cli/src/codemod/collections-to-tables/vocabulary.ts";
const CUSTOMIZATION = "packages/cms-types/src/table_customization.ts";
const CUSTOMIZE = "packages/cms/src/tables/customize_table.ts";
const ADMIN_BLOCK = "packages/types/src/types/admin_block.ts";

const TABLE_KEYS = new Set(stringArray(CUSTOMIZATION, "TABLE_CUSTOMIZATION_KEYS"));
const FIELD_KEYS = new Set(stringArray(CUSTOMIZATION, "FIELD_CUSTOMIZATION_KEYS"));
const KANBAN_KEYS = new Set(["columnField", "orderField"]);

/** A hint's new key, when it names exactly one: "`fieldOrder`" → "fieldOrder", "`kanban.orderField`" → "kanban.orderField". */
function hintedKey(hint) {
    const match = /^`([A-Za-z.]+)`$/.exec(hint);
    return match ? match[1] : undefined;
}

function assertTableDestination(where, destination) {
    if (typeof destination !== "string") return;
    const [head, ...rest] = destination.split(".");
    assert.ok(TABLE_KEYS.has(head), `${where} → "${destination}": "${head}" is not a customizeTable option (TABLE_CUSTOMIZATION_KEYS)`);
    if (rest.length > 0) {
        assert.equal(head, "kanban", `${where} → "${destination}": only kanban is addressed by path`);
        assert.ok(KANBAN_KEYS.has(rest.join(".")), `${where} → "${destination}" is not a kanban option`);
    }
}

function assertFieldDestination(where, destination) {
    if (typeof destination !== "string") return;
    assert.ok(FIELD_KEYS.has(destination), `${where} → "${destination}" is not a field customization option (FIELD_CUSTOMIZATION_KEYS)`);
}

test("every collection admin key has an entry, and goes to a real customizeTable option", () => {
    const table = record(VOCABULARY, "COLLECTION_ADMIN_DESTINATIONS");
    for (const key of stringArray(ADMIN_BLOCK, "ADMIN_COLLECTION_KEYS")) {
        assert.ok(key in table, `admin.${key} (ADMIN_COLLECTION_KEYS) has no entry in COLLECTION_ADMIN_DESTINATIONS: give it a destination or { dropped: "why" }`);
    }
    for (const [key, destination] of Object.entries(table)) assertTableDestination(`admin.${key}`, destination);
});

test("every property admin key has an entry, and goes to a real field option", () => {
    const table = record(VOCABULARY, "PROPERTY_ADMIN_DESTINATIONS");
    for (const key of stringArray(ADMIN_BLOCK, "ADMIN_PROPERTY_KEYS")) {
        assert.ok(key in table, `property admin.${key} (ADMIN_PROPERTY_KEYS) has no entry in PROPERTY_ADMIN_DESTINATIONS: give it a destination or { dropped: "why" }`);
    }
    for (const [key, destination] of Object.entries(table)) assertFieldDestination(`property admin.${key}`, destination);
});

test("presentation fields outside admin go to real options", () => {
    for (const [key, destination] of Object.entries(record(VOCABULARY, "COLLECTION_FIELD_DESTINATIONS"))) assertTableDestination(key, destination);
    for (const [key, destination] of Object.entries(record(VOCABULARY, "PROPERTY_FIELD_DESTINATIONS"))) assertFieldDestination(key, destination);
    for (const [key, destination] of Object.entries(record(VOCABULARY, "KANBAN_DESTINATIONS"))) {
        assert.ok(KANBAN_KEYS.has(destination), `kanban.${key} → "${destination}" is not a kanban option`);
    }
});

test("a legacy name customizeTable refuses with a hint goes where the hint says", () => {
    const tableHints = record(CUSTOMIZE, "RENAMED_TABLE_KEYS");
    const fieldHints = record(CUSTOMIZE, "RENAMED_FIELD_KEYS");
    const collectionAdmin = record(VOCABULARY, "COLLECTION_ADMIN_DESTINATIONS");
    const propertyAdmin = record(VOCABULARY, "PROPERTY_ADMIN_DESTINATIONS");
    const propertyFields = record(VOCABULARY, "PROPERTY_FIELD_DESTINATIONS");
    let checked = 0;
    for (const [legacy, hint] of Object.entries(tableHints)) {
        const expected = hintedKey(hint);
        if (expected === undefined || !(legacy in collectionAdmin)) continue;
        assert.equal(collectionAdmin[legacy], expected, `admin.${legacy}: customizeTable says ${hint}`);
        checked++;
    }
    for (const [legacy, hint] of Object.entries(fieldHints)) {
        const expected = hintedKey(hint);
        if (expected === undefined) continue;
        const ours = legacy in propertyAdmin ? propertyAdmin[legacy] : propertyFields[legacy];
        if (ours === undefined) continue;
        assert.equal(ours, expected, `property ${legacy}: customizeTable says ${hint}`);
        checked++;
    }
    // propertiesOrder, listProperties, previewProperties, orderProperty,
    // hideFromCollection, previewProperties (field), propertiesOrder (field)…
    assert.ok(checked >= 5, `only ${checked} hints were comparable; the hint format changed?`);
});
