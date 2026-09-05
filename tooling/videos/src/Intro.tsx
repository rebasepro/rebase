import React from "react";
import { AbsoluteFill, Sequence } from "remotion";
import { Plane, StationContext } from "./Plane";
import { Narration } from "./Narration";
import { SCENES, STARTS } from "./film";
import { OVERLAP } from "./transitions";

/**
 * The film.
 *
 * One plane, rendered once, underneath everything — then the slides, each at
 * its own station in it. Cuts are still cuts, but the art does not cut: it is
 * mid-move across every one of them, carrying the outgoing slide out and the
 * incoming one in. That is the difference between a shared plane and nine
 * backdrops that happen to match.
 *
 * THE SCENES OVERLAP. This was a `Series`, which mounts exactly one scene at
 * a time — so the outgoing slide had finished fading on the last frame before
 * the cut and the incoming one had not started on the first frame after it.
 * Measured on the render: 9 to 25 frames of bare ground at every one of the
 * sixteen cuts, and the film read as pausing to breathe at each edit no
 * matter how fast the slides themselves moved. A push in which nothing is
 * ever pushed past anything is a dip to black with extra steps.
 *
 * So every scene after the first is mounted OVERLAP frames before its own
 * cut, which is exactly the window the previous scene spends leaving. The two
 * slides cross; the incoming one is on top. The cut itself — where the camera
 * turns, where the ground changes, where the narration is timed from — is
 * still STARTS[i]. A scene simply starts arriving a little before it.
 */
export const RebaseIntro: React.FC = () => (
    <AbsoluteFill style={{ background: "#000" }}>
        <Plane />
        {SCENES.map((scene, i) => {
            const lead = i === 0 ? 0 : OVERLAP;
            return (
                <Sequence
                    key={scene.id}
                    from={STARTS[i] - lead}
                    durationInFrames={scene.durationInFrames + lead}
                    layout="none"
                >
                    <StationContext.Provider value={{ index: i, start: STARTS[i], lead }}>
                        <scene.component />
                    </StationContext.Provider>
                </Sequence>
            );
        })}
    </AbsoluteFill>
);

/**
 * Each scene, on its own, but standing where it stands in the film — same
 * station, same moment of the plane's animation. Previewing a cut against a
 * different background than it will ship with is worse than not previewing it.
 */
export const STANDALONE = SCENES.map((scene, i) => {
    const lead = i === 0 ? 0 : OVERLAP;
    const Component: React.FC = () => (
        <AbsoluteFill style={{ background: "#000" }}>
            <Plane offset={STARTS[i] - lead} />
            <StationContext.Provider value={{ index: i, start: STARTS[i], lead }}>
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
