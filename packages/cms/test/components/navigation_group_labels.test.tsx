/**
 * @jest-environment jsdom
 */
import React from "react";
import { describe, expect, it } from "@jest/globals";
import { render } from "@testing-library/react";
import { MemoryRouter } from "react-router";

import { RebaseI18nProvider } from "@rebasepro/app";
import { DrawerNavigationGroup } from "../../src/components/DrawerNavigationGroup";
import { NavigationGroup } from "../../src/components/HomePage/NavigationGroup";
import { NAVIGATION_DEFAULT_GROUP_NAME } from "../../src/hooks/navigation/utils";

/**
 * One group, one label — on the home page and in the drawer beside it.
 *
 * `NavigationGroup` translated only the default group (`t("views_group")`) and
 * rendered every other name raw, while `DrawerNavigationGroup` went through
 * `useNavigationGroupLabel`. On the same Spanish screen the home page read
 * `VISTAS / DATABASE / SETTINGS` and the drawer read
 * `VIEWS / BASE DE DATOS / SETTINGS`: three groups, six labels, two of them
 * wrong depending on where you looked.
 *
 * Rendered rather than asserted against the catalogue, because the defect was
 * in *which* lookup each component made, and both would pass a test that only
 * read `es.ts`.
 */

const GROUPS = [NAVIGATION_DEFAULT_GROUP_NAME, "Database", "Settings"];

function textOf(node: HTMLElement): string {
    return (node.textContent ?? "").trim();
}

function drawerLabel(group: string, locale: string): string {
    const { container, unmount } = render(
        <RebaseI18nProvider locale={locale}>
            <MemoryRouter>
                <DrawerNavigationGroup
                    group={group}
                    entries={[] as never}
                    collapsed={false}
                    onToggleCollapsed={() => undefined}
                    drawerOpen={true}
                />
            </MemoryRouter>
        </RebaseI18nProvider>
    );
    const label = textOf(container);
    unmount();
    return label;
}

function homeLabel(group: string, locale: string): string {
    const { container, unmount } = render(
        <RebaseI18nProvider locale={locale}>
            <NavigationGroup group={group === NAVIGATION_DEFAULT_GROUP_NAME ? undefined : group}/>
        </RebaseI18nProvider>
    );
    const label = textOf(container);
    unmount();
    return label;
}

describe("a navigation group has one label", () => {

    it.each(GROUPS)("agrees between the home page and the drawer for %s, in Español", (group) => {
        expect(homeLabel(group, "es")).toBe(drawerLabel(group, "es"));
    });

    it("translates all three, rather than leaving two in English", () => {
        const labels = GROUPS.map(group => homeLabel(group, "es"));

        expect(labels).toEqual(["Vistas", "Base de datos", "Ajustes"]);
    });

    it("renders a group the app declared itself exactly as written", () => {
        // No key exists for one of these and none should: the name is the
        // app's, and inventing a translation for it would be worse than
        // leaving it alone.
        expect(homeLabel("Marketing", "es")).toBe("Marketing");
        expect(drawerLabel("Marketing", "es")).toBe("Marketing");
    });
});
