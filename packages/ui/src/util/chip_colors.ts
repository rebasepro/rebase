import { ChipColorKey, ChipColorScheme } from "../components";
import { hashString } from "./hash";

export const CHIP_COLORS: Record<string, ChipColorScheme> = {
    blueLighter: { color: "#cfdfff", text: "#102046", darkColor: "#2750ae", darkText: "#cfdfff" },
    cyanLighter: { color: "#d0f0fd", text: "#04283f", darkColor: "#0b76b7", darkText: "#d0f0fd" },
    tealLighter: { color: "#c2f5e9", text: "#012524", darkColor: "#06a09b", darkText: "#daf3e9" },
    greenLighter: { color: "#d1f7c4", text: "#0b1d05", darkColor: "#338a17", darkText: "#d1f7c4" },
    yellowLighter: { color: "#ffeab6", text: "#3b2501", darkColor: "#b87503", darkText: "#ffeab6" },
    orangeLighter: { color: "#fee2d5", text: "#6b2613", darkColor: "#d74d26", darkText: "#fee2d5" },
    redLighter: { color: "#ffdce5", text: "#4c0c1c", darkColor: "#ba1e45", darkText: "#ffdce5" },
    pinkLighter: { color: "#ffdaf6", text: "#400832", darkColor: "#b2158b", darkText: "#ffdaf6" },
    purpleLighter: { color: "#ede2fe", text: "#280b42", darkColor: "#6b1cb0", darkText: "#ede2fe" },
    grayLighter: { color: "#eee", text: "#040404", darkColor: "#444", darkText: "#eee" },

    blueLight: { color: "#9cc7ff", text: "#102046", darkColor: "#2d7ff9", darkText: "#fff" },
    cyanLight: { color: "#77d1f3", text: "#04283f", darkColor: "#18bfff", darkText: "#fff" },
    tealLight: { color: "#72ddc3", text: "#012524", darkColor: "#20d9d2", darkText: "#fff" },
    greenLight: { color: "#93e088", text: "#0b1d05", darkColor: "#20c933", darkText: "#fff" },
    yellowLight: { color: "#ffd66e", text: "#3b2501", darkColor: "#fcb400", darkText: "#fff" },
    orangeLight: { color: "#ffa981", text: "#6b2613", darkColor: "#ff6f2c", darkText: "#fff" },
    redLight: { color: "#ff9eb7", text: "#4c0c1c", darkColor: "#f82b60", darkText: "#fff" },
    pinkLight: { color: "#f99de2", text: "#400832", darkColor: "#ff08c2", darkText: "#fff" },
    purpleLight: { color: "#cdb0ff", text: "#280b42", darkColor: "#8b46ff", darkText: "#fff" },
    grayLight: { color: "#ccc", text: "#040404", darkColor: "#666", darkText: "#fff" },

    blueDark: { color: "#2d7ff9", text: "#fff", darkColor: "#2d7ff9", darkText: "#fff" },
    cyanDark: { color: "#18bfff", text: "#fff", darkColor: "#18bfff", darkText: "#fff" },
    tealDark: { color: "#20d9d2", text: "#fff", darkColor: "#20d9d2", darkText: "#fff" },
    greenDark: { color: "#20c933", text: "#fff", darkColor: "#20c933", darkText: "#fff" },
    yellowDark: { color: "#fcb400", text: "#fff", darkColor: "#fcb400", darkText: "#fff" },
    orangeDark: { color: "#ff6f2c", text: "#fff", darkColor: "#ff6f2c", darkText: "#fff" },
    redDark: { color: "#f82b60", text: "#fff", darkColor: "#f82b60", darkText: "#fff" },
    pinkDark: { color: "#ff08c2", text: "#fff", darkColor: "#ff08c2", darkText: "#fff" },
    purpleDark: { color: "#8b46ff", text: "#fff", darkColor: "#8b46ff", darkText: "#fff" },
    grayDark: { color: "#666", text: "#fff", darkColor: "#666", darkText: "#fff" },

    blueDarker: { color: "#2750ae", text: "#cfdfff", darkColor: "#2750ae", darkText: "#cfdfff" },
    cyanDarker: { color: "#0b76b7", text: "#d0f0fd", darkColor: "#0b76b7", darkText: "#d0f0fd" },
    tealDarker: { color: "#06a09b", text: "#daf3e9", darkColor: "#06a09b", darkText: "#daf3e9" },
    greenDarker: { color: "#338a17", text: "#d1f7c4", darkColor: "#338a17", darkText: "#d1f7c4" },
    yellowDarker: { color: "#b87503", text: "#ffeab6", darkColor: "#b87503", darkText: "#ffeab6" },
    orangeDarker: { color: "#d74d26", text: "#fee2d5", darkColor: "#d74d26", darkText: "#fee2d5" },
    redDarker: { color: "#ba1e45", text: "#ffdce5", darkColor: "#ba1e45", darkText: "#ffdce5" },
    pinkDarker: { color: "#b2158b", text: "#ffdaf6", darkColor: "#b2158b", darkText: "#ffdaf6" },
    purpleDarker: { color: "#6b1cb0", text: "#ede2fe", darkColor: "#6b1cb0", darkText: "#ede2fe" },
    grayDarker: { color: "#444", text: "#eee", darkColor: "#444", darkText: "#eee" }
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
