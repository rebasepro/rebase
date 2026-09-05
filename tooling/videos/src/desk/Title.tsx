import React from "react";
import { Sequence } from "remotion";
import { DisplayLine, DISPLAY, Eyebrow } from "../components/Type";

/**
 * A headline that lives ON THE DESK — at world coordinates, appearing at an
 * absolute frame, in the type tiers the slide film uses. Its lines rise into
 * their clip boxes the way every headline in the brand does; the only thing
 * different is that the camera comes to it rather than the other way round.
 */
export const Title: React.FC<{
    x: number;
    y: number;
    at: number;
    lines: string[];
    size?: number;
    /** A label over the line. No chapter numbers on the desk: this is one
     *  story, not ten chapters. */
    eyebrow?: string;
    width?: number;
}> = ({ x, y, at, lines, size = DISPLAY.statement, eyebrow, width = 1520 }) => (
    <div style={{ position: "absolute", left: x, top: y, width }}>
        <Sequence from={at} layout="none">
            {eyebrow && (
                <div style={{ marginBottom: 24 }}>
                    <Eyebrow delay={0}>{eyebrow}</Eyebrow>
                </div>
            )}
            {lines.map((line, i) => (
                <DisplayLine key={line} size={size} delay={6 + i * 6}>
                    {line}
                </DisplayLine>
            ))}
        </Sequence>
    </div>
);
