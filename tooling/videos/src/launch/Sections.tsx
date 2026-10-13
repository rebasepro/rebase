import React from "react";
import { AbsoluteFill, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { pop, ramp, SPRING } from "../components/motion";
import { RebaseLogo } from "../components/RebaseLogo";
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
 * the downbeat and its callout lands on beat two; on bar two the first
 * callout is already gone, the camera moves on the downbeat and the second
 * callout lands on beat two. One thing on screen at a time, all on the beat.
 */
const A_ON = BEAT;
const A_OFF = BAR - 14;
const B_ON = BAR + BEAT;

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
            { at: BAR, target: b.target, scale: b.scale },
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

/** The close: the mark and the name on the drop, the line under it, then
 *  the one command that starts a project. Held to the last frame. */
export const EndCard: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps, durationInFrames } = useVideoConfig();
    const tone = useTone();
    const mark = pop(frame, fps, -LEAD, SPRING.pop);
    const push = 1 + 0.06 * (frame / durationInFrames);
    const cmd = ramp(frame, BAR, 20);
    return (
        <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", transform: `scale(${push})` }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 34 }}>
                    <div style={{ transform: `scale(${0.6 + 0.4 * mark}) rotate(${(1 - mark) * -18}deg)`, opacity: Math.min(1, mark * 2) }}>
                        <RebaseLogo size={150} />
                    </div>
                    <Word at={0} size={SIZE.word} duration={22}>
                        Rebase
                    </Word>
                </div>
                <div style={{ marginTop: 34 }}>
                    <Word at={BEAT} size={52} color={tone.copy} style={{ letterSpacing: TRACKING.title }}>
                        A backend for your Postgres.
                    </Word>
                </div>
                <div
                    style={{
                        marginTop: 64,
                        display: "flex",
                        alignItems: "center",
                        gap: 30,
                        opacity: cmd,
                        transform: `translateY(${(1 - cmd) * 16}px)`,
                    }}
                >
                    <div
                        style={{
                            padding: "16px 26px",
                            borderRadius: RADIUS.lg,
                            background: SURFACE.well,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                            fontFamily: FONT.mono,
                            fontSize: 28,
                            color: "#E7E9EB",
                        }}
                    >
                        <span style={{ color: tone.muted, marginRight: 16 }}>$</span>
                        pnpm dlx @rebasepro/cli init
                    </div>
                    <div style={{ fontFamily: FONT.mono, fontSize: 28, color: tone.copy, letterSpacing: "0.02em" }}>
                        rebase.pro
                    </div>
                </div>
            </div>
        </AbsoluteFill>
    );
};
