import React, { createContext, useContext, useMemo } from "react";
import {
    AbsoluteFill,
    Easing,
    interpolate,
    OffthreadVideo,
    Sequence,
    staticFile,
    useCurrentFrame,
    useVideoConfig,
} from "remotion";
import { NeatCanvas } from "../gradient/NeatCanvas";
import { HERO_TONES } from "../data/neat-config";
import { Mark } from "../components/Mark";
import { ENTER, ramp, SHIFT } from "../components/motion";
import { LiveCamera, Placeholder, type LiveFeed, type Take } from "../desk/Presenter";
import { FONT, FRAME, GROUND, INK, SURFACE, TRACKING } from "../theme";
import {
    assertSameScript,
    authoredTiming,
    checkCues,
    cueFrame,
    LIVE_HORIZON,
    type Cue,
    type Script,
    type Timing,
} from "../spoken/narration";

/**
 * THE SERIES — ten short films, one benefit each, released one at a time.
 *
 * Each is 45-60 seconds, narrated to camera like the desk film, and comes in
 * two shapes from the same take: 16:9 (WIDE) for the site, YouTube and X,
 * and 9:16 (TALL) for Reels, Shorts and TikTok. A film is a SCRIPT and a list
 * of SCENES; each scene starts on a word of the script (a Cue), so a slower
 * read simply holds a scene longer, and the recording page can play the film
 * live while the presenter reads it (src/live).
 *
 * What every film shares lives here: the ground (the site's Neat ribbon in
 * its loud register), the presenter's window and its three places, the
 * scene shell (an entrance on the scene's cue, a dissolve out on the next
 * scene's), the episode mark, and the end card. What each film does with
 * its own scenes is its own business — they are meant to differ.
 */

export type Format = "wide" | "tall";

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

/** Where the presenter's window sits: large for the hook, small through the
 *  demo, large again for the last line. Per format. */
export interface PresenterPlan {
    open: Box;
    corner: Box;
    close: Box;
}

export const PRESENTER: Record<Format, PresenterPlan> = {
    wide: {
        open: { x: 520, y: 180, w: 880, h: 720 },
        /* 320, not the desk film's 260: a short is watched on a phone. */
        corner: { x: 1540, y: 700, w: 320, h: 320 },
        close: { x: 200, y: 240, w: 680, h: 600 },
    },
    /* 9:16 is a split screen: the product in the top half, the presenter in
       a wide card under it — the way vertical video is watched, face large.
       Feeds lay their own UI over the right edge and the bottom fifth, so
       nothing that must be read goes below ~1560 or right of ~960. */
    tall: {
        open: { x: 72, y: 300, w: 936, h: 1120 },
        corner: { x: 96, y: 1120, w: 888, h: 500 },
        close: { x: 72, y: 230, w: 936, h: 760 },
    },
};

export interface SceneSpec {
    id: string;
    /** When the scene starts: usually four frames after its line begins. */
    at: Cue;
    /** The ribbon's rotation while this scene is up — each scene turns it. */
    roll?: number;
    /** How much of the ribbon shows, 0-1. */
    reveal?: number;
    /** The ground colour under the scene. */
    ground?: string;
    render: React.FC;
}

export interface FilmSpec {
    /** Short id: the recording page's ?film= and the composition's name. */
    id: string;
    number: number;
    /** The benefit, as the episode mark sets it. */
    title: string;
    script: Script;
    scenes: SceneSpec[];
    /** The presenter leaves the open for the corner. */
    toCorner: Cue;
    /** The close begins: the presenter grows back and the end card lands. */
    close: Cue;
    /** The film's own hue, for its mark and accents. */
    accent: string;
    /** Per-format overrides of the presenter's places. */
    presenter?: Partial<Record<Format, Partial<PresenterPlan>>>;
}

/* ── the timeline ───────────────────────────────────────────────────── */

