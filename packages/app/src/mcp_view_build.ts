/**
 * The pieces of `rebaseMcpViewPlugin`'s second build: the view's document, its
 * utilities, its entry and the two plugins it builds with. Exported for the
 * plugin and for `@rebasepro/mcp-apps`' generic view, which builds the same
 * way; not part of `@rebasepro/app/vitePlugin`, which re-exports none of it.
 */
import fs from "fs";
import path from "path";
import type { Plugin } from "vite";

export function resolvesFrom(root: string, specifier: string): boolean {
    try {
        return fs.existsSync(path.join(root, "node_modules", specifier, "package.json"));
    } catch {
        return false;
    }
}

/** The view's document: a root for the app, and storage that works in a frame with no origin of its own. */
export function mcpViewDocument(entry = "./boot.tsx"): string {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="UTF-8"/>
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Rebase</title>
    <script>${MCP_VIEW_STORAGE_SHIM}</script>
</head>
<body>
<div id="root"></div>
<script type="module" src="${entry}"></script>
</body>
</html>
`;
}

/**
 * A host may sandbox the view without an origin of its own, and then reading
 * `localStorage` or `sessionStorage` throws. The admin keeps view preferences
 * there; in memory they last as long as the view.
 */
export const MCP_VIEW_STORAGE_SHIM = `for (const name of ["localStorage", "sessionStorage"]) {
    try { void window[name]; } catch {
        const data = new Map();
        Object.defineProperty(window, name, { configurable: true, value: {
            get length() { return data.size; },
            key: (index) => [...data.keys()][index] ?? null,
            getItem: (key) => data.has(key) ? data.get(key) : null,
            setItem: (key, value) => void data.set(key, String(value)),
            removeItem: (key) => void data.delete(key),
            clear: () => data.clear()
        } });
    }
}`;

export function mcpViewBoot(app: string, styles: string | undefined, insights: boolean): string {
    return [
        "import React from \"react\";",
        "import { createRoot } from \"react-dom/client\";",
        ...(styles ? [`import ${JSON.stringify(styles)};`] : []),
        "import \"./view.css\";",
        "import { addAppModules, startMcpView } from \"@rebasepro/cms/mcp-view\";",
        ...(insights ? [
            "import { BarChart, ChartCard, ChartStatus, KpiChange, KpiGrid, KpiReadout, KpiTile, SERIES_COLORS, TimeSeriesChart, compactFormat, describeChange, formatNumber, niceTicks } from \"@rebasepro/plugin-insights\";",
            "addAppModules({ \"@rebasepro/plugin-insights\": { BarChart, ChartCard, ChartStatus, KpiChange, KpiGrid, KpiReadout, KpiTile, SERIES_COLORS, TimeSeriesChart, compactFormat, describeChange, formatNumber, niceTicks } });"
        ] : []),
        "startMcpView({",
        `    mountApp: async () => {`,
        `        const { App } = await import(${JSON.stringify(app)});`,
        "        createRoot(document.getElementById(\"root\")!).render(<App/>);",
        "    }",
        "});",
        ""
    ].join("\n");
}

/**
 * The utilities an app Claude writes may use (show_app). Tailwind generates
 * only the classes it finds when it builds, and an app's code arrives later:
 * a class missing here does nothing, silently. Colours are the app's own,
 * from its stylesheet. And the root is held to the frame's width: an app's
 * stylesheet may lay out the page (a flex body sizes the root to its content).
 */
export const MCP_VIEW_UTILITIES = `@import "tailwindcss/utilities" source(none);
/* The view is as wide as its frame, whatever the app's stylesheet does with the page. */
#root { width: 100%; min-width: 0; }
@source inline("{sm:,md:,lg:,xl:,}{flex,inline-flex,grid,block,inline-block,hidden}");
@source inline("{sm:,md:,lg:,xl:,}{flex-row,flex-col,flex-wrap,flex-1,flex-none,shrink-0,grow,order-first,order-last}");
@source inline("{sm:,md:,lg:,xl:,}grid-cols-{1,2,3,4,5,6,7,8,9,10,11,12}");
@source inline("{sm:,md:,lg:,xl:,}col-span-{1,2,3,4,5,6,7,8,9,10,11,12,full}");
@source inline("{sm:,md:,lg:,xl:,}{gap,gap-x,gap-y,p,px,py,pt,pb,pl,pr,m,mx,my,mt,mb,ml,mr,space-x,space-y}-{0,0.5,1,1.5,2,2.5,3,4,5,6,8,10,12,16}");
@source inline("{sm:,md:,lg:,xl:,}{w,h,min-w,min-h,max-w,max-h}-{0,full,screen,fit,min,max,auto,1/2,1/3,2/3,1/4,3/4}");
@source inline("{w,h,min-h,max-h,size}-{4,5,6,8,10,12,16,20,24,32,40,48,64,72,80,96}");
@source inline("max-w-{xs,sm,md,lg,xl,2xl,3xl,4xl,5xl,6xl,7xl,prose}");
@source inline("{items,self}-{start,center,end,stretch,baseline}");
@source inline("justify-{start,center,end,between,around,evenly}");
@source inline("text-{xs,sm,base,lg,xl,2xl,3xl,4xl,left,center,right}");
@source inline("font-{normal,medium,semibold,bold,mono}");
@source inline("{truncate,whitespace-nowrap,break-words,uppercase,tabular-nums,underline}");
@source inline("leading-{tight,snug,normal,relaxed} tracking-{tight,wide}");
@source inline("rounded{,-md,-lg,-xl,-full} border{,-t,-b,-l,-r}");
@source inline("overflow-{hidden,auto,x-auto,y-auto} {relative,absolute,sticky} {top,bottom,left,right,inset}-0 z-{10,20}");
@source inline("opacity-{50,75} cursor-pointer select-none");
`;

/**
 * Every chunk inlined into the view's document: a frame fetches nothing, so
 * the script and the stylesheet are written into the page. The preload
 * helper's placeholder, which a build with no chunks to preload leaves
 * unreplaced, is filled in.
 */
export function mcpViewInlineIntoHtml(): Plugin {
    return {
        name: "rebase-mcp-view-inline",
        enforce: "post",
        generateBundle(_options, bundle) {
            for (const page of Object.values(bundle)) {
                if (page.type !== "asset" || !page.fileName.endsWith(".html")) continue;
                let html = String(page.source);
                for (const [fileName, file] of Object.entries(bundle)) {
                    if (file.type === "chunk" && fileName.endsWith(".js")) {
                        const tag = new RegExp(`<script[^>]*src="[^"]*${escapeForRegExp(fileName)}"[^>]*></script>`);
                        const code = file.code
                            // `</script` inside the code would close the tag early.
                            .replace(/<\/script/gi, "<\\/script")
                            .replace(/__VITE_PRELOAD__/g, "void 0");
                        html = html.replace(tag, () => `<script type="module">${code}</script>`);
                        delete bundle[fileName];
                    } else if (file.type === "asset" && fileName.endsWith(".css")) {
                        const tag = new RegExp(`<link[^>]*href="[^"]*${escapeForRegExp(fileName)}"[^>]*>`);
                        html = html.replace(tag, () => `<style>${String(file.source)}</style>`);
                        delete bundle[fileName];
                    }
                }
                page.source = html;
            }
        }
    };
}

