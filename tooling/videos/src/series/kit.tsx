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
import { DraftingGrid, GLOW_MASK, GlowField, isChromaGround, railInset, RailRule, seatForRoll } from "../gradient/GlowField";
import { Mark } from "../components/Mark";
import { Code } from "../components/Code";
import { Dot } from "../components/Type";
import { ENTER, ramp, SHIFT } from "../components/motion";
import { LiveCamera, Placeholder, type LiveFeed, type Take } from "../desk/Presenter";
import { DISSOLVE, type Clip } from "../spoken/production";
import { EYEBROW, FONT, FRAME, GROUND, INK, SURFACE, TONE, TRACKING } from "../theme";
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
 * What every film shares lives here: the ground (the site's hero backdrop:
 * the glow field masked into the ground, under the drafting grid and its
 * rails — gradient/GlowField.tsx), the presenter's window and its three places, the
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
    /** The scene's turn: once the ribbon's rotation, now read as the glow's
     *  seat (seatForRoll) — each scene moves the field to its own light. */
    roll?: number;
    /** How much of the field shows, 0-1. */
    reveal?: number;
    /** One of the film's bright moments: the field at the hero's full
     *  strength instead of banked to EMBER. Keep it to the film's turn —
     *  one scene, the payoff; the open is always bright. */
    bright?: boolean;
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
    /** A film-wide layer over the scenes that does not cut with them: a
     *  picture that persists and changes state across several scenes (the
     *  explainers' floor plan). It times itself off `useSeries()`; frames
     *  are the film's own. None by default. */
    layer?: React.FC;
    /** The command under the address on the end card. Undefined keeps the
     *  series' `pnpm dlx @rebasepro/cli init`; null leaves the line out. */
    endCommand?: string | null;
    /** The backdrop. "glow" (the default) is the site's hero field under the
     *  drafting grid, banking per scene, with chroma grounds where a scene
     *  asks; "dark" is plain `GROUND.base` under the grid for the whole film,
     *  every scene's `ground`, `roll`, `reveal` and `bright` ignored. */
    backdrop?: "glow" | "dark";
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
    /* A cut leaves lines out (a short is a few of the long film's): a cue on
       a line this cut does not have is a line never said — null, as an
       unsaid word is live. Scenes, the corner and the close are still
       checked against the cut's own script at import (checkFilm). */
    const has = new Set(spec.script.map((l) => l.id));
    const cue = (c: Cue) => (has.has(c.line) ? cueFrame(spec.script, timing, c) : null);
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

export const SeriesContext = createContext<SeriesTimeline | null>(null);
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
    /** An assembled film's recordings, laid end to end (production.ts):
     *  instead of one `take`. */
    clips?: Clip[] | null;
    live?: LiveFeed | null;
    /** FOR scripts/audit-film.ts ONLY. "probe" renders the film as it is and
     *  logs the display-type sizes on screen; "content" also drops the
     *  ground, the captions and the episode mark and paints the presenter
     *  flat while large, so what is left is what the scenes, the layer and
     *  the end card put up — a bare-ground frame renders black. Absent,
     *  nothing changes. */
    audit?: "probe" | "content" | null;
    [key: string]: unknown;
}

export function seriesDuration(spec: FilmSpec, props: SeriesProps): number {
    return buildSeries(spec, props.timing ?? authoredTiming(spec.script)).duration ?? 1;
}