export interface SeriesTimeline {
    spec: FilmSpec;
    timing: Timing;
    /** Each placed scene's first frame; null while its word is unsaid. */
    starts: (number | null)[];
    toCorner: number | null;
    closeAt: number | null;
    /** The film's length: the last word, then a second and a half. */
    duration: number | null;
    until: number;
    cue(c: Cue): number | null;
}

/** Frames a scene is held before the next may begin, however fast the read. */
const MIN_SCENE = 24;
/** The end card's tail after the last word. */
const TAIL = 50;

export function buildSeries(spec: FilmSpec, timing: Timing): SeriesTimeline {
    if (timing.script) assertSameScript(spec.script, timing.script);
    const cue = (c: Cue) => cueFrame(spec.script, timing, c);
    const starts: (number | null)[] = [];
    let previous = -Infinity;
    for (const s of spec.scenes) {
        const at = cue(s.at);
        if (at === null) {
            starts.push(null);
            continue;
        }
        const start = Math.max(at, previous + MIN_SCENE, 0);
        starts.push(start);
        previous = start;
    }
    const last = spec.script[spec.script.length - 1];
    const end = cue({ line: last.id, end: true, plus: 0 });
    const duration = end === null ? null : end + TAIL;
    return {
        spec,
        timing,
        starts,
        toCorner: cue(spec.toCorner),
        closeAt: cue(spec.close),
        duration,
        until: duration ?? LIVE_HORIZON,
        cue,
    };
}

/** Fails at import if a film's cues name words its script does not have. */
export function checkFilm(spec: FilmSpec): FilmSpec {
    checkCues(spec.script, [...spec.scenes.map((s) => s.at), spec.toCorner, spec.close]);
    return spec;
}

const SeriesContext = createContext<SeriesTimeline | null>(null);
const SceneContext = createContext<{ start: number; next: number | null }>({ start: 0, next: null });

export function useSeries(): SeriesTimeline {
    const s = useContext(SeriesContext);
    if (!s) throw new Error("useSeries outside a series film");
    return s;
}

export function useFormat(): Format {
    const { width, height } = useVideoConfig();
    return height > width ? "tall" : "wide";
}

/** A cue's frame relative to the current scene, or null if unsaid. Inside a
 *  scene, `useCurrentFrame()` is local, so this is what to compare it to. */
export function useCue(c: Cue): number | null {
    const series = useSeries();
    const { start } = useContext(SceneContext);
    const at = series.cue(c);
    return at === null ? null : at - start;
}

/** Frames into the scene at which the next one starts (it is leaving). */
export function useSceneEnd(): number | null {
    const { start, next } = useContext(SceneContext);
    return next === null ? null : next - start;
}

/* ── the film ───────────────────────────────────────────────────────── */

export interface SeriesProps {
    timing?: Timing | null;
    take?: Take | null;
    live?: LiveFeed | null;
    [key: string]: unknown;
}

export function seriesDuration(spec: FilmSpec, props: SeriesProps): number {
    return buildSeries(spec, props.timing ?? authoredTiming(spec.script)).duration ?? 1;
}

/** The composition component for a film. */
export function seriesFilm(spec: FilmSpec): React.FC<SeriesProps> {
    const authored = authoredTiming(spec.script);
    const Film: React.FC<SeriesProps> = ({ timing, take, live }) => {
        const t = timing ?? authored;
        const series = useMemo(() => buildSeries(spec, t), [t]);
        return (
            <SeriesContext.Provider value={series}>
                <AbsoluteFill style={{ background: GROUND.base, overflow: "hidden" }}>
                    <Ribbon />
                    <Scenes />
                    <EndCard />
                    <Presenter take={take} live={live} />
                    <Captions />
                    <EpisodeMark />
                </AbsoluteFill>
            </SeriesContext.Provider>
        );
    };
    Film.displayName = `Series(${spec.id})`;
    return Film;
}

/* ── the ground ─────────────────────────────────────────────────────── */

