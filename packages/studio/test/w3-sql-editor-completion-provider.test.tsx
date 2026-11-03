/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { render } from "@testing-library/react";

/**
 * The SQL console's completions, registered with Monaco's one page-wide
 * language registry.
 *
 * Monaco does not run in jsdom, so `@monaco-editor/react` is stood in for by
 * a component that mounts a fake editor and a fake `monaco` whose registry
 * records what is registered and what is disposed.
 */

type Provider = {
    provideCompletionItems: (model: unknown, position: unknown) => { suggestions: { label: string; detail: string }[] };
};

const registry: { provider: Provider; disposed: boolean }[] = [];

const fakeMonaco = {
    KeyMod: { CtrlCmd: 2048 },
    KeyCode: { Enter: 3 },
    languages: {
        CompletionItemKind: { Field: 3, Class: 5, Keyword: 17 },
        registerCompletionItemProvider: (_language: string, provider: Provider) => {
            const entry = { provider, disposed: false };
            registry.push(entry);
            return { dispose: () => { entry.disposed = true; } };
        }
    }
};

const fakeEditor = {
    addAction: () => ({ dispose: () => undefined }),
    focus: () => undefined,
    getSelection: () => null,
    getModel: () => null,
    getValue: () => ""
};

jest.mock("@monaco-editor/react", () => ({
    __esModule: true,
    default: function Editor({ onMount }: { onMount: (editor: unknown, monaco: unknown) => void }) {
        React.useEffect(() => { onMount(fakeEditor, fakeMonaco); }, [onMount]);
        return <div data-testid="editor"/>;
    }
}));

jest.mock("@rebasepro/app", () => ({
    useModeController: () => ({ mode: "light", setMode: () => undefined })
}));

import { MonacoEditor } from "../src/components/SQLEditor/MonacoEditor";

/** A model holding `text`, with the cursor at its end on one line. */
function modelOf(text: string) {
    return {
        getWordUntilPosition: () => ({ startColumn: text.length + 1, endColumn: text.length + 1 }),
        getValueInRange: () => text,
        getValue: () => text
    };
}

const position = { lineNumber: 1, column: 1 };

beforeEach(() => {
    registry.length = 0;
});

describe("the SQL console's completion provider", () => {
    it("is disposed when the editor unmounts, so a second visit offers each name once", () => {
        const schemas = { public: [{ schemaName: "public", tableName: "posts", columns: [{ name: "id", dataType: "integer" }] }] };

        const first = render(<MonacoEditor value="" onChange={() => undefined} schemas={schemas}/>);
        first.unmount();
        render(<MonacoEditor value="" onChange={() => undefined} schemas={schemas}/>);

        const live = registry.filter(entry => !entry.disposed);
        expect(registry).toHaveLength(2);
        expect(live).toHaveLength(1);

        const offered = live.flatMap(entry =>
            entry.provider.provideCompletionItems(modelOf("SELECT * FROM "), position).suggestions
        ).filter(suggestion => suggestion.label === "posts");
        expect(offered).toHaveLength(1);
    });

    it("offers suggestions when a table's name holds a regular-expression character", () => {
        const schemas = {
            public: [
                { schemaName: "public", tableName: "legacy(2019", columns: [{ name: "old_id", dataType: "integer" }] },
                { schemaName: "public", tableName: "posts", columns: [{ name: "title", dataType: "text" }] }
            ]
        };
        render(<MonacoEditor value="" onChange={() => undefined} schemas={schemas}/>);

        const [{ provider }] = registry;
        const labels = provider.provideCompletionItems(modelOf("SELECT  FROM posts"), position)
            .suggestions.map(suggestion => suggestion.label);
        expect(labels).toContain("posts");
        // A column of the table the text names, and none of the one it does not.
        expect(labels).toContain("title");
        expect(labels).not.toContain("old_id");
    });
});
