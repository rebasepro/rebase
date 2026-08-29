import React, { useMemo } from "react";
import { useCurrentFrame, useVideoConfig } from "remotion";
import { LOGO_FACETS, LOGO_VIEW_BOX } from "../data/logo";
import { ramp, SPRING, pop } from "./motion";

/**
 * The Rebase mark, assembling one facet at a time.
 *
 * The mark is 64 flat fills that already look like a solid being viewed from
 * an angle, so the natural way in is to let it BUILD — each facet springing up
 * from its own centre, in a wave that crosses the cube. Nothing here invents
 * geometry: `src/data/logo.ts` is generated straight from the canonical SVG,
 * offset viewBox and all.
 */

/** The sweep direction, in viewBox space: up and to the right. */
const SWEEP = { x: 0.72, y: -0.69 };

export const Mark: React.FC<{
    size: number;
    /** Frame at which the first facet starts. */
    delay?: number;
    /** How long the wave takes to cross the whole mark, in frames. */
    spread?: number;
    /** 1 = assemble; pass a static 1 to skip the animation entirely. */
    animate?: boolean;
    style?: React.CSSProperties;
}> = ({ size, delay = 0, spread = 26, animate = true, style }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();

    // Project every facet centre onto the sweep axis and normalise, so the
    // order is spatial rather than whatever order the file happens to list.
    const ordered = useMemo(() => {
        const proj = LOGO_FACETS.map((f) => f.cx * SWEEP.x + f.cy * SWEEP.y);
        const lo = Math.min(...proj);
        const hi = Math.max(...proj);
        const span = hi - lo || 1;
        return LOGO_FACETS.map((f, i) => ({ facet: f, t: (proj[i] - lo) / span }));
    }, []);

    return (
        <svg
            width={size}
            height={size}
            viewBox={LOGO_VIEW_BOX}
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            style={style}
        >
            {ordered.map(({ facet, t }, i) => {
                const at = delay + t * spread;
                const p = animate ? pop(frame, fps, at, SPRING.pop) : 1;
                if (p <= 0) return null;

                // Scaling about the facet's own centre, so it grows in place
                // instead of sliding in from the origin of the viewBox.
                const s = 0.55 + 0.45 * p;
                return (
                    <g
                        key={i}
                        transform={`translate(${facet.cx} ${facet.cy}) scale(${s}) translate(${-facet.cx} ${-facet.cy})`}
                        opacity={Math.min(1, p * 1.4) * (facet.opacity ?? 1)}
                    >
                        <path d={facet.d} fill={facet.fill} />
                    </g>
                );
            })}
        </svg>
    );
};

/** Mark plus wordmark, locked up the way the site header has it. */
export const Lockup: React.FC<{
    size?: number;
    delay?: number;
    gap?: number;
    wordSize?: number;
}> = ({ size = 96, delay = 0, gap = 22, wordSize = 60 }) => {
    const frame = useCurrentFrame();
    const t = ramp(frame, delay + 20, 24);

    return (
        <div style={{ display: "flex", alignItems: "center", gap }}>
            <Mark size={size} delay={delay} />
            <div style={{ overflow: "hidden", paddingBottom: "0.1em", marginBottom: "-0.1em" }}>
                <div
                    style={{
                        fontFamily: "'Instrument Sans', sans-serif",
                        fontWeight: 600,
                        fontSize: wordSize,
                        letterSpacing: "-0.028em",
                        color: "#F7F8F8",
                        transform: `translateY(${(1 - t) * 105}%)`,
                    }}
                >
                    Rebase
                </div>
            </div>
        </div>
    );
};
