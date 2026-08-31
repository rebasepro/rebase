import React from "react";
import { S00_ColdOpen } from "./scenes/S00_ColdOpen";
import { S01_Headline } from "./scenes/S01_Headline";
import { S02_OneCommand } from "./scenes/S02_OneCommand";
import { S03b_Drift } from "./scenes/S03b_Drift";
import { S03_OneDefinition } from "./scenes/S03_OneDefinition";
import { S05_Headless } from "./scenes/S05_Headless";
import { S07_Studio } from "./scenes/S07_Studio";
import { S07b_Everything } from "./scenes/S07b_Everything";
import { S11_Ownership } from "./scenes/S11_Ownership";
import { S04_Claim } from "./scenes/S04_Claim";
import { S08b_TwoUsers } from "./scenes/S08b_TwoUsers";
import { S05b_Stream } from "./scenes/S05b_Stream";
import { S08c_Map } from "./scenes/S08c_Map";
import { S05_Proof } from "./scenes/S05_Proof";
import { S06_Panel } from "./scenes/S06_Panel";
import { S07_Agent } from "./scenes/S07_Agent";
import { S08_Close } from "./scenes/S08_Close";
import type { Ground } from "./theme";
import type { TransitionKind } from "./transitions";

/**
 * The film, as a route through one plane.
 *
 * THE PLANE IS SHARED. There is exactly one Neat ribbon for the whole 53
 * seconds, and every slide is a place in it. A shape that leaves the bottom of
 * the headline arrives at the top of the next slide, because it is the same
 * shape and the camera simply kept going. An earlier version gave each scene
 * its own gradient with its own little move, which looks similar in a still
 * and is not the same thing at all: nine unrelated backdrops that happen to
 * share a palette.
 *
 * So a scene no longer owns art. It owns a STATION — where in the plane it
 * sits — and a REVEAL, how much of the plane its ground lets through. The
 * camera holds at a station for the body of a scene and glides to the next
 * across the cut, which is what carries the slides in and out with it.
 *
 * The order is the site's own argument order, which is ranked rather than
 * chronological (SITE-STORY §2): the claim the product rests on goes first
 * among the claims, its proof immediately after, and the panel — the thing
 * most people would open with — comes late, because leading with it is what
 * mispositions the product against everything else in the category.
 */

export interface Station {
    /** Where the camera sits, in Neat's own units. */
    x: number;
    y: number;
    zoom: number;
    /** Rotation of the ribbon about the view axis, in radians. Variety that
     *  costs no coverage — see the note under SCENES. */
    roll?: number;
    /**
     * How much of the plane shows through this scene's ground, 0-1. The ground
     * is painted over the art at `1 - reveal`, so 0 is an opaque field and 1 is
     * the bare ribbon. This is the film's exposure control: chapters that are
     * carrying dense information keep it low, and the ones that are breathing
     * open it up.
     */
    reveal: number;
}

export interface SceneEntry {
    id: string;
    title: string;
    component: React.FC;
    durationInFrames: number;
    /** Painted over the plane at `1 - reveal`. Lives here rather than on the
     *  scene because it has to CROSS-FADE across a cut: a scene that owned its
     *  own ground would snap to the next colour the instant Series swapped
     *  them, which is most visible on exactly the cut that changes colour. */
    ground: Ground;
    station: Station;
    /**
     * How this scene ARRIVES. The previous scene's exit is derived as the
     * mirror of this, so one field defines both halves of a cut and the two
     * cannot drift apart. `null` on the first scene, which has nothing to
     * arrive from.
     */
    enter: TransitionKind | null;
}

/**
 * The route. Read the x/y column on its own and it is a loop: it opens up and
 * to the right, crosses to the middle for the headline, sweeps left through
 * the two mechanism chapters, drops south for the claim and its proof, comes
 * back east across the panel and the agent, and rises to finish near where it
 * started. The film ends looking at the same region of plane it opened on,
 * from a different distance.
 */