const EASE = Easing.inOut(Easing.cubic);
const CLAMP = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Faded into the ground before the type, as in the desk film. */
const FADE_WIDE = "linear-gradient(to bottom, #000 0%, #000 9%, rgba(0,0,0,0.55) 20%, transparent 34%)";
const FADE_TALL = "linear-gradient(to bottom, #000 0%, #000 6%, rgba(0,0,0,0.55) 13%, transparent 22%)";

/** The ribbon: one Neat plane under the whole film, turning to each scene's
 *  roll over the scene's first second, steady in between. */
const Ribbon: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const series = useSeries();
    const format = useFormat();
    const keys: { at: number; roll: number; reveal: number; ground: string }[] = [
        { at: 0, roll: 0.1, reveal: 0, ground: GROUND.base },
    ];
    /* The ribbon rises with the first word, under the presenter's open. */
    const first = series.cue({ line: series.spec.script[0].id, plus: -4 });
    if (first !== null) keys.push({ at: Math.max(1, first), roll: 0.58, reveal: 0.8, ground: GROUND.base });
    series.spec.scenes.forEach((s, i) => {
        const start = series.starts[i];
        if (start === null) return;
        keys.push({ at: start, roll: s.roll ?? 0.3 + 0.13 * i, reveal: s.reveal ?? 0.8, ground: s.ground ?? GROUND.base });
    });
    /* A running blend: each scene eases the ribbon from wherever it is to
       its own roll and exposure over its first second. Continuous even when
       a fast read starts the next scene before the last blend has landed. */
    let roll = keys[0].roll;
    let reveal = keys[0].reveal;
    let ground = keys[0].ground;
    for (const k of keys.slice(1)) {
        if (frame < k.at) break;
        const p = interpolate(frame, [k.at, k.at + 30], [0, 1], { ...CLAMP, easing: EASE });
        roll += (k.roll - roll) * p;
        reveal += (k.reveal - reveal) * p;
        if (p >= 0.5) ground = k.ground;
    }
    /* The last frames are ground and the address: the ribbon goes. */
    const out = series.duration === null ? 1 : 1 - ramp(frame, series.duration - 60, 50, SHIFT);
    const fade = format === "tall" ? FADE_TALL : FADE_WIDE;
    return (
        <>
            <AbsoluteFill style={{ background: ground }} />
            <NeatCanvas
                framing="hero"
                tone={HERO_TONES.loud}
                opacity={reveal * out}
                camera={{ cameraX: 0, cameraY: format === "tall" ? -18 : -14, cameraZoom: format === "tall" ? 2.6 : 2.05, cameraRotationZ: roll }}
                time={frame / fps / 4}
                style={{ mixBlendMode: "screen", WebkitMaskImage: fade, maskImage: fade }}
            />
        </>
    );
};

/* ── scenes ─────────────────────────────────────────────────────────── */

const Scenes: React.FC = () => {
    const series = useSeries();
    return (
        <>
            {series.spec.scenes.map((s, i) => {
                const start = series.starts[i];
                if (start === null) return null;
                const next = series.starts.slice(i + 1).find((x): x is number => x !== null) ?? null;
                const end = next ?? series.until;
                const Render = s.render;
                return (
                    <Sequence key={s.id} from={start} durationInFrames={Math.max(1, end - start + EXIT)} layout="none">
                        <SceneContext.Provider value={{ start, next }}>
                            <Shell exitAt={next === null ? null : next - start}>
                                <Render />
                            </Shell>
                        </SceneContext.Provider>
                    </Sequence>
                );
            })}
        </>
    );
};

/** How long a scene takes to leave once the next has begun. */
const EXIT = 14;

/** A scene arrives on its cue — up a few pixels and in — and leaves as the
 *  next arrives: a dissolve with a slight shrink, never a slide across. */
