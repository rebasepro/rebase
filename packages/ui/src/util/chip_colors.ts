import { ChipColorKey, ChipColorScheme } from "../components";
import { hashString } from "./hash";

export const CHIP_COLORS: Record<string, ChipColorScheme> = {
    blue: { color: "#cfdfff",
text: "#102046",
darkColor: "#2750ae",
darkText: "#cfdfff" },
    teal: { color: "#c2f5e9",
text: "#012524",
darkColor: "#06a09b",
darkText: "#daf3e9" },
    yellow: { color: "#ffeab6",
text: "#3b2501",
darkColor: "#b87503",
darkText: "#ffeab6" },
    pink: { color: "#ffdaf6",
text: "#400832",
darkColor: "#b2158b",
darkText: "#ffdaf6" },
    purple: { color: "#ede2fe",
text: "#280b42",
darkColor: "#6b1cb0",
darkText: "#ede2fe" },
    cyan: { color: "#d0f0fd",
text: "#04283f",
darkColor: "#0b76b7",
darkText: "#d0f0fd" },
    orange: { color: "#fee2d5",
text: "#6b2613",
darkColor: "#d74d26",
darkText: "#fee2d5" },
    green: { color: "#d1f7c4",
text: "#0b1d05",
darkColor: "#338a17",
darkText: "#d1f7c4" },
    red: { color: "#ffdce5",
text: "#4c0c1c",
darkColor: "#ba1e45",
darkText: "#ffdce5" },
    gray: { color: "#eee",
text: "#040404",
darkColor: "#444",
darkText: "#eee" },
    indigo: { color: "#e0e7ff",
text: "#312e81",
darkColor: "#4f46e5",
darkText: "#e0e7ff" },
    violet: { color: "#ede9fe",
text: "#4c1d95",
darkColor: "#7c3aed",
darkText: "#ede9fe" },
    fuchsia: { color: "#fae8ff",
text: "#701a75",
darkColor: "#c026d3",
darkText: "#fae8ff" },
    rose: { color: "#ffe4e6",
text: "#881337",
darkColor: "#e11d48",
darkText: "#ffe4e6" },
    emerald: { color: "#d1fae5",
text: "#064e3b",
darkColor: "#059669",
darkText: "#d1fae5" }
};

export function getColorSchemeForKey(key: ChipColorKey): ChipColorScheme {
    return CHIP_COLORS[key];
}

export function getColorSchemeForSeed(seed: string): ChipColorScheme {
    const hash: number = hashString(seed);
    const colorKeys = Object.keys(CHIP_COLORS);
    const index = hash % colorKeys.length;
    return CHIP_COLORS[colorKeys[index]];
}
