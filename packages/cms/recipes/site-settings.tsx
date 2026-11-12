/**
 * Recipe: a singleton — one settings record, edited on a page of its own.
 *
 * A singleton is not a special kind of table. It is an ordinary table whose
 * admin page always opens the same row. `RecordForm` given an id edits that
 * record, and creates it under that id the first time, so there is nothing to
 * seed.
 *
 * To use it:
 *   1. Put `siteSettings` in `backend/schema/site_settings.ts` and export it
 *      from `backend/schema/index.ts` (it is a normal table: `rebase db push`
 *      creates it). In the backend, import `defineTable` and `col` from
 *      `@rebasepro/server/schema`.
 *   2. Put `siteSettingsCms` in `frontend/src/cms/site_settings.tsx` and add it
 *      to `<RebaseCMS tableCustomizations={[…]}>`.
 *   3. Add `siteSettingsView` to `<RebaseCMS views={[…]}>`.
 *
 * Reading the settings elsewhere is a normal read of row `"site"`:
 * `client.data.table("site_settings").findById("site")`.
 */
import React from "react";
import { col, defineTable } from "@rebasepro/types";
import type { AppView } from "@rebasepro/cms-types";
import { customizeTable, RecordForm } from "@rebasepro/cms";
import { Container, Typography } from "@rebasepro/ui";

/** The one row every visit to the page edits. */
export const SITE_SETTINGS_ID = "site";

/** The table — backend/schema/site_settings.ts. Admins read and write it. */
export const siteSettings = defineTable("site_settings", {
    columns: {
        id: col.text().primaryKey(),
        siteName: col.text().notNull(),
        tagline: col.text(),
        maintenanceMode: col.boolean(),
        supportEmail: col.text().validate({ email: true })
    },
    rls: "admin-only"
});

/** How the admin shows it — frontend/src/cms/site_settings.tsx. */
export const siteSettingsCms = customizeTable<typeof siteSettings>("site_settings", {
    name: "Site settings",
    singularName: "Site settings",
    icon: "Settings",
    // The page below is the way in; a list of one row is not.
    hideFromNavigation: true,
    hideIdFromForm: true
});

export function SiteSettingsPage() {
    return (
        <Container maxWidth={"3xl"} className={"py-8"}>
            <Typography variant={"h4"} gutterBottom>Site settings</Typography>
            <RecordForm
                collection={"site_settings"}
                id={SITE_SETTINGS_ID}
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