const Shell: React.FC<{ exitAt: number | null; children: React.ReactNode }> = ({ exitAt, children }) => {
    const frame = useCurrentFrame();
    const enter = ramp(frame, 0, 16, ENTER);
    const exit = exitAt === null ? 0 : ramp(frame, exitAt, EXIT, SHIFT);
    const opacity = Math.min(enter, 1 - exit);
    if (opacity <= 0) return null;
    const moving = enter < 1 || exit > 0;
    return (
        <AbsoluteFill
            style={{
                opacity,
                transform: moving ? `translateY(${(1 - enter) * 18}px) scale(${1 - exit * 0.02})` : undefined,
            }}
        >
            {children}
        </AbsoluteFill>
    );
};

/* ── the presenter ──────────────────────────────────────────────────── */

function lerp(a: Box, b: Box, t: number): Box {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, w: a.w + (b.w - a.w) * t, h: a.h + (b.h - a.h) * t };
}

const Presenter: React.FC<{ take?: Take | null; live?: LiveFeed | null }> = ({ take, live }) => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const format = useFormat();
    const plan = { ...PRESENTER[format], ...(series.spec.presenter?.[format] ?? {}) };
    const opacity = ramp(frame, 0, 10);
    let box = plan.open;
    let stage = "open";
    if (series.toCorner !== null && frame >= series.toCorner) {
        box = lerp(plan.open, plan.corner, interpolate(frame, [series.toCorner, series.toCorner + 34], [0, 1], { ...CLAMP, easing: EASE }));
        stage = "corner";
    }
    if (series.closeAt !== null && frame >= series.closeAt) {
        box = lerp(plan.corner, plan.close, interpolate(frame, [series.closeAt, series.closeAt + 44], [0, 1], { ...CLAMP, easing: EASE }));
        stage = "close";
    }
    if (opacity <= 0) return null;
    return (
        <AbsoluteFill style={{ pointerEvents: "none" }}>
            <div
                style={{
                    position: "absolute",
                    left: Math.round(box.x),
                    top: Math.round(box.y),
                    width: Math.round(box.w),
                    height: Math.round(box.h),
                    borderRadius: FRAME.radius,
                    border: FRAME.border,
                    background: SURFACE.frame,
                    overflow: "hidden",
                    opacity,
                }}
            >
                {live?.stream ? (
                    <LiveCamera stream={live.stream} />
                ) : take ? (
                    <OffthreadVideo src={staticFile(take.src)} startFrom={take.startFrom} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <Placeholder stage={stage} />
                )}
            </div>
        </AbsoluteFill>
    );
};

/* ── the marks ──────────────────────────────────────────────────────── */

/** The episode, small, top left from the corner move on: which benefit this
 *  is, in the film's hue. A series is recognised by its constants. */
const EpisodeMark: React.FC = () => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const format = useFormat();
    if (series.toCorner === null) return null;
    const on = ramp(frame, series.toCorner + 10, 20);
    const off = series.closeAt === null ? 0 : ramp(frame, series.closeAt, 14, SHIFT);
    const o = Math.min(on, 1 - off);
    if (o <= 0) return null;
    const { number, title, accent } = series.spec;
    return (
        <div
            style={{
                position: "absolute",
                left: format === "tall" ? 72 : 120,
                top: format === "tall" ? 150 : 64,
                display: "flex",
                alignItems: "center",
                gap: 14,
                fontFamily: FONT.mono,
                fontSize: format === "tall" ? 22 : 17,
                letterSpacing: TRACKING.eyebrow,
                textTransform: "uppercase",
                color: INK.copy,
                opacity: o,
            }}
        >
            <span style={{ color: accent }}>{String(number).padStart(2, "0")}</span>
            <span style={{ width: 28, height: 1, background: INK.rule }} />
            <span>{title}</span>
        </div>
    );
};

/** The close: the mark, the address and the one command, beside (wide) or
 *  under (tall) the presenter. */
