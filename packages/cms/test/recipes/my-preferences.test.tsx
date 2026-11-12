/**
 * @jest-environment jsdom
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { User } from "@rebasepro/types";
import { compileTables } from "@rebasepro/common";
import { CollectionsProvider } from "@rebasepro/cms";
import { db, InRebase, userWith } from "./recipe_harness";
import { MyPreferencesPage, userPreferences, userPreferencesCms } from "../../recipes/my-preferences";

/** What the server serves for the recipe's table, and the recipe's customization over it. */
const TABLES = compileTables([userPreferences]);

function Page({ user }: { user: User | null }) {
    return (
        <InRebase user={user}>
            <CollectionsProvider tables={TABLES} tableCustomizations={[userPreferencesCms]}><MyPreferencesPage/></CollectionsProvider>
        </InRebase>
    );
}

describe("recipe: per-user preferences", () => {
    it("locks each row to its user in the table's rls", () => {
        expect(TABLES[0].rls.rules).toEqual([{ operation: "all", ownerField: "id" }]);
    });

    beforeEach(() => {
        db.rows = {
            user_preferences: [{ id: "grace", theme: "dark", weeklyDigest: false }]
        };
    });

    it("creates the signed-in user's record under their uid", async () => {
        render(<Page user={userWith("ada")}/>);

        fireEvent.click(await screen.findByRole("button", { name: /create/i }));

        await waitFor(() => expect(db.rows.user_preferences).toContainEqual(
            expect.objectContaining({ id: "ada", theme: "system", weeklyDigest: true })
        ));
        // Somebody else's record is left alone.
        expect(db.rows.user_preferences).toContainEqual({ id: "grace", theme: "dark", weeklyDigest: false });
    });

    it("opens the record a user already has", async () => {
        render(<Page user={userWith("grace")}/>);
        expect(await screen.findByRole("button", { name: /save/i })).toBeTruthy();
        expect(screen.queryByRole("button", { name: /create/i })).toBeNull();
    });

    it("renders nothing for nobody signed in", () => {
        const { container } = render(<Page user={null}/>);
        expect(container.textContent).toBe("");
    });
});
