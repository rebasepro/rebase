/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { compileTables } from "@rebasepro/common";
import { CollectionsProvider } from "@rebasepro/cms";
import { db, InRebase } from "./recipe_harness";
import { SITE_SETTINGS_ID, SiteSettingsPage, siteSettings, siteSettingsCms } from "../../recipes/site-settings";

/** What the server serves for the recipe's table, and the recipe's customization over it. */
const TABLES = compileTables([siteSettings]);

function Page() {
    return (
        <InRebase>
            <CollectionsProvider tables={TABLES} tableCustomizations={[siteSettingsCms]}><SiteSettingsPage/></CollectionsProvider>
        </InRebase>
    );
}

describe("recipe: site settings singleton", () => {
    it("is a table of its own, and kept out of the navigation", () => {
        expect(TABLES[0]).toMatchObject({ slug: "site_settings", primaryKey: ["id"], rls: { posture: "admin-only" } });
        expect(siteSettingsCms).toMatchObject({ table: "site_settings", hideFromNavigation: true });
    });

    beforeEach(() => {
        db.rows = {};
    });

    it("creates the settings record on first save, with nothing seeded", async () => {
        render(<Page/>);

        const name = await screen.findByDisplayValue("My site");
        await act(async () => {
            fireEvent.change(name, { target: { value: "Rebase" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /create/i }));

        await waitFor(() => expect(db.rows.site_settings).toEqual([
            expect.objectContaining({ id: SITE_SETTINGS_ID, siteName: "Rebase" })
        ]));
    });

    it("edits the same record on every visit", async () => {
        db.rows.site_settings = [{ id: SITE_SETTINGS_ID, siteName: "Rebase", tagline: "Postgres, with an admin" }];
        render(<Page/>);

        const tagline = await screen.findByDisplayValue("Postgres, with an admin");
        await act(async () => {
            fireEvent.change(tagline, { target: { value: "Your backend, customizable" } });
        });
        fireEvent.click(screen.getByRole("button", { name: /save/i }));

        await waitFor(() => expect(db.rows.site_settings).toEqual([
            expect.objectContaining({ id: SITE_SETTINGS_ID, tagline: "Your backend, customizable" })
        ]));
    });
});