/** The composition component for a film. */
export function seriesFilm(spec: FilmSpec): React.FC<SeriesProps> {
    const authored = authoredTiming(spec.script);
    const Layer = spec.layer;
    const Film: React.FC<SeriesProps> = ({ timing, take, clips, live, audit }) => {
        const t = timing ?? authored;
        const series = useMemo(() => buildSeries(spec, t), [t]);
        if (audit === "content") {
            return (
                <SeriesContext.Provider value={series}>
                    <AbsoluteFill style={{ background: "#000", overflow: "hidden" }}>
                        <Scenes />
                        {Layer && <Layer />}
                        <EndCard />
                        <Presenter flat />
                        <AuditProbe />
                    </AbsoluteFill>
                </SeriesContext.Provider>
            );
        }
        return (
            <SeriesContext.Provider value={series}>
                <AbsoluteFill style={{ background: GROUND.base, overflow: "hidden" }}>
                    <Ribbon />
                    <Scenes />
                    {Layer && <Layer />}
                    <EndCard />
                    <Presenter take={take} clips={clips} live={live} />
                    <Captions />
                    <OpenBadge />
                    <EpisodeMark />
                    {audit === "probe" && <AuditProbe />}
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

/** The glow, masked into the ground. Wide is the site's hero mask exactly
 *  (the frame is the hero). Tall holds it to the top third: the product sits
 *  in the top half of a vertical cut and the presenter's card under it, so
 *  the field gives way earlier, as the site's does on a phone-height hero. */
const MASK_WIDE = GLOW_MASK;
const MASK_TALL = "linear-gradient(to bottom, #000 0%, #000 16%, transparent 50%)";

/** The field's strength under normal scenes, as a share of the hero's. Kept
 *  whisper-quiet (0.13) so content scenes read on pure `#08090A` with the
 *  drafted grid and rails leading — just like the site's chapters below the
 *  hero. The open and `bright` payoff scenes bring the full hero glow back. */
const EMBER = 0.13;

/** The ground: the glow field under the whole film, flowing to each scene's
 *  seat over the scene's first second, steady in between; the drafting grid
 *  and its rails over it. Kept under its old name — the films and the EIC
 *  film mount it as <Ribbon />. */
export const Ribbon: React.FC = () => {
    const frame = useCurrentFrame();
    const { fps } = useVideoConfig();
    const series = useSeries();
    const format = useFormat();
    if (series.spec.backdrop === "dark") return <DraftingGrid chroma={false} />;
    /* The film opens on the hero at full colour from its first frame — no
       rise out of black, so the only change of strength is the bank to the
       ember when the scenes begin (and back for a bright one). */
    const keys: { at: number; roll: number; reveal: number; ground: string }[] = [
        { at: 0, roll: 0.58, reveal: 0.8, ground: GROUND.base },
    ];
    series.spec.scenes.forEach((s, i) => {
        const start = series.starts[i];
        if (start === null) return;
        /* Under a scene the field banks to an ember of itself, unless the
           scene is one of the film's bright moments. */
        const exposure = (s.reveal ?? 0.8) * (s.bright ? 1 : EMBER);
        keys.push({ at: start, roll: s.roll ?? 0.3 + 0.13 * i, reveal: exposure, ground: s.ground ?? GROUND.base });
    });
    /* A running blend: each scene eases the field from wherever it is to
       its own seat and exposure over its first second. Continuous even when
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
    /* The last frames are ground and the address: the field goes. */
    const out = series.duration === null ? 1 : 1 - ramp(frame, series.duration - 60, 50, SHIFT);
    return (
        <>
            <GlowField
                ground={ground}
                reveal={reveal * out}
                seat={seatForRoll(roll)}
                time={frame / fps / 4}
                mask={format === "tall" ? MASK_TALL : MASK_WIDE}
            />
            <DraftingGrid chroma={isChromaGround(ground)} />
        </>
    );
};

/* ── scenes ─────────────────────────────────────────────────────────── */

export const Scenes: React.FC = () => {
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

/** How long a scene takes to leave once the next has begun: quicker than
 *  the next one's entrance, so two headlines never sit on top of each other. */
const EXIT = 8;

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

const Presenter: React.FC<{ take?: Take | null; clips?: Clip[] | null; live?: LiveFeed | null; flat?: boolean }> = ({ take, clips, live, flat }) => {
    const frame = useCurrentFrame();
    const series = useSeries();
    const format = useFormat();
    const plan = { ...PRESENTER[format], ...(series.spec.presenter?.[format] ?? {}) };
    /* In the picture from the first frame, like the ground: a film that
       opens on a person never pops them in. */
    const opacity = 1;
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
    if (flat) {
        /* The audit's stand-in: solid while the presenter is the picture
           (open, close and the moves between), gone in the corner, where it
           is not what fills the frame. */
        const area = (b: Box) => b.w * b.h;
        const large = Math.min(1, Math.max(0, (area(box) - area(plan.corner)) / (area(plan.open) - area(plan.corner) || 1)));
        if (large <= 0.02) return null;
        return <div style={{ position: "absolute", left: box.x, top: box.y, width: box.w, height: box.h, background: "#808080", opacity: opacity * large }} />;
    }
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
                ) : clips && clips.length > 0 ? (
                    <Clips clips={clips} stage={stage} />
                ) : take ? (
                    <OffthreadVideo src={staticFile(take.src)} startFrom={take.startFrom} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                ) : (
                    <Placeholder stage={stage} />
                )}
            </div>
        </AbsoluteFill>
    );
};

/** An assembled film's recordings, end to end. Each after the first fades
 *  in over the one before for DISSOLVE frames (the earlier runs on under
 *  it, its sound fading out), so a cut between takes never jumps. Where no
 *  clip plays — a line nobody has recorded yet — the placeholder shows. */
const Clips: React.FC<{ clips: Clip[]; stage: string }> = ({ clips, stage }) => (
    <>
        <Placeholder stage={stage} />
        {clips.map((c, i) => (
            <Sequence key={`${c.take}-${c.from}`} from={c.from} durationInFrames={Math.max(1, c.to - c.from + (i < clips.length - 1 ? DISSOLVE : 0))} layout="none">
                <ClipVideo clip={c} fadeIn={i > 0} fadeOut={i < clips.length - 1} />
            </Sequence>
        ))}
    </>
);

const ClipVideo: React.FC<{ clip: Clip; fadeIn: boolean; fadeOut: boolean }> = ({ clip, fadeIn, fadeOut }) => {
    const frame = useCurrentFrame();
    const length = clip.to - clip.from;
    const o = fadeIn ? ramp(frame, 0, DISSOLVE) : 1;
    return (
        <AbsoluteFill style={{ opacity: o }}>
            <OffthreadVideo
                src={staticFile(clip.src)}
                startFrom={clip.startFrom}
                volume={(f) => (fadeIn ? Math.min(1, f / DISSOLVE) : 1) * (fadeOut ? Math.max(0, Math.min(1, (length + DISSOLVE - f) / DISSOLVE)) : 1)}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
        </AbsoluteFill>
    );
};

/* ── the marks ──────────────────────────────────────────────────────── */

/** Whether the currently active scene sits on a chroma ground (`#0021C1`). */
function useActiveScene(): { index: number; total: number; chroma: boolean } {
    const frame = useCurrentFrame();
    const series = useSeries();
    const contentScenes = series.spec.scenes.filter((s) => s.id !== "close");
    let active = 0;
    let chroma = false;
    contentScenes.forEach((s, idx) => {
        const origIdx = series.spec.scenes.indexOf(s);
        const start = series.starts[origIdx];
        if (start !== null && frame >= start) {
            active = idx;
            chroma = series.spec.backdrop !== "dark" && isChromaGround(s.ground ?? GROUND.base);
        }
    });
    return { index: active, total: Math.max(1, contentScenes.length), chroma };
}

/** The landing-page `.hero-badge` dark-glass pill shown over the hero glow
 *  during the opening hook (before the presenter moves to the corner). */
const OpenBadge: React.FC = () => {
    const frame = useCurrentFrame();
    const { width } = useVideoConfig();
    const series = useSeries();
    const format = useFormat();
    const off = series.toCorner === null ? 0 : ramp(frame, series.toCorner - 4, 14, SHIFT);
    const o = 1 - off;
    if (o <= 0) return null;
    const tall = format === "tall";
    const inset = railInset(width);
    const padX = tall ? 72 : 120;
    const { number, title, accent } = series.spec;
    const badgeLabel = number === 0 ? "POSTGRESQL — YOURS, OR ONE WE RUN FOR YOU" : `${String(number).padStart(2, "0")} · ${title}`;
    const rightTag = number === 0 ? "00 / REBASE INTRODUCTION" : `SERIES · ${String(number).padStart(2, "0")} / 10`;
    return (
        <div data-audit="skip" style={{ position: "absolute", inset: 0, opacity: o, pointerEvents: "none" }}>
            <div
                style={{
                    position: "absolute",
                    left: padX,
                    right: padX,
                    top: tall ? 136 : 56,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                }}
            >
                <div
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 12,
                        padding: tall ? "10px 20px" : "8px 18px",
                        borderRadius: 9999,
                        border: "1px solid rgba(255,255,255,0.14)",
                        background: "rgba(9,10,12,0.72)",
                        fontFamily: FONT.mono,
                        fontSize: tall ? 18 : 15,
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                        color: INK.high,
                    }}
                >
                    <Dot color={accent} size={tall ? 8 : 6} />
                    <span>{badgeLabel}</span>
                </div>
                {!tall && (
                    <span
                        style={{
                            fontFamily: FONT.mono,
                            fontSize: 15,
                            letterSpacing: TRACKING.eyebrow,
                            textTransform: "uppercase",
                            color: TONE.base.eyebrow,
                            fontVariantNumeric: "tabular-nums",
                        }}
                    >
                        {rightTag}
                    </span>
                )}
            </div>
            <RailRule y={tall ? 212 : 114} inset={inset} opacity={0.85} />
        </div>
    );
};

