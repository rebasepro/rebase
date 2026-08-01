import { EnumValueConfig } from "@rebasepro/types";
import { ChipColorScheme, getColorSchemeForKey, getColorSchemeForSeed } from "@rebasepro/ui";
import { getLabelOrConfigFrom } from "@rebasepro/common";

export function getColorScheme(enumValues: EnumValueConfig[], key: string | number): ChipColorScheme | undefined {
    const labelOrConfig = getLabelOrConfigFrom(enumValues, key);
    if (!labelOrConfig?.color)
        return getColorSchemeForSeed(key.toString());
    if (typeof labelOrConfig === "object" && "color" in labelOrConfig) {
        if (typeof labelOrConfig.color === "string")
            // Not a raw table lookup: a config naming a colour this build does
            // not have still deserves a colour rather than `undefined`.
            return getColorSchemeForKey(labelOrConfig.color);
        if (typeof labelOrConfig.color === "object")
            return labelOrConfig.color;
    }
    return undefined;
}

export function isEnumValueDisabled(labelOrConfig?: string | EnumValueConfig) {
    return typeof labelOrConfig === "object" && (labelOrConfig as EnumValueConfig).disabled;
}

export function buildEnumLabel(
    labelOrConfig?: string | EnumValueConfig
): string | undefined {
    if (labelOrConfig === undefined)
        return undefined;
    if (typeof labelOrConfig === "object") {
        return labelOrConfig.label;
    } else {
        return labelOrConfig;
    }
}
