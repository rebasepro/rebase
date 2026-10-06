"use client";
import React, { useEffect, useMemo, useSyncExternalStore } from "react";
import { deepEqual as equal } from "fast-equals"

import type MarkdownIt from "markdown-it";
import { cls } from "../util";
import { loadChunk } from "../util/lazy_chunk";

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

/**
 * The parser, fetched the first time a `Markdown` mounts and shared after that.
 *
 * markdown-it and its dependencies are ~100 kB minified (44 kB gzipped), and
 * every admin evaluates this module on boot — the login screen included —
 * while only markdown cells and previews ever render one. A static import put
 * all of it in the chunk the login screen preloads. So it is imported on
 * demand; until it lands, `Markdown` shows its source as plain text in the
 * same container. Once loaded it is reused for the session, and every later
 * render is synchronous.
 *
 * Read through `useSyncExternalStore` with an empty server snapshot, so a
 * server render and the hydration that follows it both show the plain text,
 * whatever the server process had loaded before.
 */
let md: MarkdownIt | undefined;
let loading: Promise<MarkdownIt> | undefined;
const parserListeners = new Set<() => void>();

function loadParser(): Promise<MarkdownIt> {
    loading ??= loadChunk(() => import("markdown-it")).then(({ default: MarkdownItParser }) => {
        md = new MarkdownItParser({ html: false });
        parserListeners.forEach(listener => listener());
        return md;
    }, (error: unknown) => {
        // The next `Markdown` to mount tries again; this one stays plain text.
        loading = undefined;
        throw error;
    });
    return loading;
}

function subscribeToParser(listener: () => void): () => void {
    parserListeners.add(listener);
    return () => parserListeners.delete(listener);
}

const loadedParser = () => md;
const noParserOnTheServer = () => undefined;

/**
 * @group Preview components
 */
export const Markdown = React.memo<MarkdownProps>(function Markdown({
                                                                        source,
                                                                        className,
                                                                        size = "medium"
                                                                    }: MarkdownProps) {
        const parser = useSyncExternalStore(subscribeToParser, loadedParser, noParserOnTheServer);
        const text = typeof source === "string" ? source : "";

        useEffect(() => {
            if (parser) return;
            loadParser().catch(error => console.error("[rebase] could not load the markdown renderer", error));
        }, [parser]);

        const html = useMemo(() => parser?.render(text), [parser, text]);
        const classes = cls(proseClasses[size], "dark:prose-invert prose-headings:font-title", proseWeightOverrides, className);

        if (html === undefined) {
            // Until the parser arrives: the source as text, line breaks kept,
            // in the same box, so the space the rendered markdown takes is
            // roughly held and nothing is hidden.
            return <div className={cls(classes, "whitespace-pre-line")}>{text}</div>;
        }

        return <div
            className={classes}
            dangerouslySetInnerHTML={{ __html: html }}
        />;
    }
    , equal) as React.FunctionComponent<MarkdownProps>;
