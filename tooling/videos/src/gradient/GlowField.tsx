import React from "react";
import { AbsoluteFill, useVideoConfig } from "remotion";
import { NeatCanvas } from "./NeatCanvas";
import { GLOW_CONFIG, GLOW_TRAVEL } from "../data/neat-config";
import { GROUND } from "../theme";

/**
 * The drafted instrument's backdrop, as the site draws it (HeroBackdrop.astro):
 * the smooth `glow` field masked into the ground, under a faint square grid
 * set on hairline rails.
 *
 *   GlowField     NeatBackground's `glow` variant — the real @firecms/neat
 *                 running GLOW_CONFIG — at full strength across the top of the
 *                 frame and gone into the ground by three quarters of the way
 *                 down (`.hero-glow` in global.css).
 *   DraftingGrid  `.hero-drafting`: 1px lines at white/0.045 on a twelve-column
 *                 module, anchored on the left rail, fading out down the frame;
 *                 and the rails themselves (`.drafted::before`), two 1px
 *                 verticals at white/0.07, full height.
 *
 * Nothing else. No ticks, no corner marks, no curves: the site draws a tick
 * only where two lines cross, and in a hero it draws none (the chapter rule's
 * hairline is hidden there, so there is no crossing to mark).
 */

/** `.hero-glow`: solid to 30%, gone by 78%. The film frame is the hero. */
export const GLOW_MASK = "linear-gradient(to bottom, #000 0%, #000 30%, transparent 78%)";

/** `.hero-drafting`: visible cleanly through the upper and middle stage,
 *  softening near the foot so the drafted grid stays subtle and never busy. */
export const GRID_MASK = "linear-gradient(to bottom, #000 0%, #000 60%, rgba(0,0,0,0.32) 100%)";

/**
 * A film's scene-to-scene turn, as a seat on the glow.
 *
 * The films were cut against the ribbon, and each scene names a ROLL — how far
 * the ribbon turns while it is up. The glow has a fixed camera and nothing to
 * turn; the site moves it between pages by `yOffset` instead (GlowPose in
 * NeatBackground.tsx), up to GLOW_TRAVEL either side. So a roll is read as a
 * seat along that travel: the same keyframes, the same easing, the same
 * windows — the field flows to the next scene's light exactly where the ribbon
 * used to turn. The rolls the films use (0.1-0.82) span most of one travel.
 */
export function seatForRoll(roll: number): number {
    return roll * GLOW_TRAVEL;
}

/**
 * How far the films' camera is zoomed into the field. At the site's 1 the
 * patches of colour behind a presenter read as busy at 1920 wide; zooming in
 * magnifies the same waves into larger fields of colour without changing
 * their shape, and can never bring the plane's edge into frame. Compared at
 * 1, 1.7 and 2.4 on 2026-11-10 ("i need bigger color patches"); 1.8 went
 * into the site's GLOW_CONFIG, so the hero and the films share it.
 */
export const GLOW_FILM_ZOOM = GLOW_CONFIG.cameraZoom;

export const GlowField: React.FC<{
    /** The ground under the field: where the mask fades, this is what shows. */
    ground: string;
    /** The field's opacity over the ground, 0-1. */
    reveal?: number;
    /** Where along the field's travel the frame sits (Neat's yOffset). */
    seat?: number;
    /** Seconds on the field's clock. A pure function of the frame. */
    time: number;
    /** Overrides GLOW_MASK. */
    mask?: string;
}> = ({ ground, reveal = 1, seat = 0, time, mask = GLOW_MASK }) => (
    <>
        <AbsoluteFill style={{ background: ground }} />
        {reveal > 0 && (
            <NeatCanvas
                variant="glow"
                opacity={reveal}
                camera={{ yOffset: seat, cameraZoom: GLOW_FILM_ZOOM }}
                time={time}
                /* Smooth shading has no silhouettes to alias, and the site
                   draws this field at one buffer pixel per CSS pixel — which
                   is also the scale its grain is designed at. */
                supersample={1}
                style={{ WebkitMaskImage: mask, maskImage: mask }}
            />
        )}
    </>
);

/** Whether a ground (hex or `rgb(r, g, b)`) is a chroma field rather than
 *  the near-black base — the rails strengthen there, as the site's do on
 *  `.ground-claim`: white/0.07 is gone on blue. Mid-cross-fade counts once it
 *  is visibly on its way. */
