/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render } from "@testing-library/react";

/**
 * The rich-text editor's root keeps the white-space ProseMirror needs.
 *
 * ProseMirror reads the document's spaces back from the DOM, so it requires
 * `white-space: pre-wrap` (or `break-spaces`) on its root; `prosemirror-view`
 * ships that rule in `style/prosemirror.css`. The editor injects its own
 * stylesheet instead and never set it, so the root computed to `normal`: the
 * browser collapsed runs of spaces the document kept, and ProseMirror said so
 * in the console ("ProseMirror expects the CSS white-space property to be
 * set") the first time the document changed.
 */

jest.mock("@rebasepro/app", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import { RichTextEditor } from "../../src/editor";

/** The values `prosemirror-view` warns about (`checkCSS`). */
const COLLAPSING = ["normal", "nowrap", "pre-line"];

describe("the rich-text editor's root", () => {
    it("preserves white-space the way ProseMirror requires", async () => {
        const { container } = render(<RichTextEditor content={"Two  spaces"} handleImageUpload={async () => ""}/>);
        // The stylesheet is injected from an effect.
        await act(async () => { await Promise.resolve(); });

        const root = container.querySelector(".ProseMirror");
        expect(root).not.toBeNull();
        const whiteSpace = getComputedStyle(root as HTMLElement).whiteSpace;
        expect(COLLAPSING).not.toContain(whiteSpace);
        expect(["pre-wrap", "break-spaces"]).toContain(whiteSpace);
    });
});
