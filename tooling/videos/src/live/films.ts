import type React from "react";
import { SERIES_FILMS } from "../series";
import { EXPLAINER_FILMS, explainerCompositions, shortComposition } from "../explainers";
import { EIC_SCRIPT, EicFilm } from "../eic/EicFilm";
import type { LiveFeed, Take } from "../desk/Presenter";
import type { Script, Timing } from "../spoken/narration";
import { wholeScript, type Chapter, type Clip } from "../spoken/production";

/** What the page hands any film: the timing, and the camera or recordings. */
export type FilmProps = { timing?: Timing | null; take?: Take | null; clips?: Clip[] | null; live?: LiveFeed | null };

/** A film released from a production: its own lines and scenes, its shape. */
export interface Cut {
    /** "long", "short", or "film" for a production released once. */
    id: string;
    label: string;
    script: Script;
    component: React.FC<FilmProps>;
    width: number;
    height: number;
    /** The composition ids this cut renders as. */
    compositions: string[];
    /** Whether it can play an assembled film's clips (the series kit can;
     *  the desk and EIC films play one take). */
    assembles: boolean;
}

/**
 * Every narrated film the recording page can record (`?film=<id>`): its
 * whole script, the chapters it is recorded in, and the cuts released from
 * it. A take names its film and the lines it covers; the page assembles each
 * cut from the takes (src/spoken/production.ts).
 */
export interface RecordableFilm {
    id: string;
    title: string;
    script: Script;
    chapters: readonly Chapter[];
    cuts: Cut[];
}

const WIDE = { width: 1920, height: 1080 };
const TALL = { width: 1080, height: 1920 };

export const FILMS: RecordableFilm[] = [
    ...SERIES_FILMS.map(({ spec, component }) => ({
        id: spec.id,
        title: spec.number === 0 ? spec.title : `${String(spec.number).padStart(2, "0")} · ${spec.title}`,
        script: spec.script,
        chapters: wholeScript(spec.script),
        cuts: [
            {
                id: "film",
                label: "Film · 16:9 + 9:16",
                script: spec.script,
                component,
                ...WIDE,
                compositions: [`Series-${spec.id}`, `Series-${spec.id}-Tall`],
                assembles: true,
            },
        ],
    })),
    {
        id: "eic",
        title: "EIC Accelerator · Francesco & Marian",
        script: EIC_SCRIPT,
        chapters: wholeScript(EIC_SCRIPT),
        cuts: [{ id: "film", label: "Film", script: EIC_SCRIPT, component: EicFilm, ...WIDE, compositions: ["EIC"], assembles: false }],
    },
    ...EXPLAINER_FILMS.map(({ spec, component, lines, chapters, short }) => {
        const [wide, tall] = explainerCompositions(spec.id);
        const script = lines ?? spec.script;
        const cuts: Cut[] = [
            {
                id: "long",
                label: short ? "Long · 16:9" : "Film · 16:9 + 9:16",
                script: spec.script,
                component,
                ...WIDE,
                compositions: short ? [wide] : [wide, tall],
                assembles: true,
            },
        ];
        if (short) {
            cuts.push({
                id: "short",
                label: "Short · 9:16",
                script: short.spec.script,
                component: short.component,
                ...TALL,
                compositions: [shortComposition(spec.id)],
                assembles: true,
            });
        }
        return {
            id: spec.id,
            title: `Explainer ${String(spec.number).padStart(2, "0")} · ${spec.title}`,
            script,
            chapters: chapters ?? wholeScript(script),
            cuts,
        };
    }),
];

export function filmById(id: string | null): RecordableFilm {
    return FILMS.find((f) => f.id === id) ?? FILMS[0];
}

/** The cut to show while recording some lines: the first that has them all
 *  (a short-only line is only in the short). */
export function cutFor(film: RecordableFilm, lineIds: readonly string[]): Cut {
    return film.cuts.find((c) => lineIds.every((id) => c.script.some((l) => l.id === id))) ?? film.cuts[0];
}
