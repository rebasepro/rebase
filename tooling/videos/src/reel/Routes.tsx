import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp } from "../components/motion";
import { CHROMA, FONT, INK, TRACKING } from "../theme";

/**
 * CANDIDATE — the surface area.
 *
 * A poster, not a sequence: forty generated endpoints filling the frame at
 * once. The film keeps saying "REST over every table" in a column of body copy
 * beside something else, and a phrase is not a quantity. Forty paths arriving
 * in two seconds is.
 *
 * Nothing here is decorative. Every path is one this actually emits — five
 * operations per collection across eight collections — so the poster is a
 * count of real work rather than a texture that looks like one.
 *
 * The methods are coloured because the SHAPE is the message: an even spread of
 * read and write across every table is what "generated" looks like, and it is
 * not what a hand-rolled API ever looks like.
 */

const COLLECTIONS = [
    "products", "orders", "order_items", "customers",
    "tickets", "posts", "authors", "users",
];

type M = "GET" | "POST" | "PATCH" | "DELETE";

const METHOD: Record<M, string> = {
    GET: CHROMA.cyan,
    POST: CHROMA.violet,
    PATCH: CHROMA.yellow,
    DELETE: CHROMA.coral,
};

interface Route {
    m: M;
    path: string;
}

/* Five per collection: list, read, create, update, delete. */
const ROUTES: Route[] = COLLECTIONS.flatMap((c) => [
    { m: "GET" as M, path: `/api/${c}` },
    { m: "GET" as M, path: `/api/${c}/:id` },
    { m: "POST" as M, path: `/api/${c}` },
    { m: "PATCH" as M, path: `/api/${c}/:id` },
    { m: "DELETE" as M, path: `/api/${c}/:id` },
]);

const COLS = 4;
const COL_W = 378;
const ROW_H = 62;
const X = 214;
const TOP = 212;

/* Down each column, then across — so the eye sees a column fill rather than a
   scatter, and the last collection lands last. */
const at = (i: number) => 20 + i * 2.6;

export const Routes: React.FC = () => {
    const frame = useCurrentFrame();
    const shown = ROUTES.filter((_, i) => frame > at(i) + 8).length;

    return (
        <AbsoluteFill>
            <div
                style={{
                    position: "absolute",
                    left: X,
                    top: 118,
                    display: "flex",
                    gap: 12,
                    alignItems: "baseline",
                    opacity: ramp(frame, 4, 16),
                }}
            >
                <span
                    style={{
                        fontFamily: FONT.body,
                        fontSize: 14,
                        fontWeight: 600,
                        color: INK.muted,
                        textTransform: "uppercase",
                        letterSpacing: TRACKING.eyebrow,
                    }}
                >
                    Generated
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: 14, color: INK.muted }}>
                    · {shown} of {ROUTES.length} endpoints · 8 collections
                </span>
            </div>

            {ROUTES.map((r, i) => {
                const col = Math.floor(i / 10);
                const row = i % 10;
                const up = ramp(frame, at(i), 12);
                const hue = METHOD[r.m];
                return (
                    <div
                        key={r.path + r.m + i}
                        style={{
                            position: "absolute",
                            left: X + col * COL_W,
                            top: TOP + row * ROW_H,
                            width: COL_W - 26,
                            height: ROW_H - 12,
                            display: "flex",
                            alignItems: "center",
                            gap: 14,
                            opacity: up,
                        }}
                    >
                        <span
                            style={{
                                fontFamily: FONT.mono,
                                fontSize: 12,
                                letterSpacing: TRACKING.eyebrow,
                                color: hue,
                                background: `${hue}1C`,
                                border: `1px solid ${hue}3D`,
                                borderRadius: 5,
                                padding: "4px 8px",
                                width: 74,
                                textAlign: "center",
                            }}
                        >
                            {r.m}
                        </span>
                        <span style={{ fontFamily: FONT.mono, fontSize: 17, color: INK.copy }}>
                            {r.path}
                        </span>
                    </div>
                );
            })}

            <div
                style={{
                    position: "absolute",
                    left: X,
                    top: 872,
                    width: 1500,
                    fontFamily: FONT.display,
                    fontSize: 46,
                    fontWeight: 600,
                    letterSpacing: "-0.02em",
                    color: INK.high,
                    opacity: ramp(frame, 132, 26),
                }}
            >
                Forty endpoints. Nobody wrote one.
            </div>
        </AbsoluteFill>
    );
};

export const ROUTES_DURATION = 270;
