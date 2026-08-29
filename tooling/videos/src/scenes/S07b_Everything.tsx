import React from "react";
import { AbsoluteFill } from "remotion";
import { Scene } from "../components/Scene";
import { Chapter } from "../components/Type";
import { DisplayLine } from "../components/Type";
import { DISPLAY } from "../components/Type";
import { BentoTiles } from "../bento/Bento";

/**
 * 07 · EVERY VIEW — 300 frames.
 *
 * The breadth beat, and the only scene that shows more than one thing at once.
 * Five and six make the offer one layer at a time — take the backend, add the
 * panel, add Studio — and each of them can only show a single screen while it
 * does. This is the answer to "yes, but how much IS there", which no amount of
 * one-screen-at-a-time can answer.
 *
 * Seven live views, each doing something only it does: search, filter a table,
 * switch a view from cards to a table, read a form and its relations, drag a
 * card between board columns, select rows, open a record out of a list.
 *
 * The grid is the same one the standalone Bento composition uses, sized to the
 * film's own 1520 measure so its left edge lands on STAGE_INSET like every
 * other slide — the margin never moving between stations is most of why very
 * different slides read as one piece. Scaling the box keeps every tile's
 * aspect ratio, so the clips still fill their tiles without cropping.
 *
 * The tiles arrive with far less travel than they do standalone: this scene
 * already enters on the film's own transition, and two motions on the same
 * frames fight rather than compound.
 */

const GRID = { x: 200, y: 250, w: 1520, h: 793, gap: 14 };

export const S07b_Everything: React.FC = () => (
    <Scene>
        <AbsoluteFill style={{ padding: "0 112px" }}>
            <div style={{ width: "100%", maxWidth: 1520, margin: "0 auto", paddingTop: 116 }}>
                <Chapter n="07" label="Every view" delay={2} />
                <div style={{ marginTop: 22 }}>
                    <DisplayLine size={DISPLAY.statement} delay={8}>
                        Lists, boards, tables, forms.
                    </DisplayLine>
                </div>
            </div>
        </AbsoluteFill>
        <AbsoluteFill>
            <BentoTiles box={GRID} duration={300} travel={90} lift={26} />
        </AbsoluteFill>
    </Scene>
);
