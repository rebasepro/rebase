/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { db, InRebase, userWith } from "./recipe_harness";
import { MyPreferencesPage } from "../../recipes/my-preferences";

describe("recipe: per-user preferences", () => {
    beforeEach(() => {
        db.rows = {
            user_preferences: [{ id: "grace", theme: "dark", weeklyDigest: false }]
        };
    });

    it("creates the signed-in user's record under their uid", async () => {
        render(<InRebase user={userWith("ada")}><MyPreferencesPage/></InRebase>);

        fireEvent.click(await screen.findByRole("button", { name: /create/i }));

        await waitFor(() => expect(db.rows.user_preferences).toContainEqual(
            expect.objectContaining({ id: "ada", theme: "system", weeklyDigest: true })
        ));
        // Somebody else's record is left alone.
        expect(db.rows.user_preferences).toContainEqual({ id: "grace", theme: "dark", weeklyDigest: false });
    });

    it("opens the record a user already has", async () => {
        render(<InRebase user={userWith("grace")}><MyPreferencesPage/></InRebase>);
        expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    });

    it("renders nothing for nobody signed in", () => {
        const { container } = render(<InRebase user={null}><MyPreferencesPage/></InRebase>);
        expect(container.textContent).toBe("");
    });
});
