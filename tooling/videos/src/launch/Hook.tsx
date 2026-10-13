import React from "react";
import { AbsoluteFill, Easing, interpolate, OffthreadVideo, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Code } from "../components/Code";
import { pop, ramp, SPRING } from "../components/motion";
import { FONT, FRAME, INK, SURFACE } from "../theme";
import { LEAD } from "./kit";
import { BAR, BEAT, FPS } from "./score";

/**
 * The first two bars: the whole product at once.
 *
 * A wall of live windows — cards, tables, a board, records, the schema
 * editor, SQL, and the one file they all come from — tilted away from the
 * camera, dealt in from the centre on the first three beats, drifting, then
 * flown through into the headline.
 *
 * It replaced four macro close-ups of the same footage. Those were Teasr's
 * opening for a hardware product, where a close-up of a knob is a beautiful
 * object; a close-up of an admin panel is a cropped word ("ee maker"), and
 * at 2x the footage was the softest image in the film (3x upscaled in the 4K
 * master). Every tile here shows its clip at or below its native size, so the
 * opening is as sharp as everything after it, and it says what the product
 * IS — a lot of real screens — before the headline says it in words.
 */

interface Tile {
    file?: string;
    /** Seconds into the clip. */
    from?: number;
    position?: string;
}

const COLLECTION = `export const products = defineCollection({
  slug: "products",
  table: "products",
  name: "Products",
  properties: {
    name: { name: "Name", type: "string" },
    price: { name: "Price", type: "number" },
    in_stock: { name: "In stock", type: "boolean" },
  },
});`;

/** Row by row. The empty tile is the collection file, at the centre, so the
 *  first thing to land is the thing the rest is generated from. */
const WALL: Tile[][] = [
    [
        { file: "demo/bento/b_cards.mp4", from: 2.5 },
        { file: "demo/orders.mp4", from: 1 },
        { file: "demo/bento/b_tickets.mp4", from: 2 },
        { file: "demo/studio.mp4", from: 15.8 },
    ],
    [
        { file: "demo/bento/b_customers.mp4", from: 2 },
        {},
        { file: "demo/panel.mp4", from: 0.3 },
        { file: "demo/schema.mp4", from: 5 },
    ],
    [
        { file: "demo/bento/b_posts.mp4", from: 2.5 },
        { file: "demo/bento/b_record.mp4", from: 2, position: "center top" },
        { file: "demo/bento/b_exercises.mp4", from: 2 },
        { file: "demo/bento/b_authors.mp4", from: 2 },
    ],
];

const TILE = { w: 600, h: 375, gap: 30 } as const;
const COLS = WALL[0].length;
const ROWS = WALL.length;
const W = COLS * TILE.w + (COLS - 1) * TILE.gap;
const H = ROWS * TILE.h + (ROWS - 1) * TILE.gap;

/** Centre-out rings. The middle two are already there on the first frame (an
 *  opening frame with two small tiles on it is an empty frame); the six
 *  around them land on the first kick, the corners on the second. */
const ring = (r: number, c: number) => Math.floor(Math.abs(r - (ROWS - 1) / 2) + Math.abs(c - (COLS - 1) / 2));

/** The flight out: accelerating, so it reads as moving through, not fading. */
const EXIT_AT = BAR * 2 - 22;
const EXIT = Easing.bezier(0.55, 0, 1, 0.45);

const CollectionFile: React.FC = () => (
    <div style={{ position: "absolute", inset: 0, background: SURFACE.well }}>
        <div
            style={{
                height: 40,
                display: "flex",
                alignItems: "center",
                padding: "0 18px",
                borderBottom: `1px solid ${SURFACE.hairline}`,
                fontFamily: FONT.mono,
                fontSize: 15,
                color: INK.copy,
            }}
        >
            collections/products.ts
        </div>
        <div style={{ padding: "18px 22px", fontVariantLigatures: "none" }}>
            <Code code={COLLECTION} size={16} delay={-60} />
        </div>
    </div>
);

const TileView: React.FC<{ tile: Tile; r: number; c: number }> = ({ tile, r, c }) => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const p = pop(frame, fps, (ring(r, c) - 1) * BEAT - LEAD, SPRING.card);
    return (
        <div
            style={{
                position: "absolute",
                left: c * (TILE.w + TILE.gap),
                top: r * (TILE.h + TILE.gap),
                width: TILE.w,
                height: TILE.h,
                borderRadius: FRAME.radius,
                border: FRAME.border,
                background: FRAME.background,
                overflow: "hidden",
                opacity: Math.min(1, p * 1.5),
                transform: `translateY(${(1 - p) * 60}px) scale(${0.9 + 0.1 * p})`,
            }}
        >
            {tile.file ? (
                <OffthreadVideo
                    src={staticFile(tile.file)}
                    trimBefore={Math.round((tile.from ?? 0) * FPS)}
                    muted
                    style={{
                        width: "100%",
                        height: "100%",
                        objectFit: "cover",
                        objectPosition: tile.position ?? "left top",
                    }}
                />
            ) : (
                <CollectionFile />
            )}
        </div>
    );
};

export const Hook: React.FC = () => {
    const frame = useCurrentFrame();
    const length = BAR * 2;

    // One continuous move: a steady diagonal drift and a slow push, at a fixed
    // angle. The beat lives in the tiles landing, not in the camera. It used
    // to pulse on every beat and turn 4 degrees on the second downbeat; under
    // a two-step, whose kicks skip beats, the pulse landed on nothing and the
    // turn read as a wobble (Francesco, 2026-10-13: "pulse and rotate oddly").
    const panX = interpolate(frame, [0, length], [150, -150]);
    const panY = interpolate(frame, [0, length], [50, -40]);
    const exit = ramp(frame, EXIT_AT, 22, EXIT);
    const scale = interpolate(frame, [0, length], [0.98, 1.06]) * (1 + 0.45 * exit);

    return (
        <AbsoluteFill
            style={{
                perspective: 2400,
                perspectiveOrigin: "50% 40%",
                opacity: 1 - exit,
                // The wall's far edges dissolve into the ground rather than
                // being cut by the frame.
                maskImage: "radial-gradient(ellipse 62% 66% at 50% 50%, #000 55%, transparent 100%)",
                WebkitMaskImage: "radial-gradient(ellipse 62% 66% at 50% 50%, #000 55%, transparent 100%)",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: W,
                    height: H,
                    transform: `translate(-50%, -50%) translate(${panX}px, ${panY}px) rotateX(24deg) rotateZ(-12deg) scale(${scale})`,
                }}
            >
                {WALL.map((row, r) => row.map((tile, c) => <TileView key={`${r}-${c}`} tile={tile} r={r} c={c} />))}
            </div>
        </AbsoluteFill>
    );
};
