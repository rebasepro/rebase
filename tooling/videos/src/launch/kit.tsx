import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import { CHROMA, FONT, FRAME, TRACKING } from "../theme";
import { useTone } from "../Plane";
import { ENTER, ramp, SHIFT } from "../components/motion";

/**
 * The launch film's parts: kinetic type, the product window and the callout
 * that points into it.
 *
 * The film is a 30-second teaser cut to music, the format short product
 * videos use for feeds and launch pages: one idea per bar, type set on the
 * beat, the product shown up close. It is built from the same tokens as the
 * long films (theme.ts) — the grounds, the faces, the 600 weight ceiling —
 * and runs at 60 fps, so every duration here is in sixtieths.
 */

/** Three display sizes, chosen by role, as in the long film. */
export const SIZE = {
    /** One word or a short claim that IS the frame. */
    word: 150,
    /** A sentence set across the frame. */
    line: 96,
    /** A claim in a stacked list. */
    list: 112,
} as const;

/** The callout hue. Cyan is in the mark and on the site's ribbon, and on the
 *  near-black ground it is 10:1 — a label you can read at feed size. */
export const ACCENT = CHROMA.cyan;

/** The callout hue on the current ground: cyan on near-black, white on a
 *  chroma field, where cyan is too close in value to the blue to read. */
function useAccent(): string {
    const tone = useTone();
    return tone.high === "#FFFFFF" ? tone.high : ACCENT;
}

/** Left margin every section aligns to. */
export const GUTTER = 140;

/**
 * How many frames before its beat a thing starts to move, so that it LANDS
 * on the beat. Starting an entrance on the beat puts the kick on an empty
 * frame and the content a third of a second behind the music — measured on
 * the first render, every section's downbeat was bare ground. With the expo
 * ENTER curve, six frames in is ~85% of the way there.
 */
export const LEAD = 6;

/**
 * One word (or a few) set into its own clip box, rising into place so it
 * lands on its frame. A box per word is what lets a sentence assemble on the
 * beat; the box carries room for descenders so a g or a y is never sliced
 * flat.
 */
export const Word: React.FC<{
    children: React.ReactNode;
    at: number;
    size: number;
    color?: string;
    /** Frames for the rise. Short: a word lands on a beat, it does not drift. */
    duration?: number;
    style?: React.CSSProperties;
}> = ({ children, at, size, color, duration = 16, style }) => {
    const frame = useCurrentFrame();
    const tone = useTone();
    const start = at - LEAD;
    const t = ramp(frame, start, duration);
    return (
        <span
            style={{
                display: "inline-block",
                overflow: "hidden",
                paddingBottom: "0.24em",
                marginBottom: "-0.24em",
                verticalAlign: "top",
            }}
        >
            <span
                style={{
                    display: "inline-block",
                    fontFamily: FONT.display,
                    fontWeight: 600,
                    fontSize: size,
                    lineHeight: 1.02,
                    letterSpacing: TRACKING.display,
                    color: color ?? tone.high,
                    transform: `translateY(${(1 - t) * 110}%)`,
                    opacity: frame < start ? 0 : 1,
                    whiteSpace: "pre",
                    ...style,
                }}
            >
                {children}
            </span>
        </span>
    );
};

/** A line of words, each landing on its own frame. */
export const Sentence: React.FC<{
    words: [text: string, at: number][];
    size: number;
    color?: string;
    style?: React.CSSProperties;
}> = ({ words, size, color, style }) => (
    <div style={{ display: "flex", flexWrap: "nowrap", columnGap: size * 0.26, ...style }}>
        {words.map(([text, at], i) => (
            <Word key={i} at={at} size={size} color={color}>
                {text}
            </Word>
        ))}
    </div>
);

/** Small, mono, tracked. Never a sentence. */
export const Eyebrow: React.FC<{ children: React.ReactNode; at: number; color?: string }> = ({
    children,
    at,
    color,
}) => {
    const frame = useCurrentFrame();
    const tone = useTone();
    const t = ramp(frame, at, 18);
    return (
        <div
            style={{
                fontFamily: FONT.mono,
                fontSize: 20,
                textTransform: "uppercase",
                letterSpacing: TRACKING.eyebrow,
                color: color ?? tone.muted,
                opacity: t,
                transform: `translateY(${(1 - t) * 10}px)`,
            }}
        >
            {children}
        </div>
    );
};

/** The window's entrance, in frames, and the section frame it has landed
 *  by: it starts two LEADs before the downbeat. A camera move must not start
 *  before this, or it fights the entrance's own easing. */
const ENTRANCE = 30;
export const WINDOW_LANDS = ENTRANCE - LEAD * 2;

/** Where the product window sits in every verb section, in frame pixels.
 *  8:5, the demo footage's own aspect, so a clip fills it uncropped. */
