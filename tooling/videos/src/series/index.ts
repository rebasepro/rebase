import { TYPED } from "./films/01-typed";
import { SECURITY } from "./films/02-security";
import { AGENTS } from "./films/03-agents";
import { OWN } from "./films/04-own";
import { ONE_DEFINITION } from "./films/05-one-definition";
import { ZERO } from "./films/06-zero";
import { REALTIME } from "./films/07-realtime";
import { PANEL } from "./films/08-panel";
import { BACKEND } from "./films/09-backend";
import { EXISTING } from "./films/10-existing";
import { seriesDuration, seriesFilm, type FilmSpec, type SeriesProps } from "./kit";

/**
 * Every film in the series, in release order. Each renders as two
 * compositions — `Series-<id>` at 1920x1080 and `Series-<id>-Tall` at
 * 1080x1920 — from the same take, and the recording page reads it with
 * `?film=<id>`.
 */
export const SERIES: FilmSpec[] = [TYPED, SECURITY, AGENTS, OWN, ONE_DEFINITION, ZERO, REALTIME, PANEL, BACKEND, EXISTING];

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
