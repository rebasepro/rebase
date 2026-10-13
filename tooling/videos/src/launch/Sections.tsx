import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { ramp, SHIFT } from "../components/motion";
import { Mark } from "../components/Mark";
import { FONT, RADIUS, SURFACE, TRACKING } from "../theme";
import { useTone } from "../Plane";
import { cell, Editor, TIMING } from "./Editor";
import { Callout, type CalloutSpec, Drift, type Focus, GUTTER, LEAD, ProductWindow, SIZE, Verb, WINDOW, Word } from "./kit";
import { BAR, BEAT, FPS } from "./score";

/**
 * The verb sections and the two that close the film.
 *
 * A verb section is two bars: the verb and its window on the downbeat, a
 * callout on beat two, and on the second bar a second callout replacing the
 * first. Three of them, one per thing Rebase is — the backend your app calls,
 * the panel your team works in, and Studio — which is the order the site
 * itself presents them in.
 */

const Clip: React.FC<{ file: string; from: number; rate?: number }> = ({ file, from, rate = 1 }) => (
    <OffthreadVideo
        src={staticFile(file)}
        trimBefore={Math.round(from * FPS)}
        playbackRate={rate}
        muted
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
);

const Callouts: React.FC<{ items: CalloutSpec[] }> = ({ items }) => (
    <>
        {items.map((c) => (
            <Callout key={c.label} {...c} />
        ))}
    </>
);

/**
 * The beats every verb section keeps: the camera finds the first point on
 * the downbeat and its callout lands just before beat two; it holds until
 * the bar is nearly out, the camera moves on as it fades, and the second
 * callout lands as the move settles. One thing on screen at a time.
 *
 * Each callout used to run from beat two to fourteen frames before the bar,
 * which left "Typed SDK" readable for about a second — too little for a
 * label and its sentence (Francesco, 2026-10-13). Now each one gets about
 * 1.5 s at full strength.
 */
const A_ON = BEAT - LEAD;
const A_OFF = BAR - 4;
/** The camera leaves A once it has faded, and B arrives when it has landed. */
const MOVE_AT = BAR + 4;
const B_ON = BAR + 14;

function beats(
    a: Omit<CalloutSpec, "at" | "until"> & { scale: number },
    b: Omit<CalloutSpec, "at" | "until"> & { scale: number },
): { callouts: CalloutSpec[]; focus: Focus[] } {
    return {
        callouts: [
            { label: a.label, text: a.text, target: a.target, at: A_ON, until: A_OFF },
            { label: b.label, text: b.text, target: b.target, at: B_ON },
        ],
        focus: [
            { at: 0, target: a.target, scale: a.scale },
            { at: MOVE_AT, target: b.target, scale: b.scale },
        ],
    };
}

/** Window-relative fraction of a pixel point inside the editor. */
const inEditor = (x: number, y: number): [number, number] => [x / WINDOW.width, y / WINDOW.height];

export const Build: React.FC = () => {
    const row = cell(5, 35);
    const listen = cell(8, 0);
    const { callouts, focus } = beats(
        {
            label: "Typed SDK",
            text: "Autocomplete from your own tables.",
            // The "products" row of the completion list.
            target: inEditor(row.x + 30, row.y + 4 + 1 + 6 + 3 * 42 + 21),
            // Code is legible at full size; a nudge, not a push, so the
            // left margin and the tab stay in frame.
            scale: 1.06,
        },
        {
            label: "Realtime",
            text: "Every change, pushed to every client.",
            // In the margin left of the line number, so the ring frames the
            // line without sitting on its first letters.
            target: inEditor(24, listen.y + 22),
            // Pulls back out, so the event arriving in the corner is seen.
            scale: 1,
        },
    );
    return (
        <AbsoluteFill>
            <Verb word="Build." product="The backend" />
            <ProductWindow focus={focus}>
                <Editor />
            </ProductWindow>
            <Callouts items={[{ ...callouts[0], at: TIMING.popup + 4 }, callouts[1]]} />
        </AbsoluteFill>
    );
};

export const Manage: React.FC = () => {
    const { callouts, focus } = beats(
        { label: "Views", text: "Cards, tables and boards over any table.", target: [0.42, 0.44], scale: 1.2 },
        // The record's image strip, once the card has opened.
        { label: "Forms", text: "Media, relations and validation, from one file.", target: [0.3, 0.5], scale: 1.45 },
    );
    return (
        <AbsoluteFill>
            <Verb word="Manage." product="The admin panel" />
            <ProductWindow focus={focus}>
                <Clip file="demo/panel.mp4" from={1.7} />
            </ProductWindow>
            <Callouts items={callouts} />
        </AbsoluteFill>
    );
};

