/**
 * Recipe: per-user settings — each signed-in user edits their own record.
 *
 * The same shape as the site-settings singleton, keyed by the user instead of
 * a constant: the record's id is the user's uid. The first visit creates it.
 *
 * Protect it on the server too: a `securityRules` owner rule (`ownerField:
 * "id"`) makes a user's row readable and writable by that user alone, so the
 * page is a convenience, not the only lock.
 *
 * To use it: put `userPreferencesCollection` in `config/collections`, and add
 * `myPreferencesView` to `<RebaseCMS views={[…]}>`.
 */
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { useAuthController } from "@rebasepro/app";
import { EntityFormPanel } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

export const userPreferencesCollection = defineCollection({
    name: "User preferences",
    singularName: "Preferences",
    slug: "user_preferences",
    table: "user_preferences",
    properties: {
        id: { name: "User", type: "string", isId: true },
        theme: {
            name: "Theme",
            type: "string",
            enum: [
                { id: "system", label: "System" },
                { id: "light", label: "Light" },
                { id: "dark", label: "Dark" }
            ]
        },
        weeklyDigest: { name: "Weekly digest email", type: "boolean" }
    },
    admin: {
        icon: "UserCog",
        hideFromNavigation: true,
        hideIdFromForm: true
    }
});

export function MyPreferencesPage() {
    const { user } = useAuthController();
    if (!user) return null;
    return (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>My preferences</Typography>
            <EntityFormPanel
                // A new user is a new record: remount rather than carry one
                // user's form state into another's.
                key={user.uid}
                collection={userPreferencesCollection}
                entityId={user.uid}
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