/** The landing-page `.chapter-rule`: eyebrow + dot on the left, live tabular
 *  scene counter ("01 / 05") on the right, and a 1px rail-to-rail hairline
 *  with 7px hollow diamond ticks at both rail intersections. Also anchors the
 *  foot of the drafted stage with a matching bottom rule. */
const EpisodeMark: React.FC = () => {
    const frame = useCurrentFrame();
    const { width } = useVideoConfig();
    const series = useSeries();
    const format = useFormat();
    const { index, total, chroma } = useActiveScene();
    if (series.toCorner === null) return null;
    const on = ramp(frame, series.toCorner + 8, 18);
    const off = series.closeAt === null ? 0 : ramp(frame, series.closeAt, 14, SHIFT);
    const o = Math.min(on, 1 - off);
    if (o <= 0) return null;
    const { number, title, accent } = series.spec;
    const tall = format === "tall";
    const inset = railInset(width);
    const padX = tall ? 72 : 120;
    const counter = `${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}`;
    return (
        <div data-audit="skip" style={{ position: "absolute", inset: 0, opacity: o, pointerEvents: "none" }}>
            <div
                style={{
                    position: "absolute",
                    left: padX,
                    right: tall ? 1080 - 960 : padX,
                    top: tall ? 136 : 56,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 16,
                    fontFamily: FONT.mono,
                    fontSize: tall ? 20 : 16,
                    letterSpacing: TRACKING.eyebrow,
                    textTransform: "uppercase",
                    color: chroma ? TONE.claim.eyebrow : TONE.base.eyebrow,
                }}
            >
                <div style={{ display: "flex", alignItems: "center", gap: EYEBROW.gap }}>
                    <Dot color={accent} size={tall ? 8 : 6} />
                    <span>
                        {number > 0 && (
                            <>
                                <span style={{ color: INK.high }}>{String(number).padStart(2, "0")}</span>
                                <span style={{ margin: "0 0.7em", opacity: 0.55 }}>/</span>
                            </>
                        )}
                        {title}
                    </span>
                </div>
                <span
                    style={{
                        color: chroma ? TONE.claim.eyebrow : INK.muted,
                        fontVariantNumeric: "tabular-nums",
                        flexShrink: 0,
                    }}
                >
                    {counter}
                </span>
            </div>
            {/* Top chapter hairline + rail intersection diamonds */}
            <RailRule y={tall ? 188 : 104} chroma={chroma} inset={inset} />
            {/* Bottom drafted rail divider — separates stage from presenter card in tall, anchors footer in wide */}
            <RailRule y={tall ? 1102 : 956} chroma={chroma} inset={inset} opacity={0.85} />
        </div>
    );
};