export const Shape: React.FC = () => {
    const { callouts, focus } = beats(
        // The enum's values, open in the property editor.
        { label: "Schema", text: "Fields, enums and relations, edited visually.", target: [0.66, 0.7], scale: 1.3 },
        // The result grid, which arrives on beat two: the clip is cut so the
        // query runs half a second after the downbeat. The camera pulls back
        // to the whole editor — the query and its rows are one picture.
        { label: "SQL", text: "A SQL editor on the same database.", target: [0.42, 0.86], scale: 1 },
    );
    return (
        <AbsoluteFill>
            <Verb word="Shape." product="Studio" />
            <ProductWindow focus={focus}>
                <Sequence durationInFrames={BAR}>
                    <Clip file="demo/schema.mp4" from={4.4} />
                </Sequence>
                <Sequence from={BAR}>
                    <Clip file="demo/studio.mp4" from={15.5} />
                </Sequence>
            </ProductWindow>
            <Callouts items={callouts} />
        </AbsoluteFill>
    );
};

/**
 * The claim: four short lines on the claim field, one per word hit in the
 * music. Each new line takes the light; the ones before it step back.
 */
const CLAIMS = ["Open source.", "MIT licensed.", "Any Postgres.", "No lock-in."];

export const Claim: React.FC = () => {
    const frame = useCurrentFrame();
    const tone = useTone();
    return (
        <Drift frames={BAR * 2}>
            <div style={{ position: "absolute", left: GUTTER, top: 290, display: "flex", flexDirection: "column", rowGap: 6 }}>
                {CLAIMS.map((text, i) => {
                    const at = i * BEAT * 2;
                    const next = (i + 1) * BEAT * 2;
                    const current = i === CLAIMS.length - 1 || frame < next;
                    return (
                        <Word key={text} at={at} size={SIZE.list} color={current ? tone.high : tone.muted}>
                            {text}
                        </Word>
                    );
                })}
            </div>
        </Drift>
    );
};

/**
 * The close: the mark and the name on the drop, the line under it, then the
 * one command that starts a project. Held to the last frame.
 *
 * The block is centred at every moment, not just when it is complete: the
 * command row GROWS into the layout on its downbeat, so the lockup and the
 * line glide up to make room instead of sitting high for two seconds waiting
 * for a row that is not there yet.
 */
const CMD_ROW = 56 + 70 + 20 + 32;

export const EndCard: React.FC = () => {
    const frame = useCurrentFrame();
    const { durationInFrames } = useVideoConfig();
    const tone = useTone();
    const push = 1 + 0.06 * (frame / durationInFrames);
    const grow = ramp(frame, BAR - LEAD, 30, SHIFT);
    const cmd = ramp(frame, BAR - LEAD, 24);
    const url = ramp(frame, BAR + BEAT - LEAD, 24);
    return (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${push})` }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 40 }}>
                    {/* The brand's own entrance: the facets assemble in a wave
                        across the cube (components/Mark.tsx, the long film's). */}
                    <Mark size={200} delay={-LEAD} spread={30} />
                    <Word at={0} size={SIZE.word} duration={22}>
                        Rebase
                    </Word>
                </div>
                <div style={{ marginTop: 30 }}>
                    <Word at={BEAT} size={52} color={tone.copy} style={{ letterSpacing: TRACKING.title }}>
                        A backend for your Postgres.
                    </Word>
                </div>
                <div style={{ height: grow * CMD_ROW, position: "relative", width: "100%" }}>
                    <div
                        style={{
                            position: "absolute",
                            top: 56,
                            left: "50%",
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            transform: "translateX(-50%)",
                            whiteSpace: "nowrap",
                        }}
                    >
                        <div
                            style={{
                                padding: "16px 28px",
                                borderRadius: RADIUS.lg,
                                background: SURFACE.well,
                                border: `1px solid ${SURFACE.hairlineStrong}`,
                                fontFamily: FONT.mono,
                                fontSize: 30,
                                lineHeight: "36px",
                                color: "#E7E9EB",
                                opacity: cmd,
                                transform: `translateY(${(1 - cmd) * 18}px)`,
                            }}
                        >
                            <span style={{ color: tone.muted, marginRight: 18 }}>$</span>
                            pnpm dlx @rebasepro/cli init
                        </div>
                        <div
                            style={{
                                marginTop: 20,
                                fontFamily: FONT.mono,
                                fontSize: 26,
                                lineHeight: "32px",
                                letterSpacing: "0.04em",
                                color: tone.copy,
                                opacity: url,
                                transform: `translateY(${(1 - url) * 12}px)`,
                            }}
                        >
                            rebase.pro
                        </div>
                    </div>
                </div>
            </div>
        </AbsoluteFill>
    );
};
