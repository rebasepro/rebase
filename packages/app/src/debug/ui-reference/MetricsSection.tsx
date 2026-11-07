/**
 * The metric blocks: KPI tiles, the one-line readout, the change arrow, and
 * the two charts on their card, each in the states a dashboard passes through
 * — loading, failed, empty and loaded.
 *
 * The blocks size themselves by their own width, never the window's: drag the
 * window narrow and the grid steps from four tiles across to two.
 */
import React, { useState } from "react";
import {
    BarChart,
    ChartCard,
    ChartStatus,
    KpiChange,
    KpiGrid,
    KpiReadout,
    KpiTile,
    Placeholder,
    TimeSeriesChart,
    type Bar,
    type TimeSeries,
    Typography
} from "@rebasepro/ui";
import { SectionBlock, SpecimenLabel } from "./SectionBlock";

const USD: Intl.NumberFormatOptions = { style: "currency", currency: "USD", maximumFractionDigits: 0 };

/** Thirty days of a steady figure with a weekly swing, starting 2026-10-08. */
function days(base: number, swing: number, seed: number): TimeSeries["points"] {
    return Array.from({ length: 30 }, (_, i) => {
        const day = new Date(Date.UTC(2026, 9, 8 + i)).toISOString().slice(0, 10);
        const value = Math.round(base + swing * Math.sin((i + seed) / 1.2) + i * base * 0.01);
        return { at: day, value };
    });
}

const REVENUE: TimeSeries[] = [{ id: "revenue", label: "Revenue", points: days(4200, 900, 0) }];
const CHANNELS: TimeSeries[] = [
    { id: "web", label: "Web", points: days(2600, 500, 0) },
    { id: "store", label: "Store", points: days(1400, 300, 2) },
    { id: "partners", label: "Partners", points: days(600, 200, 4) }
];
const STATUSES: Bar[] = [
    { key: "pending", label: "Pending", value: 48 },
    { key: "confirmed", label: "Confirmed", value: 131 },
    { key: "shipped", label: "Shipped", value: 212 },
    { key: "cancelled", label: "Cancelled", value: 9 }
];

export function MetricsSection() {
    const [opened, setOpened] = useState<string | null>(null);
    return (
        <SectionBlock id="metrics" title="Metrics and charts">
            <Typography variant="body2" color="secondary" className="mb-6 max-w-[68ch]">
                A KPI is a tile: the card header grammar — icon, micro label — one figure in the stat tier, and its
                change on the previous window as an arrow coloured by whether it is good news. A grid names the window
                once, above the tiles. Charts are SVG on a card: one axis from zero, the primary for a single series,
                a legend from two, a hover and arrow-key readout. Numbers are written in the admin language.
            </Typography>

            <SpecimenLabel>KpiGrid · KpiTile — loaded, falling where down is good, loading, failed</SpecimenLabel>
            <KpiGrid periodDays={30} className="mb-8">
                <KpiTile label="Revenue" icon="DollarSign" value={128_400} previous={114_900} format={USD}/>
                <KpiTile label="Refunds" icon="Undo2" value={12} previous={19} goodWhen="down" show="absolute"/>
                <KpiTile label="Orders" icon="ShoppingCart" value={undefined} previous={undefined} loading/>
                <KpiTile label="Open tickets" icon="LifeBuoy" value={undefined} error={new Error("The insights function returned 500")}/>
            </KpiGrid>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div>
                    <SpecimenLabel>KpiReadout · one line, for a home-page card</SpecimenLabel>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <KpiReadout label="Shipped" value={212} previous={180}/>
                        <KpiReadout label="Revenue" value={30_600} previous={30_620} format={{ ...USD, notation: "compact" }}/>
                        <KpiReadout label="Late" value={undefined} loading/>
                    </div>
                </div>
                <div>
                    <SpecimenLabel>KpiChange · Placeholder</SpecimenLabel>
                    <div className="flex flex-wrap items-center gap-4">
                        <KpiChange value={71} previous={50}/>
                        <KpiChange value={10} previous={6} goodWhen="down" show="absolute"/>
                        <KpiChange value={5} previous={5}/>
                        <Placeholder className="h-3 w-12"/>
                    </div>
                </div>
            </div>

            <SpecimenLabel>ChartCard · TimeSeriesChart — one series as an area, several as lines</SpecimenLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <ChartCard title="Revenue per day" icon="ChartArea" headline="$128,400">
                    <TimeSeriesChart series={REVENUE} format={USD}/>
                </ChartCard>
                <ChartCard title="Revenue by channel" icon="ChartLine">
                    <TimeSeriesChart series={CHANNELS} variant="line" format={USD}/>
                </ChartCard>
            </div>

            <SpecimenLabel>ChartCard · BarChart — each bar a button that opens what it counts</SpecimenLabel>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-8">
                <ChartCard title="Orders by status" icon="ChartBar" action={opened && <Typography variant="caption" color="secondary">opened {opened}</Typography>}>
                    <BarChart bars={STATUSES} onBarClick={(bar) => setOpened(bar.label)}/>
                </ChartCard>
                <ChartCard title="Top products" icon="Package">
                    <BarChart bars={[]}/>
                </ChartCard>
            </div>

            <SpecimenLabel>ChartStatus · loading, empty, failed</SpecimenLabel>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <ChartStatus height={96} loading/>
                <ChartStatus height={96} empty/>
                <ChartStatus height={96} error={new Error("Could not reach the insights function")}/>
            </div>
        </SectionBlock>
    );
}
