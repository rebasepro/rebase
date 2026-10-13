/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorState, TextSelection } from "prosemirror-state";
import { EditorView } from "prosemirror-view";
import { schema } from "../../src/editor/schema";
import { ProseMirrorContext } from "../../src/editor/hooks/useProseMirrorContext";
import { LinkSelector } from "../../src/editor/selectors/link-selector";

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: (key: string) => key })
}));

// The popover measures itself; jsdom has no ResizeObserver.
class ResizeObserverStub {
    observe() { /* nothing to measure */ }
    unobserve() { /* nothing to measure */ }
    disconnect() { /* nothing to measure */ }
}
Object.assign(global, { ResizeObserver: ResizeObserverStub });

/**
 * The markdown editor's link box is a form inside a popover. React sends a
 * portal's events up the component tree, so its submit reached the record form
 * around the editor and saved the record while someone was typing a link.
 */
describe("the editor's link box", () => {
    const setup = () => {
        const doc = schema.node("doc", null, [schema.node("paragraph", null, [schema.text("hello")])]);
        const mount = document.createElement("div");
        const view = new EditorView(mount, { state: EditorState.create({ schema, doc }) });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
        const outerSubmit = jest.fn((e: React.FormEvent) => e.preventDefault());
        render(
            <form onSubmit={outerSubmit}>
                <ProseMirrorContext.Provider value={{ state: view.state, view }}>
                    <LinkSelector open={true} onOpenChange={() => undefined}/>
                </ProseMirrorContext.Provider>
            </form>
        );
        const input = screen.getByPlaceholderText("editor_paste_or_type_link") as HTMLInputElement;
        return { view, outerSubmit, input };
    };

    it("does not submit the form around the editor", () => {
        const { view, outerSubmit, input } = setup();
        fireEvent.change(input, { target: { value: "rebase.pro" } });
        fireEvent.submit(input.closest("form")!);

        expect(outerSubmit).not.toHaveBeenCalled();
        const marks = view.state.doc.nodeAt(1)?.marks ?? [];
        expect(marks.find(m => m.type === schema.marks.link)?.attrs.href).toBe("https://rebase.pro/");
    });

    it("shows the selection's link, and takes what is typed", () => {
        const linked = schema.text("hello", [schema.marks.link.create({ href: "https://old.example/" })]);
        const doc = schema.node("doc", null, [schema.node("paragraph", null, [linked])]);
        const view = new EditorView(document.createElement("div"), { state: EditorState.create({ schema, doc }) });
        view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2, 4)));
        render(
            <ProseMirrorContext.Provider value={{ state: view.state, view }}>
                <LinkSelector open={true} onOpenChange={() => undefined}/>
            </ProseMirrorContext.Provider>
        );
        const input = screen.getByPlaceholderText("editor_paste_or_type_link") as HTMLInputElement;
        expect(input.value).toBe("https://old.example/");

        fireEvent.change(input, { target: { value: "https://new.example/" } });
        expect(input.value).toBe("https://new.example/");
    });

    it("says so when the text is not a link, instead of doing nothing", () => {
        const { view, outerSubmit, input } = setup();
        fireEvent.change(input, { target: { value: "not a link" } });
        fireEvent.submit(input.closest("form")!);

        expect(outerSubmit).not.toHaveBeenCalled();
        expect(screen.getByText("editor_invalid_url")).toBeTruthy();
        expect(input.getAttribute("aria-invalid")).toBe("true");
        expect(view.state.doc.nodeAt(1)?.marks.some(m => m.type === schema.marks.link)).toBe(false);

        fireEvent.change(input, { target: { value: "not a link either" } });
        expect(screen.queryByText("editor_invalid_url")).toBeNull();
    });
});
