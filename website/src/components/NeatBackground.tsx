import { useEffect, useRef } from "react";
import * as neatModule from "@firecms/neat";

interface NeatGradientConfig {
    ref: HTMLCanvasElement;
    [key: string]: unknown;
}

interface NeatGradientInstance {
    yOffset: number;
    cameraX: number;
    cameraY: number;
    cameraRotationX: number;
    cameraRotationY: number;
    cameraZoom: number;
    planeBend: number;
    planeTwist: number;
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
// The canvas shape the camera offsets below were composed against (a 600px-tall
// divider on a ~1440px desktop).
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

// ---------------------------------------------------------------------------
// Hero poses
// ---------------------------------------------------------------------------
// Every hero on the site is the same gradient seen from a different seat. The
// seat is a function of the page's path, not of chance: a page is framed the
// same way every time it is loaded, and moving between two pages is a move
// between two known points rather than a jump to a new random one — which is
// what lets the camera *travel* on navigation instead of cutting.
//
// This replaces a `Math.random()` jitter of +/-1.2 on cameraX and +/-0.8 on
// cameraY. Against a frustum half-width of ~26 units that was under 5% of the
// frame: not a variant, a wobble. The ranges below are the ones that still read
// as the same composition — cameraX past ~+/-10 walks the camera off the end of
// a ribbon that only spans +/-25, and every unit cameraY drops below ~-11.5
// lifts the ribbon further out of frame and leaves flat black under the
// headline. Measured on the four quadrants of the orbit, not guessed.
//
// The seats lie on a closed orbit rather than in a table keyed by path. A table
// has to be extended by hand every time a page is added, and goes stale
// silently when one is renamed; the orbit gives every path a seat by
// construction, and bounding each term bounds every seat on it.
const TAU = Math.PI * 2;

interface HeroPose {
    cameraX: number;
    cameraY: number;
    cameraRotationX: number;
    cameraRotationY: number;
    cameraZoom: number;
    // The ribbon's own shape, not just the seat it is viewed from. Writing either
    // of these rebuilds the mesh on the CPU rather than only marking the uniform
    // block dirty — measured at 0.038ms against a 16.7ms frame, so they tween per
    // frame alongside the camera like everything else.
    planeBend: number;
    planeTwist: number;
    // The base of the value the page scroll drives. `yOffset` feeds the wave,
    // colour and flow multipliers at once, so starting each page at a different
    // one puts every hero at a different point of the ribbon's own travel before
    // the reader has scrolled at all. Scroll adds to this rather than replacing it.
    yOffset: number;
    // Where the shader clock starts. Neat defaults this to the wall clock
    // (`minutes * 60 + seconds`), so the same page loaded a minute later opened
    // on a different moment of the animation — the largest part of the
    // "every page looks different" effect, and the part that was not reproducible.
    // Deriving it from the path makes a page look like itself on every load and
    // still gives neighbouring pages a different moment to open on.
    phase: number;
}

// The home page is not on the orbit. It keeps the composition the site was
// designed around exactly as it was, and only takes a fixed clock start in place
// of the wall-clock one, so it too looks like itself on every load.
const HOME_POSE: Omit<HeroPose, "phase"> = {
    cameraX: 0,
    cameraY: -9.5,
    cameraRotationX: 0.8310000000000001,
    cameraRotationY: 0.483,
    cameraZoom: 2.3,
    planeBend: -0.7,
    planeTwist: 1,
    yOffset: 0,
};

// Each term rides the orbit at its own frequency and phase offset rather than all
// of them moving in lockstep with `t`: two pages that land near each other on the
// camera still separate on the twist, the bend or the scroll base.
function heroPose(t: number, isHome: boolean): HeroPose {
    const phase = 3600 * t;
    if (isHome) return { ...HOME_POSE, phase };
    return {
        // Deliberately the smallest term of the lot. Translating the camera
        // sideways slides the whole composition across the frame, which reads as
        // the page shifting rather than as a different view of it; the same
        // lateral variety comes from the yaw below, which turns the camera in
        // place instead of moving it.
        cameraX: 5 * Math.sin(TAU * t),
        cameraY: -9.5 + 2.8 * Math.cos(TAU * t),
        cameraRotationX: 0.831 + 0.18 * Math.sin(TAU * 2 * t),
        cameraRotationY: 0.483 + 0.15 * Math.cos(TAU * t),
        cameraZoom: 2.3 + 0.3 * Math.sin(TAU * t + 1),
        planeBend: -0.7 + 0.38 * Math.sin(TAU * t + 2.1),
        planeTwist: 1 + 0.3 * Math.cos(TAU * 2 * t + 0.7),
        yOffset: 100 * Math.sin(TAU * t + 3.4),
        phase,
    };
}

function poseForPath(pathname: string): HeroPose {
    const key = pageKey(pathname);
    return heroPose(poseParamFor(key), key === "/");
}

// The language is not part of a page's identity: /es/product and /product are
// the same page, and switching language must not move the camera.
const LOCALE_PREFIXES = new Set(["es", "de", "fr"]);

function pageKey(pathname: string) {
    const segments = pathname.split("/").filter(Boolean);
    if (segments.length > 0 && LOCALE_PREFIXES.has(segments[0])) segments.shift();
    return "/" + segments.join("/");
}

// FNV-1a. Any stable hash would do; this one spreads the short, near-identical
// paths this site has ("/product", "/pricing", "/security") around the orbit
// rather than clustering them at one seat.
function poseParamFor(pathname: string) {
    const key = pageKey(pathname);
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
}

// Long enough to read as the camera moving rather than the page cutting, short
// enough to be over before a reader has finished taking in the new headline.
const POSE_TWEEN_MS = 700;

function easeInOutCubic(k: number) {
    return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

function lerpPose(from: HeroPose, to: HeroPose, k: number): HeroPose {
    const mix = (a: number, b: number) => a + (b - a) * k;
    return {
        cameraX: mix(from.cameraX, to.cameraX),
        cameraY: mix(from.cameraY, to.cameraY),
        cameraRotationX: mix(from.cameraRotationX, to.cameraRotationX),
        cameraRotationY: mix(from.cameraRotationY, to.cameraRotationY),
        cameraZoom: mix(from.cameraZoom, to.cameraZoom),
        planeBend: mix(from.planeBend, to.planeBend),
        planeTwist: mix(from.planeTwist, to.planeTwist),
        yOffset: mix(from.yOffset, to.yOffset),
        phase: to.phase,
    };
}

// How long the page must be still before a gradient is allowed to compile.
const SCROLL_QUIET_MS = 250;

// One listener for the page, not one per instance: the home page mounts six of
// these. `lastScrollAt` starts at 0 so a fresh load reads as "settled" and the
// hero gradient still starts immediately.
let lastScrollAt = 0;
let watchingScroll = false;

function watchScroll() {
    if (watchingScroll || typeof window === "undefined") return;
    watchingScroll = true;
    window.addEventListener("scroll", () => { lastScrollAt = performance.now(); }, { passive: true });
}

function msSinceScroll() {
    return performance.now() - lastScrollAt;
}

// Compiles are serialised across instances. The three hero gradients all become
// eligible in the same tick, and three synchronous compiles that share one task
// are one ~700ms block rather than three separate ones — the browser gets no
// frame in between, so it reads as a single freeze. The lock is released from a
// later task so the next gradient always starts with a clean slate.
let compiling = false;

function takeCompileSlot(): boolean {
    if (compiling) return false;
    compiling = true;
    return true;
}

function releaseCompileSlot() {
    setTimeout(() => { compiling = false; }, 0);
}

export function NeatBackground({ variant = "hero" }: { variant?: "hero" | "a" | "b" }) {
    const canvasRef = useRef<HTMLCanvasElement>(null);

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

        const isHero = variant === "hero";
        const config = { ...NEAT_BASE_CONFIG, ...(VARIANT_OVERRIDES[variant] ?? {}) };
        if (prefersReducedMotion) config.speed = 0;

        let neat: NeatGradientInstance | undefined;
        let scrollHandler: (() => void) | null = null;
        let cancelled = false;

        const dividerBaseOffset = config.yOffset ?? 0;
        const canvas = canvasRef.current;

        // The hero is the only variant that persists across a client-side
        // navigation (`transition:persist` at the call sites), so it is the only
        // one whose pose can change while the instance is alive.
        let pose = poseForPath(window.location.pathname);

        // The camera offsets above are composed for a wide canvas. On a phone the
        // frustum is less than half as wide, so the same offset lands the camera
        // near — or past — the end of a ribbon that only spans +/-25, and the
        // gradient renders as a black band with a sliver of art in one corner.
        // Re-express the offset as a fraction of the frustum we actually get.
        // Never scale it up: at or above the reference aspect this is a no-op, so
        // wide screens keep their composition.
        //
        // The zoom cancels out of that ratio — both half-widths divide by it — so
        // framing depends only on the canvas shape. It is measured on resize and
        // at compile time, never per frame: `clientWidth` forces a layout, and a
        // tween that read it every frame would pay for one on each.
        let framing = 1;
        const measureFraming = () => {
            const aspect = canvas.clientWidth / canvas.clientHeight;
            if (!Number.isFinite(aspect) || aspect <= 0) return;
            framing = Math.min(
                1,
                frustumHalfWidth(aspect, 1) / frustumHalfWidth(REFERENCE_ASPECT, 1),
            );
        };

        // Neat regenerates its uniforms from these on the next frame — cameraX/Y
        // and the rotations only mark the uniform block dirty, and cameraZoom
        // recomputes an orthographic matrix. `planeBend`/`planeTwist` are the
        // expensive pair, rebuilding the ribbon mesh on the CPU on every write;
        // measured at 0.038ms each against a 16.7ms frame, which is cheap enough
        // to tween rather than snap.
        const writePose = (p: HeroPose) => {
            if (!neat) return;
            neat.cameraX = p.cameraX * framing;
            neat.cameraY = p.cameraY;
            neat.cameraRotationX = p.cameraRotationX;
            neat.cameraRotationY = p.cameraRotationY;
            neat.cameraZoom = p.cameraZoom;
            neat.planeBend = p.planeBend;
            neat.planeTwist = p.planeTwist;
            // The pose supplies the base and the scroll adds to it, so the two
            // cannot fight: a tween landing mid-scroll keeps the reader's depth.
            neat.yOffset = p.yOffset + window.scrollY * 0.3;
        };

        let poseRaf = 0;
        const goToPose = (next: HeroPose, animate: boolean) => {
            cancelAnimationFrame(poseRaf);
            measureFraming();
            if (!animate || !neat) {
                pose = next;
                writePose(next);
                return;
            }
            // `from` is where the camera actually is, not where the last tween was
            // aiming: a reader who clicks through three pages in a second must
            // pick up each new leg from mid-flight, not snap back to the seat the
            // interrupted tween had been heading for.
            const from = pose;
            let startedAt = 0;
            const step = () => {
                // Timed from the first frame we are actually granted, not from the
                // moment the pose changed. requestAnimationFrame is suspended while
                // the document is hidden and while the browser runs the view
                // transition over the swap — the gap is routinely longer than the
                // tween itself, so a tween clocked from the swap would find its
                // whole duration already spent and land in one frame. That is a cut,
                // and a cut is exactly what this is here to avoid.
                if (startedAt === 0) startedAt = performance.now();
                const k = Math.min(1, (performance.now() - startedAt) / POSE_TWEEN_MS);
                pose = lerpPose(from, next, easeInOutCubic(k));
                writePose(pose);
                if (k < 1) poseRaf = requestAnimationFrame(step);
            };
            poseRaf = requestAnimationFrame(step);
        };

        // Compiling the shaders costs 600-1000ms of main thread on a throttled
        // phone. Astro's `client:idle` schedules this for the first idle moment,
        // which is precisely the gap where the hero headline is trying to paint —
        // it pushed LCP from ~2.3s to ~3.8s whenever the two collided. Nothing
        // here is content, so let the page finish loading first, then take an
        // idle slot.
        const startGradient = () => {
            if (cancelled || !NeatGradient) return;

            if (isHero) {
                // Read the pose at compile time, not at mount: a reader can navigate
                // away before the gradient is eligible, and the seat that matters is
                // the one for the page they are on now.
                measureFraming();
                Object.assign(config, {
                    cameraX: pose.cameraX * framing,
                    cameraY: pose.cameraY,
                    cameraRotationX: pose.cameraRotationX,
                    cameraRotationY: pose.cameraRotationY,
                    cameraZoom: pose.cameraZoom,
                    planeBend: pose.planeBend,
                    planeTwist: pose.planeTwist,
                    yOffset: pose.yOffset,
                    seed: pose.phase,
                });
            } else {
                measureFraming();
                config.cameraX = (config.cameraX ?? 0) * framing;
            }

            neat = new NeatGradient({
                ref: canvas,
                ...config,
            });
            scrollHandler?.();
        };

        // Building the gradient is one synchronous 300-450ms block, and an idle
        // callback does not make that safe: a callback that overruns its deadline
        // is not preempted, so taking an idle slot between two wheel events still
        // costs the same twenty dropped frames. The divider variants mount on
        // `client:visible`, which means they hydrate *while the page is moving* by
        // construction — precisely when that block is most visible, and why the
        // page stuttered every time a divider came into view.
        //
        // So wait for the scroll to stop rather than for the main thread to look
        // free. The gradients are decorative and `aria-hidden`; arriving a quarter
        // second after the page settles costs nothing. If the reader never stops,
        // the gradient never compiles, which is the right answer too — someone
        // travelling to the footer is not looking at a background.
        // `client:visible` hydrates a divider once and never revisits the decision,
        // so a reader who scrolls straight past every divider to the footer arrives
        // with six gradients all waiting for the same quiet moment — and pays for
        // five they cannot see. Re-check at compile time instead: only build the
        // ones still near the viewport, and let the rest keep waiting until the
        // reader comes back to them.
        const NEAR_VIEWPORT_PX = 600;
        const nearViewport = () => {
            const r = canvas.getBoundingClientRect();
            return r.bottom > -NEAR_VIEWPORT_PX && r.top < window.innerHeight + NEAR_VIEWPORT_PX;
        };

        let settleTimer: ReturnType<typeof setTimeout> | undefined;
        const startWhenSettled = () => {
            if (cancelled) return;
            const quietFor = msSinceScroll();
            if (quietFor < SCROLL_QUIET_MS) {
                settleTimer = setTimeout(startWhenSettled, SCROLL_QUIET_MS - quietFor);
                return;
            }
            if (!nearViewport()) {
                // Off-screen: nothing to show yet. This poll stops for good once the
                // gradient compiles, so it costs one layout read per idle instance.
                settleTimer = setTimeout(startWhenSettled, 250);
                return;
            }
            if (!takeCompileSlot()) {
                // Another gradient holds the slot; come back for the next one.
                settleTimer = setTimeout(startWhenSettled, 32);
                return;
            }
            try {
                startGradient();
            } finally {
                releaseCompileSlot();
            }
        };

        const scheduleGradient = () => {
            if (cancelled) return;
            watchScroll();
            if ("requestIdleCallback" in window) {
                requestIdleCallback(startWhenSettled, { timeout: 2000 });
            } else {
                setTimeout(startWhenSettled, 200);
            }
        };

        if (document.readyState === "complete") {
            scheduleGradient();
        } else {
            addEventListener("load", scheduleGradient, { once: true });
        }

        // A resize changes the frustum, and with it how much of the pose's offset
        // the canvas can actually afford. Re-seat rather than rebuild: the offset
        // is the only thing `framing` feeds, and it is live-settable. This also
        // covers a device rotation, which used to destroy and recompile the whole
        // gradient on the belief that Neat reads `cameraX` once at construction.
        // It does not — every camera field on the instance is a setter.
        let resizeTimer: ReturnType<typeof setTimeout> | undefined;
        const onResize = () => {
            clearTimeout(resizeTimer);
            resizeTimer = setTimeout(() => {
                if (!neat) return;
                if (isHero) {
                    measureFraming();
                    writePose(pose);
                } else {
                    // The divider variants bake their framed offset into the config at
                    // compile time; re-derive it from the unframed value so a resize
                    // does not compound the scaling it already applied.
                    const base = VARIANT_OVERRIDES[variant]?.cameraX ?? 0;
                    measureFraming();
                    neat.cameraX = base * framing;
                }
            }, 150);
        };
        window.addEventListener("resize", onResize);

        // The hero canvas outlives the page it was built on: `transition:persist`
        // hands the same element — and so the same WebGL context and the same
        // running shader clock — to the next page. Nothing here is torn down and
        // nothing is recompiled; the camera simply travels to the next page's seat
        // while the content swaps underneath it.
        const onAfterSwap = () => {
            if (!isHero || cancelled) return;
            goToPose(poseForPath(window.location.pathname), !prefersReducedMotion);
            // The new page starts at the top, so the parallax offset the old page
            // left behind is stale by exactly its scroll depth.
            scrollHandler?.();
        };
        if (isHero) document.addEventListener("astro:after-swap", onAfterSwap);

        const teardown = () => {
            cancelled = true;
            clearTimeout(settleTimer);
            clearTimeout(resizeTimer);
            cancelAnimationFrame(poseRaf);
            removeEventListener("load", scheduleGradient);
            window.removeEventListener("resize", onResize);
            document.removeEventListener("astro:after-swap", onAfterSwap);
            if (scrollHandler) window.removeEventListener("scroll", scrollHandler);
            if (neat) neat.destroy();
        };

        // Scroll parallax is motion too, so reduced-motion viewers keep the still
        // frame the config above froze rather than having it driven by the page.
        if (prefersReducedMotion) return teardown;

        // Coalesced into one rAF tick. This used to run per scroll event, and the
        // non-hero branch reads `getBoundingClientRect()` — a forced layout. With
        // four canvases on the home page that was three synchronous layout reads
        // plus four WebGL uniform writes on every event, which scroll fires far
        // more often than once a frame. That is the jank.
        let ticking = false;
        const applyOffset = () => {
            ticking = false;
            if (!neat) return;
            if (isHero) {
                writePose(pose);
            } else {
                const rect = canvas.getBoundingClientRect();
                const viewportCenter = window.innerHeight / 2;
                const offset = (rect.top - viewportCenter) * 0.3;
                neat.yOffset = dividerBaseOffset + offset;
            }
        };

        scrollHandler = () => {
            if (ticking) return;
            ticking = true;
            requestAnimationFrame(applyOffset);
        };

        window.addEventListener("scroll", scrollHandler, { passive: true });
        applyOffset();

        return teardown;
    }, [variant]);

