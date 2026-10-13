import React from "react";
import { useCurrentFrame } from "remotion";
import { ramp, SHIFT } from "../components/motion";
import { BAR, BEAT } from "./score";
import { Drift, GUTTER, LEAD, Sentence, SIZE } from "./kit";

/**
 * Bars three and four: the site's own headline, set a beat at a time.
 *
 * The words are rebase.pro's hero, verbatim — a teaser takes its words from
 * the page it is selling, so the two say the same thing.
 */
export const Premise: React.FC = () => {
    const frame = useCurrentFrame();
    // The first sentence makes room for the second, moving as it rises in.
    const lift = ramp(frame, BAR - LEAD - 4, 22, SHIFT);
    return (
        <Drift frames={BAR * 2}>
            <div
                style={{
                    position: "absolute",
                    left: GUTTER,
                    // Line one alone sits on the frame's centre; all three
                    // together do, once it has lifted.
                    top: 480 - lift * 108,
                    display: "flex",
                    flexDirection: "column",
                    rowGap: 14,
                }}
            >
                <Sentence
                    size={SIZE.line}
                    words={[
                        ["A backend", 0],
                        ["for your", BEAT],
                        ["Postgres.", BEAT * 2],
                    ]}
                />
                <Sentence
                    size={SIZE.line}
                    words={[
                        ["And an admin panel", BAR],
                    ]}
                />
                <Sentence
                    size={SIZE.line}
                    words={[
                        ["you don't", BAR + BEAT],
                        ["have to build.", BAR + BEAT * 2],
                    ]}
                />
            </div>
        </Drift>
    );
};