export const WINDOW = { x: 760, y: 198, width: 1088, height: 680 } as const;

/**
 * A point the window's camera pushes in on, from `at` until the next one.
 * Scaling happens AROUND the point, so a callout's ring stays on its target
 * for as long as the camera holds it — only the move between two points
 * travels, and that is timed to land before the next callout arrives.
 */
export interface Focus {
    at: number;
    /** Fraction of the window. */
    target: [x: number, y: number];
    scale: number;
}

/** The camera's slow drift after it lands, so a held shot is not a still. */
const DRIFT = 0.05;
const MOVE = 30;

function camera(frame: number, focus: Focus[]) {
    let s = 1;
    let ox = 0;
    let oy = 0;
    for (const f of focus) {
        if (frame < f.at) break;
        const px = f.target[0] * WINDOW.width;
        const py = f.target[1] * WINDOW.height;
        const scale = f.scale * (1 + DRIFT * ramp(frame, f.at + MOVE, 200, (t) => t));
        const k = ramp(frame, f.at, MOVE, SHIFT);
        s = s + (scale - s) * k;
        ox = ox + (px * (1 - scale) - ox) * k;
        oy = oy + (py * (1 - scale) - oy) * k;
    }
    return { s, ox, oy };
}

/**
 * The product surface: a sheet with a hairline and the card radius, no
 * shadow — the treatment theme.ts gives every product surface. It arrives
 * from the right on the section's downbeat.
 */
export const ProductWindow: React.FC<{
    children: React.ReactNode;
    at?: number;
    focus?: Focus[];
    /** A window that is not the standard one (the camera assumes WINDOW). */
    rect?: { x: number; y: number; width: number; height: number };
}> = ({ children, at = 0, focus = [], rect = WINDOW }) => {
    const frame = useCurrentFrame();
    // Lands on the downbeat with the verb, rather than starting from it.
    const t = ramp(frame, at - LEAD * 2, ENTRANCE);
    const cam = camera(frame, focus);
    return (
        <div
            style={{
                position: "absolute",
                left: rect.x,
                top: rect.y,
                width: rect.width,
                height: rect.height,
                borderRadius: FRAME.radius,
                border: FRAME.border,
                background: FRAME.background,
                overflow: "hidden",
                opacity: interpolate(t, [0, 0.4], [0, 1], { extrapolateRight: "clamp" }),
                transform: `translateX(${(1 - t) * 160}px) scale(${0.96 + 0.04 * t})`,
                transformOrigin: "left center",
            }}
        >
            <div
                style={{
                    position: "absolute",
                    inset: 0,
                    transformOrigin: "0 0",
                    transform: `translate(${cam.ox}px, ${cam.oy}px) scale(${cam.s})`,
                }}
            >
                {children}
            </div>
        </div>
    );
};

export interface CalloutSpec {
    label: string;
    text: string;
    /** Where the line ends, as a fraction of the product window. */
    target: [x: number, y: number];
    /** Section-local frames: on, and (optionally) off. */
    at: number;
    until?: number;
}

/** Where callouts are set: under the verb, in the left column, at the height
 *  of what they point at where that leaves room — so the line runs flat. */
const CALLOUT = { x: GUTTER, top: 540, bottom: 780, width: 500 } as const;

/**
 * A label in the accent, a sentence under it, and a hairline from the label
 * into the product, ending on a ring — the thing the sentence is about.
 * Callouts replace each other in place; one is on screen at a time.
 */
