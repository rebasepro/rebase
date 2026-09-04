import React from "react";
import { AbsoluteFill, Series } from "remotion";
import { Plane, StationContext } from "./Plane";
import { Narration } from "./Narration";
import { SCENES, STARTS } from "./film";

/**
 * The film.
 *
 * One plane, rendered once, underneath everything — then the slides, each at
 * its own station in it. Cuts are still cuts, but the art does not cut: it is
 * mid-move across every one of them, carrying the outgoing slide out and the
 * incoming one in. That is the difference between a shared plane and nine
 * backdrops that happen to match.
 */
export const RebaseIntro: React.FC = () => (
    <AbsoluteFill style={{ background: "#000" }}>
        <Plane />
        <Series>
            {SCENES.map((scene, i) => (
                <Series.Sequence key={scene.id} durationInFrames={scene.durationInFrames}>
                    <StationContext.Provider value={{ index: i, start: STARTS[i] }}>
                        <scene.component />
                    </StationContext.Provider>
                </Series.Sequence>
            ))}
        </Series>
    </AbsoluteFill>
);

/**
 * Each scene, on its own, but standing where it stands in the film — same
 * station, same moment of the plane's animation. Previewing a cut against a
 * different background than it will ship with is worse than not previewing it.
 */
export const STANDALONE = SCENES.map((scene, i) => {
    const Component: React.FC = () => (
        <AbsoluteFill style={{ background: "#000" }}>
            <Plane offset={STARTS[i]} />
            <StationContext.Provider value={{ index: i, start: STARTS[i] }}>
                <scene.component />
            </StationContext.Provider>
        </AbsoluteFill>
    );
    Component.displayName = `Standalone(${scene.id})`;
    return Component;
});

/**
 * The film with the voiceover printed on it, for testing the rhythm of a read
 * that has not been recorded yet. Not a deliverable.
 */
export const RebaseIntroVO: React.FC = () => (
    <>
        <RebaseIntro />
        <Narration />
    </>
);
