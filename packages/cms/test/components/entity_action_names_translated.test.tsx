/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { EntityAction } from "@rebasepro/cms-types";

/**
 * The built-in record actions are named in the admin's language.
 *
 * "Edit", "Copy", "Delete", "Remove" and "Reset Password" were English
 * literals on the actions themselves, rendered as `action.name` beside a row
 * menu otherwise in Italian. They carry a `nameKey` now; an action of the
 * project's own, without one, still shows its `name` as written. The row's
 * icon-only controls are named in the same language.
 */

jest.mock("../../src/hooks/useAdminContext", () => {
    const context = { sidePanelController: {} };
    return { useAdminContext: () => context };
});

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useSlot: () => [],
        getIcon: () => null,
        getEntityFromCache: () => undefined,
        getLocalChangesBackup: () => false
    };
    return new Proxy({}, {
        get: (_t, key: string | symbol) =>
            (typeof key === "string" && key in overrides)
                ? overrides[key]
                : (jest.requireActual("@rebasepro/app") as Record<string | symbol, unknown>)[key]
    });
});

import { RebaseI18nProvider } from "@rebasepro/app";
import { CollectionRowActions } from "../../src/components/CollectionTableBinding/CollectionRowActions";
import { copyEntityAction, editEntityAction } from "../../src/components/common/default_entity_actions";
import { mergeEntityActions } from "../../src/util/entity_actions";

beforeAll(() => {
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

const post: Entity<Record<string, unknown>> = { id: "7", path: "posts", values: {} };

const publish: EntityAction = { key: "publish", name: "Publish", collapsed: true, onClick: () => undefined };

function renderRow(actions: EntityAction[]) {
    return render(
        <RebaseI18nProvider locale="it">
            <CollectionRowActions
                entity={post}
                path="posts"
                width={140}
                size="m"
                actions={actions}
                openEntityMode="side_panel"/>
        </RebaseI18nProvider>
    );
}

describe("entity action names, in Italian", () => {
    it("names the built-in Edit button in Italian, and a custom action as written", async () => {
        renderRow([editEntityAction, { ...copyEntityAction, collapsed: true }, publish]);

        expect(await screen.findByRole("button", { name: "Modifica" })).toBeTruthy();
        expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();

        const trigger = screen.getAllByRole("button").find(b => b.hasAttribute("aria-haspopup"))!;
        fireEvent.keyDown(trigger, { key: "Enter" });
        const items = screen.getAllByRole("menuitem").map(item => item.textContent);
        expect(items).toContain("Copia");
        expect(items).toContain("Publish");
    });

    it("names the row's menu button and its selection checkbox", async () => {
        render(
            <RebaseI18nProvider locale="it">
                <CollectionRowActions
                    entity={post}
                    path="posts"
                    width={140}
                    size="m"
                    actions={[publish]}
                    selectionEnabled
                    isSelected={false}
                    openEntityMode="side_panel"/>
            </RebaseI18nProvider>
        );
        expect(await screen.findByRole("button", { name: "Altre azioni" })).toBeTruthy();
        expect(screen.getByRole("checkbox", { name: "Seleziona 7" })).toBeTruthy();
    });

    it("an override that renames a built-in shows its own name", async () => {
        const [renamed] = mergeEntityActions([editEntityAction], [{ ...editEntityAction, nameKey: undefined, name: "Open" }]);
        const [plain] = mergeEntityActions([editEntityAction], [{ key: "edit", name: "Open", onClick: () => undefined }]);
        expect(renamed.nameKey).toBeUndefined();
        expect(plain.nameKey).toBeUndefined();

        renderRow([plain]);
        expect(await screen.findByRole("button", { name: "Open" })).toBeTruthy();
    });
});
