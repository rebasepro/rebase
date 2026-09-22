/**
 * @jest-environment jsdom
 */
import React from "react";
import { beforeAll, beforeEach, describe, expect, it, jest } from "@jest/globals";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Entity } from "@rebasepro/types";
import type { EntityAction, EntityActionClickProps } from "@rebasepro/cms-types";

/**
 * An entity action's `isEnabled` holds on a collection's rows, not only in the
 * record.
 *
 * The record form's action bar asked `isEnabled` and disabled the action; the
 * table row's buttons and its overflow menu did not ask at all. A "Publish"
 * action declared `isEnabled: e => status === "draft"` was greyed out on a
 * published record and clickable on the same record's row.
 */

jest.mock("../../src/hooks/useAdminContext", () => {
    const context = { sidePanelController: {} };
    return { useAdminContext: () => context };
});

jest.mock("@rebasepro/app", () => {
    const overrides: Record<string, unknown> = {
        useTranslation: () => ({ t: (key: string) => key }),
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

import { CollectionRowActions } from "../../src/components/CollectionTableBinding/CollectionRowActions";

beforeAll(() => {
    // Radix menus need pointer capture and scrollIntoView; jsdom has neither.
    Object.assign(Element.prototype, {
        hasPointerCapture: () => false,
        setPointerCapture: () => undefined,
        releasePointerCapture: () => undefined,
        scrollIntoView: () => undefined
    });
});

type Post = { status: string };

const published: Entity<Post> = { id: "7", path: "posts", values: { status: "published" } };

const publishClicked = jest.fn();
const isEnabled = jest.fn((props: EntityActionClickProps<Record<string, unknown>>) => props.entity?.values.status === "draft");

function publishAction(collapsed: boolean): EntityAction {
    return {
        key: "publish",
        name: "Publish",
        collapsed,
        onClick: () => publishClicked(),
        isEnabled
    };
}

function renderRow(action: EntityAction) {
    return render(
        <CollectionRowActions
            entity={published}
            path="posts"
            width={140}
            size="m"
            actions={[action]}
            openEntityMode="side_panel"/>
    );
}

describe("CollectionRowActions — isEnabled", () => {

    beforeEach(() => {
        publishClicked.mockReset();
        isEnabled.mockClear();
    });

    it("disables an inline action the row's record does not allow", () => {
        renderRow(publishAction(false));

        expect(isEnabled).toHaveBeenCalled();
        expect(isEnabled.mock.calls[0][0].entity).toBe(published);
        const button = screen.getAllByRole<HTMLButtonElement>("button").find(b => !b.hasAttribute("aria-haspopup"))!;
        expect(button.disabled).toBe(true);
        fireEvent.click(button);
        expect(publishClicked).not.toHaveBeenCalled();
    });

    it("disables a menu action the row's record does not allow", () => {
        renderRow(publishAction(true));

        const trigger = screen.getByRole("button");
        // jsdom has no PointerEvent, so the menu is opened from the keyboard.
        fireEvent.keyDown(trigger, { key: "Enter" });
        const item = screen.getByText("Publish");
        fireEvent.click(item);
        expect(publishClicked).not.toHaveBeenCalled();
    });
});
