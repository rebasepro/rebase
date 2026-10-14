/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { act, render, screen } from "@testing-library/react";
import type { PostgresPolicy } from "@rebasepro/types";

/**
 * The policy editor saved the USING and WITH CHECK expressions from its own
 * state, which learns of an edit only when it re-renders. Save right after a
 * paste wrote the expression from before it: the policy created was not the
 * one on screen.
 */

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => en[key as keyof typeof en] ?? key,
        i18n: { language: "en" }
    }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() })
}));

/** The one expression editor on screen: its own text, and its last `onChange`. */
const editorModel: { text: string; onChange?: (value: string) => void } = { text: "" };

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ ref, value, onChange }: {
        ref?: React.Ref<{ getSelectedText: () => string | undefined; getValue: () => string }>;
        value: string;
        onChange: (value: string) => void;
    }) => {
        editorModel.onChange = onChange;
        React.useLayoutEffect(() => { editorModel.text = value; }, [value]);
        React.useImperativeHandle(ref, () => ({
            getSelectedText: () => undefined,
            getValue: () => editorModel.text
        }));
        return <textarea readOnly value={value}/>;
    }
}));

import { PolicyEditor } from "../src/components/RLSEditor/PolicyEditor";

function policy(cmd: PostgresPolicy["cmd"]): PostgresPolicy {
    return {
        policyname: "owner_only",
        tablename: "posts",
        permissive: "PERMISSIVE",
        roles: ["public"],
        cmd,
        qual: cmd === "INSERT" ? null : "true",
        with_check: cmd === "INSERT" ? "true" : null
    };
}

/** The expression changes, and Save is pressed before the editor re-renders. */
function editThenSave(text: string): void {
    const save = screen.getByRole("button", { name: en.studio_policy_save });
    act(() => {
        editorModel.text = text;
        editorModel.onChange?.(text);
        save.click();
    });
}

beforeEach(() => {
    editorModel.text = "";
});

describe("saving a policy right after an edit", () => {
    it("saves the USING expression the editor holds", () => {
        const onSave = jest.fn();
        render(<PolicyEditor policy={policy("SELECT")} schema="public" table="posts" onSave={onSave} onCancel={jest.fn()}/>);

        editThenSave("author_id = auth.uid()");

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ qual: "author_id = auth.uid()" }));
    });

    it("saves the WITH CHECK expression the editor holds", () => {
        const onSave = jest.fn();
        render(<PolicyEditor policy={policy("INSERT")} schema="public" table="posts" onSave={onSave} onCancel={jest.fn()}/>);

        editThenSave("author_id = auth.uid()");

        expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ with_check: "author_id = auth.uid()" }));
    });
});