/** The close: the mark, the address and the one command, framed inside the
 *  drafted rails with top/bottom chapter rules and the landing-page install bar. */
const EndCard: React.FC = () => {
    const frame = useCurrentFrame();
    const { width } = useVideoConfig();
    const series = useSeries();
    const format = useFormat();
    if (series.closeAt === null) return null;
    const at = series.closeAt + 24;
    if (frame < at) return null;
    const fade = ramp(frame, at - 20, 36);
    const url = ramp(frame, at + 22, 24);
    const cmd = ramp(frame, at + 40, 22);
    const command = series.spec.endCommand === undefined ? "pnpm dlx @rebasepro/cli init" : series.spec.endCommand;
    const plan = { ...PRESENTER[format], ...(series.spec.presenter?.[format] ?? {}) };
    const tall = format === "tall";
    const inset = railInset(width);
    const area: React.CSSProperties = tall
        ? { left: 0, right: 0, top: plan.close.y + plan.close.h + 34, bottom: 210 }
        : { left: plan.close.x + plan.close.w + 60, right: 120, top: 0, bottom: 0 };
    return (
        <AbsoluteFill data-audit="skip">
            <AbsoluteFill style={{ background: GROUND.base, opacity: 0.88 * fade }} />
            <DraftingGrid opacity={0.9 * fade} />
            <RailRule y={tall ? 188 : 104} inset={inset} opacity={fade} />
            <RailRule y={tall ? 1720 : 956} inset={inset} opacity={fade} />
            <div style={{ position: "absolute", ...area, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
                <div
                    style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 10,
                        padding: tall ? "8px 18px" : "7px 16px",
                        borderRadius: 9999,
                        border: "1px solid rgba(255,255,255,0.12)",
                        background: "rgba(17,19,22,0.85)",
                        fontFamily: FONT.mono,
                        fontSize: tall ? 16 : 14,
                        letterSpacing: "0.2em",
                        textTransform: "uppercase",
                        color: INK.copy,
                        marginBottom: tall ? 24 : 28,
                        opacity: url,
                    }}
                >
                    <Dot color={series.spec.accent} size={6} />
                    <span>MIT OPEN SOURCE · REBASE CLOUD BETA</span>
                </div>
                <Mark size={tall ? 88 : 102} delay={at} spread={18} />
                <div style={{ overflow: "hidden", marginTop: 26, paddingBottom: "0.12em" }}>
                    <div
                        style={{
                            fontFamily: FONT.display,
                            fontWeight: 600,
                            fontSize: tall ? 88 : 96,
                            letterSpacing: "-0.034em",
                            lineHeight: 1,
                            color: INK.high,
                            transform: `translateY(${(1 - url) * 108}%)`,
                        }}
                    >
                        rebase.pro
                    </div>
                </div>
                {command !== null && (
                    <div
                        style={{
                            marginTop: 28,
                            padding: "14px 28px",
                            borderRadius: 12,
                            border: `1px solid ${SURFACE.hairlineStrong}`,
                            background: SURFACE.sheet,
                            fontFamily: FONT.mono,
                            fontSize: tall ? 28 : 24,
                            color: INK.high,
                            opacity: cmd,
                            transform: `translateY(${(1 - cmd) * 14}px)`,
                        }}
                    >
                        <span style={{ color: "#34D399", marginRight: 14 }}>$</span>
                        {command}
                    </div>
                )}
            </div>
        </AbsoluteFill>
    );
};

