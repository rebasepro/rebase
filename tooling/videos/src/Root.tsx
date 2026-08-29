import "./index.css";
import React from "react";
import { Composition, Series } from "remotion";
import { loadFonts } from "./fonts";
import { RebaseIntro, STANDALONE } from "./Intro";
import { INTRO_DURATION, SCENES } from "./film";
import { HeroIntro } from "./components/HeroIntro";
import { HowItWorks } from "./components/HowItWorks";
import { FeatureShowcase } from "./components/FeatureShowcase";
import { ProductUIReveal } from "./components/ProductUIReveal";
import { RealProductVideo } from "./components/RealProductVideo";
import { BentoBoxAnimation } from "./components/BentoBoxAnimation";

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
        <Series.Sequence durationInFrames={150}><BentoBoxAnimation /></Series.Sequence>
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