/**
 * What the admin loads lazily and a view does without. With every chunk
 * inlined, an `import()` is no longer a fetch on demand but bytes in the
 * document: the whole Lucide map (an icon a collection names by string), every
 * date-fns locale but the default, the admin's translations (the view is in
 * English), and the toolbar's import and export (both work on files, and a
 * view has none to read nor anywhere to save one). Each becomes an empty
 * module, which every one of their loaders treats as "not there".
 */
export function mcpViewWithoutLazyExtras(): Plugin {
    return {
        name: "rebase-mcp-view-without-lazy-extras",
        enforce: "pre",
        load(id) {
            if (/\/icons\/lucide_icon_map\.[jt]s$/.test(id)) return "export const icons = {};";
            if (/\/date-fns\/locale\/(?!en-US)[^/]+\.js$/.test(id)) return "export {};";
            if (/\/app\/(src|dist)\/locales\/(?!en\.)[a-z]+\.[jt]s$/.test(id)) return "export {};";
            if (/\/data_import\/import\/ImportCollectionAction\.[jt]sx?$/.test(id)) {
                return "export const ImportCollectionAction = () => null, PropertySelectEntry = () => null, ImportDataPreview = () => null;";
            }
            if (/\/data_export\/export\/ExportCollectionAction\.[jt]sx?$/.test(id)) {
                return "export const ExportCollectionAction = () => null;";
            }
            return undefined;
        }
    };
}

function escapeForRegExp(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
