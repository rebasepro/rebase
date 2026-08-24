import "./index.css";
import { Composition, Sequence, Series } from "remotion";
import { HeroIntro } from "./components/HeroIntro";
import { HowItWorks } from "./components/HowItWorks";
import { FeatureShowcase } from "./components/FeatureShowcase";
import { ProductUIReveal } from "./components/ProductUIReveal";
import { RealProductVideo } from "./components/RealProductVideo";
import { BentoBoxAnimation } from "./components/BentoBoxAnimation";

/**
 * Full product video — all scenes stitched together via Series.
 */
const ProductVideo: React.FC = () => {
  return (
    <Series>
      <Series.Sequence durationInFrames={150}>
        <HeroIntro/>
      </Series.Sequence>
      <Series.Sequence durationInFrames={300}>
        <RealProductVideo/>
      </Series.Sequence>
      <Series.Sequence durationInFrames={150}>
        <ProductUIReveal/>
      </Series.Sequence>
      <Series.Sequence durationInFrames={150}>
        <BentoBoxAnimation/>
      </Series.Sequence>
      <Series.Sequence durationInFrames={120}>
        <HowItWorks/>
      </Series.Sequence>
      <Series.Sequence durationInFrames={120}>
        <FeatureShowcase/>
      </Series.Sequence>
    </Series>
  );
};

export const RemotionRoot: React.FC = () => {
  return (
    <>
      {/* Full product video (all scenes) */}
      <Composition
        id="ProductVideo"
        component={ProductVideo}
        durationInFrames={990}
        fps={30}
        width={1440}
        height={810}
      />

      {/* Individual scenes for preview / standalone export */}
      <Composition
        id="HeroIntro"
        component={HeroIntro}
        durationInFrames={150}
        fps={30}
        width={1440}
        height={810}
      />
      <Composition
        id="ProductUIReveal"
        component={ProductUIReveal}
        durationInFrames={150}
        fps={30}
        width={1440}
        height={810}
      />
      <Composition
        id="BentoBoxAnimation"
        component={BentoBoxAnimation}
        durationInFrames={150}
        fps={30}
        width={1440}
        height={810}
      />
      <Composition
        id="HowItWorks"
        component={HowItWorks}
        durationInFrames={120}
        fps={30}
        width={1440}
        height={810}
      />
      <Composition
        id="FeatureShowcase"
        component={FeatureShowcase}
        durationInFrames={120}
        fps={30}
        width={1440}
        height={810}
      />
      <Composition
        id="RealProductVideo"
        component={RealProductVideo}
        durationInFrames={300}
        fps={30}
        width={1440}
        height={810}
      />
    </>
  );
};
