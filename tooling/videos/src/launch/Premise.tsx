import React from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { ramp, SHIFT } from "../components/motion";
import { BAR, BEAT } from "./score";
import { ACCENT, fitSize, GUTTER, LEAD, Sentence, SIZE } from "./kit";

/**
 * The first two bars: the site's own headline, and the film's first frame.
 *
 * The words are rebase.pro's hero, verbatim — a teaser takes its words from
 * the page it is selling. Since 2026-10-21 they ARE the opening: the wall of
 * product that came first read as an intro, and a feed gives a video about a
 * second before the thumb moves on. So the first word lands on frame one, on
 * the first kick, as large as the frame allows, and every group after it
 * slams in on its own beat.
 *
 * Two pages, one per bar, each set as a poster: three short lines, one per
 * beat, as large as the page's widest line lets it be (the first version set
 * two long lines at 132 px and filled a quarter of the frame). The word each
 * sentence turns on takes the accent.
 */

const PAGES: [text: string, at: number, accent?: boolean][][][] = [
    [
        [["A backend", 0]],
        [["for your", BEAT]],
        [["Postgres.", BEAT * 2, true]],
    ],
    [
        [["And an admin panel", BAR]],
        [["you don't", BAR + BEAT]],
        [["have to", BAR + BEAT * 2], ["build.", BAR + BEAT * 2, true]],
    ],
];

/** The widest the type may set: the frame, inside the gutters. */
const MAX = 1920 - GUTTER * 2;

export const Premise: React.FC = () => {
    const frame = useCurrentFrame();
    // Each page as large as its widest line allows: a poster, not a slide.
    const sizes = PAGES.map((page) => fitSize(page.map((line) => line.map(([t]) => t).join(" ")), MAX, SIZE.poster));

    // The first page clears just before the second one's first word lands.
    const out = ramp(frame, BAR - LEAD - 8, 8, SHIFT);

    return (
        <AbsoluteFill>
            {PAGES.map((page, p) => {
                if (p === 0 && out >= 1) return null;
                if (p === 1 && frame < BAR - LEAD) return null;
                const leave = p === 0 ? out : 0;
                const size = sizes[p];
                const height = page.length * size * 1.02 + (page.length - 1) * 8;
                return (
                    <div
                        key={p}
                        style={{
                            position: "absolute",
                            left: GUTTER,
                            top: 540 - height / 2 - leave * 60,
                            display: "flex",
                            flexDirection: "column",
                            rowGap: 8,
                            opacity: 1 - leave,
                        }}
                    >
                        {page.map((line, l) => (
                            <Sentence
                                key={l}
                                size={size}
                                slam
                                words={line.map(([text, at, accent]) => [text, at, accent ? ACCENT : undefined])}
                            />
                        ))}
                    </div>
                );
            })}
        </AbsoluteFill>
    );
};
