import React from "react";
import { Scene } from "../components/Scene";
import { Drift } from "../reel/Drift";

/**
 * 02 · THE SECOND COPY — 270 frames.
 *
 * Replaces the older second-copy scene, which showed five declarations of one
 * table and then collapsed them into one. The collapse was the problem: the
 * NEXT scene already delivers "there is no second data model" with the single
 * collection file, so the film made its best point twice and made it weaker
 * both times.
 *
 * This keeps the recognition and spends the rest of the scene on what that
 * recognition costs — add a column and four of the five are silently wrong —
 * which the film never showed anywhere. Recognition, cost, answer, across three
 * scenes instead of two.
 *
 * The body lives in reel/ because it is also its own composition; this is the
 * film's wrapper, which is what gives it the slide transition.
 */
export const S03b_Drift: React.FC = () => (
    <Scene>
        <Drift />
    </Scene>
);