/* ── the audit probe ────────────────────────────────────────────────── */

/** Display type at or above this size is a headline, for the audit. */
export const AUDIT_HEADLINE_MIN = 32;

/**
 * Mounted only when the composition gets `audit` (scripts/audit-film.ts).
 * After each frame commits it logs, as one `[audit] {...}` console line, the
 * sizes of every run of display type on screen at headline size, and how
 * many lines the most-wrapped headline takes — outside the captions, the
 * marks and the end card (`data-audit="skip"`), which are the kit's own.
 * Line count reads `offsetTop`, which ignores transforms, so words still
 * rising into place count on their final line. Reads the DOM; changes nothing.
 */
const AuditProbe: React.FC = () => {
    const frame = useCurrentFrame();
    React.useLayoutEffect(() => {
        const sizes = new Set<number>();
        const lineTops = new Map<Element, Set<number>>();
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            const el = n.parentElement;
            if (!el || !n.textContent?.trim()) continue;
            if (el.closest("[data-audit=skip]")) continue;
            const cs = getComputedStyle(el);
            if (!cs.fontFamily.includes("Instrument Sans") || cs.opacity === "0") continue;
            const px = Math.round(parseFloat(cs.fontSize));
            if (px < AUDIT_HEADLINE_MIN) continue;
            sizes.add(px);
            if (el instanceof HTMLElement && el.offsetParent) {
                const tops = lineTops.get(el.offsetParent) ?? new Set<number>();
                tops.add(Math.round(el.offsetTop / (px * 0.5)));
                lineTops.set(el.offsetParent, tops);
            }
        }
        const headlineLines = Math.max(0, ...[...lineTops.values()].map((t) => t.size));
        console.log(`[audit] ${JSON.stringify({ frame, headlineSizes: [...sizes].sort((a, b) => a - b), headlineLines })}`);
    }, [frame]);
    return null;
};

