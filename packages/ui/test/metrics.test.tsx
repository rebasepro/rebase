/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { BarChart, ChartStatus, KpiChange, KpiGrid, KpiTile, TimeSeriesChart, UiLabelsProvider } from "../src";
import type { TimeSeries } from "../src";

global.ResizeObserver = class {
    observe() { /* noop */ }
    unobserve() { /* noop */ }
    disconnect() { /* noop */ }
};

/**
 * The metric blocks take their words and their number language from the kit's
 * labels, not from an i18n library: the kit cannot import the admin's. Without
 * a provider they speak English; `@rebasepro/app` mounts one in the admin
 * language.
 */
const italian = {
    changeUp: (change: string) => `Su del ${change}`,
    changeDown: (change: string) => `Giù del ${change}`,
    noChange: "Nessuna variazione",
    previousPeriodValue: (days: number, value: string) => `${days} giorni precedenti: ${value}`,
    lastDays: (days: number) => `Ultimi ${days} giorni`,
    noData: "Nessun dato per questo periodo",
    date: "data",
    locale: "it"
};

describe("KpiTile", () => {
    it("writes the figure and its change in English without a provider", () => {
        render(<KpiTile label="Revenue" value={1234.5} previous={1000} format={{ maximumFractionDigits: 1 }}/>);
        expect(screen.getByText("1,234.5")).toBeInTheDocument();
        expect(screen.getByText("Up 23%. Previous 30 days: 1,000")).toBeInTheDocument();
    });

    it("writes them in the provider's language", () => {
        render(<UiLabelsProvider labels={italian}>
            <KpiTile label="Fatturato" value={1234.5} previous={1000} periodDays={7} format={{ maximumFractionDigits: 1 }}/>
        </UiLabelsProvider>);
        expect(screen.getByText("1234,5")).toBeInTheDocument();
        expect(screen.getByText("Su del 23%. 7 giorni precedenti: 1000")).toBeInTheDocument();
    });

    it("shows the error instead of the change", () => {
        render(<KpiTile label="Orders" value={undefined} previous={3} error={new Error("boom")}/>);
        expect(screen.getByText("boom")).toBeInTheDocument();
        expect(screen.getByText("—")).toBeInTheDocument();
    });
});

describe("KpiChange", () => {
    it("is nothing without two numbers to compare", () => {
        const { container } = render(<KpiChange value={5} previous={null}/>);
        expect(container).toBeEmptyDOMElement();
    });

    it("says when nothing moved", () => {
        render(<KpiChange value={5} previous={5} tooltip={false}/>);
        expect(screen.getByText(/^No change\./)).toBeInTheDocument();
    });
});

describe("KpiGrid", () => {
    it("names the window once, from the labels", () => {
        render(<UiLabelsProvider labels={italian}><KpiGrid periodDays={30}><div/></KpiGrid></UiLabelsProvider>);
        expect(screen.getByRole("heading", { name: "Ultimi 30 giorni" })).toBeInTheDocument();
    });

    // A grid inside a split panel or a 700px frame must not take four columns
    // because the window is wide: its columns follow its own width.
    it("lays out by its own width, not the window's", () => {
        const { container } = render(<KpiGrid><div/></KpiGrid>);
        const section = container.querySelector("section")!;
        expect(section).toHaveClass("@container");
        const grid = section.querySelector(".grid")!;
        expect(grid.className).not.toMatch(/(^|\s)(sm|md|lg|xl):/);
        expect(grid.className).toMatch(/@[a-z0-9]+:grid-cols-4/);
    });
});

describe("charts", () => {
    it("say there is no data in the provider's words", () => {
        render(<UiLabelsProvider labels={italian}><ChartStatus height={40} empty/></UiLabelsProvider>);
        expect(screen.getByText("Nessun dato per questo periodo")).toBeInTheDocument();
    });

    it("give screen readers the series as a table headed by the date label", () => {
        render(<UiLabelsProvider labels={italian}>
            <TimeSeriesChart series={[{ id: "r", label: "Fatturato", points: [{ at: "2026-11-06", value: 1200.5 }, { at: "2026-11-07", value: 900 }] }]}/>
        </UiLabelsProvider>);
        expect(screen.getByRole("columnheader", { name: "data" })).toBeInTheDocument();
        expect(screen.getByRole("columnheader", { name: "Fatturato" })).toBeInTheDocument();
        expect(screen.getByRole("cell", { name: "1200,5" })).toBeInTheDocument();
    });

    // Rows straight from an API: one point has no value at all, one a value
    // that is not a number. Only `null` used to be a gap, so these reached the
    // y scale as NaN and `niceTicks` never returned — the tab froze.
    it("draw a point whose value is missing or not a number as a gap", () => {
        const series: TimeSeries[] = JSON.parse(JSON.stringify([{
            id: "r",
            label: "Revenue",
            points: [
                { at: "2026-11-05", value: 10 },
                { at: "2026-11-06" },
                { at: "2026-11-07", value: "n/a" },
                { at: "2026-11-08", value: 30 }
            ]
        }]));
        render(<TimeSeriesChart series={series}/>);
        expect(screen.getByRole("cell", { name: "10" })).toBeInTheDocument();
        expect(screen.getByRole("cell", { name: "30" })).toBeInTheDocument();
        expect(screen.getAllByRole("cell", { name: "—" })).toHaveLength(2);
        expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    });

    it("make each bar a button when given onBarClick", () => {
        const onBarClick = jest.fn();
        render(<BarChart bars={[{ key: "open", label: "Open", value: 3 }, { key: "closed", label: "Closed", value: 7 }]} onBarClick={onBarClick}/>);
        fireEvent.click(screen.getByRole("button", { name: /Closed/ }));
        expect(onBarClick).toHaveBeenCalledWith({ key: "closed", label: "Closed", value: 7 });
    });

    it("make a bar with an href a link, which a plain click hands to onBarClick and a modified click leaves to the browser", () => {
        const onBarClick = jest.fn();
        render(<BarChart bars={[{ key: "open", label: "Open", value: 3, href: "/orders?status=open" }]} onBarClick={onBarClick}/>);
        const link = screen.getByRole("link", { name: /Open/ });
        expect(link.getAttribute("href")).toBe("/orders?status=open");
        fireEvent.click(link, { metaKey: true });
        expect(onBarClick).not.toHaveBeenCalled();
        fireEvent.click(link);
        expect(onBarClick).toHaveBeenCalledTimes(1);
    });
});