export const Callout: React.FC<CalloutSpec> = ({ label, text, target, at, until }) => {
    const frame = useCurrentFrame();
    const { width, height } = useVideoConfig();
    const tone = useTone();
    const accent = useAccent();

    const on = ramp(frame, at, 18);
    const off = until === undefined ? 0 : ramp(frame, until, 10, SHIFT);
    if (frame < at || off >= 1) return null;

    const line = ramp(frame, at + 6, 22, ENTER);
    const ring = ramp(frame, at + 20, 14);

    // The label's right edge is measured from its length rather than from the
    // DOM: a render is a screenshot, and there is no layout pass to wait for.
    const labelWidth = label.length * 20 * 0.6 + (label.length - 1) * 20 * 0.22;
    const tx = WINDOW.x + target[0] * WINDOW.width;
    const ty = WINDOW.y + target[1] * WINDOW.height;
    const top = Math.min(CALLOUT.bottom, Math.max(CALLOUT.top, ty - 12));
    const x0 = CALLOUT.x + labelWidth + 22;
    const y0 = top + 12;
    const elbow = WINDOW.x - 50;
    const path = `M ${x0} ${y0} H ${elbow} L ${tx} ${ty}`;
    const length = elbow - x0 + Math.hypot(tx - elbow, ty - y0);

    const alpha = on * (1 - off);
    return (
        <>
            <svg
                width={width}
                height={height}
                style={{ position: "absolute", inset: 0, opacity: 1 - off }}
            >
                <path
                    d={path}
                    fill="none"
                    stroke={accent}
                    strokeWidth={2}
                    strokeDasharray={length}
                    strokeDashoffset={(1 - line) * length}
                />
                <circle cx={tx} cy={ty} r={18 * ring} fill="none" stroke={accent} strokeWidth={2} opacity={ring} />
                <circle cx={tx} cy={ty} r={6 * ring} fill={accent} />
            </svg>
            <div
                style={{
                    position: "absolute",
                    left: CALLOUT.x,
                    top,
                    width: CALLOUT.width,
                    opacity: alpha,
                    transform: `translateY(${(1 - on) * 14 - off * 14}px)`,
                }}
            >
                <div
                    style={{
                        fontFamily: FONT.mono,
                        fontSize: 20,
                        lineHeight: "24px",
                        textTransform: "uppercase",
                        letterSpacing: TRACKING.eyebrow,
                        color: accent,
                    }}
                >
                    {label}
                </div>
                <div
                    style={{
                        marginTop: 18,
                        fontFamily: FONT.body,
                        fontSize: 32,
                        lineHeight: 1.35,
                        letterSpacing: "-0.01em",
                        color: tone.copy,
                        textWrap: "balance",
                    }}
                >
                    {text}
                </div>
            </div>
        </>
    );
};

/** The verb that names a section, with the eyebrow that says which product
 *  it is. Set on the downbeat. */
/** The widest a verb may set: the left column, short of the window. */
const VERB_MAX = WINDOW.x - GUTTER - 60;

const widths = new Map<string, number>();

/**
 * A display string's width, measured with the loaded face. Measured rather
 * than estimated because the verbs differ by a third in length ("Build." to
 * "Delegate.") and at a fixed size the long ones ran into the window. Only
 * cached once the face is really there, so a fallback measurement taken
 * before fonts resolve is never kept.
 */
function displayWidth(text: string, size: number): number {
    const key = `${size}|${text}`;
    const known = widths.get(key);
    if (known !== undefined) return known;
    const ctx = document.createElement("canvas").getContext("2d");
    if (!ctx) return 0;
    const font = `600 ${size}px 'Instrument Sans'`;
    ctx.font = font;
    const tracking = parseFloat(TRACKING.display) * size;
    const width = ctx.measureText(text).width + tracking * text.length;
    if (document.fonts.check(font)) widths.set(key, width);
    return width;
}

export const Verb: React.FC<{ word: string; product: string }> = ({ word, product }) => {
    const size = Math.min(SIZE.word, Math.floor((SIZE.word * VERB_MAX) / Math.max(1, displayWidth(word, SIZE.word))));
    return (
        <div style={{ position: "absolute", left: GUTTER, top: 250 }}>
            <Eyebrow at={4}>{product}</Eyebrow>
            <div style={{ marginTop: 22 }}>
                <Word at={0} size={size} duration={20}>
                    {word}
                </Word>
            </div>
        </div>
    );
};

/** A label and its sentence in the callout position, with no line: for a
 *  section whose picture is a diagram that already draws its own. */
export const Caption: React.FC<{ label: string; text: string; at: number }> = ({ label, text, at }) => {
    const frame = useCurrentFrame();
    const tone = useTone();
    const accent = useAccent();
    const on = ramp(frame, at, 18);
    if (frame < at) return null;
    return (
        <div
            style={{
                position: "absolute",
                left: GUTTER,
                top: CALLOUT.top,
                width: CALLOUT.width,
                opacity: on,
                transform: `translateY(${(1 - on) * 14}px)`,
            }}
        >
            <div
                style={{
                    fontFamily: FONT.mono,
                    fontSize: 20,
                    lineHeight: "24px",
                    textTransform: "uppercase",
                    letterSpacing: TRACKING.eyebrow,
                    color: accent,
                }}
            >
                {label}
            </div>
            <div
                style={{
                    marginTop: 18,
                    fontFamily: FONT.body,
                    fontSize: 32,
                    lineHeight: 1.35,
                    letterSpacing: "-0.01em",
                    color: tone.copy,
                    textWrap: "balance",
                }}
            >
                {text}
            </div>
        </div>
    );
};

/**
 * A type slide's slow push: the frame is never quite still while it is
 * read. Without it the holds between word hits measured as frozen video
 * (0.5-0.8 s at a time, five times) under freezedetect.
 */
export const Drift: React.FC<{ children: React.ReactNode; frames: number }> = ({ children, frames }) => {
    const frame = useCurrentFrame();
    return (
        <AbsoluteFill style={{ transform: `scale(${1 + 0.03 * (frame / frames)})`, transformOrigin: "30% 50%" }}>
            {children}
        </AbsoluteFill>
    );
};

