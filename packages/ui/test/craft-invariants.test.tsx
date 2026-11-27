import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import {
    buildThemeStyleSheet,
    Chip,
    contrastRatio,
    deriveRebaseTheme,
    InspectorRow,
    Menu,
    MenuItem,
    MenuSub,
    MenuSubContent,
    MenuSubTrigger,
    MultiSelect,
    MultiSelectItem,
    Popover,
    Tooltip
} from "../src";

class NoopResizeObserver implements ResizeObserver {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
}
globalThis.ResizeObserver = NoopResizeObserver;
Element.prototype.scrollIntoView = jest.fn();

describe("craft invariants — 3-variable OKLCH theme engine", () => {
    const accents = ["#0070F4", "#EAB308", "#10B981", "#E11D48", "#7C3AED", "#F97316"];

    it("guarantees WCAG AA contrast (>= 4.5:1) for --color-on-primary across diverse brand accents", () => {
        for (const accent of accents) {
            const derived = deriveRebaseTheme({ accent });
            const ratio = contrastRatio(derived.common["--color-primary"], derived.common["--color-on-primary"]);
            expect(ratio).toBeGreaterThanOrEqual(4.5);
        }
    });

    it("derives valid light/dark ladders and strengthens hairlines under contrast='high'", () => {
        const normal = deriveRebaseTheme({ accent: "#10B981", background: "#f7f5f0", contrast: "normal" });
        const high = deriveRebaseTheme({ accent: "#10B981", background: "#f7f5f0", contrast: "high" });

        expect(normal.light["--hairline"]).not.toEqual(high.light["--hairline"]);
        expect(normal.dark["--hairline"]).not.toEqual(high.dark["--hairline"]);

        const css = buildThemeStyleSheet(high);
        expect(css).toContain("--color-primary: #10b981;");
        expect(css).toContain(":root, [data-theme=\"light\"]");
        expect(css).toContain(".dark, [data-theme=\"dark\"]");
    });
});

describe("craft invariants — directional overlays & submenus", () => {
    it("injects crisp directional transform-origin animations for Menu and Popover", () => {
        render(
            <>
                <Popover open trigger={<button type="button">Pop</button>}>
                    <div>Popover body</div>
                </Popover>
                <Menu open trigger={<button type="button">Act</button>}>
                    <MenuItem>Duplicate</MenuItem>
                    <MenuSub>
                        <MenuSubTrigger>More</MenuSubTrigger>
                        <MenuSubContent>
                            <MenuItem>Copy ID</MenuItem>
                        </MenuSubContent>
                    </MenuSub>
                </Menu>
            </>
        );

        const styles = Array.from(document.querySelectorAll("style")).map((s) => s.innerHTML).join("\n");
        expect(styles).toContain("var(--radix-popover-content-transform-origin)");
        expect(styles).toContain("var(--radix-dropdown-menu-content-transform-origin)");
        expect(styles).toContain("animation-duration: 120ms");
    });
});

describe("craft invariants — Tooltip shortcut pills", () => {
    it("renders quiet shortcut keycaps beside the tooltip title", () => {
        render(
            <Tooltip open title="Command palette" shortcut={["⌘", "K"]} familiarity="low">
                <button type="button">Open</button>
            </Tooltip>
        );
        const tooltip = screen.getByRole("tooltip");
        expect(tooltip).toHaveTextContent("Command palette");
        expect(tooltip).toHaveTextContent("⌘");
        expect(tooltip).toHaveTextContent("K");
    });
});

describe("craft invariants — stable-order MultiSelect", () => {
    it("freezes selected-first ordering while open and re-sorts only on reopen", () => {
        function Harness() {
            const [val, setVal] = React.useState<string[]>(["b"]);
            const [open, setOpen] = React.useState(true);
            return (
                <>
                    <button type="button" onClick={() => setOpen((o) => !o)}>Toggle</button>
                    <MultiSelect open={open} onOpenChange={setOpen} value={val} onValueChange={setVal} includeSelectAll={false}>
                        <MultiSelectItem value="a">Alpha</MultiSelectItem>
                        <MultiSelectItem value="b">Bravo</MultiSelectItem>
                        <MultiSelectItem value="c">Charlie</MultiSelectItem>
                    </MultiSelect>
                </>
            );
        }

        render(<Harness />);
        const getLabels = () =>
            screen.getAllByRole("option").map((el) => el.textContent?.trim());

        // Initially "b" was selected when opened, so Bravo is first.
        expect(getLabels()).toEqual(["Bravo", "Alpha", "Charlie"]);

        // Click Charlie while open: it MUST NOT jump above Alpha mid-session.
        fireEvent.click(screen.getByText("Charlie"));
        expect(getLabels()).toEqual(["Bravo", "Alpha", "Charlie"]);

        // Close and reopen: now both Bravo and Charlie float above Alpha.
        fireEvent.click(screen.getByText("Toggle"));
        fireEvent.click(screen.getByText("Toggle"));
        expect(getLabels()).toEqual(["Bravo", "Charlie", "Alpha"]);
    });
});

describe("craft invariants — Chip variant='dot' & InspectorRow", () => {
    it("renders Chip variant='dot' as a rounded-full pill with a colored indicator dot", () => {
        const { container } = render(
            <Chip variant="dot" colorScheme="blue" size="smallest">Security</Chip>
        );
        const pill = container.firstElementChild as HTMLElement;
        expect(pill.className).toContain("rounded-full");
        expect(pill.className).toContain("border-hairline");
        expect(pill).toHaveTextContent("Security");
        const dot = pill.querySelector("span[aria-hidden='true']") as HTMLElement | null;
        expect(dot).not.toBeNull();
        expect(dot?.style.backgroundColor).toBeTruthy();
    });

    it("renders InspectorRow with a 2-column label and control slot", () => {
        const { container } = render(
            <InspectorRow label="Status" required description="Publication status">
                <span>Published</span>
            </InspectorRow>
        );
        expect(screen.getByText("Status")).toBeInTheDocument();
        expect(screen.getByText("*")).toBeInTheDocument();
        expect(screen.getByText("Published")).toBeInTheDocument();
        expect(container.querySelector("[data-field-control]")).not.toBeNull();
    });
});
