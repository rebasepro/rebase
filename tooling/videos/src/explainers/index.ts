import { seriesDuration, seriesFilm, type FilmSpec, type SeriesProps } from "../series/kit";
import { SHOWN as VIEW_SIDE_DOOR_SHOWN, VIEW_SIDE_DOOR } from "./01-view-side-door";

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
    film: FilmSpec;
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
        proof: { expected: "scripts/proof/view-side-door.expected", shown: VIEW_SIDE_DOOR_SHOWN },
        terms: ["view", "views", "table", "row-level", "security", "invoker", "materialized"],
    },
];

export interface ExplainerEntry {
    spec: FilmSpec;
    component: React.FC<SeriesProps>;
    duration: (props: SeriesProps) => number;
}

export const EXPLAINER_FILMS: ExplainerEntry[] = EXPLAINERS.map(({ film }) => ({
    spec: film,
    component: seriesFilm(film),
    duration: (props: SeriesProps) => seriesDuration(film, props),
}));

/** The composition ids a film renders as, wide then tall. */
export function explainerCompositions(id: string): [string, string] {
    return [`Explainer-${id}`, `Explainer-${id}-Tall`];
}
