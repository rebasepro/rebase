import { describe, expect, it, jest } from "@jest/globals";
import type { EntityActionClickProps } from "@rebasepro/cms-types";
import { placeEntityActions, resolveEntityActionState } from "../../src/util/entity_actions";
import { fitInlineActions } from "../../src/util/fit_inline_actions";

/**
 * Where a record's actions go.
 *
 * Every action used to sit behind the record's ⋮, whatever the developer
 * declared: `collapsed: false` promoted an action on a table row and nowhere
 * else. And because the built-ins were listed first, Delete was the second
 * item of that menu, wedged between Copy and the collection's own operations.
 */
describe("placeEntityActions", () => {

    const copy = { key: "copy" };
    const del = { key: "delete" };
    const unlink = { key: "unlink" };
    const edit = { key: "edit", collapsed: false };
    const recalculate = { key: "recalculate", collapsed: false };
    const resend = { key: "resend" };
    const wallet = { key: "wallet", collapsed: true };
    const unkeyed = {};

    it("makes the actions declared collapsed: false buttons, in declaration order", () => {
        const placed = placeEntityActions([copy, recalculate, del, edit, resend]);
        expect(placed.inline).toEqual([recalculate, edit]);
    });

    it("leads the menu with the collection's own actions and keeps Delete apart", () => {
        const placed = placeEntityActions([copy, del, resend, wallet, unkeyed]);
        expect(placed.own).toEqual([resend, wallet, unkeyed]);
        expect(placed.generic).toEqual([copy]);
        expect(placed.destructive).toEqual([del]);
    });

    it("treats a linked tab's Remove as destructive", () => {
        expect(placeEntityActions([unlink]).destructive).toEqual([unlink]);
    });

    it("lets a developer promote a built-in", () => {
        const promotedDelete = { key: "delete", collapsed: false };
        const placed = placeEntityActions([copy, promotedDelete]);
        expect(placed.inline).toEqual([promotedDelete]);
        expect(placed.destructive).toEqual([]);
    });
});

describe("fitInlineActions", () => {

    const labelled = [120, 100, 90];
    const compact = [32, 32, 32];
    const gap = 4;

    it("keeps every label while they all fit", () => {
        expect(fitInlineActions(318, labelled, compact, gap)).toEqual({ count: 3, compact: false });
    });

    it("drops every label before folding any action away", () => {
        expect(fitInlineActions(317, labelled, compact, gap)).toEqual({ count: 3, compact: true });
        expect(fitInlineActions(104, labelled, compact, gap)).toEqual({ count: 3, compact: true });
    });

    it("folds the last-declared actions into the menu first", () => {
        expect(fitInlineActions(103, labelled, compact, gap)).toEqual({ count: 2, compact: true });
        expect(fitInlineActions(32, labelled, compact, gap)).toEqual({ count: 1, compact: true });
        expect(fitInlineActions(31, labelled, compact, gap)).toEqual({ count: 0, compact: true });
    });

    it("counts an action without an icon at its labelled width when compact", () => {
        expect(fitInlineActions(160, [120, 100], [32, 120], gap)).toEqual({ count: 2, compact: true });
        expect(fitInlineActions(155, [120, 100], [32, 120], gap)).toEqual({ count: 1, compact: true });
    });

    it("shows everything when nothing has been laid out yet", () => {
        expect(fitInlineActions(0, [0, 0], [0, 0], gap)).toEqual({ count: 2, compact: false });
    });

    it("has nothing to fit without actions", () => {
        expect(fitInlineActions(500, [], [], gap)).toEqual({ count: 0, compact: false });
    });
});

describe("resolveEntityActionState", () => {

    const props: EntityActionClickProps<Record<string, unknown>> = {
        view: "form",
        entity: { id: "7", path: "customers", values: { shopify_id: null } }
    };

    it("is enabled without isEnabled, and never asks for a reason then", () => {
        const disabledReason = jest.fn(() => "never shown");
        expect(resolveEntityActionState({ disabledReason }, props)).toEqual({ enabled: true });
        expect(resolveEntityActionState({ isEnabled: () => true, disabledReason }, props)).toEqual({ enabled: true });
        expect(disabledReason).not.toHaveBeenCalled();
    });

    it("asks a disabled action why, with the props isEnabled was asked with", () => {
        const state = resolveEntityActionState({
            isEnabled: ({ entity }) => Boolean(entity?.values.shopify_id),
            disabledReason: ({ entity }) => `Customer ${entity?.id} has no Shopify account`
        }, props);
        expect(state).toEqual({ enabled: false, disabledReason: "Customer 7 has no Shopify account" });
    });

    it("is disabled without a reason when the action gives none", () => {
        expect(resolveEntityActionState({ isEnabled: () => false }, props)).toEqual({ enabled: false });
        expect(resolveEntityActionState({ isEnabled: () => false, disabledReason: () => "" }, props)).toEqual({ enabled: false });
    });
});