export const SCENES: SceneEntry[] = [
    {
        id: "ColdOpen", title: "00 · Cold open", component: S00_ColdOpen,
        durationInFrames: 96, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.1, reveal: 0.0 },
        enter: null,
    },
    {
        id: "Headline", title: "01 · Headline", component: S01_Headline,
        durationInFrames: 150, ground: "base",
        // The site's own hero framing, to the number.
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.58, reveal: 0.30 },
        enter: "hold",
    },
    {
        id: "OneCommand", title: "02 · One command", component: S02_OneCommand,
        durationInFrames: 205, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.22, reveal: 0.30 },
        enter: "push",
    },
    {
        id: "SecondCopy", title: "03 · The second copy", component: S03b_Drift,
        durationInFrames: 270, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.7, reveal: 0.30 },
        enter: "descend",
    },
    {
        id: "OneDefinition", title: "04 · One definition", component: S03_OneDefinition,
        durationInFrames: 210, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.34, reveal: 0.30 },
        enter: "rise",
    },
    {
        id: "Headless", title: "05 · Headless", component: S05_Headless,
        durationInFrames: 200, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.82, reveal: 0.30 },
        enter: "push",
    },
    {
        id: "Stream", title: "06 · The wire", component: S05b_Stream,
        durationInFrames: 240, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.28, reveal: 0.30 },
        enter: "rise",
    },
    {
        id: "Panel", title: "07 · The panel", component: S06_Panel,
        durationInFrames: 280, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.1, reveal: 0.30 },
        enter: "descend",
    },
    {
        id: "Everything", title: "08 · Every view", component: S07b_Everything,
        durationInFrames: 240, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.16, reveal: 0.30 },
        enter: "descend",
    },
    {
        id: "Studio", title: "09 · Studio", component: S07_Studio,
        durationInFrames: 200, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.46, reveal: 0.30 },
        enter: "push",
    },
    {
        id: "SchemaMap", title: "10 · The schema", component: S08c_Map,
        durationInFrames: 260, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.64, reveal: 0.30 },
        enter: "push",
    },
    {
        id: "Claim", title: "11 · Row-level security", component: S04_Claim,
        durationInFrames: 170, ground: "claim",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.7, reveal: 0.30 },
        enter: "rise",
    },
    {
        id: "TwoUsers", title: "12 · The same query, twice", component: S08b_TwoUsers,
        durationInFrames: 240, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.16, reveal: 0.30 },
        enter: "push",
    },
    {
        id: "Proof", title: "13 · The proof", component: S05_Proof,
        durationInFrames: 200, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.22, reveal: 0.30 },
        enter: "descend",
    },
    {
        id: "Agent", title: "14 · Agent-native", component: S07_Agent,
        durationInFrames: 165, ground: "deep",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.58, reveal: 0.30 },
        enter: "push",
    },
    {
        id: "Ownership", title: "15 · Yours", component: S11_Ownership,
        durationInFrames: 175, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.34, reveal: 0.30 },
        enter: "rise",
    },
    {
        id: "Close", title: "16 · The ask", component: S08_Close,
        durationInFrames: 160, ground: "base",
        station: { x: 0, y: -12, zoom: 2.05, roll: 0.82, reveal: 0.30 },
        enter: "scale",
    },
];

/**
 * THE SHAPE OF THE STORY, and why it is this one.
 *
 * The product declares its own structure in PRODUCT.md: **three adoption
 * modes** — BaaS, CMS, Full — described there as "the shape of the offer". The
 * film had been telling only the middle one, which is how a platform with a
 * full CMS, a database workspace, a typed SDK, agents and an MIT licence ended
 * up sounding like a way to generate REST routes.
 *
 *   I   PREMISE      00-02  you already have the database; point at it
 *   II  INSIGHT      03-04  you have written this table five times; now once
 *   III THE OFFER    05-07  take the backend / add the panel / add Studio
 *   IV  GUARANTEE    08-10  whichever layers you took, RLS holds — provably,
 *                           for people and agents alike
 *   V   OWNERSHIP    11-12  MIT, self-hosted, nobody holds your credentials
 *
 * Act III is the product's own three modes and it is additive by construction,
 * which carries claim 3 structurally instead of asserting it: the panel is
 * plainly optional because the film showed you what came before it.
 *
 * Act V was missing entirely, and it is the strongest close available — every
 * competitor in this category is a service you rent, and not one of them can
 * end on this.
 */

