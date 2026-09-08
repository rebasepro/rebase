/**
 * The site's gradient, as a module.
 *
 * `NeatBackground.tsx` frames every page on the site with an `@firecms/neat`
 * ribbon. Two offline renderers need the same material — the per-post blog
 * artwork (`generate_blog_images.mjs`) and the per-page social cards
 * (`generate_og_images.mjs`) — and until 2026-09-09 the page cards did not use
 * it at all: they shipped a system font, two radial gradients and a blue square
 * where the logo goes. One config here, imported by both, so the cards cannot
 * drift from the artwork again.
 *
 * Everything below was lifted verbatim from `generate_blog_images.mjs`; the
 * comments are the reasons the values are what they are.
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(SITE, "package.json"));

/** The Neat entry point, resolved from the site's own dependency. */
export const NEAT = require.resolve("@firecms/neat/dist/index.es.js", { paths: [SITE] });

/**
 * SwiftShader, so a render is the same pixels on a CI box with no GPU as on a
 * laptop. A hardware renderer would make every re-run a diff.
 */
export const CHROMIUM_ARGS = ["--use-gl=angle", "--use-angle=swiftshader"];

/**
 * The licence is domain-locked to rebase.pro, and `@firecms/neat` accepts
 * `localhost` alongside it — which is why this serves the page over HTTP rather
 * than opening a `file://` URL. The check also runs through `crypto.subtle`,
 * and Web Crypto is only exposed in a secure context: `file://` is not one, so
 * a file URL fails the licence check and renders a watermark over every card.
 */
export const LICENSE_KEY =
    "NEAT-eyJkb21haW4iOiJyZWJhc2UucHJvIiwiZW1haWwiOiJmcmFuY2VzY29AZmlyZWNtcy5jbyIsImlhdCI6MTc4MTQ4MTE5NX0.0gblm3vGqyk_e9WJ8OTO5SHQ8qF8HmgJQkt_qElKskW5YqOiHPc24ppKmpI6utufEtqbyJ58Vt_uAB2HNtprFQ";

export const ART = { width: 1600, height: 800 };
export const OG = { width: 1200, height: 630 };
// The hero is served from our own pages at 1600px wide, where a lossless
// gradient is megabytes and a quality-92 JPEG is ~60KB with nothing visible
// lost. The OG card stays PNG: it carries type, and JPEG rings around 68px
// letterforms.
export const ART_QUALITY = 92;

/**
 * The gradient, minus the seat it is viewed from.
 *
 * Lifted from `NeatBackground.tsx` so the artwork is the same material as the
 * site's own backgrounds, with three deliberate departures:
 *
 *  - `resolution` is 0.11, near the site's 0.05 and nowhere near 1.
 *
 *    This field is misleadingly named: its setter calls `_updateGeometry()`, so
 *    it is the ribbon's **mesh subdivision**, not a render scale. That makes it
 *    the single control over whether the artwork is angular or curvy, and the
 *    site is angular. A dense mesh (0.45) bends the ribbon into smooth organic
 *    curves that look nothing like the rest of the site; a coarse one leaves
 *    large flat facets with hard straight edges, which — with `flatShading` —
 *    is the faceted look every page background already has.
 *
 *    Too coarse is its own failure: past about 0.05 the frame is two or three
 *    enormous slabs, and zooming in at that mesh magnifies slabs rather than
 *    revealing detail. 0.11 is where a frame holds a dozen or so facets.
 *  - `backgroundAlpha` is 1 against the site's 0, because a PNG has nothing
 *    behind it to composite onto. `backgroundColor` is the site's own ground.
 *  - `colorBrightness` is raised. On the site the canvas sits at `opacity:
 *    0.55` over a dark page; here it is the whole image and 0.25 renders as
 *    near-black.
 *
 * `textureBandDensity: 0.1` is the site's value and is doing most of the work:
 * it is what makes the ribbon read as broad planes of colour rather than fine
 * stripes, which is the difference between artwork and a test pattern.
 */
export const BASE = {
    licenseKey: LICENSE_KEY,
    colors: [
        { color: "#FB5066", enabled: true },
        { color: "#36CCD6", enabled: true },
        { color: "#FFC600", enabled: true },
        { color: "#8B6AE6", enabled: true },
        { color: "#2E0EC7", enabled: true },
        { color: "#FF9A9E", enabled: true },
    ],
    speed: 0,
    horizontalPressure: 3,
    verticalPressure: 3,
    waveFrequencyX: 3,
    waveFrequencyY: 5,
    waveAmplitude: 10,
    shadows: 2,
    highlights: 6,
    // Brighter and more saturated than the site's 0.25/1. On the site the
    // canvas sits at `opacity: 0.55` over a dark page; here it is the whole
    // image. Brightness alone washes the palette toward pastel orange, so the
    // saturation comes up with it to keep the reds, cyans and violets reading
    // as themselves.
    colorBrightness: 0.85,
    colorSaturation: 1.2,
    wireframe: false,
    colorBlending: 3,
    backgroundColor: "#0b0d12",
    backgroundAlpha: 1,
    grainScale: 0,
    grainSparsity: 0,
    grainIntensity: 0,
    grainSpeed: 2.4,
    resolution: 0.11,
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
    // The site's value, and it survives the coarse mesh: 0.1 paints each facet
    // as a broad plane of colour. Raising it to 0.4 threads thin stripes across
    // the facets, which fights the geometry and reads as busy rather than bold.
    textureBandDensity: 0.1,
    textureColorBlending: 0,
    textureEase: 0.86,
    textureShapeTriangles: 51,
    textureShapeCircles: 0,
    textureShapeBars: 15,
    textureShapeSquiggles: 0,
    proceduralBackgroundColor: "#000000",
    domainWarpEnabled: false,
    vignetteIntensity: 0,
    fresnelEnabled: false,
    iridescenceEnabled: false,
    bloomIntensity: 0,
    chromaticAberration: 0,
    shapeType: "ribbon",
    shapeRotationX: 0,
    shapeRotationY: 0,
    shapeRotationZ: 0,
    cameraZ: 0,
    cameraRotationZ: 0,
    cameraLock: false,
    silhouetteFade: 0,
    // NOT 0, which is what `NeatBackground.tsx` carries. On a "ribbon" shape a
    // `ribbonFade` of exactly 0 renders nothing at all — the canvas comes back
    // as a flat fill of `backgroundColor`, with no error and no warning. 0.001
    // renders; 0.08 is the value the site uses for the cylinder shape and looks
    // right here. This cost an hour, and it is the reason the guard below
    // measures pixels instead of trusting the run to have worked.
    ribbonFade: 0.08,
    flatShading: true,
};

