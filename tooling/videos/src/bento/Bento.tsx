import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../components/motion";
import { GROUND, INK } from "../theme";

/**
 * The bento: seven live views of the product in one rectangle.
 *
 * It exists twice — as its own composition (`Bento`, 14s, full frame) and as a
 * beat in the film (see S07b_Everything), which is why the grid is a function
 * of a box rather than seven hard-coded rectangles. Both use the same clips.
 *
 * The layout PARTITIONS its box exactly, so the block has a straight edge on
 * all four sides; an earlier cut scattered tiles around a large centre one and
 * left ragged gaps, which reads as a collage. Column one is three equal rows,
 * the other two are one tall tile and one short, mirrored — regular at the
 * edges, irregular inside.
 *
 * Every tile does something DIFFERENT, and that is the point: search, filter a
 * table, switch a view from cards to a table, read a form and its relations,
 * drag a card between board columns, select rows, and open a record out of a
 * list. Seven tiles all scrolling read as one view scrolled seven times.
 *
 * Scaling the box uniformly keeps every tile's aspect ratio, which matters:
 * each clip is captured at the viewport that matches its tile, so `cover`
 * crops nothing.
 */

export const BENTO_DURATION = 420;

/** Slightly under real time — seven tiles is a lot to take in at once, and it
 *  buys headroom against the clip lengths. */
const RATE = 0.8;

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
    gap: number;
}

/** The whole frame, for the standalone composition. */
export const FULL: Box = { x: 80, y: 80, w: 1760, h: 920, gap: 16 };

/** How much of the box's height the tall tiles take. */
const TALL_FRAC = 604 / 920;

/** Seven rectangles that exactly fill the box, in tile order. */
export function bentoRects({ x, y, w, h, gap }: Box) {
    const col = Math.round((w - 2 * gap) / 3);
    const third = Math.round((h - 2 * gap) / 3);
    const tall = Math.round(h * TALL_FRAC);
    const short = h - tall - gap;
    const cx = [x, x + col + gap, x + 2 * (col + gap)];
    return [
        { x: cx[0], y, w: col, h: third },
        { x: cx[0], y: y + third + gap, w: col, h: third },
        { x: cx[0], y: y + 2 * (third + gap), w: col, h: h - 2 * (third + gap) },
        { x: cx[1], y, w: col, h: tall },
        { x: cx[1], y: y + tall + gap, w: col, h: short },
        { x: cx[2], y, w: col, h: short },
        { x: cx[2], y: y + short + gap, w: col, h: tall },
    ];
}

interface Tile {
    file: string;
    /** Which edge it arrives from. The middle column rises instead. */
    from: "left" | "right" | "up";
    delay: number;
    /** Source frame to start on, so no two tiles are in step, and so each
     *  tile's window CONTAINS its action. */
    at: number;
    /** Frames the clip actually has — `startAt` clamps against it, because a
     *  video asked for a frame past its end holds its LAST one and the tile
     *  would sit frozen while everything around it kept moving. */
    length: number;
    /** Where to start when the tile only gets the FILM's eight seconds rather
     *  than the standalone's fourteen. One offset cannot serve both: several
     *  of these clips hold deliberately still for five seconds so a filtered
     *  result or an open record can be read, and a hold that is a third of the
     *  long window is two thirds of the short one. Measured per clip; two
     *  tiles were frozen for the whole tail of the film's bento before this
     *  existed. */
    atShort: number;
}

/** In slot order: three down the left, tall-then-short, short-then-tall. */
export const TILES: Tile[] = [
    { file: "customers", from: "left", delay: 14, at: 20, length: 396, atShort: 183 },
    { file: "exercises", from: "left", delay: 20, at: 80, length: 462, atShort: 20 },
    { file: "posts", from: "left", delay: 26, at: 80, length: 572, atShort: 222 },
    /* Starts ON THE FORM, not on the grid. This clip opens on the products
       grid because that is where the click comes from, and the middle tile
       was spending its first third showing cards — in the one box that
       exists to show a record. The cards have their own box now. */
    { file: "record", from: "up", delay: 0, at: 204, length: 594, atShort: 100 },
    { file: "tickets", from: "up", delay: 8, at: 30, length: 480, atShort: 42 },
    { file: "cards", from: "right", delay: 18, at: 40, length: 495, atShort: 153 },
    { file: "expand", from: "right", delay: 24, at: 30, length: 455, atShort: 258 },
];

const ENTRY = 32;

const Cell: React.FC<{
    tile: Tile;
    rect: { x: number; y: number; w: number; h: number };
    travel: number;
    lift: number;
    duration: number;
    hold: number;
}> = ({ tile, rect, travel, lift, duration, hold }) => {
    const frame = useCurrentFrame();
    const t = ramp(frame, tile.delay, ENTRY, ENTER);
    const away = 1 - t;

    const dx = tile.from === "left" ? -travel * away : tile.from === "right" ? travel * away : 0;
    const dy = tile.from === "up" ? lift * away : 0;
    const want = duration <= 300 ? tile.atShort : tile.at;
    const startAt = Math.min(want, Math.max(0, tile.length - duration * RATE - 6));

    return (
        <div
            style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                borderRadius: 16,
                border: `1px solid ${INK.rule}`,
                background: "#000",
                overflow: "hidden",
                opacity: Math.min(1, t * 1.6),
                // No shadow: seven of them across a grid this tight muddies the
                // gutters instead of lifting the tiles off the ground.
                ...(t < 1 ? { transform: `translate(${dx}px, ${dy}px)` } : {}),
            }}
        >
            {/* Own clock per tile. An OffthreadVideo with no Sequence plays
                against the COMPOSITION's frame, so `at` would count from the
                wrong zero — see the note in S06_Panel. */}
            <Sequence from={0} durationInFrames={duration + hold} layout="none">
                <OffthreadVideo
                    src={staticFile(`demo/bento/b_${tile.file}.mp4`)}
                    startFrom={startAt}
                    muted
                    playbackRate={RATE}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
            </Sequence>
        </div>
    );
};

export const BentoTiles: React.FC<{
    box?: Box;
    /** The window the tiles are composed for — it picks each clip's offset,
     *  so the action lands inside it. */
    duration?: number;
    /** Frames the clips stay mounted PAST that window. The desk keeps every
     *  tile on screen for the pull-back at the end; a clip past its own
     *  length holds its last frame, which is what a mosaic wants. */
    hold?: number;
    /** How far a tile starts from its resting place. The film scene arrives
     *  with a push of its own, so it asks for much less than the standalone. */
    travel?: number;
    lift?: number;
}> = ({ box = FULL, duration = BENTO_DURATION, hold = 0, travel = 240, lift = 44 }) => {
    const rects = bentoRects(box);
    return (
        <>
            {TILES.map((tile, i) => (
                <Cell
                    key={tile.file}
                    tile={tile}
                    rect={rects[i]}
                    travel={travel}
                    lift={lift}
                    duration={duration}
                    hold={hold}
                />
            ))}
        </>
    );
};

export const Bento: React.FC = () => (
    <AbsoluteFill style={{ width: 1920, height: 1080, background: GROUND.base }}>
        <BentoTiles />
    </AbsoluteFill>
);
