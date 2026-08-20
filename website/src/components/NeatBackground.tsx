import { useEffect, useRef, useState } from "react";
import * as neatModule from "@firecms/neat";

interface NeatGradientConfig {
    ref: HTMLCanvasElement;
    [key: string]: unknown;
}

interface NeatGradientInstance {
    yOffset: number;
    destroy: () => void;
}

interface NeatModuleShape {
    NeatGradient?: new (config: NeatGradientConfig) => NeatGradientInstance;
    default?: {
        NeatGradient?: new (config: NeatGradientConfig) => NeatGradientInstance;
        default?: {
            NeatGradient?: new (config: NeatGradientConfig) => NeatGradientInstance;
        };
    };
}

const neatModuleTyped = neatModule as unknown as NeatModuleShape;
const NeatGradient = neatModuleTyped.NeatGradient || 
                     neatModuleTyped.default?.NeatGradient || 
                     neatModuleTyped.default?.default?.NeatGradient;

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
    yOffset: 0,
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
    planeBend: -0.7,
    planeTwist: 1,
    silhouetteFade: 0,
    cylinderFade: 0.08,
    ribbonFade: 0,
    flatShading: true,
    cameraLock: false,
    cameraX: 0,
    cameraY: -9.5,
    cameraZ: 0,
    cameraRotationX: 0.8310000000000001,
    cameraRotationY: 0.483,
    cameraRotationZ: 0,
    cameraZoom: 2.3,
};

// Neat frames a "ribbon" with an orthographic camera whose *vertical* extent is
// fixed: the horizontal half-width is `25 * aspect / zoom` while the canvas is
// landscape, but the moment it turns portrait the width stops following the
// aspect and pins at `25 * 1.05 / zoom`. See updateCamera() in @firecms/neat.
const RIBBON_HALF_SIZE = 25;
// The canvas shape the divider camera offsets below were composed against
// (a 600px-tall divider on a ~1440px desktop).
const REFERENCE_ASPECT = 2.4;

function frustumHalfWidth(aspect: number, zoom: number) {
    return (aspect >= 1 ? RIBBON_HALF_SIZE * aspect : RIBBON_HALF_SIZE * 1.05) / zoom;
}

const VARIANT_OVERRIDES: Record<string, Partial<any>> = {
    hero: {},
    a: {
        yOffset: 0,
        planeBend: 0.2,
        planeTwist: 0.8,
        cameraX: 25.5,
        cameraY: 10.5,
        cameraRotationX: 0.61,
        cameraRotationY: 0.483,
        cameraZoom: 2.05,
        speed: 0.2,
    },
    b: {
        yOffset: 0,
        planeBend: 0.2,
        planeTwist: 0.8,
        cameraX: -29.5,
        cameraY: 1.5,
        cameraRotationX: 0.61,
        cameraRotationY: 0.483,
        cameraZoom: 2.05,
        speed: 0.2,
    },
};

// Neat reads cameraX once, at construction, so the framing above can only follow
// a rotation by rebuilding the gradient. Orientation flips are rare enough that
// paying for a shader recompile is fine; plain resizes are left alone.
function useOrientation() {
    const [portrait, setPortrait] = useState(false);

    useEffect(() => {
        const query = window.matchMedia?.("(orientation: portrait)");
        if (!query) return;
        setPortrait(query.matches);
        const onChange = (event: MediaQueryListEvent) => setPortrait(event.matches);
        query.addEventListener("change", onChange);
        return () => query.removeEventListener("change", onChange);
    }, []);

    return portrait;
}

