/**
 * Recipe: per-user settings — each signed-in user edits their own record.
 *
 * The same shape as the site-settings singleton, keyed by the user instead of
 * a constant: the record's id is the user's uid. The first visit creates it.
 *
 * The table's `rls` is the real lock: an owner rule on `id` makes a user's row
 * readable and writable by that user alone, in Postgres, so the page is a
 * convenience, not the only lock.
 *
 * To use it: put `userPreferences` in `backend/schema/user_preferences.ts`
 * (importing `defineTable` and `col` from `@rebasepro/server/schema`) and
 * export it from `backend/schema/index.ts`; put `userPreferencesCms` in
 * `frontend/src/cms/` and add it to `<RebaseCMS tableCustomizations={[…]}>`;
 * add `myPreferencesView` to `<RebaseCMS views={[…]}>`.
 */
import React from "react";
import { col, defineTable } from "@rebasepro/types";
import type { AppView } from "@rebasepro/cms-types";
import { useAuthController } from "@rebasepro/app";
import { customizeTable, RecordForm } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

/** The table — backend/schema/user_preferences.ts. A row is its user's alone. */
export const userPreferences = defineTable("user_preferences", {
    columns: {
        id: col.text().primaryKey(),
        theme: col.enum(["system", "light", "dark"]),
        weeklyDigest: col.boolean()
    },
    rls: [{ operation: "all", ownerField: "id" }]
});

/** How the admin shows it — frontend/src/cms/user_preferences.tsx. */
export const userPreferencesCms = customizeTable<typeof userPreferences>("user_preferences", {
    name: "User preferences",
    singularName: "Preferences",
    icon: "UserCog",
    hideFromNavigation: true,
    hideIdFromForm: true,
    fields: {
        id: { name: "User" },
        theme: {
            enumLabels: {
                system: { label: "System" },
                light: { label: "Light" },
                dark: { label: "Dark" }
            }
        },
        weeklyDigest: { name: "Weekly digest email" }
    }
});

export function MyPreferencesPage() {
    const { user } = useAuthController();
    if (!user) return null;
    return (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>My preferences</Typography>
            <RecordForm
                // A new user is a new record: remount rather than carry one
                // user's form state into another's.
                key={user.uid}
                collection={"user_preferences"}
                id={user.uid}
                defaultValues={{ theme: "system", weeklyDigest: true }}/>
        </Container>
    );
}

export const myPreferencesView: AppView = {
    slug: "me/preferences",
    name: "My preferences",
    icon: "UserCog",
    view: <MyPreferencesPage/>
};
