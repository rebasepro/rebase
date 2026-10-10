/**
 * @jest-environment jsdom
 */
/**
 * The SQL console's cell box answers once.
 *
 * Enter saved and closed, Escape closed, and a blur saved and closed — but a
 * box that was closing could still be blurred, and that blur saved again:
 * Enter sent the UPDATE twice, and Escape, meant to cancel, sent it once.
 */
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { act, fireEvent, render, screen } from "@testing-library/react";

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
    useRebaseContext: () => ({}),
    useStudioCollectionRegistry: () => ({ collections: [], getCollection: () => undefined }),
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    useSnackbarController: () => ({ open: jest.fn() }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useApiBase: () => "http://api.test/api",
    useApiConfig: () => ({ getAuthToken: async () => "token" }),
    IconForView: () => null,
    ErrorView: () => null,
    ConfirmationDialog: () => null
}));
jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({ MonacoEditor: () => null }));
// The kit's autosizing textarea, as a textarea.
jest.mock("@rebasepro/ui", () => {
    const stub = jest.requireActual<Record<string, unknown>>("@rebasepro/ui");
    const overrides: Record<string, unknown> = {
        TextareaAutosize: ({ defaultValue, onBlur, onKeyDown, onFocus }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
            <textarea defaultValue={defaultValue} onBlur={onBlur} onKeyDown={onKeyDown} onFocus={onFocus}/>
    };
    return new Proxy(overrides, {
        get: (target, key: string | symbol) => typeof key === "string" && key in target ? target[key] : stub[key as string],
        has: () => true
    });
});

import { FixedEditorOverlay } from "../src/components/SQLEditor/SQLEditor";

/** A box whose closing does not unmount it, so a late blur reaches it. */
async function openBox(value: string) {
    const onSave = jest.fn();
    const onCancel = jest.fn();
    await act(async () => {
        render(<div><FixedEditorOverlay displayValue={value} onSave={onSave} onCancel={onCancel}/></div>);
    });
    return { onSave, onCancel, box: screen.getByRole("textbox") };
}

describe("the cell box", () => {
    it("saves once on Enter, whatever blur follows", async () => {
        const { onSave, box } = await openBox("draft");
        fireEvent.change(box, { target: { value: "published" } });
        fireEvent.keyDown(box, { key: "Enter" });
        fireEvent.blur(box);
        expect(onSave).toHaveBeenCalledTimes(1);
        expect(onSave).toHaveBeenCalledWith("published");
    });

    it("saves nothing on Escape, whatever blur follows", async () => {
        const { onSave, onCancel, box } = await openBox("draft");
        fireEvent.change(box, { target: { value: "published" } });
        fireEvent.keyDown(box, { key: "Escape" });
        fireEvent.blur(box);
        expect(onSave).not.toHaveBeenCalled();
        expect(onCancel).toHaveBeenCalledTimes(1);
    });

    it("saves what was typed on a click away", async () => {
        const { onSave, box } = await openBox("draft");
        fireEvent.change(box, { target: { value: "published" } });
        fireEvent.blur(box);
        expect(onSave).toHaveBeenCalledWith("published");
    });
});
