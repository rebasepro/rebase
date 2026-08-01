
import React from "react";
import { CHIP_COLORS, cls } from "../util";
import { ChipColorKey, ChipColorScheme } from "./Chip";
import type { ChipTone } from "../util/chip_colors";
import { CheckIcon } from "lucide-react";
import { Tooltip } from "./Tooltip";

export interface ColorPickerProps {
    /**
     * Currently selected color key
     */
    value?: ChipColorKey;
    /**
     * Callback when color selection changes. Passes undefined when "Auto" is selected.
     */
    onChange: (colorKey: ChipColorKey | undefined) => void;
    /**
     * Size of the color swatches
     */
    size?: "small" | "medium";
    /**
     * Whether to show the "Auto" option that clears the selection
     */
    allowClear?: boolean;
    /**
     * Whether the picker is disabled
     */
    disabled?: boolean;
}

// Hues across, tones down — the arrangement the palette is built in.
const BASE_COLORS = ["blue", "indigo", "violet", "purple", "fuchsia", "pink", "rose", "red", "orange", "yellow", "green", "emerald", "teal", "cyan", "gray"] as const;

// Lightest first, matching how the bare hue name reads.
const TONES: ChipTone[] = ["Lighter", "Light", "Dark", "Darker"];

// Helper to get readable name from color key
function getColorDisplayName(hue: string, tone: ChipTone): string {
    const hueName = `${hue.charAt(0).toUpperCase()}${hue.slice(1)}`;
    return tone === "Lighter" ? hueName : `${hueName} ${tone.toLowerCase()}`;
}

/**
 * A color picker component that displays a grid of predefined CHIP_COLORS.
 * Used for selecting colors for enum values, tags, and other chip-based UI elements.
 *
 * @group Form components
 */
export function ColorPicker({
    value,
    onChange,
    size = "medium",
    allowClear = true,
    disabled = false
}: ColorPickerProps) {

    const swatchSize = size === "small" ? "w-5 h-5" : "w-6 h-6";
    const checkSize = size === "small" ? 12 : 14;

    return (
        <div className="flex flex-col gap-2">
            {allowClear && (
                <button
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(undefined)}
                    className={cls(
                        "flex items-center gap-2 px-2 py-1 rounded-lg text-sm transition-colors duration-150",
                        "hover:bg-surface-accent-100 dark:hover:bg-surface-accent-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                        disabled && "opacity-50 cursor-not-allowed",
                        !value && "bg-surface-accent-100 dark:bg-surface-accent-800 font-medium"
                    )}
                >
                    <div className={cls(
                        swatchSize,
                        "rounded-full border-2 border-dashed border-surface-accent-400 dark:border-surface-accent-600",
                        "flex items-center justify-center"
                    )}>
                        {!value && <CheckIcon size={checkSize}/>}
                    </div>
                    <span className="text-surface-accent-700 dark:text-surface-accent-300">
                        Auto (based on ID)
                    </span>
                </button>
            )}

            {/* One row per tone. Wrapping rather than a fixed 15-column grid:
                the picker also opens inside narrow property panels, where
                fifteen tracks would shrink each swatch to a few pixels. */}
            {TONES.map((tone) => (
                <div key={tone} className="flex flex-wrap gap-1.5">
                    {BASE_COLORS.map((base) => {
                        // The bare hue and its `Lighter` tone are the same
                        // scheme; the picker offers the short name so configs
                        // stay readable.
                        const colorKey = (tone === "Lighter" ? base : `${base}${tone}`) as ChipColorKey;
                        const colorScheme = CHIP_COLORS[colorKey] as ChipColorScheme;
                        const isSelected = value === colorKey;
                        const displayName = getColorDisplayName(base, tone);

                        return (
                            <Tooltip
                                key={colorKey}
                                title={displayName}
                                delayDuration={300}
                            >
                                <button
                                    type="button"
                                    disabled={disabled}
                                    onClick={() => onChange(colorKey)}
                                    className={cls(
                                        swatchSize,
                                        "rounded-full transition-all flex items-center justify-center",
                                        "hover:scale-110 hover:shadow-md",
                                        "focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                                        disabled && "opacity-50 cursor-not-allowed hover:scale-100",
                                        isSelected && "ring-2 ring-primary ring-offset-1"
                                    )}
                                    style={{
                                        backgroundColor: colorScheme.color
                                    }}
                                    aria-label={displayName}
                                    aria-pressed={isSelected}
                                >
                                    {isSelected && (
                                        <CheckIcon
                                            size={checkSize}
                                            style={{ color: colorScheme.text }}
                                        />
                                    )}
                                </button>
                            </Tooltip>
                        );
                    })}
                </div>
            ))}
        </div>
    );
}