/* ── building blocks for scenes ─────────────────────────────────────── */

/** The content box a scene lays out in: clear of the presenter's corner, the
 *  episode mark and (tall) the feed's own overlays. */
export function useStage(): { x: number; y: number; w: number; h: number; format: Format } {
    const format = useFormat();
    /* Tall: nothing readable right of x = 960 (the platforms' button rail), so the stage stops there. */
    return format === "tall" ? { x: 72, y: 230, w: 888, h: 790, format } : { x: 120, y: 150, w: 1380, h: 760, format };
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
                const bareWord = (s: string) => s.replace(/[^\w'-]/g, "");
                const marked = mark?.words.some((m) => bareWord(m) === bareWord(w));
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

/** A small uppercase label over a block: the site's eyebrow — the dot in
 *  the label's hue (cyan by default), the words in the eyebrow's ink. */
export const Label: React.FC<{ children: React.ReactNode; at: number; color?: string; size?: number }> = ({ children, at, color = EYEBROW.dotColor, size = 16 }) => {
    const frame = useCurrentFrame();
    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: EYEBROW.gap,
                fontFamily: FONT.mono,
                fontSize: size,
                letterSpacing: TRACKING.eyebrow,
                textTransform: "uppercase",
                color: TONE.base.eyebrow,
                opacity: ramp(frame, at, 12),
            }}
        >
            <Dot color={color} size={size > 18 ? 7 : 6} />
            <span>{children}</span>
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
            data-audit="skip"
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
            <Words
                text={text}
                at={at}
                size={HEADLINE[format]}
                step={2}
                mark={accent && mark ? { words: mark, color: accent } : undefined}
                /* Two lines share the words evenly: never one word left alone below. */
                style={{ textWrap: "balance" }}
            />
        </At>
    );
};

/** Where a scene's artifact goes: under its headline (two lines' room). */
export function useBody(lines = 1): { x: number; y: number; w: number; format: Format } {
    const { x, y, w, format } = useStage();
    const lh = HEADLINE[format] * 1.04;
    return { x, y: y + lines * lh + (format === "tall" ? 48 : 56), w, format };
}

/** The body under a given headline: as many lines down as the headline will
 *  take at this format. Instrument Sans sets about 0.44em a character here
 *  (measured off the stills), so a line holds ~41 characters wide, ~30 tall. */
export function useBodyFor(headline: string): { x: number; y: number; w: number; format: Format } {
    const { w, format } = useStage();
    return useBody(headlineLines(headline, HEADLINE[format], w));
}

let measure: CanvasRenderingContext2D | null = null;
const measured = new Map<string, number>();

