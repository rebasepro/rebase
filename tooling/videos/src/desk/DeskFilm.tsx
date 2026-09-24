import React, { useMemo } from "react";
import { AbsoluteFill, useCurrentFrame } from "remotion";
import { DeskPlane } from "./DeskPlane";
import { Desk } from "./Desk";
import { Mark } from "../components/Mark";
import { ramp, SHIFT } from "../components/motion";
import { FONT, FRAME, INK } from "../theme";
import { Narration } from "../Narration";
import { DESK_FRAMES_PER_WORD, DESK_NARRATION } from "./script";
import { CLOSE, Presenter, type LiveFeed, type Take } from "./Presenter";
import { AUTHORED, buildDeskTimeline, DeskTimelineContext, useDeskTimeline, type Timing } from "./timeline";

/**
 * What the desk film is given. All optional: with none of them it is the
 * authored film, a placeholder in the presenter's window.
 *
 *   timing  when each word was said (timeline.ts) — a take's, measured by
 *           scripts/take.mjs, or the recording page's, live.
 *   take    the recording that goes in the presenter's window.
 *   live    the camera, live, on the recording page.
 */
export interface DeskProps {
    timing?: Timing | null;
    take?: Take | null;
    live?: LiveFeed | null;
    [key: string]: unknown;
}

/** The timeline for these props, for every component under it. */
const WithTimeline: React.FC<{ timing?: Timing | null; children: React.ReactNode }> = ({ timing, children }) => {
    const timeline = useMemo(() => buildDeskTimeline(timing ?? AUTHORED), [timing]);
    return <DeskTimelineContext.Provider value={timeline}>{children}</DeskTimelineContext.Provider>;
};

/** How long the film runs for these props: to the close's last word and 49
 *  frames past it. Read by the compositions' calculateMetadata. */
export function deskDuration(props: DeskProps): number {
    return buildDeskTimeline(props.timing ?? AUTHORED).duration ?? 1;
}

/**
 * The film: the ribbon, the desk on it, and two things in SCREEN space that
 * are not on the desk — the presenter, and the address that closes it. It
 * opens on the presenter, already talking; there is no logo pre-roll (the
 * mark is at the close). Everything else is a place on the desk the camera
 * goes.
 */
export const RebaseDesk: React.FC<DeskProps> = ({ timing, take, live }) => (
    <WithTimeline timing={timing}>
        <DeskFilm take={take} live={live} />
    </WithTimeline>
);

const DeskFilm: React.FC<{ take?: Take | null; live?: LiveFeed | null }> = ({ take, live }) => (
    <AbsoluteFill style={{ background: "#000" }}>
        <DeskPlane />
        <Desk />
        <Close />
        <Presenter take={take} live={live} />
    </AbsoluteFill>
);

/** With the prompter, for timing the read. Not a deliverable. The prompter
 *  is pushed left of the presenter's corner so the two never overlap. */
export const RebaseDeskVO: React.FC<DeskProps> = ({ timing, take, live }) => (
    <WithTimeline timing={timing}>
        <DeskFilm take={take} live={live} />
        <Prompter />
    </WithTimeline>
);

/** The narration at the timeline's own word frames — the authored read, or
 *  a take's, word for word. A line not (fully) said is left off. */
const Prompter: React.FC = () => {
    const { timing } = useDeskTimeline();
    const script = DESK_NARRATION.flatMap((line, i) => {
        const said = timing.lines[i];
        if (!said || said.words.length < line.words.length || said.end === undefined) return [];
        return [{ at: said.words[0], words: line.words, wordsAt: said.words, endsAt: said.end }];
    });
    return <Narration script={script} framesPerWord={DESK_FRAMES_PER_WORD} insetRight={340} />;
};

/** The address, over the whole desk pulled back: every window the film
 *  visited, small, for as long as the pull-back takes — then they go, and
 *  what is left is the presenter, saying the last line to camera, and the
 *  one thing to take away beside them.
 *
 *  Two columns: the presenter's window on the left (CLOSE in presenter.ts),
 *  the mark, the address and the command centred in what remains. The
 *  desk is most of the way to black by the time the wordmark is up; a first
 *  cut held the mosaic at 38% under the whole address, and with nine
 *  windows and three headlines behind it the close had more on screen than
 *  any other shot in the film — the one shot that should have the least. */
const Close: React.FC = () => {
    const frame = useCurrentFrame();
    const { cues } = useDeskTimeline();
    if (cues.flyToClose === null) return null;
    const at = cues.flyToClose + 20;
    const mark = ramp(frame, at, 1);
    if (mark <= 0) return null;
    const scrim = ramp(frame, at + 6, 44);
    const url = ramp(frame, at + 26, 26);
    const cmd = ramp(frame, at + 48, 24);
    const foot = ramp(frame, at + 66, 22);
    /* And to black entirely under the last line, so the final frame is the
       presenter, the mark, the address and the command on ground. */
    const dark = cues.fadeOut === null ? 0 : ramp(frame, cues.fadeOut, 56, SHIFT);
    const left = CLOSE.x + CLOSE.w + 60;
    return (
        <AbsoluteFill>
            <AbsoluteFill style={{ background: "#000", opacity: 0.86 * scrim + 0.14 * dark }} />
            <AbsoluteFill style={{ left, width: 1920 - left - 120, alignItems: "center", justifyContent: "center" }}>
                <Mark size={116} delay={at} spread={18} />
                <div style={{ overflow: "hidden", marginTop: 38, paddingBottom: "0.1em" }}>
                    <div
                        style={{
                            fontFamily: FONT.display,
                            fontWeight: 600,
                            fontSize: 104,
                            letterSpacing: "-0.034em",
                            lineHeight: 1,
                            color: INK.high,
                            transform: `translateY(${(1 - url) * 108}%)`,
                        }}
                    >
                        rebase.pro
                    </div>
                </div>
                <div
                    style={{
                        marginTop: 42,
                        padding: "18px 34px",
                        borderRadius: 12,
                        border: `1px solid ${INK.rule}`,
                        background: FRAME.background,
                        fontFamily: FONT.mono,
                        fontSize: 28,
                        color: INK.high,
                        letterSpacing: "-0.01em",
                        opacity: cmd,
                        transform: `translateY(${(1 - cmd) * 14}px)`,
                    }}
                >
                    <span style={{ color: INK.muted, marginRight: 14 }}>$</span>
                    pnpm dlx @rebasepro/cli init
                </div>
                <div
                    style={{
                        marginTop: 38,
                        fontFamily: FONT.mono,
                        fontSize: 17,
                        letterSpacing: "0.22em",
                        textTransform: "uppercase",
                        color: INK.muted,
                        opacity: foot,
                    }}
                >
                    Open source · Postgres-native · Deploy anywhere
                </div>
            </AbsoluteFill>
        </AbsoluteFill>
    );
};
