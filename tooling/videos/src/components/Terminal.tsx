import React from "react";
import { useCurrentFrame } from "remotion";
import { FONT, INK, PRIMARY_LIGHT } from "../theme";
import { ramp } from "./motion";

/**
 * A shell session: a command typed a character at a time, then its output.
 *
 * The typing is a pure function of the frame — no interval, no state — because
 * the renderer seeks. It also does not type at a constant rate: a fixed
 * characters-per-frame reads as a machine printing, and the thing being shown
 * is a person running a command. A little easing at the start and a pause
 * before Return is most of the difference.
 */

export interface OutputLine {
    text: string;
    /** ok = a green tick; muted = a note; plain = as typed. */
    tone?: "ok" | "muted" | "plain" | "accent";
    /** Frames after the command finishes typing. */
    at: number;
}

const TONE: Record<NonNullable<OutputLine["tone"]>, string> = {
    ok: "#34D399",
    muted: INK.muted,
    plain: INK.copy,
    accent: PRIMARY_LIGHT,
};

export const Terminal: React.FC<{
    /** The command, without the prompt. */
    command: string;
    output?: OutputLine[];
    /** Frame at which the first character appears. */
    delay?: number;
    /** Frames per character, before easing. */
    rate?: number;
    size?: number;
    prompt?: string;
    /** Keep the caret blinking after the command is typed. */
    caret?: boolean;
    /** Leave a line out of the DOM until its frame. By default every line is
     *  laid out from the start at opacity 0, so the window has its final
     *  height before anything prints; a shell that SCROLLS needs the
     *  opposite — content that grows, so older lines are pushed off the top. */
    lazy?: boolean;
    lineHeight?: number;
}> = ({
    command,
    output = [],
    delay = 0,
    rate = 1.15,
    size = 24,
    prompt = "$",
    caret = true,
    lazy = false,
    lineHeight = 1.75,
}) => {
    const frame = useCurrentFrame();

    // Ease the run rather than typing linearly: quick after the first few
    // characters, slowing into the last word.
    const span = command.length * rate;
    const t = ramp(frame, delay, span);
    const typed = Math.round(t * command.length);
    const doneAt = delay + span;

    // A caret that blinks on a 32-frame cycle, and holds solid while typing —
    // a caret blinking mid-word is the tell that this is a text animation.
    const typing = frame >= delay && frame < doneAt;
    const blink = typing || Math.floor((frame - doneAt) / 16) % 2 === 0;

    return (
        <div style={{ fontFamily: FONT.mono, fontSize: size, lineHeight }}>
            <div style={{ display: "flex", gap: 12, opacity: frame >= delay ? 1 : 0 }}>
                <span style={{ color: INK.muted }}>{prompt}</span>
                <span style={{ color: INK.high }}>
                    {command.slice(0, typed)}
                    {caret && blink && (
                        <span
                            style={{
                                display: "inline-block",
                                width: size * 0.52,
                                height: size * 1.05,
                                background: PRIMARY_LIGHT,
                                verticalAlign: "-0.18em",
                                marginLeft: 2,
                            }}
                        />
                    )}
                </span>
            </div>

            {output.map((line, i) => {
                const at = doneAt + line.at;
                if (lazy && frame < at) return null;
                const o = ramp(frame, at, 9);
                const tone = line.tone ?? "plain";
                return (
                    <div
                        key={i}
                        style={{
                            color: TONE[tone],
                            opacity: o,
                            transform: `translateY(${(1 - o) * 5}px)`,
                            minHeight: line.text ? undefined : size * 0.9,
                        }}
                    >
                        {tone === "ok" && <span style={{ marginRight: 12 }}>✔</span>}
                        {line.text}
                    </div>
                );
            })}
        </div>
    );
};

export interface Step {
    command: string;
    output?: OutputLine[];
    /** Frames of nothing after the last output line, before the next prompt.
     *  A person reads what a command printed before typing the next one. */
    pause?: number;
    /** Pin this step to a frame instead of chaining it after the previous
     *  one. The desk film types two commands in one beat and the third in a
     *  later one, in the same window, with a minute of story in between. */
    at?: number;
}

/**
 * Several commands, one after another, in one window.
 *
 * Each step's prompt appears the moment the previous step's output has
 * finished, plus its pause — so the session is one continuous take rather
 * than three terminals stacked. The timing is a fold over the steps, which
 * is what lets a step's length be a property of the step: change one
 * command's output and everything after it moves.
 */
export const Session: React.FC<{
    steps: Step[];
    delay?: number;
    rate?: number;
    size?: number;
    prompt?: string;
    /** Pixel height of the window's body. When set, the session is anchored
     *  to the bottom and older lines scroll off the top as new ones print —
     *  what a terminal does. */
    scroll?: number;
    lineHeight?: number;
}> = ({ steps, delay = 0, rate = 1.15, size = 24, prompt = "$", scroll, lineHeight = 1.75 }) => {
    const frame = useCurrentFrame();

    const starts: number[] = [];
    let at = delay;
    for (const step of steps) {
        if (step.at !== undefined) at = step.at;
        starts.push(at);
        const typed = step.command.length * rate;
        const last = step.output?.length ? Math.max(...step.output.map((l) => l.at)) : 0;
        at += typed + last + 9 + (step.pause ?? 18);
    }

    /* A shell fills from the top and only starts scrolling once it is full.
       Bottom-aligning the content with flex did the second half and not the
       first: seven lines sat at the foot of an empty window. Pinning an
       inner box to the bottom with a min-height of the whole window does
       both — short content lays out from the top of that box, and content
       taller than it overflows upward, where it is clipped. */
    const body = (
        <div
            style={{
                fontFamily: FONT.mono,
                fontSize: size,
                lineHeight,
                ...(scroll ? { position: "absolute", left: 0, right: 0, bottom: 0, minHeight: "100%" } : {}),
            }}
        >
            {steps.map((step, i) => {
                const start = starts[i];
                if (frame < start) return null;
                const isLast = i === steps.length - 1;
                return (
                    <div key={i} style={{ marginTop: i === 0 ? 0 : size * 0.9, flexShrink: 0 }}>
                        <Terminal
                            command={step.command}
                            output={step.output}
                            delay={start}
                            rate={rate}
                            size={size}
                            prompt={prompt}
                            lazy={scroll !== undefined}
                            lineHeight={lineHeight}
                            /* Only the live prompt has a caret. Three blinking
                               carets is three shells, not one session. */
                            caret={isLast || frame < (starts[i + 1] ?? Infinity)}
                        />
                    </div>
                );
            })}
        </div>
    );
    if (!scroll) return body;
    return <div style={{ position: "relative", height: scroll, overflow: "hidden" }}>{body}</div>;
};
