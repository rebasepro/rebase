/**
 * The series colours, in the order series take them: the kit's primary, then
 * seven hues stepped separately for the light and dark card. Validated as a
 * set (lightness band, chroma floor, colour-blind separation of neighbours,
 * contrast on the card): assign them in this order and never cycle them. A
 * ninth series folds into "Other" instead of getting a ninth hue.
 *
 * A series colour is data, not a surface, so each slot names its light and
 * dark value itself rather than a theme token. Each is literal Tailwind
 * classes, so the stylesheet that scans this package carries them.
 */
export const SERIES_COLORS = [
    { stroke: "stroke-primary", fill: "fill-primary", bg: "bg-primary" },
    { stroke: "stroke-[#eb6834] dark:stroke-[#d95926]", fill: "fill-[#eb6834] dark:fill-[#d95926]", bg: "bg-[#eb6834] dark:bg-[#d95926]" },
    { stroke: "stroke-[#1baf7a] dark:stroke-[#199e70]", fill: "fill-[#1baf7a] dark:fill-[#199e70]", bg: "bg-[#1baf7a] dark:bg-[#199e70]" },
    { stroke: "stroke-[#eda100] dark:stroke-[#c98500]", fill: "fill-[#eda100] dark:fill-[#c98500]", bg: "bg-[#eda100] dark:bg-[#c98500]" },
    { stroke: "stroke-[#e87ba4] dark:stroke-[#d55181]", fill: "fill-[#e87ba4] dark:fill-[#d55181]", bg: "bg-[#e87ba4] dark:bg-[#d55181]" },
    { stroke: "stroke-[#008300]", fill: "fill-[#008300]", bg: "bg-[#008300]" },
    { stroke: "stroke-[#6250d6] dark:stroke-[#9085e9]", fill: "fill-[#6250d6] dark:fill-[#9085e9]", bg: "bg-[#6250d6] dark:bg-[#9085e9]" },
    { stroke: "stroke-[#e34948] dark:stroke-[#e66767]", fill: "fill-[#e34948] dark:fill-[#e66767]", bg: "bg-[#e34948] dark:bg-[#e66767]" }
] as const;

export type SeriesColor = typeof SERIES_COLORS[number];
