import path from "path";
import type { Plugin } from "vite";
import { MCP_VIEW_BUILD } from "./mcp_view_build.ts";

/** The body font of the Rebase theme (`--font-sans`), Latin subset, as @fontsource emits it. */
const DEFAULT_FONTS = [/^inter-latin-wght-normal-[\w-]+\.woff2$/];

/**
 * A `<link rel="preload" as="font">` in index.html for the fonts the first
 * screen draws text in.
 *
 * A font in a stylesheet is requested only once text using it is laid out —
 * in an SPA, after every eager chunk has downloaded and run and React has
 * rendered. The first paint then shows the fallback face and re-lays the page
 * out when the font arrives. Preloaded, it downloads alongside the JavaScript
 * and is in hand at the first paint.
 *
 * Only Inter's Latin file by default (48 kB): every screen's body text. Each
 * preload competes with the eager JavaScript for bandwidth, so a face the
 * first screen may not use — headings, monospace, other subsets — is better
 * left to load when it is used.
 *
 * @param fonts emitted file names to preload, matched against the base name
 */
export function rebasePreloadFonts(fonts: RegExp[] = DEFAULT_FONTS): Plugin {
    let base = "/";
    return {
        name: "rebase:preload-fonts",
        apply: "build",
        configResolved(config) {
            base = config.base.endsWith("/") ? config.base : `${config.base}/`;
        },
        transformIndexHtml: {
            order: "post",
            handler(_html, ctx) {
                // The MCP view is one document a frame shows from `srcdoc`:
                // it fetches nothing, and a preload there is a failed request.
                if (!ctx.bundle || process.env[MCP_VIEW_BUILD]) return;
                return Object.keys(ctx.bundle)
                    .filter(fileName => fonts.some(pattern => pattern.test(path.basename(fileName))))
                    .map(fileName => ({
                        tag: "link",
                        attrs: { rel: "preload",
as: "font",
type: "font/woff2",
href: `${base}${fileName}`,
crossorigin: "" },
                        injectTo: "head" as const
                    }));
            }
        }
    };
}
