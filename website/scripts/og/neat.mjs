/**
 * The site's preview cards, as a module: the glow they are lit by, the seat
 * each card views it from, and the renderer that turns `og/card.html` into a
 * PNG.
 *
 * Every hero on the site draws the same backdrop (`HeroBackdrop.astro`):
 * NeatBackground's smooth `glow` field, masked into the page ground, under a
 * faint drafting grid on the shell's module. Three offline renderers need the
 * same picture — the per-route cards (`generate_og_images.mjs`), the per-post
 * cards (`generate_blog_images.mjs`) and the GitHub social preview
 * (`og/render.mjs`) — so the config, the seat and the template live here and in
 * `og/card.html`, once. Until 2026-11-10 the cards drew the faceted ribbon the
 * site had retired from its heroes, and each generator carried its own copy of
 * the card markup.
 *
 *     import { openCardRenderer, seatFor } from "./og/neat.mjs";
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const require = createRequire(path.join(SITE, "package.json"));

/** The Neat entry point, resolved from the site's own dependency. */
export const NEAT = require.resolve("@firecms/neat/dist/index.es.js", { paths: [SITE] });

/** The one card template every renderer fills. */
export const CARD_TEMPLATE = path.join(SITE, "og", "card.html");

/**
 * SwiftShader, so a render is the same pixels on a CI box with no GPU as on a
 * laptop. A hardware renderer would make every re-run a diff.
 */
export const CHROMIUM_ARGS = ["--use-gl=angle", "--use-angle=swiftshader"];

/**
 * The licence is domain-locked to rebase.pro, and `@firecms/neat` accepts
 * `localhost` alongside it — which is why the card is served over HTTP rather
 * than opened as a `file://` URL. The check also runs through `crypto.subtle`,
 * and Web Crypto is only exposed in a secure context: `file://` is not one, so
 * a file URL fails the licence check and renders a watermark over every card.
 */
export const LICENSE_KEY =
    "NEAT-eyJkb21haW4iOiJyZWJhc2UucHJvIiwiZW1haWwiOiJmcmFuY2VzY29AZmlyZWNtcy5jbyIsImlhdCI6MTc4MTQ4MTE5NX0.0gblm3vGqyk_e9WJ8OTO5SHQ8qF8HmgJQkt_qElKskW5YqOiHPc24ppKmpI6utufEtqbyJ58Vt_uAB2HNtprFQ";

export const OG = { width: 1200, height: 630 };

/**
 * The glow, as `GLOW_CONFIG` in `NeatBackground.tsx` draws it behind every
 * hero: a smooth plane, no procedural texture, no flat shading, full mesh
 * resolution, on the page ground. One departure: `speed` is 0, so the shader
 * clock holds at the seat's `seed` and the frame is a pure function of the
 * route. Keep the rest in step with the component — a card that drifts from
 * the hero it previews is the failure this module exists to prevent.
 */
export const GLOW = {
    licenseKey: LICENSE_KEY,
    antialias: true,
    colors: [
        { color: "#2E0EC7", enabled: true },
        { color: "#0070F4", enabled: true },
        { color: "#36CCD6", enabled: true },
        { color: "#FB5066", enabled: true },
        { color: "#1B1A8A", enabled: true },
        { color: "#0B0C0E", enabled: false },
    ],
    speed: 0,
    horizontalPressure: 4,
    verticalPressure: 5,
    waveFrequencyX: 2,
    waveFrequencyY: 3,
    waveAmplitude: 5,
    shadows: 1,
    highlights: 4,
    colorBrightness: 1,
    colorSaturation: 1.1,
    wireframe: false,
    colorBlending: 8,
    backgroundColor: "#08090A",
    backgroundAlpha: 1,
    grainScale: 2,
    grainSparsity: 0,
    grainIntensity: 0.08,
    grainSpeed: 1,
    resolution: 1,
    yOffset: 0,
    flowEnabled: true,
    flowDistortionA: 0.6,
    flowDistortionB: 1.8,
    flowScale: 1.6,
    flowEase: 0.4,
    enableProceduralTexture: false,
    domainWarpEnabled: false,
    shapeType: "plane",
    flatShading: false,
};

/**
 * FNV-1a, the same hash `NeatBackground.tsx` uses on pathnames
 * (`poseParamFor`). It spreads short, near-identical keys — "/product",
 * "/pricing", and blog slugs that all open on the same year — around the
 * field instead of clustering them at one seat.
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
// `GLOW_TRAVEL` in NeatBackground.tsx.
const GLOW_TRAVEL = 220;

/**
 * Where on the field a route's card is lit from: the seat the live hero opens
 * on, `glowPoseForPath` in `NeatBackground.tsx`, so a shared link previews the
 * light the page itself shows. The glow has a fixed camera; a seat is a point
 * along the field's own travel (`yOffset`) and the moment its clock starts
 * (`seed`). The home page keeps the offset the field was composed at.
 *
 * `pathname` is the route without a locale prefix: "/", "/pricing",
 * "/blog/<slug>".
 */
export function seatFor(pathname) {
    const t = hash01(pathname);
    if (pathname === "/") return { yOffset: 0, seed: 3600 * t };
    return { yOffset: GLOW_TRAVEL * Math.sin(TAU * t + 3.4), seed: 3600 * t };
}

