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
}> = ({ command, output = [], delay = 0, rate = 1.15, size = 24, prompt = "$", caret = true }) => {
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
        <div style={{ fontFamily: FONT.mono, fontSize: size, lineHeight: 1.75 }}>
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
}> = ({ steps, delay = 0, rate = 1.15, size = 24, prompt = "$" }) => {
    const frame = useCurrentFrame();

    const starts: number[] = [];
    let at = delay;
    for (const step of steps) {
        starts.push(at);
        const typed = step.command.length * rate;
        const last = step.output?.length ? Math.max(...step.output.map((l) => l.at)) : 0;
        at += typed + last + 9 + (step.pause ?? 18);
    }

    return (
        <div style={{ fontFamily: FONT.mono, fontSize: size, lineHeight: 1.75 }}>
            {steps.map((step, i) => {
                const start = starts[i];
                if (frame < start) return null;
                const isLast = i === steps.length - 1;
                return (
                    <div key={i} style={{ marginTop: i === 0 ? 0 : size * 0.9 }}>
                        <Terminal
                            command={step.command}
                            output={step.output}
                            delay={start}
                            rate={rate}
                            size={size}
                            prompt={prompt}
                            /* Only the live prompt has a caret. Three blinking
                               carets is three shells, not one session. */
                            caret={isLast || frame < (starts[i + 1] ?? Infinity)}
                        />
                    </div>
                );
            })}
        </div>
    );
};
