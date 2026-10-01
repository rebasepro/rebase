import { useState, useEffect, useRef, useLayoutEffect } from "react";
import { EditorState, Transaction, Plugin } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "../schema";
import { getCorePlugins } from "../plugins";
import { parser } from "../markdown";
import { nodeViews } from "../nodeViews";
import { createDropImagePlugin, createImageSrcResolverPlugin, type ImageSrcResolver } from "../extensions/Image";
import { columnResizing, tableEditing } from "prosemirror-tables";
import { parseSanitizedHtml } from "../sanitize-html";

const trailingNodePlugin = new Plugin({
    appendTransaction: (_, oldState, newState) => {
        const doc = newState.doc;
        if (doc.lastChild && doc.lastChild.type.name !== "paragraph") {
            return newState.tr.insert(doc.content.size, newState.schema.nodes.paragraph.create());
        }
        return null;
    }
});

interface UseProseMirrorProps {
    initialContent?: string | any;
    editable?: boolean;
    handleImageUpload?: (file: File) => Promise<string>;
    /** See {@link RichTextEditorProps.resolveImageSrc}. */
    resolveImageSrc?: ImageSrcResolver;
}

export function useProseMirror({ initialContent, editable = true, handleImageUpload, resolveImageSrc }: UseProseMirrorProps) {
    // The view is built once, so the plugin holds a function that reads the
    // latest resolver rather than the first one — storage sources can arrive
    // after the editor mounts.
    const resolveImageSrcRef = useRef(resolveImageSrc);
    resolveImageSrcRef.current = resolveImageSrc;

    const plugins = [
        ...getCorePlugins(),
        columnResizing(),
        tableEditing(),
        trailingNodePlugin,
        createImageSrcResolverPlugin(async (src) => resolveImageSrcRef.current ? resolveImageSrcRef.current(src) : undefined)
    ];
    if (handleImageUpload) {
        plugins.push(createDropImagePlugin(handleImageUpload));
    }

    const defaultState = EditorState.create({
        doc: typeof initialContent === "string"
            ? parser.parse(initialContent)
            : initialContent
                ? schema.nodeFromJSON(initialContent)
                : schema.node("doc", null, [schema.node("paragraph")]),
        schema,
        plugins
    });

    const [state, setState] = useState<EditorState>(defaultState);
    const [view, setView] = useState<EditorView | null>(null);

    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);

    useLayoutEffect(() => {
        if (!editorRef.current) return;

        const editorView = new EditorView(editorRef.current, {
            state: defaultState,
            editable: () => editable,
            dispatchTransaction: (tr: Transaction) => {
                const newState = editorView.state.apply(tr);
                editorView.updateState(newState);
                setState(newState);
            },
            nodeViews: nodeViews,
            transformPastedHTML(html: string) {
                // Strip inline styles and classes from pasted HTML so we don't
                // get textStyle marks (color, font-size, etc.) that have no
                // markdown representation. This makes paste look consistent.
                //
                // Parsed inertly rather than through `document.createElement` +
                // `innerHTML`, which builds the content in the LIVE document —
                // so `<img src=x onerror=…>` in a clipboard fired here, before
                // this function had decided anything. A person pasting from a
                // page they were reading is the ordinary case, which is what
                // makes it worth closing.
                const div = parseSanitizedHtml(html);
                div.querySelectorAll("*").forEach((el) => {
                    el.removeAttribute("style");
                    el.removeAttribute("class");
                    el.removeAttribute("color");
                    el.removeAttribute("bgcolor");
                    el.removeAttribute("face");
                });
                return div.innerHTML;
            }
        });

        // Patch posAtCoords to allow dropping/interacting anywhere horizontally natively
        const originalPosAtCoords = editorView.posAtCoords.bind(editorView);
        editorView.posAtCoords = (coords: { left: number, top: number }) => {
            const res = originalPosAtCoords(coords);
            if (!res) {
                const editorRect = editorView.dom.getBoundingClientRect();
                // If it's literally anywhere to the left of the actual ProseMirror content block
                if (coords.left <= editorRect.left) {
                    const probeX = editorRect.left + Math.min(60, editorRect.width / 4);
                    return originalPosAtCoords({ left: probeX,
top: coords.top });
                }
                // Or if it's anywhere to the right
                if (coords.left >= editorRect.right) {
                    const probeX = editorRect.right - Math.min(60, editorRect.width / 4);
                    return originalPosAtCoords({ left: probeX,
top: coords.top });
                }
            }
            return res;
        };

        viewRef.current = editorView;
        setView(editorView);

        return () => {
            editorView.destroy();
            viewRef.current = null;
        };
    }, []);

    // Effect to update editable status without re-mounting
    useEffect(() => {
        if (viewRef.current) {
            viewRef.current.setProps({ editable: () => editable });
        }
    }, [editable]);

    return {
        state,
        view,
        editorRef
    };
}
