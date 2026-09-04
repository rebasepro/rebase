import "./index.css";
import React from "react";
import { Composition, Series } from "remotion";
import { loadFonts } from "./fonts";
import { RebaseIntro, RebaseIntroVO, STANDALONE } from "./Intro";
import { INTRO_DURATION, SCENES } from "./film";
import { HeroIntro } from "./components/HeroIntro";
import { HowItWorks } from "./components/HowItWorks";
import { FeatureShowcase } from "./components/FeatureShowcase";
import { ProductUIReveal } from "./components/ProductUIReveal";
import { RealProductVideo } from "./components/RealProductVideo";
import { Bento, BENTO_DURATION } from "./bento/Bento";
import { Reel } from "./reel/Reel";
import { Fanout, FANOUT_DURATION } from "./reel/Fanout";
import { TwoUsers, TWO_USERS_DURATION } from "./reel/TwoUsers";
import { Included, INCLUDED_DURATION } from "./reel/Included";
import { Refused, REFUSED_DURATION } from "./reel/Refused";
import { Drift, DRIFT_DURATION } from "./reel/Drift";
import { Push, PUSH_DURATION } from "./reel/Push";
import { Stream, STREAM_DURATION } from "./reel/Stream";
import { Map as SchemaMap, MAP_DURATION } from "./reel/Map";
import { Matrix, MATRIX_DURATION } from "./reel/Matrix";
import { Routes, ROUTES_DURATION } from "./reel/Routes";
import { Plausible, PLAUSIBLE_DURATION } from "./reel/Plausible";

loadFonts();

/**
 * The older ProductVideo, unchanged.
 *
 * It predates the 2026-08 design system — old brand hues, 800-weight display
 * type, 1440x810 — so it is not what RebaseIntro extends. It is kept because
 * removing a composition someone may still be rendering is not something this
 * task was asked to do. `src/index.css` keeps its palette alive for the same
 * reason. Anything NEW belongs in `src/scenes`.
 */
const ProductVideo: React.FC = () => (
    <Series>
        <Series.Sequence durationInFrames={150}><HeroIntro /></Series.Sequence>
        <Series.Sequence durationInFrames={300}><RealProductVideo /></Series.Sequence>
        <Series.Sequence durationInFrames={150}><ProductUIReveal /></Series.Sequence>
        <Series.Sequence durationInFrames={120}><HowItWorks /></Series.Sequence>
        <Series.Sequence durationInFrames={120}><FeatureShowcase /></Series.Sequence>
    </Series>
);

const FPS = 30;
const WIDTH = 1920;
const HEIGHT = 1080;

export const RemotionRoot: React.FC = () => (
    <>
        <Composition
            id="RebaseIntro"
            component={RebaseIntro}
            durationInFrames={INTRO_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        {/* The bento. Its own piece, not a beat in the film — one view held
            big and six arriving from the sides, all of them live. */}
        <Composition
            id="Bento"
            component={Bento}
            durationInFrames={BENTO_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        {/* TEMPORARY. The film with the voiceover printed on it, so the read can
            be timed before it is recorded. RebaseIntro itself is untouched. */}
        <Composition
            id="RebaseIntro-VO"
            component={RebaseIntroVO}
            durationInFrames={INTRO_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        {/* CANDIDATE scenes. Not in the film — each is here to be looked at
            and judged on whether it earns a place, the way the bento was. */}
        <Composition
            id="Reel-Fanout"
            component={() => (
                <Reel roll={0.34}>
                    <Fanout />
                </Reel>
            )}
            durationInFrames={FANOUT_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-TwoUsers"
            component={() => (
                <Reel roll={0.7}>
                    <TwoUsers />
                </Reel>
            )}
            durationInFrames={TWO_USERS_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Included"
            component={() => (
                <Reel roll={0.58}>
                    <Included />
                </Reel>
            )}
            durationInFrames={INCLUDED_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Refused"
            component={() => (
                <Reel roll={0.22} ground="#2E0EC7" reveal={0.24}>
                    <Refused />
                </Reel>
            )}
            durationInFrames={REFUSED_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Drift"
            component={() => (
                <Reel roll={0.46}>
                    <Drift />
                </Reel>
            )}
            durationInFrames={DRIFT_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Push"
            component={() => (
                <Reel roll={0.1}>
                    <Push />
                </Reel>
            )}
            durationInFrames={PUSH_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Stream"
            component={() => (
                <Reel roll={0.62} reveal={0.22}>
                    <Stream />
                </Reel>
            )}
            durationInFrames={STREAM_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Map"
            component={() => (
                <Reel roll={0.38} reveal={0.26}>
                    <SchemaMap />
                </Reel>
            )}
            durationInFrames={MAP_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Matrix"
            component={() => (
                <Reel roll={0.5} reveal={0.24}>
                    <Matrix />
                </Reel>
            )}
            durationInFrames={MATRIX_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Routes"
            component={() => (
                <Reel roll={0.74} reveal={0.24}>
                    <Routes />
                </Reel>
            )}
            durationInFrames={ROUTES_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        <Composition
            id="Reel-Plausible"
            component={() => (
                <Reel roll={0.58} reveal={0.28}>
                    <Plausible />
                </Reel>
            )}
            durationInFrames={PLAUSIBLE_DURATION}
            fps={FPS}
            width={WIDTH}
            height={HEIGHT}
        />

        {/* Every scene is also its own composition. Re-rendering 53 seconds to
            look at one cut is the fastest way to stop looking at cuts. */}
        {SCENES.map((scene, i) => (
            <Composition
                key={scene.id}
                id={`Scene-${scene.id}`}
                component={STANDALONE[i]}
                durationInFrames={scene.durationInFrames}
                fps={FPS}
                width={WIDTH}
                height={HEIGHT}
            />
        ))}

        <Composition
            id="ProductVideo"
            component={ProductVideo}
            durationInFrames={990}
            fps={30}
            width={1440}
            height={810}
        />
    </>
);
