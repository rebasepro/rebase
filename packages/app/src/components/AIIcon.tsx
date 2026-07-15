import { Wand2Icon } from "@rebasepro/ui";
import React from "react";

export interface AIIconProps {
    size?: "smallest" | "small" | "medium" | "large";
    className?: string;
}

/**
 * AI-styled AutoAwesome icon with gradient coloring.
 * Used consistently across AI features for visual identification.
 */
export function AIIcon({ size = "small", className }: AIIconProps) {
    const sizeMap: Record<string, number> = {
        smallest: 16,
        small: 20,
        medium: 24,
        large: 28
    };
    const numericSize = typeof size === "string" ? sizeMap[size] || 20 : size;

    return (
        <Wand2Icon
            size={numericSize}
            className={className}
            style={{
                background: "linear-gradient(to right, var(--color-primary), var(--color-secondary))",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text"
            }}
        />
    );
}

/**
 * Small animated dot indicator for AI-modified elements.
 * Shows a pulsing gradient dot.
 */
export function AIModifiedIndicator({ className }: { className?: string }) {
    return (
        <div
            className={`w-2 h-2 rounded-full bg-gradient-to-r from-primary to-secondary animate-pulse ${className ?? ""}`}
            title="AI modified"
        />
    );
}
