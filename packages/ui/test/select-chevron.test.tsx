import React from "react";
import { render } from "@testing-library/react";
import { iconSize, Select, SelectItem } from "../src";

/**
 * The select's chevron draws at its icon size, as the relation field's does.
 *
 * In the post form a Status select showed a small, faint chevron beside the
 * Author relation field's full-size one. Both are the same 20px Lucide
 * chevron, but the select put `px-1` on the svg itself, and with Tailwind's
 * `box-sizing: border-box` padding comes out of an element's width: the glyph
 * was drawn in the 12px left over, with its stroke scaled down to 1px. The
 * relation field (`RelationSelector`) draws `iconSize.small` with nothing on
 * it, so that is what a small select draws too.
 */

type Size = "smallest" | "small" | "medium" | "large";

function chevronOf(size: Size): SVGElement {
    const { container } = render(
        <Select size={size} value="draft" onValueChange={() => undefined} aria-label="Status">
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
        </Select>
    );
    const chevron = container.querySelector<SVGElement>("svg.lucide-chevron-down");
    if (!chevron) throw new Error("the select drew no chevron");
    return chevron;
}

/** Utilities that take space out of the svg's own box. */
const PADDING = /^(p|px|py|pl|pr|pt|pb|ps|pe)-/;

describe("the select's chevron", () => {
    it.each<[Size, number]>([
        ["smallest", iconSize.small],
        ["small", iconSize.small],
        ["medium", iconSize.small],
        ["large", iconSize.medium]
    ])("draws at full size on a %s select", (size, expected) => {
        const chevron = chevronOf(size);
        expect(chevron.getAttribute("width")).toBe(String(expected));
        expect(chevron.getAttribute("height")).toBe(String(expected));
        const classes = chevron.getAttribute("class")?.split(/\s+/) ?? [];
        expect(classes.filter(c => PADDING.test(c))).toEqual([]);
        // A long value must not squeeze it either: it is a flex item.
        expect(classes).toContain("shrink-0");
    });

    it("keeps Lucide's stroke, as the relation field's chevron does", () => {
        expect(chevronOf("small").getAttribute("stroke-width")).toBe("2");
    });
});
