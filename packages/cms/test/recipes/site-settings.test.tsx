/**
 * @jest-environment jsdom
 */
import React from "react";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { db, InRebase } from "./recipe_harness";
import { SITE_SETTINGS_ID, SiteSettingsPage } from "../../recipes/site-settings";

describe("recipe: site settings singleton", () => {
    beforeEach(() => {
        db.rows = {};
    });

    it("creates the settings record on first save, with nothing seeded", async () => {
        render(<InRebase><SiteSettingsPage/></InRebase>);

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
        render(<InRebase><SiteSettingsPage/></InRebase>);

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