/**
 * DURATIONS ARE SET BY THE VOICE-OVER, NOT BY THE ANIMATION.
 *
 * See VOICEOVER.md. Every scene below is long enough to say its line at an
 * unhurried 2.5 words a second with a beat of silence either side. Before this
 * the film was cut to the length its own animations happened to take, which is
 * why five code fragments in scene 03 were on screen for 2.6 seconds — long
 * enough to register as a picture, nowhere near long enough to read.
 *
 * Rewriting a line means retiming its scene. Not the other way round.
 */

/**
 * THE CAMERA ROTATES. IT DOES NOT TRAVEL.
 *
 * Every station is at the same place — x 0, y -12, zoom 2.05 — and differs only
 * in `roll`. That is not laziness, it is the only arrangement that gives large
 * visible rotation AND constant coverage, and it was found by measuring rather
 * than by taste.
 *
 * Roll turns out to move coverage violently: at a fixed position it swings
 * between 8% and 26% of frame. But at x 0, y -12 there is a PLATEAU — coverage
 * sits at 11.8-13.5% across the whole range from 0.10 to 0.82 radians, which is
 * 41 degrees of free rotation. Past 0.82 it runs away fast (20% at 1.0, 45% at
 * 1.5, 60% by 2.4) as the ribbon turns broadside to the camera.
 *
 * So the stations walk that plateau in big jumps rather than small ones —
 * 14 to 41 degrees per cut, never repeating the same angle twice in a row — and
 * the ribbon reads as TURNING between scenes rather than sliding. Translation
 * is zero because translation is what was making it restless; the slides
 * themselves still move (see transitions.ts), so the frame is not static.
 *
 * Coverage across all thirteen: 11.8% - 13.5%. The most consistent the film has
 * been, and the previous arrangement measured 17.5x.
 *
 * The Headline used to carry the site's own hero framing to the number. That is
 * given up here deliberately: fidelity to one page's camera is worth less than
 * an exposure that never changes.
 */

/**
 * THE GROUND RHYTHM, read down the `ground` and `reveal` columns:
 *
 *   00  black, no plane      08  a mark on nothing
 *   01  black, plane at .62  62  the hero, lit
 *   02  black               .16  the terminal needs black behind it
 *   03  raised              .12  mechanism
 *   04  BLUE  #0021C1       .09  the claim
 *   05  black              .22   evidence
 *   06  raised             .45   the product, lifted
 *   07  ULTRAMARINE #2E0EC7 .14  the second field
 *   08  black              .80   lit, bookending the open
 *
 * Two flat fields rather than one, thirteen seconds apart with black and
 * raised between them so they never read as a pair; two raised chapters; and
 * reveal swinging from 0 to 0.80 across the film. The film changes register
 * nine times without a single colour outside the shipped token set.
 */

/** Absolute start frame of each scene. */
export const STARTS: number[] = SCENES.reduce<number[]>((acc, s, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + SCENES[i - 1].durationInFrames);
    return acc;
}, []);

export const INTRO_DURATION = SCENES.reduce((n, s) => n + s.durationInFrames, 0);

/**
 * Frames spent moving on each side of a cut. The camera is still for the body
 * of a scene and covers the distance to the next one in this window either
 * side of the cut — so the move belongs to the transition rather than making
 * every shot drift.
 *
 * Every scene is longer than 2x this, which is what keeps the keyframe inputs
 * strictly increasing; the shortest is 105.
 */
export const GLIDE = 26;
