/**
 * Lightweight stubs for utilities that the config views imported from
 * @dataki/common or @rebasepro/core but don't exist in the current build.
 * These are placeholders – the config editing views are deprioritised.
 */
import React from "react";

/**
 * Simple error boundary to prevent config panels from crashing the whole page.
 */
export class ErrorBoundary extends React.Component<
    { children: React.ReactNode },
    { hasError: boolean }
> {
    state = { hasError: false };
    static getDerivedStateFromError() {
        return { hasError: true };
    }
    render() {
        if (this.state.hasError) {
            return React.createElement("div", { className: "p-4 text-red-400 text-sm" }, "Something went wrong rendering this component.");
        }
        return this.props.children;
    }
}

/**
 * Deep-merge two objects (shallow-ish — one level of nesting).
 */
export function mergeDeep<T extends Record<string, any>>(target: T, source: Partial<T>): T {
    const result = { ...target };
    for (const key of Object.keys(source) as (keyof T)[]) {
        const val = source[key];
        if (val && typeof val === "object" && !Array.isArray(val) && typeof result[key] === "object") {
            result[key] = { ...result[key], ...val } as any;
        } else if (val !== undefined) {
            result[key] = val as any;
        }
    }
    return result;
}

/**
 * Convert a string to a slug.
 */
export function slugify(str: string): string {
    return str
        .toLowerCase()
        .replace(/[^\w\s-]/g, "")
        .replace(/[\s_]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