/**
 * How many lines a headline really sets in: each word measured in the
 * headline's own face, size and tracking, then wrapped as the browser wraps
 * `Words` (each word an inline box carrying its trailing space). A guess
 * from the character count was wrong both ways — glyph widths vary — and a
 * headline that wrapped where one line was reserved ran into the body.
 * Outside a browser (lint, audit scripts) it falls back to that guess.
 */
export function headlineLines(text: string, size: number, width: number): number {
    const guess = Math.max(1, Math.ceil(text.length / Math.floor(width / (size * 0.44))));
    if (typeof document === "undefined") return guess;
    const font = `600 ${size}px ${FONT.display}`;
    const key = `${font}|${width}|${text}`;
    const hit = measured.get(key);
    if (hit !== undefined) return hit;
    measure ??= document.createElement("canvas").getContext("2d");
    if (!measure) return guess;
    measure.font = font;
    measure.letterSpacing = `${parseFloat(TRACKING.display) * size}px`;
    const words = text.split(" ");
    let lines = 1;
    let line = 0;
    words.forEach((word, i) => {
        const box = measure!.measureText(i < words.length - 1 ? `${word} ` : word).width;
        if (line > 0 && line + box > width) {
            lines++;
            line = box;
        } else line += box;
    });
    /* Remember it only once the face has loaded: a fallback's widths are not the headline's. */
    if (document.fonts.check(font)) measured.set(key, lines);
    return lines;
}

/* ── more building blocks ───────────────────────────────────────────── */

/**
 * A script from plain sentences: each line starts a breath after the last
 * one ends at the authored nine frames a word. Saves hand-counting `at`.
 */
export function lines(spec: [id: string, text: string][], start = 15, gap = 30): Script {
    let at = start;
    return spec.map(([id, text], i) => {
        const words = text.split(" ");
        const line = { id, at, words };
        at += words.length * 9 + (i === 0 ? gap + 6 : gap);
        return line;
    });
}

/** A window with a caption over it: a file, a terminal, a response. */
export const Window: React.FC<{
    caption?: string;
    title?: string;
    at?: number;
    well?: boolean;
    accent?: string;
    children: React.ReactNode;
    pad?: string;
}> = ({ caption, title, at = 0, well = true, accent, children, pad = "22px 28px" }) => {
    const format = useFormat();
    return (
        <div>
            {caption && (
                <div style={{ marginBottom: 12 }}>
                    <Label at={at} color={accent} size={format === "tall" ? 20 : 18}>
                        {caption}
                    </Label>
                </div>
            )}
            <FrameBox title={title} at={at + 4} well={well} pad={pad} accent={accent}>
                {children}
            </FrameBox>
        </div>
    );
};

/** The kit's own frame: a drafted panel matching rebase.pro (no macOS traffic
 *  lights — one 6px status dot, tracked mono title, 1px hairline). */
const FrameBox: React.FC<{ title?: string; at: number; well: boolean; pad: string; accent?: string; children: React.ReactNode }> = ({ title, at, well, pad, accent, children }) => {
    const frame = useCurrentFrame();
    const o = ramp(frame, at, 12, ENTER);
    return (
        <div
            style={{
                borderRadius: FRAME.radius,
                border: `1px solid ${SURFACE.hairlineStrong}`,
                background: well ? SURFACE.well : SURFACE.sheet,
                overflow: "hidden",
                opacity: o,
                transform: o < 1 ? `translateY(${(1 - o) * 14}px)` : undefined,
            }}
        >
            {title !== undefined && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "11px 18px",
                        background: SURFACE.sheet,
                        borderBottom: `1px solid ${SURFACE.hairline}`,
                    }}
                >
                    <Dot color={accent ?? EYEBROW.dotColor} size={6} />
                    <span style={{ fontFamily: FONT.mono, fontSize: 14, letterSpacing: "0.08em", color: INK.copy }}>{title}</span>
                </div>
            )}
            <div style={{ padding: pad }}>{children}</div>
        </div>
    );
};

