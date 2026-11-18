/**
 * The geometry of a `TimeBars` chart, as data.
 *
 * Every rule that decides what a reader sees — how a gap differs from a zero,
 * where the secondary segment sits, where a marker lands — is here, testable
 * without rendering anything. The component only draws what this returns.
 */

/** One bucket of time, already parsed: epoch ms, its value, and the share of it that is secondary. */
export interface BarSlot {
    start: number;
    end: number;
    /** `null` is a gap: nothing was recorded. `0` is a real, quiet bucket. */
    value: number | null;
    /** How much of `value` is the secondary measure (errors of requests). Clamped to `value`. */
    secondary: number;
}

/** The height of the baseline tick a recorded-but-zero bucket draws. */
export const BASELINE_TICK = 1;

/** The gap between two bars, whatever their count. */
export const BAR_GAP = 1;

/** How much a bar's top corners are rounded. */
export const BAR_RADIUS = 1;

export interface BarGeometry {
    index: number;
    x: number;
    width: number;
    /**
     * - `gap`: nothing recorded. Nothing is drawn.
     * - `quiet`: recorded, and zero. A 1px baseline tick.
     * - `bar`: a value, scaled to this chart's own maximum.
     */
    kind: "gap" | "quiet" | "bar";
    /** Top of the bar; the secondary segment sits at the top. */
    y: number;
    height: number;
    /** The secondary segment's height: its share of the bar. */
    secondaryHeight: number;
    slot: BarSlot;
}

export interface MarkerGeometry { x: number; at: number; label: string }

export interface TimeBarsGeometry {
    bars: BarGeometry[];
    markers: MarkerGeometry[];
    /** The largest bucket, which the bars are scaled against. 0 when there were none. */
    max: number;
}

/**
 * Bars for the slots inside a `width` × `height` box.
 *
 * A chart scales to its own maximum, so a quiet chart is not flattened by a
 * busy neighbour. A non-zero bucket is never shorter than the baseline tick,
 * so one request in a busy hour is still visible, and bars keep at least a
 * 1px gap between them at any count.
 */
export function timeBarsGeometry(
    slots: BarSlot[],
    width: number,
    height: number,
    markers: { at: number; label: string }[] = []
): TimeBarsGeometry {
    const n = slots.length;
    const max = Math.max(0, ...slots.map(s => s.value ?? 0));
    const pitch = n > 0 ? width / n : 0;
    const barWidth = Math.max(0.5, pitch - BAR_GAP);

    const bars = slots.map((slot, index): BarGeometry => {
        const x = index * pitch;
        if (slot.value === null) {
            return { index, x, width: barWidth, kind: "gap", y: height, height: 0, secondaryHeight: 0, slot };
        }
        if (slot.value === 0 || max === 0) {
            return { index, x, width: barWidth, kind: "quiet", y: height - BASELINE_TICK, height: BASELINE_TICK, secondaryHeight: 0, slot };
        }
        const h = Math.max(BASELINE_TICK, (slot.value / max) * height);
        const share = Math.min(1, Math.max(0, slot.secondary / slot.value));
        const secondaryHeight = slot.secondary > 0 ? Math.min(h, Math.max(BASELINE_TICK, h * share)) : 0;
        return { index, x, width: barWidth, kind: "bar", y: height - h, height: h, secondaryHeight, slot };
    });

    const start = slots[0]?.start ?? 0;
    const end = slots[n - 1]?.end ?? 0;
    const span = end - start;
    const placed = span > 0
        ? markers
            .filter(m => m.at >= start && m.at < end)
            .map(m => ({ label: m.label, at: m.at, x: ((m.at - start) / span) * width }))
        : [];

    return { bars, markers: placed, max };
}

/**
 * A bar as a path with only its TOP corners rounded, so it stands flat on the
 * baseline. The radius shrinks to fit a bar narrower or shorter than it.
 */
export function barPath(x: number, y: number, width: number, height: number, radius = BAR_RADIUS): string {
    if (width <= 0 || height <= 0) return "";
    const r = Math.max(0, Math.min(radius, width / 2, height));
    const bottom = y + height;
    return `M ${x} ${bottom} V ${y + r} Q ${x} ${y} ${x + r} ${y} H ${x + width - r} Q ${x + width} ${y} ${x + width} ${y + r} V ${bottom} Z`;
}

/** The bar under a pointer at `x`, clamped to the chart; -1 when there is none. */
export function barIndexAt(x: number, width: number, count: number): number {
    if (count <= 0 || width <= 0) return -1;
    return Math.min(count - 1, Math.max(0, Math.floor((x / width) * count)));
}

/** A marker within `tolerance` px of `x`, the nearest one, or null. */
export function markerAt(x: number, markers: MarkerGeometry[], tolerance = 3): MarkerGeometry | null {
    let best: MarkerGeometry | null = null;
    for (const m of markers) {
        const d = Math.abs(m.x - x);
        if (d <= tolerance && (!best || d < Math.abs(best.x - x))) best = m;
    }
    return best;
}
