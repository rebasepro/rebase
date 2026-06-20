/**
 * Ambient module declarations for markdown-it plugins that do not ship
 * their own type declarations and have no DefinitelyTyped packages.
 *
 * Each plugin exports a default function that is a standard markdown-it
 * plugin: it receives a MarkdownIt instance and optional options.
 */
declare module "markdown-it-task-lists" {
    import type MarkdownIt from "markdown-it";
    const markdownItTaskLists: MarkdownIt.PluginSimple;
    export default markdownItTaskLists;
}

declare module "markdown-it-mark" {
    import type MarkdownIt from "markdown-it";
    const markdownItMark: MarkdownIt.PluginSimple;
    export default markdownItMark;
}

declare module "markdown-it-ins" {
    import type MarkdownIt from "markdown-it";
    const markdownItIns: MarkdownIt.PluginSimple;
    export default markdownItIns;
}
