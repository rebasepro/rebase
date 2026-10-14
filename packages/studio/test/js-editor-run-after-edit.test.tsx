/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

/**
 * The JS console ran the script from its own state, which learns of an edit
 * only when it re-renders. Run or Cmd+Enter right after a paste ran the script
 * the editor held before it — with the administrator's client, so a delete run
 * a moment earlier ran again.
 */

/** What each script that ran passed to `client.data.record`. */
const recorded: string[] = [];

const appContext = {
    authController: { user: { uid: "admin-1", email: "admin@example.test", displayName: null, roles: ["admin"] } }
};
const appClient = {
    admin: { listUsersPaginated: async () => ({ users: [], total: 0, limit: 50, offset: 0 }) },
    data: { record: (value: string) => { recorded.push(value); } }
};
const apiConfig = { apiUrl: "http://api.test", getAuthToken: async () => "admin-token" };
const registry = { collections: [] };

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => appContext,
    useRebaseClient: () => appClient,
    useApiConfig: () => apiConfig,
    useSnackbarController: () => ({ open: jest.fn() }),
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() }),
    useStudioUrlController: () => ({}),
    useStudioCollectionRegistry: () => registry,
    useStudioSidePanelController: () => ({ open: jest.fn(), close: jest.fn() }),
    IconForView: () => null,
    ErrorView: ({ error }: { error: unknown }) => <div role="alert">{String(error)}</div>,
    UserSelectPopover: () => null
}));

jest.mock("@rebasepro/client", () => ({
    createRebaseClient: () => ({ data: appClient.data, setAuthTokenGetter: () => undefined, close: () => undefined }),
    createMemoryStorage: () => ({ getItem: () => null, setItem: () => undefined, removeItem: () => undefined })
}));

/**
 * The stand-in editor's own text — Monaco's model, which changes the moment
 * the person types or pastes — and the `onChange` and `onRun` it was last
 * rendered with, as Monaco's Cmd+Enter action reads `onRun` from a ref.
 */
const editorModel: {
    text: string;
    onChange?: (value: string) => void;
    onRun?: (selectedText?: string) => void;
} = { text: "" };

jest.mock("../src/components/JSEditor/JSMonacoEditor", () => ({
    JSMonacoEditor: ({ ref, value, onChange, onRun }: {
        ref?: React.Ref<{ getSelectedText: () => string | undefined; getValue: () => string }>;
        value: string;
        onChange: (value: string) => void;
        onRun?: (selectedText?: string) => void;
    }) => {
        editorModel.onChange = onChange;
        editorModel.onRun = onRun;
        React.useLayoutEffect(() => { editorModel.text = value; }, [value]);
        React.useImperativeHandle(ref, () => ({
            getSelectedText: () => undefined,
            getValue: () => editorModel.text
        }));
        return <textarea aria-label="Script" value={value} onChange={(e) => {
            editorModel.text = e.target.value;
            onChange(e.target.value);
        }}/>;
    }
}));

import { JSEditor } from "../src/components/JSEditor/JSEditor";

beforeEach(() => {
    localStorage.clear();
    recorded.length = 0;
    editorModel.text = "";
});

/** The editor's text changes, and `then` runs before the console re-renders. */
function editThen(text: string, then: () => void): void {
    act(() => {
        editorModel.text = text;
        editorModel.onChange?.(text);
        then();
    });
}

async function idleRunButton(): Promise<HTMLButtonElement> {
    const button = screen.getByRole("button", { name: /Run$/ }) as HTMLButtonElement;
    await waitFor(() => expect(button.disabled).toBe(false));
    return button;
}

async function runFirst(code: string): Promise<void> {
    fireEvent.change(screen.getByLabelText("Script"), { target: { value: code } });
    fireEvent.click(await idleRunButton());
    await waitFor(() => expect(recorded).toHaveLength(1));
}

describe("running a script right after an edit", () => {
    it("runs the script the editor holds from the Run button", async () => {
        render(<JSEditor/>);
        await runFirst("client.data.record('stale')");

        const run = await idleRunButton();
        editThen("client.data.record('fresh')", () => run.click());

        await waitFor(() => expect(recorded).toHaveLength(2));
        expect(recorded).toEqual(["stale", "fresh"]);
    });

    it("runs the script the editor holds from Cmd+Enter in the editor", async () => {
        render(<JSEditor/>);
        await runFirst("client.data.record('stale')");
        await idleRunButton();

        editThen("client.data.record('fresh')", () => editorModel.onRun?.(undefined));

        await waitFor(() => expect(recorded).toHaveLength(2));
        expect(recorded).toEqual(["stale", "fresh"]);
    });
});

describe("a stored active tab that names no tab", () => {
    it("opens the first tab and keeps what is typed in it", async () => {
        localStorage.setItem("rebase_js_tabs", JSON.stringify([{ id: "1", name: "Script 1", code: "// stored" }]));
        localStorage.setItem("rebase_js_activeTab", JSON.stringify("gone"));
        render(<JSEditor/>);

        fireEvent.change(screen.getByLabelText("Script"), { target: { value: "// typed" } });

        expect((screen.getByLabelText("Script") as HTMLTextAreaElement).value).toBe("// typed");
    });
});