/**
 * Does the image we are about to commit actually have the glow on it?
 *
 * Every way this can fail — a WebGL context the sandbox refuses, a licence that
 * does not validate — fails to a flat fill rather than to an exception, and a
 * committed rectangle of #08090A looks exactly like a successful run in the
 * console.
 *
 * This measures the **screenshot**, not the canvas. Reading the drawing buffer
 * back with `gl.readPixels` reports every good render as flat: the buffer is
 * cleared once the frame is composited. Measuring the encoded output is also
 * the stronger question — it covers the type too, so it fails if the card comes
 * out as a black slab for any reason at all, not only a WebGL one.
 *
 * Runs in the page (`page.evaluate`), so it must stay self-contained.
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
        n++;
    }
    return { range: max - min, chroma: chroma / n };
};

/**
 * What the card page may fetch: the shader, and the site's own type and mark —
 * the same @fontsource files `Layout.astro` ships, so the card sets in the
 * site's faces and not in whatever the rendering machine has.
 */
const STATIC = {
    "/neat.js": [NEAT, "text/javascript"],
    "/logo.svg": [path.join(SITE, "public", "logo.svg"), "image/svg+xml"],
    "/font-head.woff2": [
        require.resolve("@fontsource-variable/instrument-sans/files/instrument-sans-latin-wght-normal.woff2", {
            paths: [SITE],
        }),
        "font/woff2",
    ],
    "/font-body.woff2": [
        require.resolve("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2", { paths: [SITE] }),
        "font/woff2",
    ],
    "/font-mono.woff2": [path.join(SITE, "public", "fonts", "jetbrains-mono-latin.woff2"), "font/woff2"],
};

/**
 * Start the server and the browser once, render as many cards as needed.
 *
 *     const renderer = await openCardRenderer();
 *     const { buffer } = await renderer.render({ route: "/pricing", eyebrow, title, sub });
 *     await renderer.close();
 *
 * A card is `{ route, eyebrow, title, sub?, subHtml?, cmd? }`. `subHtml` is for
 * copy that already carries markup (the home subtitle's `<strong>`s) and is
 * inserted as is, so only pass it trusted, in-repo strings.
 *
 * `render` returns `{ buffer, stats }`, or `{ why }` when the page timed out or
 * came out flat; the caller decides whether that fails the run.
 */
export async function openCardRenderer() {
    const template = await readFile(CARD_TEMPLATE, "utf8");
    if (!template.includes("/*CARD*/")) throw new Error(`${CARD_TEMPLATE} has no /*CARD*/ marker`);

    const server = createServer(async (req, res) => {
        const hit = STATIC[req.url.split("?")[0]];
        if (!hit) {
            res.statusCode = 404;
            res.end("");
            return;
        }
        res.setHeader("content-type", hit[1]);
        res.end(await readFile(hit[0]));
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://localhost:${server.address().port}`;

    // `@playwright/test` is the dependency this repo declares; `playwright` is
    // its peer and is not always hoisted where a bare specifier from `website/`
    // can see it. Playwright's own Chromium by default; `OG_CHROME_CHANNEL=chrome`
    // renders through the Chrome already on the machine, and is tried on its own
    // when the bundled browser is not installed.
    const { chromium } = require("@playwright/test");
    const launch = (channel) => chromium.launch({ ...(channel ? { channel } : {}), args: CHROMIUM_ARGS });
    let browser;
    try {
        browser = await launch(process.env.OG_CHROME_CHANNEL);
    } catch (e) {
        if (process.env.OG_CHROME_CHANNEL) throw e;
        browser = await launch("chrome");
    }

    async function render(card, { width = OG.width, height = OG.height, deviceScaleFactor = 1 } = {}) {
        const data = {
            eyebrow: card.eyebrow,
            title: card.title,
            sub: card.sub ?? null,
            subHtml: card.subHtml ?? null,
            cmd: card.cmd ?? null,
            glow: { ...GLOW, ...seatFor(card.route) },
        };
        // `</` cannot appear inside the JSON island, or a title could close the
        // script element early.
        const body = template.replace("/*CARD*/", JSON.stringify(data).replace(/<\//g, "<\\/"));
        const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor });
        const pageErrors = [];
        page.on("pageerror", (e) => pageErrors.push(e.message));
        try {
            await page.route(`${origin}/card`, (route) => route.fulfill({ contentType: "text/html", body }));
            await page.goto(`${origin}/card`, { waitUntil: "load" });
            try {
                await page.waitForFunction(() => window.__ready === true, { timeout: 30000 });
            } catch {
                return { why: `timeout${pageErrors.length ? " · " + pageErrors.join(" | ") : ""}` };
            }
            const buffer = await page.screenshot({ type: "png" });
            const stats = await page.evaluate(IMAGE_STATS, `data:image/png;base64,${buffer.toString("base64")}`);
            // Barely above a flat fill: this asks "did the shader run at all".
            if (stats.range < 25 || stats.chroma < 8) return { why: `flat ${JSON.stringify(stats)}` };
            return { buffer, stats };
        } finally {
            await page.close();
        }
    }

    async function close() {
        await browser.close();
        server.close();
    }

    return { render, close };
}