    if (variant === "hero") {
        return (
            <div style={{ position: "absolute", inset: 0, width: "100%", height: "100%", overflow: "hidden" }}>
                <canvas
                    ref={canvasRef}
                    id="neat-hero-canvas"
                    style={{
                        position: "absolute",
                        top: 0,
                        left: 0,
                        width: "100%",
                        // Sized by the viewport, not by the hero section it happens to be
                        // sitting in. The sections are nowhere near a common height —
                        // 603px on /about, 715 on /product, 745 on /security, 992 on
                        // /europe — and this canvas now outlives the page it was built
                        // on, so a section-sized box changed by 65% mid-navigation.
                        // Neat debounces its own resize by 100ms (the ResizeObserver in
                        // NeatGradient), so for those 100ms the browser stretched the
                        // old drawing buffer over the new box and then snapped it back:
                        // the flash. A viewport-derived height only changes when the
                        // viewport does, which a navigation never does.
                        //
                        // It also makes the framing honest. `framing` below is a
                        // function of the canvas aspect, so under section sizing /about
                        // was getting its full camera offset and /europe only 60% of
                        // one — the per-page poses were being silently scaled by
                        // whatever height the section happened to have.
                        //
                        // `minHeight` covers the few heroes taller than the viewport;
                        // the section's own `overflow: hidden` clips the rest.
                        height: "100vh",
                        minHeight: "100%",
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
