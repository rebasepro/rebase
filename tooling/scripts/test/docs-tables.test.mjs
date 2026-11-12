import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { declaredOptions } from "../check-property-options-table.mjs";
import { TARGETS, declaredProps, documentedProps } from "../check-rebase-props-table.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");

/**
 * The two gates that hold a hand-written docs table to a declared type read the
 * type with a regular expression. Each case below is a member shape the
 * expression once missed or could miss, read from the real declaration, so a
 * reshaped interface fails here rather than shrinking what the gate checks.
 */

test("customization options: a method member is a key, as a property member is", () => {
    const options = declaredOptions(ROOT);
    // `dynamicProps?(props)` — written like a key in a `customizeTable` call.
    assert.ok(options.get("FieldOptions").includes("dynamicProps"));
    assert.ok(options.get("FieldOptions").includes("readOnly"));
    // `fileName?(context)` on the storage customization.
    assert.ok(options.get("StorageCustomization").includes("fileName"));
});

test("customization options: the number format interface still comes from the property options module", () => {
    const options = declaredOptions(ROOT);
    assert.ok(options.get("NumberFormatOptions").includes("notation"));
});

test("props tables: both components are read, and each stops at its own closing brace", () => {
    const [rebase, cms] = TARGETS;
    const rebaseProps = declaredProps(rebase, ROOT);
    const cmsProps = declaredProps(cms, ROOT);
    assert.ok(rebaseProps.includes("translations"));
    assert.ok(cmsProps.includes("tableCustomizations"));
    // `RebaseStudioConfig` follows `RebaseCMSConfig` in the same file; reading
    // past the closing brace would take its `tools` as a CMS prop.
    assert.ok(!cmsProps.includes("tools"));
    assert.ok(documentedProps(cms, ROOT).length > 0);
});
