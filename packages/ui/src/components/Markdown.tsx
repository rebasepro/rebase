"use client";
import React, { useMemo } from "react";
import { deepEqual as equal } from "fast-equals"

// @ts-ignore
import MarkdownIt from "markdown-it";
import { cls } from "../util";

export interface MarkdownProps {
    source: string,
    size?: "small" | "medium" | "large" | "xl" | "2xl";
    className?: string
}

const proseClasses = {
    small: "prose prose-sm typography-body2",
    medium: "prose typography-body1",
    large: "prose prose-lg",
    xl: "prose prose-xl",
    "2xl": "prose prose-2xl"
};

/**
 * Tailwind typography-plugin weight overrides.
 * The plugin defaults to very heavy weights (h1: 800, h2: 700, h3/h4: 600,
 * strong: 600, code: 600) which clash with the Rebase design-system that uses
 * font-light (300) / font-normal (400) for headings.
 * We reset them here so rendered markdown matches the rest of the UI.
 */
const proseWeightOverrides = [
    "prose-headings:font-normal",
    "prose-strong:font-semibold",
    "prose-code:font-normal",
    "prose-blockquote:font-normal",
    "prose-a:font-normal"
].join(" ");

const md = new MarkdownIt({ html: false });
/**
 * @group Preview components
 */
export const Markdown = React.memo<MarkdownProps>(function Markdown({
                                                                        source,
                                                                        className,
                                                                        size = "medium"
                                                                    }: MarkdownProps) {
        const html = useMemo(() => {
            return md.render(typeof source === "string" ? source : "");
        }, [source]);

        return <div
            className={cls(proseClasses[size], "dark:prose-invert prose-headings:font-title", proseWeightOverrides, className)}
            dangerouslySetInnerHTML={{ __html: html }}
        />;
    }
    , equal) as React.FunctionComponent<MarkdownProps>;
