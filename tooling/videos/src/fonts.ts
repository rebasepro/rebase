import { continueRender, delayRender, staticFile } from "remotion";

/**
 * The three faces the product ships, registered before any frame is captured.
 *
 * Not `@font-face` in a stylesheet, for two reasons. Webpack resolves a
 * `url(/fonts/…)` inside CSS as a MODULE, so the build fails outright; and
 * even past that, a stylesheet gives you no signal for "the font has arrived".
 * A render is a few thousand headless screenshots taken as fast as the machine
 * can take them — the first few hundred would come back set in the fallback,
 * at different metrics, with nothing anywhere to say so.
 *
 * `delayRender` makes that impossible: no frame exists until all three resolve.
 */

const FACES: [family: string, file: string, weight: string][] = [
    ["Instrument Sans", "fonts/instrument-sans.woff2", "400 700"],
    ["Inter", "fonts/inter.woff2", "100 900"],
    ["JetBrains Mono", "fonts/jetbrains-mono.woff2", "400"],
];

let started = false;

export function loadFonts() {
    if (started || typeof document === "undefined") return;
    started = true;

    /* A generous timeout and retries, because this competes for the main
     * thread with four headless Chromes each rasterising a 3840x2160 WebGL
     * frame. The files are 30-50KB served off localhost — they are never
     * genuinely slow — but under that load a fetch can miss its slot, and the
     * default 28s window then fails a render that was otherwise fine.
     * Observed twice, both times deep into a full render. */
    const handle = delayRender("loading fonts", {
        timeoutInMilliseconds: 120_000,
        retries: 2,
    });

    Promise.all(
        FACES.map(async ([family, file, weight]) => {
            const face = new FontFace(family, `url(${staticFile(file)}) format('woff2')`, {
                weight,
                display: "block",
            });
            await face.load();
            document.fonts.add(face);
        }),
    )
        .then(() => continueRender(handle))
        .catch((err) => {
            // Failing loudly beats shipping 55 seconds of Helvetica.
            throw new Error(`font load failed: ${err}`);
        });
}
