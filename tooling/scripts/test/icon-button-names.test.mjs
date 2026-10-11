/**
 * check:icon-button-names — which IconButton sites count as named.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { isCheckedSource, unnamedIconButtons } from "../check-icon-button-names.mjs";

test("package .tsx source is read; tests, the component itself and code outside src are not", () => {
    assert.equal(isCheckedSource("packages/cms/src/form/EntityForm.tsx"), true);
    assert.equal(isCheckedSource("packages/cms/src/form/x.test.tsx"), false);
    assert.equal(isCheckedSource("packages/cms/src/__tests__/x.tsx"), false);
    assert.equal(isCheckedSource("packages/ui/src/components/IconButton.tsx"), false);
    assert.equal(isCheckedSource("packages/cms/test/x.tsx"), false);
    assert.equal(isCheckedSource("packages/cms/src/util/x.ts"), false);
});

test("an icon button with no aria-label, no forwarded props and no tooltip around it is unnamed", () => {
    const text = [
        "<IconButton onClick={close}><XIcon/></IconButton>",
        "<IconButton aria-label={t(\"close\")} onClick={close}><XIcon/></IconButton>",
        "<IconButton aria-labelledby=\"h\"><XIcon/></IconButton>",
        "<IconButton {...props}><XIcon/></IconButton>",
        "<Tooltip title={t(\"delete\")}>\n    <IconButton onClick={remove}><TrashIcon/></IconButton>\n</Tooltip>",
        "<Tooltip>\n    <IconButton onClick={remove}><TrashIcon/></IconButton>\n</Tooltip>",
        "<Tooltip title=\"Delete\"><div><IconButton onClick={remove}><TrashIcon/></IconButton></div></Tooltip>",
        "<IconButton onClick={() => { if (a > b) go(); }}><XIcon/></IconButton>"
    ].join("\n");
    assert.deepEqual(unnamedIconButtons("f.tsx", text), ["f.tsx:1", "f.tsx:9", "f.tsx:11", "f.tsx:12"]);
});