export function isChromaGround(color: string): boolean {
    const channels = (c: string) =>
        c.startsWith("#") ? [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)) : (c.match(/\d+/g) ?? []).slice(0, 3).map(Number);
    const [r, g, b] = channels(color);
    const [r0, g0, b0] = channels(GROUND.base);
    return Math.abs(r - r0) + Math.abs(g - g0) + Math.abs(b - b0) > 60;
}

/** Rail inset for a frame: a twentieth of the width, so the twelve-column
 *  module is 144px at 1920 wide and 81px at 1080 (a vertical cut). Content set
 *  at the films' usual 120 / 72 margins sits just inside the rail, the way
 *  the site's copy sits inside the shell's padding. */
export function railInset(width: number): number {
    return Math.round(width / 20);
}

export const DraftingGrid: React.FC<{
    /** Left rail's x; the right rail mirrors it. Defaults to railInset(width). */
    inset?: number;
    columns?: number;
    /** White, or a chroma field's stronger rail (the site's `.ground-claim`
     *  takes white/0.14 for its rails). */
    chroma?: boolean;
    opacity?: number;
    rails?: boolean;
    mask?: string;
}> = ({ inset, columns = 12, chroma = false, opacity = 1, rails = true, mask = GRID_MASK }) => {
    const { width } = useVideoConfig();
    const left = inset ?? railInset(width);
    const cell = (width - 2 * left) / columns;
    const line = chroma ? "rgba(255,255,255,0.065)" : "rgba(255,255,255,0.042)";
    const rail = chroma ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.085)";
    if (opacity <= 0) return null;
    return (
        <AbsoluteFill style={{ opacity, pointerEvents: "none" }}>
            <AbsoluteFill
                style={{
                    backgroundImage: `linear-gradient(${line} 1px, transparent 1px), linear-gradient(90deg, ${line} 1px, transparent 1px)`,
                    backgroundSize: `${cell}px ${cell}px`,
                    backgroundPosition: `${left}px 0`,
                    WebkitMaskImage: mask,
                    maskImage: mask,
                }}
            />
            {rails && (
                <>
                    <div style={{ position: "absolute", top: 0, bottom: 0, left, width: 1, background: rail }} />
                    {/* On the grid's thirteenth line, as the site's right rail
                        lands on the shell's edge rather than a pixel inside it. */}
                    <div style={{ position: "absolute", top: 0, bottom: 0, left: width - left, width: 1, background: rail }} />
                </>
            )}
        </AbsoluteFill>
    );
};

/** The 7px hollow outline diamond from `website/src/styles/global.css` (`--tick`),
 *  placed strictly where a horizontal rule intersects a vertical rail. */
export const RailTick: React.FC<{ x: number; y: number; chroma?: boolean; size?: number }> = ({ x, y, chroma = false, size = 9 }) => {
    const half = size / 2;
    return (
        <svg
            width={size}
            height={size}
            viewBox="0 0 7 7"
            style={{
                position: "absolute",
                left: x - half + 0.5,
                top: y - half + 0.5,
                pointerEvents: "none",
                overflow: "visible",
            }}
        >
            <path d="M3.5 .6 6.4 3.5 3.5 6.4 .6 3.5Z" fill={GROUND.base} fillOpacity={chroma ? 0 : 0.9} stroke="#ffffff" strokeOpacity={chroma ? 0.48 : 0.34} strokeWidth="0.95" />
        </svg>
    );
};

/** A horizontal chapter hairline spanning rail-to-rail, with a hollow diamond
 *  tick centred on each rail intersection — the site's `.chapter-rule`. */
export const RailRule: React.FC<{ y: number; chroma?: boolean; opacity?: number; inset?: number }> = ({ y, chroma = false, opacity = 1, inset }) => {
    const { width } = useVideoConfig();
    if (opacity <= 0) return null;
    const left = inset ?? railInset(width);
    const right = width - left;
    const line = chroma ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.085)";
    return (
        <div style={{ position: "absolute", inset: 0, opacity, pointerEvents: "none" }}>
            <div style={{ position: "absolute", top: y, left, width: right - left, height: 1, background: line }} />
            <RailTick x={left} y={y} chroma={chroma} />
            <RailTick x={right} y={y} chroma={chroma} />
        </div>
    );
};
