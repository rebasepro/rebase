/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";
import type { PostgresPolicy } from "@rebasepro/types";

/**
 * The policy editor's expression boxes are painted with a surface token.
 *
 * They were `bg-white dark:bg-[#1b1e22]`: a light/dark pair with a raw hex in
 * it, which the design tokens forbid because it ignores the theme. Under the
 * Graphite dark theme it was a fourth near-black beside the dialog's well and
 * the card above it. The box holds an editor that paints its own white or
 * near-black, so it takes the card surface, the step that matches it.
 */

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => en[key as keyof typeof en] ?? key,
        i18n: { language: "en" }
    }),
    useModeController: () => ({ mode: "dark", setMode: jest.fn() })
}));

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ value }: { value: string }) => <textarea data-testid="expression-editor" readOnly value={value}/>
}));

import { PolicyEditor } from "../src/components/RLSEditor/PolicyEditor";

const policy: PostgresPolicy = {
    policyname: "owner_only",
    tablename: "posts",
    permissive: "PERMISSIVE",
    roles: ["public"],
    cmd: "UPDATE",
    qual: "true",
    with_check: "true"
};

describe("the policy editor's expression boxes", () => {
    it("are painted with the card surface, not a raw colour pair", () => {
        render(<PolicyEditor policy={policy} schema="public" table="posts" onSave={jest.fn()} onCancel={jest.fn()}/>);

        const boxes = screen.getAllByTestId("expression-editor").map(editor => editor.parentElement!);
        // USING and WITH CHECK, both shown for an UPDATE policy.
        expect(boxes).toHaveLength(2);
        for (const box of boxes) {
            const classes = box.className.split(/\s+/);
            expect(classes).toContain("bg-surface-card");
            expect(classes.filter(c => c === "bg-white" || /^dark:bg-\[/.test(c) || /^bg-\[#/.test(c))).toEqual([]);
        }
    });
});
