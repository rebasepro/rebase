/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { StatTile, StatusDot, TimeBars, UiLabelsProvider } from "../src";

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
