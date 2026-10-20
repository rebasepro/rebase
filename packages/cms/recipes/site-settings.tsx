/**
 * Recipe: a singleton — one settings record, edited on a page of its own.
 *
 * A singleton is not a special kind of collection. It is an ordinary table
 * whose admin page always opens the same row. `EntityFormPanel` given an id
 * edits that record, and creates it under that id the first time, so there is
 * nothing to seed.
 *
 * To use it:
 *   1. Put `siteSettingsCollection` in `config/collections/site_settings.ts`
 *      (it is a normal collection: `rebase db push` creates its table).
 *   2. Add `siteSettingsView` to `<RebaseCMS views={[…]}>`.
 *
 * Reading the settings elsewhere is a normal read of row `"site"`.
 */
import React from "react";
import { defineCollection } from "@rebasepro/cms-types";
import type { AppView } from "@rebasepro/cms-types";
import { EntityFormPanel } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

/** The one row every visit to the page edits. */
export const SITE_SETTINGS_ID = "site";

export const siteSettingsCollection = defineCollection({
    name: "Site settings",
    singularName: "Site settings",
    slug: "site_settings",
    table: "site_settings",
    properties: {
        id: { name: "ID", type: "string", isId: true },
        siteName: { name: "Site name", type: "string", validation: { required: true } },
        tagline: { name: "Tagline", type: "string" },
        maintenanceMode: { name: "Maintenance mode", type: "boolean" },
        supportEmail: { name: "Support email", type: "string", email: true }
    },
    admin: {
        icon: "Settings",
        // The page below is the way in; a list of one row is not.
        hideFromNavigation: true,
        hideIdFromForm: true
    }
});

export function SiteSettingsPage() {
    return (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <EntityFormPanel
                collection={siteSettingsCollection}
                entityId={SITE_SETTINGS_ID}
                defaultValues={{ siteName: "My site", maintenanceMode: false }}/>
        </Container>
    );
}

export const siteSettingsView: AppView = {
    slug: "settings/site",
    name: "Site settings",
    icon: "Settings",
    group: "Settings",
    view: <SiteSettingsPage/>
};
