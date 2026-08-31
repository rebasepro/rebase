import React from "react";
import { Scene } from "../components/Scene";
import { Stream } from "../reel/Stream";

/**
 * 06 · THE WIRE — 240 frames.
 *
 * Follows Headless, which LISTS realtime among eight things the backend gives
 * you. A list item is a claim; this is the claim running. It is the only scene
 * in the film where the product is shown working rather than shown existing.
 *
 * Placed before the panel on purpose: everything up to here has been the
 * backend on its own, and realtime is the last and least believable thing that
 * half of the offer promises.
 */
export const S05b_Stream: React.FC = () => (
    <Scene>
        <Stream />
    </Scene>
);
