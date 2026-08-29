import React from "react";
import {
    AbsoluteFill,
    OffthreadVideo,
    Sequence,
    interpolate,
    staticFile,
    useCurrentFrame,
} from "remotion";
import { NeatCanvas } from "../gradient/NeatCanvas";
import { ENTER, ramp } from "../components/motion";
import { FRAME, GROUND } from "../theme";

/**
 * The bento. A separate piece from the film, not a scene in it.
 *
 * One view held big in the middle and six smaller ones arriving from the sides,
 * all of them live. The point is VARIETY: a board, cards over photographs, a
 * table of illustrations, two different list shapes and the schema editor. Six
 * scrolling lists would read as one thing scrolled six times, which is the trap
 * a grid of product screenshots usually falls into.
 *
 * Every clip is rendered by scripts/render-demo.mjs at a true 30fps rather than
 * screen-recorded at 25 — see the note in that file. The side tiles are also
 * captured at a SMALLER viewport than the centre: a tile shows its capture at
 * roughly a third of full width, and 1280-wide app type does not survive that.
 */

const W = 1920;
const H = 1080;

export const BENTO_DURATION = 420;

interface Tile {
    file: string;
    /** Where it comes to rest. */
    x: number;
    y: number;
    w: number;
    h: number;
    /** Which edge it flies in from. The centre tile scales up instead. */
    from: "left" | "right" | "center";
    /** Frames after the start. */
    delay: number;
    /** Source frame to start the clip on, so no two tiles are in step. */
    at: number;
    /** How many frames the clip actually has. Not decoration: a video asked
     *  for a frame past its end holds its LAST one, so a tile whose window
     *  overruns freezes for the rest of the piece while everything around it
     *  keeps moving. `startAt` below clamps against this rather than trusting
     *  the offsets to have been chosen carefully. */
    length: number;
}

/* Sizes deliberately differ per tile — a bento whose cells are all one size is
   a grid. The two columns do not line up with each other either. */
const TILES: Tile[] = [
    { file: "demo/panel.mp4", x: 516, y: 232, w: 888, h: 596, from: "center", delay: 0, at: 210, length: 574 },

    { file: "demo/tickets.mp4",   x: 56, y: 96,  w: 432, h: 310, from: "left", delay: 14, at: 30, length: 495 },
    { file: "demo/customers.mp4", x: 56, y: 438, w: 432, h: 252, from: "left", delay: 24, at: 60, length: 462 },
    { file: "demo/schema.mp4",    x: 56, y: 722, w: 432, h: 262, from: "left", delay: 34, at: 96, length: 426 },

    { file: "demo/posts.mp4",     x: 1432, y: 76,  w: 432, h: 280, from: "right", delay: 20, at: 45, length: 462 },
    { file: "demo/exercises.mp4", x: 1432, y: 388, w: 432, h: 312, from: "right", delay: 30, at: 75, length: 462 },
    { file: "demo/users.mp4",     x: 1432, y: 732, w: 432, h: 252, from: "right", delay: 40, at: 40, length: 447 },
];

/** Slightly under real time. The tiles are small and the eye has seven of them
 *  to take in, so the app reads better a touch slower — and it buys headroom
 *  against the clip lengths. */
const RATE = 0.82;

const ENTRY = 34;
/** How far off its resting place a tile starts. Past the frame edge, so it is
 *  genuinely arriving rather than sliding out of a crop. */
const TRAVEL = 620;

const Cell: React.FC<{ tile: Tile }> = ({ tile }) => {
    const frame = useCurrentFrame();
    const t = ramp(frame, tile.delay, ENTRY, ENTER);

    /* Nothing rests dead still: after arriving, every tile keeps a slow drift
       on its own phase, so the composition breathes instead of freezing into a
       screenshot the moment the entrance finishes. */
    const drift = Math.sin((frame + tile.delay * 7) / 74) * 7;

    /* Never ask for a frame the clip does not have. */
    const startAt = Math.min(tile.at, Math.max(0, tile.length - BENTO_DURATION * RATE - 6));
    const dx = tile.from === "left" ? -TRAVEL : tile.from === "right" ? TRAVEL : 0;

    const scale =
        tile.from === "center"
            ? interpolate(t, [0, 1], [0.93, 1])
            : interpolate(t, [0, 1], [0.88, 1]);

    return (
        <div
            style={{
                position: "absolute",
                left: tile.x,
                top: tile.y,
                width: tile.w,
                height: tile.h,
                borderRadius: FRAME.radius,
                border: FRAME.border,
                background: FRAME.background,
                boxShadow: FRAME.boxShadow,
                overflow: "hidden",
                opacity: Math.min(1, t * 1.5),
                transform: `translate(${dx * (1 - t)}px, ${drift}px) scale(${scale})`,
            }}
        >
            {/* Each clip runs on its own clock — see the note in S06_Panel: an
                OffthreadVideo with no Sequence of its own plays against the
                COMPOSITION's frame, so `at` would be an offset from the wrong
                zero and the tiles would drift out of the windows chosen here. */}
            <Sequence from={0} durationInFrames={100000} layout="none">
                <OffthreadVideo
                    src={staticFile(tile.file)}
                    startFrom={startAt}
                    muted
                    playbackRate={RATE}
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
            </Sequence>
        </div>
    );
};

export const Bento: React.FC = () => {
    const frame = useCurrentFrame();

    /* One very slow push across the whole board. It is the difference between
       a composition that is playing and one that is merely on. */
    const push = interpolate(frame, [0, 420], [1, 1.035], { extrapolateRight: "clamp" });

    return (
        <AbsoluteFill style={{ width: W, height: H }}>
            <AbsoluteFill style={{ background: GROUND.base }} />
            {/* The backdrop carries this piece — there is no copy and no cut to
                supply rhythm, so the ribbon has to be present and it has to
                move. It rolls about 11 degrees across the fourteen seconds,
                which at this station stays on the coverage plateau rather than
                turning broadside and swamping the tiles. */}
            <NeatCanvas
                framing="hero"
                opacity={0.5}
                camera={{
                    cameraX: 0,
                    cameraY: -12,
                    cameraZoom: 2.05,
                    cameraRotationZ: interpolate(frame, [0, BENTO_DURATION], [0.34, 0.53]),
                }}
                time={frame / 30}
                style={{ mixBlendMode: "screen" }}
            />
            <AbsoluteFill style={{ transform: `scale(${push})` }}>
                {TILES.map((tile) => (
                    <Cell key={tile.file} tile={tile} />
                ))}
            </AbsoluteFill>
        </AbsoluteFill>
    );
};

