/**
 * @jest-environment jsdom
 */
import { en } from "../../app/src/locales/en";
import React from "react";
import { describe, expect, it, jest } from "@jest/globals";
import { render } from "@testing-library/react";

/**
 * The policy editor's help named `authenticated` and `anon` as the roles to
 * target for signed-in and anonymous users. Rebase creates neither: every API
 * request runs as `rebase_user`, signed in or not. On a database that has them
 * (a Supabase import), a policy `TO authenticated` is created and matches no
 * request — and a restrictive one restricts nobody.
 */

jest.mock("@rebasepro/app", () => ({
    useTranslation: () => ({
        t: (key: string) => en[key as keyof typeof en] ?? key,
        i18n: { language: "en" }
    }),
    useModeController: () => ({ mode: "light", setMode: jest.fn() })
}));

jest.mock("../src/components/SQLEditor/MonacoEditor", () => ({
    MonacoEditor: ({ value }: { value: string }) => <textarea readOnly value={value}/>
}));

import { PolicyEditor } from "../src/components/RLSEditor/PolicyEditor";

describe("the policy editor's help on target roles", () => {

    it("names only roles a request can run as", () => {
        const { container } = render(
            <PolicyEditor schema="public" table="authors" onSave={jest.fn()} onCancel={jest.fn()}/>
        );

        const roles = [...container.querySelectorAll("li > strong")].map(el => el.textContent);
        expect(roles).toEqual(["public", "rebase_user"]);
    });

    it("says that who the caller is goes in the condition", () => {
        const { container } = render(
            <PolicyEditor schema="public" table="authors" onSave={jest.fn()} onCancel={jest.fn()}/>
        );

        expect(container.textContent).toContain(en.studio_policy_help_roles_not_users);
    });
});
