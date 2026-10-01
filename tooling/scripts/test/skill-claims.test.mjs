/**
 * Tests for the `isId`-strategy rule in `docs-verify/check-skill-claims.mjs`.
 *
 * `rebase-collections` offered `isId: "cuid"` as "Auto-generated CUID" while
 * config load refuses it, so an agent following the skill wrote a collection
 * whose first boot failed. Each test feeds the rule a fixture tree in exactly
 * that shape: the refusal in a stand-in `validate-config.ts`, the offer in a
 * skill, a page or the scaffold's instructions.
 *
 * Run: node --test tooling/scripts/test/
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { checkIdStrategies, refusedIdStrategies } from "../docs-verify/check-skill-claims.mjs";

const VALIDATE = "packages/server/src/collections/validate-config.ts";
const REFUSING =
    "for (const [key, property] of ids) {\n" +
    "    if (property.isId === \"cuid\") {\n" +
    "        collect.error(`${at}.properties.${key}.isId`, \"no cuid() function\");\n" +
    "    }\n" +
    "    if (property.isId === \"increment\" && property.columnType !== undefined) {\n" +
    "        collect.warn(`${at}`, \"width ignored\");\n" +
    "    }\n" +
    "}\n";

/** Write `files` (relative path → contents) under a fresh temporary root. */
function fixtureRoot(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-claims-"));
    for (const [file, contents] of Object.entries(files)) {
        fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
        fs.writeFileSync(path.join(root, file), contents);
    }
    return root;
}

const idFindings = (files) => checkIdStrategies(fixtureRoot({ [VALIDATE]: REFUSING, ...files }));

test("the refused strategies are read from the validator, warnings excluded", () => {
    assert.deepEqual([...refusedIdStrategies(fixtureRoot({ [VALIDATE]: REFUSING }))], ["cuid"]);
});

test("a strategy table that offers a refused strategy is a finding", () => {
    const findings = idFindings({
        "tooling/rebase-agent-skills/skills/rebase-collections/SKILL.md":
            "### String isId Strategies\n\n| Value | Behavior |\n|---|---|\n" +
            "| `\"uuid\"` | Auto-generated UUID |\n| `\"cuid\"` | Auto-generated CUID |\n"
    });
    assert.equal(findings.length, 1);
    assert.match(findings[0].file, /SKILL\.md:6$/);
});

test("an isId type or snippet that names it is a finding, in a page or the scaffold", () => {
    const findings = idFindings({
        "website/src/content/docs/docs/collections/ids.mdx":
            "| `isId` | `boolean \\| \"manual\" \\| \"cuid\" \\| string` | Mark as primary key |\n",
        "packages/cli/templates/template/ai-instructions.md": "id: { type: \"string\", isId: \"cuid\" }\n"
    });
    assert.deepEqual(findings.map((f) => f.file.replace(/:\d+$/, "")).sort(), [
        "packages/cli/templates/template/ai-instructions.md",
        "website/src/content/docs/docs/collections/ids.mdx"
    ]);
});

test("a line that says the strategy is refused is the correction, not the drift", () => {
    assert.deepEqual(idFindings({
        "tooling/rebase-agent-skills/skills/rebase-collections/SKILL.md":
            "### String isId Strategies\n\n`\"cuid\"` is refused at config load: there is no `cuid()` function.\n",
        "website/src/content/docs/docs/collections/properties.mdx":
            "| `isId` | `boolean \\| string` | `\"cuid\"` is refused at config load |\n"
    }), []);
});

test("the changelog is history, and an unrelated `cuid` is not an isId claim", () => {
    assert.deepEqual(idFindings({
        "website/src/content/docs/docs/CHANGELOG.md": "- `isId: \"cuid\"` used to emit `DEFAULT cuid()`.\n",
        "website/src/content/docs/docs/recipes/ids.md": "## Ids\n\nThe `\"cuid\"` package makes collision-resistant ids.\n"
    }), []);
});

test("a validator with no refusal left says the rule stopped running", () => {
    const findings = checkIdStrategies(fixtureRoot({ [VALIDATE]: "export {};\n" }));
    assert.equal(findings.length, 1);
    assert.match(findings[0].message, /isId-strategy rule is not running/);
});