const EndCard: React.FC = () => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const format = useFormat();
    if (series.closeAt === null) return null;
    const at = series.closeAt + 24;
    if (frame < at) return null;
    const url = ramp(frame, at + 22, 24);
    const cmd = ramp(frame, at + 40, 22);
    const plan = { ...PRESENTER[format], ...(series.spec.presenter?.[format] ?? {}) };
    const tall = format === "tall";
    const area: React.CSSProperties = tall
        ? { left: 0, right: 0, top: plan.close.y + plan.close.h + 40, bottom: 260 }
        : { left: plan.close.x + plan.close.w + 60, right: 120, top: 0, bottom: 0 };
    return (
        <AbsoluteFill>
            <AbsoluteFill style={{ background: GROUND.base, opacity: 0.82 * ramp(frame, at - 20, 40) }} />
            <div style={{ position: "absolute", ...area, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <Mark size={tall ? 96 : 110} delay={at} spread={18} />
                <div style={{ overflow: "hidden", marginTop: 32, paddingBottom: "0.12em" }}>
                    <div
                        style={{
                            fontFamily: FONT.display,
                            fontWeight: 600,
                            fontSize: tall ? 92 : 100,
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
                        marginTop: 34,
                        padding: "16px 30px",
                        borderRadius: 12,
                        border: `1px solid ${INK.rule}`,
                        background: FRAME.background,
                        fontFamily: FONT.mono,
                        fontSize: tall ? 30 : 26,
                        color: INK.high,
                        opacity: cmd,
                        transform: `translateY(${(1 - cmd) * 14}px)`,
                    }}
                >
                    <span style={{ color: INK.muted, marginRight: 14 }}>$</span>
                    pnpm dlx @rebasepro/cli init
                </div>
            </div>
        </AbsoluteFill>
    );
};

/* ── building blocks for scenes ─────────────────────────────────────── */

/** The content box a scene lays out in: clear of the presenter's corner, the
 *  episode mark and (tall) the feed's own overlays. */
export function useStage(): { x: number; y: number; w: number; h: number; format: Format } {
    const format = useFormat();
    return format === "tall" ? { x: 72, y: 230, w: 936, h: 790, format } : { x: 120, y: 150, w: 1380, h: 760, format };
}

/** A headline set word by word into clip boxes, each word landing on its
 *  frame (local), as the brand's type always enters. */
export const Words: React.FC<{
    text: string;
    at: number;
    size: number;
    step?: number;
    color?: string;
    weight?: number;
    style?: React.CSSProperties;
    /** Words to set in this colour. */
    mark?: { words: string[]; color: string };
}> = ({ text, at, size, step = 3, color = INK.high, weight = 600, style, mark }) => {
    const frame = useCurrentFrame();
    const words = text.split(" ");
    return (
        <div style={{ fontFamily: FONT.display, fontWeight: weight, fontSize: size, lineHeight: 1.04, letterSpacing: TRACKING.display, color, ...style }}>
            {words.map((w, i) => {
                const t = ramp(frame, at + i * step, 18, ENTER);
                const marked = mark?.words.includes(w.replace(/[^\w'-]/g, ""));
                return (
                    <span key={i} style={{ display: "inline-block", overflow: "hidden", paddingBottom: "0.2em", marginBottom: "-0.2em", verticalAlign: "top" }}>
                        <span
                            style={{
                                display: "inline-block",
                                transform: t < 1 ? `translateY(${(1 - t) * 105}%)` : undefined,
                                color: marked ? mark?.color : undefined,
                            }}
                        >
                            {w}
                            {i < words.length - 1 ? " " : ""}
                        </span>
                    </span>
                );
            })}
        </div>
    );
};

/** A small uppercase label over a block. */
export const Label: React.FC<{ children: React.ReactNode; at: number; color?: string; size?: number }> = ({ children, at, color = INK.muted, size = 16 }) => {
    const frame = useCurrentFrame();
    return (
        <div
            style={{
                fontFamily: FONT.mono,
                fontSize: size,
                letterSpacing: TRACKING.eyebrow,
                textTransform: "uppercase",
                color,
                opacity: ramp(frame, at, 12),
            }}
        >
            {children}
        </div>
    );
};

/** Positioned absolutely on the frame. */
export const At: React.FC<{ x: number; y: number; w?: number; children: React.ReactNode; style?: React.CSSProperties }> = ({ x, y, w, children, style }) => (
    <div style={{ position: "absolute", left: x, top: y, width: w, ...style }}>{children}</div>
);

/* ── captions ───────────────────────────────────────────────────────── */

/** How many words a caption shows at once. */
const CHUNK = 4;

/**
 * What is being said, a few words at a time, as it is said: feeds autoplay
 * muted, and a short that cannot be followed without sound is not watched.
 * Chunks break at punctuation as well as at CHUNK words, so a caption never
 * runs across the end of a sentence. Timed from the same Timing as every
 * picture, so a take's captions are the take's own words at its own pace.
 */
const Captions: React.FC = () => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const format = useFormat();
    /* The open and the close are said to camera, large: no captions there. */
    if (series.toCorner === null || frame < series.toCorner + 20) return null;
    if (series.closeAt !== null && frame >= series.closeAt) return null;
    const { script } = series.spec;
    let shown: string[] | null = null;
    let lit = 0;
    script.forEach((line, k) => {
        const said = series.timing.lines[k];
        if (!said || said.words.length === 0) return;
        const end = said.end ?? Infinity;
        if (frame < said.words[0] || frame > end + 12) return;
        /* Chunks of the line. */
        const chunks: number[][] = [];
        let cur: number[] = [];
        line.words.forEach((w, i) => {
            cur.push(i);
            if (cur.length >= CHUNK || /[.,:;?!]$/.test(w)) {
                chunks.push(cur);
                cur = [];
            }
        });
        if (cur.length) chunks.push(cur);
        for (const c of chunks) {
            const startAt = said.words[c[0]];
            if (startAt === undefined || frame < startAt) break;
            shown = c.map((i) => line.words[i]);
            lit = c.filter((i) => said.words[i] !== undefined && frame >= said.words[i]).length;
        }
    });
    if (!shown) return null;
    const words: string[] = shown;
    const tall = format === "tall";
    return (
        <div
            style={{
                position: "absolute",
                left: tall ? 72 : 120,
                right: tall ? 72 : 420,
                top: tall ? 1040 : undefined,
                bottom: tall ? undefined : 70,
                display: "flex",
                justifyContent: tall ? "center" : "flex-start",
                pointerEvents: "none",
            }}
        >
            <div
                style={{
                    fontFamily: FONT.display,
                    fontWeight: 600,
                    fontSize: tall ? 50 : 40,
                    letterSpacing: "-0.015em",
                    lineHeight: 1.1,
                    padding: "8px 18px",
                    borderRadius: 10,
                    background: "rgba(9,10,12,0.72)",
                }}
            >
                {words.map((w, i) => (
                    <span key={i} style={{ color: i < lit ? INK.high : "rgba(246,247,248,0.42)" }}>
                        {w.replace(/[.,:;]$/, "")}
                        {i < words.length - 1 ? " " : ""}
                    </span>
                ))}
            </div>
        </div>
    );
};

/** The scene's headline: what the scene says, readable with the sound off.
 *  Top of the stage, one size per format, words rising into place. */
export const HEADLINE = { wide: 76, tall: 70 } as const;

export const Headline: React.FC<{ text: string; at?: number; accent?: string; mark?: string[]; width?: number }> = ({
    text,
    at = 4,
    accent,
    mark,
    width,
}) => {
    const { x, y, w, format } = useStage();
    return (
        <At x={x} y={y} w={width ?? w}>
            <Words text={text} at={at} size={HEADLINE[format]} step={2} mark={accent && mark ? { words: mark, color: accent } : undefined} />
        </At>
    );
};

/** Where a scene's artifact goes: under its headline (two lines' room). */
export function useBody(lines = 1): { x: number; y: number; w: number; format: Format } {
    const { x, y, w, format } = useStage();
    const lh = HEADLINE[format] * 1.04;
    return { x, y: y + lines * lh + (format === "tall" ? 48 : 56), w, format };
}