export function NeatBackground({ variant = "hero", randomize = true }: { variant?: "hero" | "a" | "b"; randomize?: boolean }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const portrait = useOrientation();

    useEffect(() => {
        if (!canvasRef.current) return;

        // Respect users who prefer reduced motion. This used to skip the gradient
        // outright, which is a bigger concession than the preference asks for and
        // costs more than it looks: iOS Safari reports `reduce` for the whole of
        // Low Power Mode, so a phone on a low battery lost every gradient on the
        // page and got flat black in their place. Keep the art, drop the motion —
        // speed 0 freezes the shader clock, so it renders as a still image.
        const prefersReducedMotion =
            typeof window !== "undefined" &&
            window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

        const config = { ...NEAT_BASE_CONFIG, ...(VARIANT_OVERRIDES[variant] ?? {}) };
        if (prefersReducedMotion) config.speed = 0;

        // Add a tiny touch of randomness to position/shape so each instance feels unique (if enabled)
        // Only affects camera position and shape — never colors or textures.
        if (randomize) {
            const r = () => (Math.random() - 0.5) * 2; // -1 to 1
            config.cameraX = (config.cameraX ?? 0) + r() * 1.2;
            config.cameraY = (config.cameraY ?? 0) + r() * 0.8;
            config.planeTwist = (config.planeTwist ?? 1) + r() * 0.08;
        }

        let neat: NeatGradientInstance | undefined;
        let scrollHandler: (() => void) | null = null;
        let cancelled = false;

        const baseOffset = config.yOffset ?? 0;
        const canvas = canvasRef.current;

        // Compiling the shaders costs 600-1000ms of main thread on a throttled
        // phone. Astro's `client:idle` schedules this for the first idle moment,
        // which is precisely the gap where the hero headline is trying to paint —
        // it pushed LCP from ~2.3s to ~3.8s whenever the two collided. Nothing
        // here is content, so let the page finish loading first, then take an
        // idle slot.
        const startGradient = () => {
            if (cancelled || !NeatGradient) return;

            // The divider variants park the camera 25-30 world units to one side, which
            // puts the ribbon's centre at the edge of frame on a wide canvas. On a phone
            // the frustum is less than half as wide, so that same offset lands the camera
            // past the end of the ribbon (which only spans +/-25) and the divider renders
            // as a black band with a sliver of art in one corner. Re-express the offset as
            // a fraction of the frustum we actually get. Never scale it up: at or above the
            // reference aspect this is a no-op, so wide screens keep their composition.
            const aspect = canvas.clientWidth / canvas.clientHeight;
            if (Number.isFinite(aspect) && aspect > 0) {
                const zoom = config.cameraZoom ?? 1;
                const framing = Math.min(
                    1,
                    frustumHalfWidth(aspect, zoom) / frustumHalfWidth(REFERENCE_ASPECT, zoom),
                );
                config.cameraX = (config.cameraX ?? 0) * framing;
            }

            neat = new NeatGradient({
                ref: canvas,
                ...config,
            });
            scrollHandler?.();
        };

        const scheduleGradient = () => {
            if (cancelled) return;
            if ("requestIdleCallback" in window) {
                requestIdleCallback(startGradient, { timeout: 2000 });
            } else {
                setTimeout(startGradient, 200);
            }
        };

        if (document.readyState === "complete") {
            scheduleGradient();
        } else {
            addEventListener("load", scheduleGradient, { once: true });
        }

        // Scroll parallax is motion too, so reduced-motion viewers keep the still
        // frame the config above froze rather than having it driven by the page.
        if (prefersReducedMotion) {
            return () => {
                cancelled = true;
                removeEventListener("load", scheduleGradient);
                if (neat) neat.destroy();
            };
        }

        // Coalesced into one rAF tick. This used to run per scroll event, and the
        // non-hero branch reads `getBoundingClientRect()` — a forced layout. With
        // four canvases on the home page that was three synchronous layout reads
        // plus four WebGL uniform writes on every event, which scroll fires far
        // more often than once a frame. That is the jank.
        let ticking = false;
        const applyOffset = () => {
            ticking = false;
            if (!neat) return;
            if (variant === "hero") {
                neat.yOffset = baseOffset + window.scrollY * 0.3;
            } else {
                const rect = canvas.getBoundingClientRect();
                const viewportCenter = window.innerHeight / 2;
                const offset = (rect.top - viewportCenter) * 0.3;
                neat.yOffset = baseOffset + offset;
            }
        };

        scrollHandler = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(applyOffset);
        };

        window.addEventListener("scroll", scrollHandler, { passive: true });
        applyOffset();

        return () => {
            cancelled = true;
            removeEventListener("load", scheduleGradient);
            if (scrollHandler) window.removeEventListener("scroll", scrollHandler);
            if (neat) neat.destroy();
        };
    }, [variant, randomize, portrait]);

    if (variant === "hero") {
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

    // Divider variants ("a", "b")
    return (
        <canvas
            ref={canvasRef}
            style={{
                display: "block",
                width: "100%",
                height: "100%",
                opacity: 0.55,
            }}
            aria-hidden="true"
        />
    );
}
