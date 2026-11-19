/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BarChart, ChartCard, StatTile, StatusDot, TimeBars, UiLabelsProvider } from "../src";

global.ResizeObserver = class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
};

describe("StatusDot", () => {
    it("puts the word after a dot in the tone's hue", () => {
        const { container } = render(<StatusDot tone="ok">Running</StatusDot>);
        expect(screen.getByText("Running")).toBeInTheDocument();
        expect(container.querySelector(".bg-emerald-500")).not.toBeNull();
    });

    it("pulses only while busy", () => {
        const busy = render(<StatusDot tone="busy">Deploying</StatusDot>);
        expect(busy.container.querySelector(".motion-safe\\:animate-ping")).not.toBeNull();
        const idle = render(<StatusDot tone="idle">Stopped</StatusDot>);
        expect(idle.container.querySelector(".motion-safe\\:animate-ping")).toBeNull();
    });

    it("paints idle in the disabled ink, not a numbered surface", () => {
        const { container } = render(<StatusDot tone="idle">Stopped</StatusDot>);
        expect(container.innerHTML).toContain("bg-text-disabled");
        expect(container.innerHTML).not.toMatch(/bg-surface-\d/);
    });

    it("is an image with a name when it has no word", () => {
        render(<StatusDot tone="bad" aria-label="Failed"/>);
        expect(screen.getByRole("img", { name: "Failed" })).toBeInTheDocument();
    });
});

describe("StatTile", () => {
    it("names its fact with a micro label over the value, and a detail line", () => {
        render(<StatTile icon={<svg/>} label="Compute" value="100m · 384Mi" detail="1/1 instances"/>);
        expect(screen.getByText("Compute")).toHaveClass("typography-micro");
        expect(screen.getByText("100m · 384Mi")).toHaveClass("typography-h5");
        expect(screen.getByText("1/1 instances")).toBeInTheDocument();
    });

    it("draws the large size with a 48px well and an h4 value", () => {
        const { container } = render(<StatTile size="large" icon={<svg/>} label="Status" value="Running"/>);
        expect(screen.getByText("Running")).toHaveClass("typography-h4");
        expect(container.querySelector(".w-12.h-12")).not.toBeNull();
    });

    it("is one button when clickable, with its action beside it rather than inside it", () => {
        const onClick = jest.fn();
        const onAction = jest.fn();
        render(<StatTile icon={<svg/>} label="Status" value="Running" onClick={onClick}
            action={<button type="button" onClick={onAction}>More</button>}/>);
        const tile = screen.getByRole("button", { name: /Status/ });
        fireEvent.click(tile);
        expect(onClick).toHaveBeenCalledTimes(1);
        expect(tile).not.toContainElement(screen.getByRole("button", { name: "More" }));
    });

    it("top-aligns its content, so tiles in a row share their label and value lines", () => {
        render(<StatTile icon={<svg/>} label="Compute" value="1" detail="1 of 1 ready" onClick={() => undefined}/>);
        const content = screen.getByText("Compute").closest("div");
        expect(content).toHaveClass("items-start");
        expect(content).not.toHaveClass("items-center");
    });

    it("names its stretched button by the label, value and detail it covers", () => {
        render(<StatTile icon={<svg/>} label="Backup" value="None" detail="No manual backup yet" onClick={() => undefined}/>);
        expect(screen.getByRole("button", { name: "Backup None No manual backup yet" })).toBeInTheDocument();
    });

    it("draws a valueAction right after the value, outside the tile's button", () => {
        const onClick = jest.fn();
        const onChevron = jest.fn();
        render(<StatTile icon={<svg/>} label="Status" value="Stopped" onClick={onClick}
            valueAction={<button type="button" onClick={onChevron}>Details</button>}/>);
        const chevron = screen.getByRole("button", { name: "Details" });
        expect(chevron.parentElement?.previousElementSibling).toHaveTextContent("Stopped");
        expect(chevron.parentElement?.parentElement).toHaveClass("gap-1.5");
        expect(screen.getByRole("button", { name: /Status/ })).not.toContainElement(chevron);
        fireEvent.click(chevron);
        expect(onChevron).toHaveBeenCalledTimes(1);
        expect(onClick).not.toHaveBeenCalled();
    });

    it("never truncates: the label, value and detail wrap", () => {
        render(<StatTile icon={<svg/>} label="Last backup" value="A value far longer than its tile" detail="and a detail too"/>);
        for (const text of ["Last backup", "A value far longer than its tile", "and a detail too"]) {
            expect(screen.getByText(text)).not.toHaveClass("truncate");
            expect(screen.getByText(text)).toHaveClass("break-words");
        }
    });

    it("is not a button when nothing opens", () => {
        render(<StatTile icon={<svg/>} label="Region" value="europe-west1"/>);
        expect(screen.queryByRole("button")).toBeNull();
    });
});

