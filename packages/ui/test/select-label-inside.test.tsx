import React from "react";
import { act, render, screen } from "@testing-library/react";
import { Select, SelectItem } from "../src";

/**
 * A labelled Select draws its label inside the box, as a TextField does.
 *
 * It drew the label above the box, so a form mixing the two showed a select's
 * label over its box beside a text field's label in its top edge (an email
 * composer's "From" next to its "To"). The CMS record form laid the kit's
 * floating label over the select itself to get the TextField look; the kit
 * does it now, and keeps the label above only at `smallest`, whose 28px box
 * has no room for it.
 */

type Size = "smallest" | "small" | "medium" | "large";

function renderSelect(props: Partial<React.ComponentProps<typeof Select>> = {}) {
    return render(
        <Select label="Status" onValueChange={() => undefined} {...props}>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="published">Published</SelectItem>
        </Select>
    );
}

/** The `<label>` the select drew inside its box, if any. */
function insideLabel(container: HTMLElement): HTMLLabelElement | null {
    return container.querySelector<HTMLLabelElement>("label[data-shrink]");
}

describe("a labelled select", () => {
    it.each<Size>(["small", "medium", "large"])("draws its label inside the box at %s", (size) => {
        const { container } = renderSelect({ size, value: "draft" });
        const label = insideLabel(container);
        expect(label).not.toBeNull();
        expect(label!.textContent).toBe("Status");
        // In the same box as the trigger, not before it.
        const trigger = screen.getByRole("combobox");
        expect(label!.parentElement).toBe(trigger.parentElement);
    });

    it("keeps the label above the box at smallest", () => {
        const { container } = renderSelect({ size: "smallest", value: "draft" });
        expect(insideLabel(container)).toBeNull();
        expect(screen.getByText("Status")).toBeTruthy();
    });

    it("puts the label above when asked to", () => {
        const { container } = renderSelect({ labelPlacement: "above", value: "draft" });
        expect(insideLabel(container)).toBeNull();
        expect(screen.getByText("Status")).toBeTruthy();
    });

    it("is named by the label inside it", () => {
        renderSelect({ value: "draft" });
        expect(screen.getByRole("combobox", { name: "Status" })).toBeTruthy();
    });

    it("is named by an element label too, rather than by a fallback literal", () => {
        render(
            <Select label={<span>Kind</span>} value="a" onValueChange={() => undefined}>
                <SelectItem value="a">A</SelectItem>
            </Select>
        );
        expect(screen.getByRole("combobox", { name: "Kind" })).toBeTruthy();
    });

    it("rests the label in the middle while empty and shrinks it once a value is shown", () => {
        const empty = renderSelect({ placeholder: "Pick one" });
        expect(insideLabel(empty.container)?.getAttribute("data-shrink")).toBe("false");
        // The resting label fills the box, so the placeholder waits for it to move.
        expect(screen.queryByText("Pick one")).toBeNull();
        empty.unmount();

        const filled = renderSelect({ value: "published" });
        expect(insideLabel(filled.container)?.getAttribute("data-shrink")).toBe("true");
    });

    it("keeps a value drawn by renderValue on one 20px line, so a chip cannot grow the box", () => {
        // jsdom has no layout, so this pins the class that holds the line; the
        // admin e2e `form-control-height` measures the result beside a text field.
        render(
            <Select label="Status" size="large" value="draft" onValueChange={() => undefined}
                renderValue={(value) => <span data-testid="chip" className="py-1.5">{value}</span>}>
                <SelectItem value="draft">Draft</SelectItem>
            </Select>
        );
        // chip → the primitive's value span → the line that holds it.
        const line = screen.getByTestId("chip").parentElement?.parentElement;
        expect(line?.className).toContain("h-5");
        expect(line?.className).toContain("items-center");
    });

    it("shrinks the label and shows the placeholder once focused", () => {
        const { container } = renderSelect({ placeholder: "Pick one" });
        act(() => screen.getByRole("combobox").focus());
        expect(insideLabel(container)?.getAttribute("data-shrink")).toBe("true");
        expect(screen.getByText("Pick one")).toBeTruthy();
    });
});
