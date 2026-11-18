import { barIndexAt, barPath, markerAt, timeBarsGeometry, BAR_GAP, BASELINE_TICK, type BarSlot } from "../src/components/metrics/time_bars_geometry";

/** Moved from the console's activity chart, where these rules were first written. */
const slot = (i: number, value: number | null, secondary = 0): BarSlot => ({
    start: i * 60_000, end: (i + 1) * 60_000, value, secondary
});

describe("TimeBars geometry — scaling", () => {
    it("scales every bar to this chart's own maximum", () => {
        const g = timeBarsGeometry([slot(0, 10), slot(1, 5), slot(2, 2)], 300, 56);
        expect(g.max).toBe(10);
        expect(g.bars[0]).toMatchObject({ kind: "bar", height: 56, y: 0 });
        expect(g.bars[1].height).toBeCloseTo(28, 5);
    });

    it("never draws a non-zero bucket shorter than the baseline tick", () => {
        const g = timeBarsGeometry([slot(0, 10_000), slot(1, 1)], 100, 56);
        expect(g.bars[1].height).toBe(BASELINE_TICK);
    });

    it("keeps at least a 1px gap between bars at any count", () => {
        for (const [n, width] of [[60, 150], [48, 150], [56, 150], [60, 600]]) {
            const g = timeBarsGeometry(Array.from({ length: n }, (_, i) => slot(i, 5)), width, 56);
            expect(g.bars[1].x - (g.bars[0].x + g.bars[0].width)).toBeGreaterThanOrEqual(BAR_GAP - 1e-9);
        }
    });
});

describe("TimeBars geometry — gaps are not zeros", () => {
    it("draws nothing for a gap and a baseline tick for a recorded zero", () => {
        const g = timeBarsGeometry([slot(0, null), slot(1, 0), slot(2, 4)], 90, 56);
        expect(g.bars[0]).toMatchObject({ kind: "gap", height: 0 });
        expect(g.bars[1]).toMatchObject({ kind: "quiet", height: BASELINE_TICK, y: 56 - BASELINE_TICK });
        expect(g.bars[2].kind).toBe("bar");
    });

    it("draws an all-zero chart as ticks, not full-height bars", () => {
        const g = timeBarsGeometry([slot(0, 0), slot(1, 0)], 100, 56);
        expect(g.bars.every(b => b.kind === "quiet")).toBe(true);
    });
});

describe("TimeBars geometry — the secondary segment", () => {
    it("is the secondary share of the bar, at its top", () => {
        expect(timeBarsGeometry([slot(0, 10, 5)], 100, 40).bars[0]).toMatchObject({ y: 0, height: 40, secondaryHeight: 20 });
    });

    it("keeps one error visible on a tall bar, and is absent with none", () => {
        expect(timeBarsGeometry([slot(0, 10_000, 1)], 100, 56).bars[0].secondaryHeight).toBe(BASELINE_TICK);
        expect(timeBarsGeometry([slot(0, 8, 0)], 100, 56).bars[0].secondaryHeight).toBe(0);
    });
});

describe("TimeBars geometry — markers and pointers", () => {
    it("lands a marker at its time across the window, and drops one outside it", () => {
        const g = timeBarsGeometry([slot(0, 1), slot(1, 1), slot(2, 1), slot(3, 1)], 400, 56,
            [{ at: 120_000, label: "Deployed" }, { at: 600_000, label: "late" }]);
        expect(g.markers).toEqual([{ label: "Deployed", at: 120_000, x: 200 }]);
    });

    it("finds the marker under the pointer within a few pixels", () => {
        const markers = [{ label: "a", at: 0, x: 100 }, { label: "b", at: 1, x: 140 }];
        expect(markerAt(102, markers)?.label).toBe("a");
        expect(markerAt(120, markers)).toBeNull();
    });

    it("maps a pointer to the bar under it, clamped", () => {
        expect(barIndexAt(305, 600, 60)).toBe(30);
        expect(barIndexAt(9999, 600, 60)).toBe(59);
        expect(barIndexAt(10, 0, 60)).toBe(-1);
    });

    it("rounds only the top corners, and shrinks the radius to fit", () => {
        expect(barPath(10, 20, 4, 30).startsWith("M 10 50 V 21 Q 10 20 11 20")).toBe(true);
        expect(barPath(0, 0, 1, 1)).toBe("M 0 1 V 0.5 Q 0 0 0.5 0 H 0.5 Q 1 0 1 0.5 V 1 Z");
        expect(barPath(0, 0, 0, 10)).toBe("");
    });
});
