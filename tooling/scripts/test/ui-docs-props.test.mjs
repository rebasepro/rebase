import { test } from "node:test";
import assert from "node:assert/strict";

import { readProps } from "../../design-sync/gen-ui-docs.mjs";

/**
 * The component reference's Description column was empty in 488 cells, next to
 * a library whose props are documented. The reader saw a name, a type, and
 * nothing — and concluded the props were undocumented.
 *
 * The cause was a one-line assumption: the parser matched only `/** text *\/`
 * written on a single line, and tsc emits a multi-line block for anything
 * longer than a few words. Those lines started with `*`, hit the skip branch,
 * and left the description empty.
 */

const dts = (body) => `export interface ThingProps {\n${body}\n}\n`;

test("a single-line doc comment still reaches the table", () => {
    const [row] = readProps(dts(`    /** The label shown on the button. */\n    label: string;`), "Thing");
    assert.equal(row.name, "label");
    assert.equal(row.doc, "The label shown on the button.");
    assert.equal(row.required, true);
});

test("a multi-line doc comment reaches it too", () => {
    const [row] = readProps(dts([
        "    /**",
        "     * Whether the row can be selected. Rows in a read-only",
        "     * collection are never selectable, whatever this says.",
        "     */",
        "    selectable?: boolean;"
    ].join("\n")), "Thing");
    assert.equal(row.name, "selectable");
    assert.equal(row.required, false);
    assert.equal(
        row.doc,
        "Whether the row can be selected. Rows in a read-only collection are never selectable, whatever this says."
    );
});

test("the summary stops at the first tag", () => {
    const [row] = readProps(dts([
        "    /**",
        "     * How many rows to fetch at a time.",
        "     *",
        "     * @default 50",
        "     * @see useCollectionData",
        "     */",
        "    pageSize?: number;"
    ].join("\n")), "Thing");
    assert.equal(row.doc, "How many rows to fetch at a time.");
});

test("a property with no comment gets no description, not the previous one", () => {
    const rows = readProps(dts([
        "    /** The label. */",
        "    label: string;",
        "    value: string;"
    ].join("\n")), "Thing");
    assert.equal(rows[0].doc, "The label.");
    assert.equal(rows[1].doc, "");
});

test("text on the same line as the opening /** is kept", () => {
    const [row] = readProps(dts([
        "    /** Fires when the value changes,",
        "     * with the new value. */",
        "    onChange?: (value: string) => void;"
    ].join("\n")), "Thing");
    assert.equal(row.doc, "Fires when the value changes, with the new value.");
});

test("a generic props interface is still found", () => {
    const src = "export interface ThingProps<T> {\n    /** The row. */\n    row: T;\n}\n";
    const [row] = readProps(src, "Thing");
    assert.equal(row.name, "row");
    assert.equal(row.doc, "The row.");
});
