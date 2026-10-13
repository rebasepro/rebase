/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, waitFor } from "@testing-library/react";
import type { EditorAIController } from "../../src";

/**
 * The markdown field's AI continuation is the editor's `aiController`, and no
 * CMS component handed it one: plugin-ai built a controller for every form and
 * passed it to nothing, so the slash command never appeared unless a host
 * wired `useEditorAIController()` into each field by hand. A plugin now gives
 * it to every markdown field of a form through `EditorAIControllerProvider`;
 * the field's own `editorProps.aiController` still wins.
 */

type EditorProps = { aiController?: EditorAIController };
let editorProps: EditorProps | undefined;

jest.mock("../../src/editor", () => ({
    RichTextEditor: (props: EditorProps) => {
        editorProps = props;
        return null;
    }
}));

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useAuthController: () => ({ user: { uid: "u1" } }),
        useStorageSource: () => ({}),
        useStorageSources: () => ({ registry: {}, sources: {} })
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { MarkdownEditorFieldBinding } from "../../src/form/field_bindings/MarkdownEditorFieldBinding";
import { EditorAIControllerProvider } from "../../src";

const fromPlugin: EditorAIController = { autocomplete: async () => "plugin" };
const fromField: EditorAIController = { autocomplete: async () => "field" };

async function mount(wrap: (node: React.ReactElement) => React.ReactElement, customProps?: object) {
    editorProps = undefined;
    render(wrap(<MarkdownEditorFieldBinding
        property={{ type: "string", admin: { markdown: true } } as never}
        propertyKey="body"
        value={""}
        setValue={() => undefined}
        setFieldValue={() => undefined}
        context={{ values: {}, entityId: "1", path: "posts", formex: { version: 0 } } as never}
        customProps={customProps as never}
        includeDescription={false}
        showError={false}
        isSubmitting={false}
        disabled={false}
        minimalistView={true}
        hideLabel={true}
        partOfArray={false}
        autoFocus={false}
        underlyingValueHasChanged={false}/>));
    await waitFor(() => expect(editorProps).toBeDefined());
}

describe("the markdown field's AI controller", () => {
    it("is the one a plugin provides for the form", async () => {
        await mount((node) => <EditorAIControllerProvider controller={fromPlugin}>{node}</EditorAIControllerProvider>);
        expect(editorProps!.aiController).toBe(fromPlugin);
    });

    it("is none when nothing provides one, as before", async () => {
        await mount((node) => node);
        expect(editorProps!.aiController).toBeUndefined();
    });

    it("is none when the provider turns it off", async () => {
        await mount((node) => <EditorAIControllerProvider controller={undefined}>{node}</EditorAIControllerProvider>);
        expect(editorProps!.aiController).toBeUndefined();
    });

    it("is the field's own when its editorProps name one", async () => {
        await mount((node) => <EditorAIControllerProvider controller={fromPlugin}>{node}</EditorAIControllerProvider>,
            { editorProps: { aiController: fromField } });
        expect(editorProps!.aiController).toBe(fromField);
    });
});
