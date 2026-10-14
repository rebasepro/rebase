/**
 * @jest-environment jsdom
 */
import { es } from "../../app/src/locales/es";
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render, screen } from "@testing-library/react";

/**
 * The policy editor's help speaks the admin's language, all of it.
 *
 * Its auth helper bullets ("Returns the current user's ID as text. Example:")
 * were English literals although their keys existed in every locale, the
 * example wells said "Example:", and the dialog was named "Row-Level Security
 * Help" for a screen reader while its visible heading was translated.
 */

jest.mock("@rebasepro/app", () => {
    const { es: table } = jest.requireActual<{ es: Record<string, string> }>("../../app/src/locales/es");
    const translation = {
        t: (key: string) => table[key] ?? key,
        i18n: { language: "es" }
    };
    return {
        useTranslation: () => translation,
        useModeController: () => ({ mode: "light", setMode: () => undefined })
    };
});

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ value }: { value: string }) => <textarea readOnly value={value}/>
}));

import { PolicyEditor } from "../src/components/RLSEditor/PolicyEditor";

/** The Spanish text of a key, which must exist. */
function spanish(key: keyof typeof es): string {
    const value = es[key];
    if (typeof value !== "string") throw new Error(`es.ts has no ${String(key)}`);
    return value;
}

describe("the policy editor's help, in Spanish", () => {
    it("names the dialog and explains the auth helpers in Spanish", () => {
        // The kit is stubbed in this package's tests: a dialog renders its
        // content inline, open or not, so the help is on the page as text.
        const { container } = render(<PolicyEditor schema="public" table="authors" onSave={jest.fn()} onCancel={jest.fn()}/>);
        const text = container.textContent ?? "";

        // The visible heading and the dialog's hidden title, which names it.
        expect(screen.getAllByText(spanish("studio_policy_help_title"))).toHaveLength(2);
        expect(text).toContain(spanish("studio_policy_help_auth_uid"));
        expect(text).toContain(spanish("studio_policy_help_auth_jwt"));
        expect(text).toContain(spanish("studio_policy_help_auth_roles"));
        expect(text).toContain(`${spanish("studio_policy_help_example")} rebase.uid() = uid`);

        expect(text).not.toContain("Row-Level Security Help");
        expect(text).not.toContain("Returns the current user's ID as text");
        expect(text).not.toContain("Returns the full JWT payload");
        expect(text).not.toContain("Returns the user's role IDs");
        expect(text).not.toContain("Example:");
    });
});