describe("TimeBars", () => {
    const at = (m: number) => new Date(Date.UTC(2026, 10, 18, 10, m));
    const buckets = [
        { start: at(0), end: at(1), value: 10, secondary: 2 },
        { start: at(1), end: at(2), value: null },
        { start: at(2), end: at(3), value: 0 }
    ];

    it("is one labelled focus stop, not a stop per bar", () => {
        render(<TimeBars buckets={buckets} label="Data: 10 requests" valueLabel="requests" secondaryLabel="errors"/>);
        expect(screen.getByRole("group", { name: "Data: 10 requests" })).toHaveAttribute("tabindex", "0");
        expect(document.querySelectorAll("[tabindex]")).toHaveLength(1);
    });

    it("reads a bucket out on the arrow keys, and says a gap recorded nothing", () => {
        render(<TimeBars buckets={buckets} label="Data" valueLabel="requests" secondaryLabel="errors"/>);
        const chart = screen.getByRole("group", { name: "Data" });
        fireEvent.focus(chart);
        fireEvent.keyDown(chart, { key: "ArrowLeft" });
        expect(screen.getByText("Nothing recorded")).toBeInTheDocument();
        fireEvent.keyDown(chart, { key: "ArrowLeft" });
        expect(screen.getByText("requests")).toBeInTheDocument();
        expect(screen.getByText("errors")).toBeInTheDocument();
    });

    it("takes the gap's words from the nearest labels provider", () => {
        render(
            <UiLabelsProvider labels={{ nothingRecorded: "Niente di registrato", locale: "it" }}>
                <TimeBars buckets={buckets} label="Dati" valueLabel="richieste"/>
            </UiLabelsProvider>
        );
        const chart = screen.getByRole("group", { name: "Dati" });
        fireEvent.focus(chart);
        fireEvent.keyDown(chart, { key: "ArrowLeft" });
        expect(screen.getByText("Niente di registrato")).toBeInTheDocument();
    });

    it("shows the chart status for loading, error and nothing at all", () => {
        const { rerender, container } = render(<TimeBars buckets={[]} label="x" valueLabel="v"/>);
        expect(screen.getByText("No data for this period")).toBeInTheDocument();
        rerender(<TimeBars buckets={buckets} label="x" valueLabel="v" error={new Error("unreachable")}/>);
        expect(screen.getByText("unreachable")).toBeInTheDocument();
        rerender(<TimeBars buckets={buckets} label="x" valueLabel="v" loading/>);
        expect(container.querySelector("[role=group]")).toBeNull();
    });
});

describe("one bar strength across the kit", () => {
    it("draws BarChart's bars at TimeBars' resting strength, full on hover or focus", () => {
        const { container } = render(<BarChart bars={[{ key: "a", label: "A", value: 3 }]}/>);
        const bar = container.querySelector("span.block.h-4");
        expect(bar).toHaveClass("opacity-[0.58]");
        expect(bar).toHaveClass("group-hover:opacity-100");
        expect(bar).toHaveClass("group-focus-visible:opacity-100");
    });
});

describe("ChartCard", () => {
    it("lets its title wrap between words rather than truncate, and the action move to the next line", () => {
        render(<ChartCard title="Functions" action={<span>2 errors</span>}><div/></ChartCard>);
        const title = screen.getByRole("heading", { name: "Functions" });
        expect(title).not.toHaveClass("truncate");
        expect(title).not.toHaveClass("break-words");
        expect(title.parentElement).toHaveClass("flex-wrap");
        expect(screen.getByText("2 errors").parentElement).toHaveClass("ml-auto", "whitespace-nowrap");
    });
});
