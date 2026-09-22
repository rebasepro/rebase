/**
 * @jest-environment jsdom
 */
import React, { useState } from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, render, waitFor } from "@testing-library/react";

/**
 * Typing in a markdown field and then typing back to what was stored.
 *
 * The binding ignores editor output that matches the stored text's canonical
 * form — ProseMirror re-serialises markdown on load, and that is not an edit.
 * But it compared against the stored text and then simply returned, so once
 * the form held an edit, typing back to the stored text left the edit in the
 * form: the editor showed "Hello", the form still held "Hello!", and Save
 * wrote "Hello!".
 */

let emitMarkdown: ((markdown: string) => void) | undefined;

jest.mock("../../src/editor", () => ({
    RichTextEditor: (props: { onMarkdownContentChange: (markdown: string) => void }) => {
        emitMarkdown = props.onMarkdownContentChange;
        return null;
    }
}));

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useAuthController: () => ({ user: { uid: "u1" } }),
        useStorageSource: () => ({}),
        useStorageSources: () => ({ sources: {} })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { MarkdownEditorFieldBinding } from "../../src/form/field_bindings/MarkdownEditorFieldBinding";

let formValue: string | null;

function Host({ stored }: { stored: string | null }) {
    const [value, setValue] = useState<string | null>(stored);
    formValue = value;
    return <MarkdownEditorFieldBinding
        property={{ type: "string", admin: { markdown: true } } as never}
        propertyKey="body"
        value={value}
        setValue={(next: string | null) => setValue(next)}
        setFieldValue={() => undefined}
        context={{ values: {}, entityId: "1", path: "posts", formex: { version: 0 } } as never}
        includeDescription={false}
        showError={false}
        isSubmitting={false}
        disabled={false}
        minimalistView={true}
        hideLabel={true}
        partOfArray={false}
        autoFocus={false}
        underlyingValueHasChanged={false}/>;
}

async function mount(stored: string | null) {
    emitMarkdown = undefined;
    render(<Host stored={stored}/>);
    await waitFor(() => expect(emitMarkdown).toBeDefined());
    // The markdown utilities load lazily; let the canonical form settle.
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
    });
}

describe("MarkdownEditorFieldBinding", () => {

    it("typing back to the stored text puts the stored text back", async () => {
        await mount("Hello");

        await act(async () => emitMarkdown!("Hello!"));
        expect(formValue).toEqual("Hello!");

        await act(async () => emitMarkdown!("Hello"));
        expect(formValue).toEqual("Hello");
    });

    it("emptying a field that was empty puts the empty value back", async () => {
        await mount(null);

        await act(async () => emitMarkdown!("a"));
        expect(formValue).toEqual("a");

        await act(async () => emitMarkdown!(""));
        expect(formValue).toBeNull();
    });

    it("keeps the stored text verbatim when the editor only re-serialises it", async () => {
        // "* a" re-serialises as "- a": a canonical match, not an edit.
        await mount("* a");

        await act(async () => emitMarkdown!("- a"));
        expect(formValue).toEqual("* a");
    });

});
