import { seriesDuration, seriesFilm, type FilmSpec, type SeriesProps } from "../series/kit";
import type { Script } from "../spoken/narration";
import type { Chapter } from "../spoken/production";
import { CHAPTERS as VIEW_SIDE_DOOR_CHAPTERS, SHOWN as VIEW_SIDE_DOOR_SHOWN, VIEW_SIDE_DOOR, VIEW_SIDE_DOOR_LINES, VIEW_SIDE_DOOR_SHORT } from "./01-view-side-door";

/**
 * THE EXPLAINERS — short lessons about Postgres (and the things around it)
 * that are not about Rebase. Rebase is named once, in the last line, as who
 * made it. Each film has its own visual device, built for its subject; they
 * share the series' machinery (src/series/kit.tsx: the voice-following
 * timeline, the presenter's places, the ground, the captions, the end card)
 * and nothing else.
 *
 * Each renders as `Explainer-<id>` (1920x1080) and `Explainer-<id>-Tall`
 * (1080x1920) from the same take; the recording page reads it with
 * `?film=<id>`. Scripts and proof notes live in VOICEOVER-EXPLAINERS.md.
 */
export interface ExplainerSpec {
    /** The long film: 16:9, three to five minutes. */
    film: FilmSpec;
    /** Every line read for it (the long film's and the short's), in
     *  reading order, and the chapters they are recorded in. Absent: the
     *  long film's script, recorded whole. */
    lines?: Script;
    chapters?: readonly Chapter[];
    /** The short cut: 9:16, under a minute, from the same takes. */
    short?: FilmSpec;
    /** The claims' evidence: a file of real output (path from tooling/videos)
     *  and every statement and result the film puts on screen. The lint
     *  fails if one of them is not in the file (whitespace aside). */
    proof?: { expected: string; shown: readonly string[] };
    /** The subject's own terms, allowed to recur close together without the
     *  lint calling it repetition. Keep it short. */
    terms?: readonly string[];
}

export const EXPLAINERS: ExplainerSpec[] = [
    {
        film: VIEW_SIDE_DOOR,
        lines: VIEW_SIDE_DOOR_LINES,
        chapters: VIEW_SIDE_DOOR_CHAPTERS,
        short: VIEW_SIDE_DOOR_SHORT,
        proof: { expected: "scripts/proof/view-side-door.expected", shown: VIEW_SIDE_DOOR_SHOWN },
        terms: ["view", "views", "table", "row-level", "security", "invoker", "materialized"],
    },
];

export interface ExplainerEntry {
    spec: FilmSpec;
    component: React.FC<SeriesProps>;
    duration: (props: SeriesProps) => number;
    lines?: Script;
    chapters?: readonly Chapter[];
    short?: { spec: FilmSpec; component: React.FC<SeriesProps>; duration: (props: SeriesProps) => number };
}

export const EXPLAINER_FILMS: ExplainerEntry[] = EXPLAINERS.map(({ film, lines, chapters, short }) => ({
    spec: film,
    component: seriesFilm(film),
    duration: (props: SeriesProps) => seriesDuration(film, props),
    lines,
    chapters,
    short: short && {
        spec: short,
        component: seriesFilm(short),
        duration: (props: SeriesProps) => seriesDuration(short, props),
    },
}));

/** The short's composition id (1080x1920). */
export function shortComposition(id: string): string {
    return `Explainer-${id}-Short`;
}

/** The composition ids a film renders as, wide then tall. */
export function explainerCompositions(id: string): [string, string] {
    return [`Explainer-${id}`, `Explainer-${id}-Tall`];
}
