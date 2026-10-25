import type React from "react";
import { RebaseDesk } from "../desk/DeskFilm";
import { DESK_NARRATION } from "../desk/script";
import { SERIES_FILMS } from "../series";
import type { LiveFeed, Take } from "../desk/Presenter";
import type { Script, Timing } from "../spoken/narration";

/** What the page hands any film: the live timing and the camera. */
export type FilmProps = { timing?: Timing | null; take?: Take | null; live?: LiveFeed | null };

/**
 * Every narrated film the recording page can play: the desk film and the
 * series. `?film=<id>` picks one; the page reads that film's script, plays
 * that film live, and the take it saves names the film, so the processor
 * prints the right render commands (scripts/take.mjs).
 */
export interface RecordableFilm {
    id: string;
    title: string;
    script: Script;
    component: React.FC<FilmProps>;
    /** The composition ids a take of this film renders as. */
    compositions: string[];
}

export const FILMS: RecordableFilm[] = [
    {
        id: "desk",
        title: "The desk film",
        script: DESK_NARRATION,
        component: RebaseDesk,
        compositions: ["RebaseDesk"],
    },
    ...SERIES_FILMS.map(({ spec, component }) => ({
        id: spec.id,
        title: `${String(spec.number).padStart(2, "0")} · ${spec.title}`,
        script: spec.script,
        component,
        compositions: [`Series-${spec.id}`, `Series-${spec.id}-Tall`],
    })),
];

export function filmById(id: string | null): RecordableFilm {
    return FILMS.find((f) => f.id === id) ?? FILMS[0];
}
