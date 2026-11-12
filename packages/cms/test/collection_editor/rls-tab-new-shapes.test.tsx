import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { SecurityRule } from "@rebasepro/types";

/**
 * The collection editor's RLS tab over the rule forms added with the
 * Postgres-first `rls` — a `PolicyShorthand` condition / check, `access` with a
 * condition / check, bare `access: "authenticated"` — and the `redacted`
 * marker the server sends in place of a rule whose SQL it withheld.
 *
 * The tab's form has no field for any of them, so they are listed with what
 * they mean and shown read-only (edit in code / defined on the server), and
 * they are saved exactly as written when another rule is edited: rewritten
 * into another shape, a rule's policy would be renamed.
 */

const setFieldValue = jest.fn();
let values: Record<string, unknown> = {};

jest.mock("@rebasepro/forms", () => ({
    useFormex: () => ({ values, setFieldValue })
}));

jest.mock("../../src/collection_editor/useCollectionsConfigController", () => ({
    useCollectionsConfigController: () => ({ readOnly: false })
}));

jest.mock("@rebasepro/app", () => ({
    useRebaseContext: () => ({ databaseAdmin: { executeSql: async () => ({ rows: [] }), fetchApplicationRoles: async () => [] } }),
    useTranslation: () => ({
        t: (key: string, options?: Record<string, unknown>) =>
            options && typeof options.condition === "string" ? `${key}(${options.condition})` : key
    })
}));

import { CollectionRLSTab } from "../../src/collection_editor/ui/collection_editor/CollectionRLSTab";
import { describeCondition, isEditableInForm, rlsRuleForm } from "../../src/collection_editor/ui/collection_editor/rlsRuleForm";

const properties = {
    id: { name: "ID", type: "string", isId: "uuid" },
    status: { name: "Status", type: "string" },
    orgId: { name: "Org", type: "string", columnName: "org_id" }
};

const editButtons = () => screen.getAllByRole("button", { name: "EDIT" });

beforeEach(() => {
    setFieldValue.mockReset();
    values = { slug: "posts", name: "Posts", table: "posts", properties, securityRules: [] };
});

describe("rlsRuleForm", () => {
    it("classifies every form, and leaves the new ones out of the form", () => {
        const cases: [SecurityRule, string, boolean][] = [
            [{ operation: "select", using: "true" }, "raw", true],
            [{ operation: "insert", withCheck: "true" }, "raw", true],
            [{ operation: "select", ownerField: "orgId" }, "owner", true],
            [{ operation: "select", access: "public" }, "public", true],
            [{ operation: "select", condition: { kind: "authenticated" } }, "structured", true],
            [{ operation: "delete", roles: ["admin"] }, "roles_only", true],
            [{ operation: "select", condition: { status: "published" } }, "shorthand", false],
            [{ operation: "select", access: "public", condition: { status: "published" } }, "conditional_access", false],
            [{ operation: "insert", access: "authenticated", check: { status: "draft" } }, "conditional_access", false],
            [{ operation: "select", access: "authenticated" }, "authenticated", false],
            [{ operation: "update", roles: ["editor"], redacted: true }, "redacted", false]
        ];
        for (const [rule, form, editable] of cases) {
            expect({ rule, form: rlsRuleForm(rule), editable: isEditableInForm(rlsRuleForm(rule)) }).toEqual({ rule, form, editable });
        }
    });

    it("describes a shorthand as the SQL it compiles to, columns resolved", () => {
        expect(describeCondition({ status: "published", orgId: "acme" }, { name: "Posts", slug: "posts", table: "posts", properties: {
            status: { name: "Status", type: "string" }, orgId: { name: "Org", type: "string", columnName: "org_id" }
        } })).toBe("(org_id = 'acme') AND (status = 'published')");
        expect(describeCondition({ kind: "authenticated" })).toContain("rebase.uid()");
    });
});

describe("the RLS tab on the new rule forms", () => {
    it("lists a shorthand as the equality it means, read-only", () => {
        values.securityRules = [{ operation: "select", access: "public", condition: { status: "published" } }];
        render(<CollectionRLSTab/>);
        expect(screen.getByText("studio_rls_rule_who_public")).toBeTruthy();
        expect(screen.getByText("studio_rls_rule_rows(status = 'published')")).toBeTruthy();
        expect(editButtons()[0].hasAttribute("disabled")).toBe(true);
    });

    it("lists bare `access: \"authenticated\"` and a check, read-only", () => {
        values.securityRules = [
            { operation: "select", access: "authenticated" },
            { operation: "insert", access: "authenticated", check: { orgId: "acme" } }
        ];
        render(<CollectionRLSTab/>);
        expect(screen.getAllByText("studio_rls_rule_who_authenticated")).toHaveLength(2);
        expect(screen.getByText("studio_rls_rule_writes(org_id = 'acme')")).toBeTruthy();
        expect(editButtons().every(b => b.hasAttribute("disabled"))).toBe(true);
    });

    it("lists a redacted rule as defined on the server, read-only, with no clauses", () => {
        values.securityRules = [{ operation: "update", roles: ["editor"], redacted: true }];
        render(<CollectionRLSTab/>);
        expect(screen.getByText("studio_rls_rule_redacted")).toBeTruthy();
        expect(screen.queryByText(/studio_rls_rule_rows/)).toBeNull();
        expect(editButtons()[0].hasAttribute("disabled")).toBe(true);
    });

    it("keeps the forms it already edited editable", () => {
        values.securityRules = [{ operation: "select", ownerField: "orgId" }, { operation: "select", access: "public" }];
        render(<CollectionRLSTab/>);
        expect(editButtons().map(b => b.hasAttribute("disabled"))).toEqual([false, false]);
    });

    it("saves the new forms untouched when another rule is edited", async () => {
        const untouched: SecurityRule[] = [
            { operation: "select", access: "public", condition: { status: "published" } },
            { operation: "select", access: "authenticated" },
            { operation: "update", roles: ["editor"], redacted: true }
        ];
        values.securityRules = [...untouched, { name: "own", operation: "select", ownerField: "orgId" }];
        render(<CollectionRLSTab/>);
        fireEvent.click(editButtons()[3]);
        fireEvent.change(await screen.findByLabelText("studio_policy_name"), { target: { value: "own_v2" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));

        await waitFor(() => expect(setFieldValue).toHaveBeenCalledTimes(1));
        expect(setFieldValue.mock.calls[0]).toEqual([
            "securityRules",
            [...untouched, { name: "own_v2", operation: "select", ownerField: "orgId" }]
        ]);
    });
});
