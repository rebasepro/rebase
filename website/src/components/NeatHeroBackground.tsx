import { useEffect, useRef } from "react";
import { NeatGradient } from "@firecms/neat";

/**
 * Inlined config (duplicated from neatConfig.ts) to avoid a separate chunk
 * that creates a critical request chain visible to Lighthouse.
 * NeatSectionDivider still imports from neatConfig.ts but those are client:visible.
 */
const NEAT_BASE_CONFIG = {
    licenseKey: "NEAT-eyJkb21haW4iOiJyZWJhc2UucHJvIiwiZW1haWwiOiJmcmFuY2VzY29AZmlyZWNtcy5jbyIsImlhdCI6MTc4MTQ4MTE5NX0.0gblm3vGqyk_e9WJ8OTO5SHQ8qF8HmgJQkt_qElKskW5YqOiHPc24ppKmpI6utufEtqbyJ58Vt_uAB2HNtprFQ",
    colors: [
        { color: "#FB5066", enabled: true },
        { color: "#36CCD6", enabled: true },
        { color: "#FFC600", enabled: true },
        { color: "#8B6AE6", enabled: true },
        { color: "#2E0EC7", enabled: true },
        { color: "#FF9A9E", enabled: true },
    ],
    speed: 0.3,
    horizontalPressure: 3,
    verticalPressure: 3,
    waveFrequencyX: 3,
    waveFrequencyY: 5,
    waveAmplitude: 10,
    shadows: 2,
    highlights: 6,
    colorBrightness: 0.25,
    colorSaturation: 1,
    wireframe: false,
    colorBlending: 3,
    backgroundColor: "#000000",
    backgroundAlpha: 0,
    grainScale: 0,
    grainSparsity: 0,
    grainIntensity: 0,
    grainSpeed: 2.4,
    resolution: 0.05,
    yOffset: 18063.63558959961,
    yOffsetWaveMultiplier: 7.2,
    yOffsetColorMultiplier: 6.8,
    yOffsetFlowMultiplier: 7.7,
    flowDistortionA: 0.4,
    flowDistortionB: 2.6,
    flowScale: 1.9,
    flowEase: 0.94,
    flowEnabled: true,
    enableProceduralTexture: true,
    transparentTextureVoid: false,
    textureVoidLikelihood: 0.59,
    textureVoidWidthMin: 120,
    textureVoidWidthMax: 330,
    textureBandDensity: 0.1,
    textureColorBlending: 0,
    textureSeed: 478,
    textureEase: 0.86,
    proceduralBackgroundColor: "#000000",
    textureShapeTriangles: 51,
    textureShapeCircles: 0,
    textureShapeBars: 15,
    textureShapeSquiggles: 0,
    domainWarpEnabled: false,
    domainWarpIntensity: 0,
    domainWarpScale: 3,
    vignetteIntensity: 0,
    vignetteRadius: 0.8,
    fresnelEnabled: false,
    fresnelPower: 2,
    fresnelIntensity: 0.5,
    fresnelColor: "#FFFFFF",
    iridescenceEnabled: false,
    iridescenceIntensity: 0.5,
    iridescenceSpeed: 1,
    bloomIntensity: 0,
    bloomThreshold: 0.7,
    chromaticAberration: 0,
    shapeType: "ribbon" as const,
    shapeRotationX: 0,
    shapeRotationY: 0,
    shapeRotationZ: 0,
    shapeAutoRotateSpeedX: 0,
    shapeAutoRotateSpeedY: 0,
    sphereRadius: 30,
    torusRadius: 15,
    torusTube: 5,
    cylinderRadius: 10,
    cylinderHeight: 40,
    planeBend: -0.8,
    planeTwist: 1,
    silhouetteFade: 0,
    cylinderFade: 0.08,
    ribbonFade: 0,
    flatShading: true,
    cameraLock: false,
    cameraX: 0,
    cameraY: -11.5,
    cameraZ: 0,
    cameraRotationX: 0.7310000000000001,
    cameraRotationY: 0.483,
    cameraRotationZ: 0,
    cameraZoom: 2.05,
} as const;
export function NeatHeroBackground() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const neatRef = useRef<NeatGradient | null>(null);

    useEffect(() => {
        if (!canvasRef.current) return;

        const neat = new NeatGradient({
            ref: canvasRef.current,
            ...NEAT_BASE_CONFIG,
        });
        neatRef.current = neat;

        const baseOffset = NEAT_BASE_CONFIG.yOffset;
        const handleScroll = () => {
            neat.yOffset = baseOffset + window.scrollY * 0.3;
        };

        window.addEventListener("scroll", handleScroll, { passive: true });

        return () => {
            window.removeEventListener("scroll", handleScroll);
            neat.destroy();
            neatRef.current = null;
        };
    }, []);

    return (
        <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden" }}>
            <canvas
                ref={canvasRef}
                id="neat-hero-canvas"
                style={{
                    position: "absolute",
                    inset: 0,
                    width: "100%",
                    height: "100%",
                    opacity: 0.55,
                    isolation: "isolate",
                }}
                aria-hidden="true"
            />
        </div>
    );
}
