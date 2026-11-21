/**
 * The scaffold tells an assistant to customize every table it ships, with
 * options `customizeTable` accepts.
 *
 * The first admin an assistant shipped from a scaffolded project was the
 * derived one: every column, ids, foreign keys and raw JSON included, records
 * titled by whatever the derivation found. The always-loaded instruction file
 * now carries a checklist for the `customizeTable` pass, and the
 * customize-admin skill repeats it. Both name options; a renamed option would
 * leave them telling assistants to write something that throws.
 */
import fs from "node:fs";
import path from "node:path";
import { FIELD_CUSTOMIZATION_KEYS, TABLE_CUSTOMIZATION_KEYS } from "@rebasepro/cms-types";

const ROOT = path.resolve(__dirname, "../../../..");
const SOURCES = [
    "packages/cli/templates/template/ai-instructions.md",
    "tooling/rebase-agent-skills/skills/rebase-customize-admin/SKILL.md"
];

/** The options the checklist tells an assistant to set. */
const TABLE_OPTIONS = ["display", "listFields", "fields"];
const FIELD_OPTIONS = ["hidden", "hiddenInForm", "name", "enumLabels", "previewFields", "Preview"];

describe.each(SOURCES)("%s", (file) => {
    const text = fs.readFileSync(path.join(ROOT, file), "utf8");

    it("has the customizeTable checklist", () => {
        expect(text).toMatch(/`customizeTable` pass/);
        for (const step of ["Title:", "Columns:", "Hide the machinery:", "Labels:", "JSON columns:", "Look at it"]) {
            expect(text).toContain(step);
        }
    });

    it.each(TABLE_OPTIONS)("names `%s`, which customizeTable accepts", (option) => {
        expect(text).toContain(`\`${option}`);
        expect(TABLE_CUSTOMIZATION_KEYS as readonly string[]).toContain(option);
    });

    it.each(FIELD_OPTIONS)("names the field option `%s`, which a field accepts", (option) => {
        expect(text).toContain(option);
        expect(FIELD_CUSTOMIZATION_KEYS as readonly string[]).toContain(option);
    });
});
