import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame } from "remotion";
import { ENTER, ramp } from "../components/motion";
import { GROUND, INK } from "../theme";

/**
 * The bento. Its own composition, not a beat in the film.
 *
 * A RECTANGLE: three columns of differing heights that partition 1760x920
 * exactly, so the block has a straight edge on all four sides. An earlier cut
 * scattered tiles around a large centre one and left ragged gaps top and
 * bottom, which reads as a collage rather than a bento.
 *
 * No gradient behind it and no drift on the tiles. The clips are the only
 * moving thing, which is the whole idea — seven views of the product, live.
 * (Per-tile drift was tried and had to go: any wobble breaks the 16px gutters
 * that make the grid read as a grid.)
 */

const W = 1920;
const H = 1080;
export const BENTO_DURATION = 420;

/** Slightly under real time — seven tiles is a lot to take in at once, and it
 *  buys headroom against the clip lengths. */
const RATE = 0.85;

interface Tile {
    file: string;
    x: number;
    y: number;
    w: number;
    h: number;
    /** Which edge it arrives from. The middle column rises instead. */
    from: "left" | "right" | "up";
    delay: number;
    /** Source frame to start on, so no two tiles are in step. */
    at: number;
    /** Frames the clip actually has — `startAt` clamps against it, because a
     *  video asked for a frame past its end holds its LAST one and the tile
     *  would sit frozen while everything around it kept moving. */
    length: number;
}

/* The grid: x 80..1840, y 80..1000, 16px gutters. Column one is three equal
   rows; the other two are one tall tile and one short, mirrored, so the block
   is regular at its edges and irregular inside. Every tile's aspect ratio is
   matched by the viewport its clip was captured at — see render-demo.mjs. */
const TILES: Tile[] = [
    { file: "customers", x: 80, y: 80, w: 576, h: 296, from: "left", delay: 14, at: 30, length: 477 },
    { file: "exercises", x: 80, y: 392, w: 576, h: 296, from: "left", delay: 20, at: 70, length: 477 },
    { file: "users", x: 80, y: 704, w: 576, h: 296, from: "left", delay: 26, at: 50, length: 477 },

    { file: "tickets", x: 672, y: 80, w: 576, h: 604, from: "up", delay: 0, at: 40, length: 477 },
    { file: "posts", x: 672, y: 700, w: 576, h: 300, from: "up", delay: 8, at: 90, length: 477 },

    { file: "orders", x: 1264, y: 80, w: 576, h: 300, from: "right", delay: 18, at: 60, length: 477 },
    { file: "record", x: 1264, y: 396, w: 576, h: 604, from: "right", delay: 24, at: 20, length: 473 },
];

const ENTRY = 32;
const SIDE = 240;
const LIFT = 44;

const Cell: React.FC<{ tile: Tile }> = ({ tile }) => {
    const frame = useCurrentFrame();
    const t = ramp(frame, tile.delay, ENTRY, ENTER);
    const away = 1 - t;

    const dx = tile.from === "left" ? -SIDE * away : tile.from === "right" ? SIDE * away : 0;
    const dy = tile.from === "up" ? LIFT * away : 0;

    const startAt = Math.min(tile.at, Math.max(0, tile.length - BENTO_DURATION * RATE - 6));

    return (
        <div
            style={{
                position: "absolute",
                left: tile.x,
                top: tile.y,
                width: tile.w,
                height: tile.h,
                borderRadius: 16,
                border: `1px solid ${INK.rule}`,
                background: "#000",
                overflow: "hidden",
                opacity: Math.min(1, t * 1.6),
                // No shadow: seven of them across a grid this tight muddies the
                // gutters instead of lifting the tiles off the ground.
                transform: `translate(${dx}px, ${dy}px)`,
            }}
        >
            {/* Own clock per tile. An OffthreadVideo with no Sequence plays
                against the COMPOSITION's frame, so `at` would count from the
                wrong zero — see the note in S06_Panel. */}
            <Sequence from={0} durationInFrames={BENTO_DURATION} layout="none">
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

export const Bento: React.FC = () => (
    <AbsoluteFill style={{ width: W, height: H, background: GROUND.base }}>
        {TILES.map((tile) => (
            <Cell key={tile.file} tile={tile} />
        ))}
    </AbsoluteFill>
);
