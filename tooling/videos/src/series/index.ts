import { INTRO_FILM } from "./v2/00-intro";
import { CLAIM } from "./v2/01-claim";
import { REVIEW_QUEUE } from "./v2/02-review-queue";
import { CLAUDE_PANEL } from "./v2/03-claude-panel";
import { DB_BRANCH } from "./v2/04-db-branch";
import { TIME_MACHINE } from "./v2/05-time-machine";
import { RLS_SIMULATE } from "./v2/06-rls-simulate";
import { LEAVE_SUPABASE } from "./v2/07-leave-supabase";
import { SAFE_PREVIEWS } from "./v2/08-safe-previews";
import { ONE_CLI } from "./v2/09-one-cli";
import { HONEST_CLOUD } from "./v2/10-honest-cloud";
import { seriesDuration, seriesFilm, type FilmSpec, type SeriesProps } from "./kit";

/**
 * The flagship product introduction plus ten short films in the 2026 series.
 * Each renders as two compositions — `Series-<id>` at 1920x1080 and
 * `Series-<id>-Tall` at 1080x1920 — from the same take, and the recording
 * page reads it with `?film=<id>`.
 *
 * The earlier boilerplate-era films remain archived in `./films/`.
 */
export const SERIES: FilmSpec[] = [
    INTRO_FILM,
    CLAIM,
    REVIEW_QUEUE,
    CLAUDE_PANEL,
    DB_BRANCH,
    TIME_MACHINE,
    RLS_SIMULATE,
    LEAVE_SUPABASE,
    SAFE_PREVIEWS,
    ONE_CLI,
    HONEST_CLOUD,
];

export interface SeriesEntry {
    spec: FilmSpec;
    component: React.FC<SeriesProps>;
    duration: (props: SeriesProps) => number;
}

export const SERIES_FILMS: SeriesEntry[] = SERIES.map((spec) => ({
    spec,
    component: seriesFilm(spec),
    duration: (props: SeriesProps) => seriesDuration(spec, props),
}));