/**
 * FNV-1a, the same hash `NeatBackground.tsx` uses on pathnames.
 *
 * Any stable hash would do. This one spreads short, near-identical keys — and
 * blog slugs are the extreme case, since they all start with a date in the same
 * year — instead of clustering them at one seat.
 */
export function hash01(key) {
    let h = 2166136261;
    for (let i = 0; i < key.length; i++) {
        h ^= key.charCodeAt(i);
        h = Math.imul(h, 16777619);
    }
    return (h >>> 0) / 4294967296;
}

const TAU = Math.PI * 2;

/**
 * A seat on a closed orbit, one per slug.
 *
 * Every term rides at its own frequency and phase so two posts that land near
 * each other on the camera still separate on the twist, the bend or the texture
 * — the same trick as the site's hero orbit, for the same reason: a table of
 * hand-picked poses has to be extended whenever a post is written, and goes
 * stale silently when one is renamed.
 *
 * The ranges are the ones that still read as the same composition. They were
 * chosen by rendering the four quadrants and looking, not by guessing:
 *
 *  - `cameraZoom` below ~4 walks the camera far enough back that the ribbon
 *    stops filling the frame and leaves a flat black third along the bottom.
 *    Above ~7 the bands magnify past the point where the ribbon is legible as
 *    a surface, and the result reads as a candy stripe.
 *  - `cameraY` past about -7 lifts the ribbon out of frame entirely.
 *  - `textureSeed` is the strongest term of the lot — it redraws the colour
 *    banding wholesale — so it gets the widest range and its own frequency.
 */
export function poseFor(slug, offset = 0) {
    // The offset walks the same orbit rather than perturbing the terms, so a
    // later seat is as composed as the first — it is a different chair in the
    // same room, not the first chair nudged.
    const t = (hash01(slug) + offset) % 1;
    return {
        cameraX: 4 * Math.sin(TAU * t),
        cameraY: -3 + 2.6 * Math.cos(TAU * t + 0.9),
        cameraRotationX: 0.46 + 0.15 * Math.sin(TAU * 2 * t),
        cameraRotationY: 0.34 + 0.16 * Math.cos(TAU * t + 1.7),
        cameraZoom: 5.5 + 1.4 * Math.sin(TAU * t + 2.4),
        planeBend: 0.15 + 0.34 * Math.sin(TAU * t + 2.1),
        planeTwist: 0.7 + 0.32 * Math.cos(TAU * 2 * t + 0.7),
        yOffset: 140 * Math.sin(TAU * t + 3.4),
        textureSeed: Math.floor(1 + 997 * hash01(`${slug}#texture`)),
    };
}

/**
 * Does the image we are about to commit actually have a gradient on it?
 *
 * Every way this can fail — a WebGL context the sandbox refuses, a licence that
 * does not validate, a pose that walks the camera off the end of the ribbon —
 * fails to a flat fill rather than to an exception, and a committed 1600×800
 * rectangle of #0b0d12 looks exactly like a successful run in the console.
 *
 * This measures the **screenshot**, not the canvas. The obvious version reads
 * the drawing buffer back with `gl.readPixels`, and it reports every good
 * render as flat: the buffer is cleared once the frame is composited, and
 * anything running after that reads zeroes, which is precisely the "guard that
 * cannot tell success from failure" this exists to prevent. Measuring the
 * encoded output is also the stronger question — it covers the scrim and the
 * type, so it fails if the card renders as a black slab for any reason at all,
 * not only a WebGL one.
 */
export const IMAGE_STATS = async (dataUrl) => {
    const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    let min = 255;
    let max = 0;
    let chroma = 0;
    let ink = 0;
    let n = 0;
    // Every 37th pixel: coprime with the row width, so the walk crosses columns
    // instead of sampling one stripe down the image.
    for (let i = 0; i < bitmap.width * bitmap.height; i += 37) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (lum < min) min = lum;
        if (lum > max) max = lum;
        chroma += Math.max(r, g, b) - Math.min(r, g, b);
        // "Ink" is a pixel the ribbon actually covers, as opposed to the void
        // behind it. The ground is #0b0d12 — luminance about 12 — so anything
        // above 26 is paint. This is the number that separates a composition
        // from a black rectangle with a shard in one corner, and neither the
        // luminance range nor the mean chroma can see the difference: one bright
        // corner satisfies both.
        if (lum > 26) ink++;
        n++;
    }
    return { ok: true, range: max - min, chroma: chroma / n, ink: ink / n };
};

