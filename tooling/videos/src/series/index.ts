import { AGENTS } from "./films/03-agents";
import { seriesDuration, seriesFilm, type FilmSpec, type SeriesProps } from "./kit";

/**
 * Every film in the series, in release order. Each renders as two
 * compositions — `Series-<id>` at 1920x1080 and `Series-<id>-Tall` at
 * 1080x1920 — from the same take, and the recording page reads it with
 * `?film=<id>`.
 */
export const SERIES: FilmSpec[] = [AGENTS];

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