/** Lines of output that print at their own frames (local), each in a tone. */
export const Log: React.FC<{ lines: { text: string; at: number; color?: string }[]; size: number }> = ({ lines: rows, size }) => {
    const frame = useCurrentFrame();
    return (
        <div style={{ fontFamily: FONT.mono, fontSize: size, lineHeight: 1.6 }}>
            {rows.map((r, i) =>
                frame < r.at ? null : (
                    <div key={i} style={{ color: r.color ?? INK.copy, opacity: ramp(frame, r.at, 6), whiteSpace: "pre-wrap" }}>
                        {r.text === "" ? " " : r.text}
                    </div>
                ),
            )}
        </div>
    );
};

/** A typed command line: prompt, then the command a character at a time. */
export const Prompt: React.FC<{ command: string; at: number; size: number; rate?: number }> = ({ command, at, size, rate = 0.55 }) => {
    const frame = useCurrentFrame();
    const n = Math.round(ramp(frame, at, command.length * rate, (t) => t) * command.length);
    if (frame < at) return null;
    return (
        <div style={{ fontFamily: FONT.mono, fontSize: size, lineHeight: 1.6, color: INK.high, whiteSpace: "pre-wrap" }}>
            <span style={{ color: INK.muted, marginRight: size * 0.5 }}>$</span>
            {command.slice(0, n)}
            <span style={{ color: "#4E9BFF", opacity: n < command.length || Math.floor(frame / 16) % 2 === 0 ? 1 : 0 }}>▌</span>
        </div>
    );
};

/** A pill: a scope, a status, a name — something to point at. */
export const Pill: React.FC<{ children: React.ReactNode; at: number; color?: string; size: number; filled?: boolean }> = ({ children, at, color = INK.high, size, filled }) => {
    const frame = useCurrentFrame();
    const o = ramp(frame, at, 14, ENTER);
    return (
        <span
            style={{
                display: "inline-block",
                fontFamily: FONT.mono,
                fontSize: size,
                padding: `${size * 0.32}px ${size * 0.6}px`,
                borderRadius: 10,
                border: `2px solid ${color}`,
                background: filled ? color : "transparent",
                color: filled ? GROUND.base : color,
                opacity: o,
                transform: o < 1 ? `translateY(${(1 - o) * 10}px)` : undefined,
            }}
        >
            {children}
        </span>
    );
};

/* ── an editor ──────────────────────────────────────────────────────── */

/** The editor window: a tab with the file's name, line numbers, the code. */
export const Editor: React.FC<{ file: string; code: string; size: number; at?: number; step?: number; accent?: string; sql?: boolean; children?: React.ReactNode }> = ({
    file,
    code,
    size,
    at = 6,
    step = 2,
    accent = "#36CCD6",
    sql = false,
    children,
}) => {
    const frame = useCurrentFrame();
    const n = code.split("\n").length;
    const o = ramp(frame, 0, 12, ENTER);
    return (
        <div style={{ borderRadius: 13, border: `1px solid ${SURFACE.hairline}`, background: SURFACE.well, overflow: "hidden", opacity: o, position: "relative" }}>
            <div style={{ display: "flex", background: SURFACE.sheet, borderBottom: `1px solid ${SURFACE.hairline}` }}>
                <div style={{ padding: "12px 22px", fontFamily: FONT.mono, fontSize: size * 0.72, color: INK.high, borderBottom: `2px solid ${accent}` }}>{file}</div>
            </div>
            <div style={{ display: "flex", padding: "18px 0" }}>
                <div style={{ width: size * 2.4, flexShrink: 0, textAlign: "right", paddingRight: size * 0.8, fontFamily: FONT.mono, fontSize: size, lineHeight: 1.65, color: INK.muted, opacity: 0.6 }}>
                    {Array.from({ length: n }, (_, i) => (
                        <div key={i}>{i + 1}</div>
                    ))}
                </div>
                <div style={{ flex: 1, position: "relative" }}>
                    <Code code={code} size={size} delay={at} step={step} sql={sql} />
                    {children}
                </div>
            </div>
        </div>
    );
};

