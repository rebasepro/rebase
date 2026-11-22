import React from "react";
import { BookOpenIcon, Button, Card, iconSize, TableIcon, Typography } from "@rebasepro/ui";
import { useTranslation } from "@rebasepro/app";

/** The docs page that explains `defineTable`. */
export const DEFINE_TABLES_DOCS_URL = "https://rebase.pro/docs/schema";

const EXAMPLE_TABLE = `// backend/schema/notes.ts
import { defineTable, col } from "@rebasepro/server/schema";

export const notes = defineTable("notes", {
    columns: {
        id: col.uuid().primaryKey().defaultRandom(),
        body: col.text().notNull()
    },
    rls: "admin-only"
});`;

const EXAMPLE_EXPORT = `// backend/schema/index.ts
export { notes } from "./notes";`;

/**
 * What the CMS home shows while the project declares no table of its own —
 * only the built-in users table. A freshly scaffolded blank project lands
 * here after sign-up, and without this the page is a lone users card with
 * nothing saying where content comes from.
 */
export function NoTablesEmptyState() {
    const { t } = useTranslation();
    return (
        <Card className="p-6 mb-8 flex flex-col gap-4" data-testid="home-no-tables">
            <div className="flex items-center gap-3">
                <TableIcon size={iconSize.small} className="text-text-secondary dark:text-text-secondary-dark"/>
                <Typography variant="subtitle1" component="h2">
                    {t("home_no_tables_title")}
                </Typography>
            </div>
            <Typography variant="body2" color="secondary">
                {t("home_no_tables_body")}
            </Typography>
            <pre className="bg-surface-field rounded-md p-3 font-mono text-xs overflow-x-auto">
                {EXAMPLE_TABLE}
            </pre>
            <pre className="bg-surface-field rounded-md p-3 font-mono text-xs overflow-x-auto">
                {EXAMPLE_EXPORT}
            </pre>
            <Typography variant="body2" color="secondary">
                {t("home_no_tables_dev")}
            </Typography>
            <div>
                <Button
                    component="a"
                    href={DEFINE_TABLES_DOCS_URL}
                    target="_blank"
                    rel="noreferrer"
                    variant="outlined"
                >
                    <BookOpenIcon size={iconSize.smallest}/>
                    {t("home_no_tables_docs")}
                </Button>
            </div>
        </Card>
    );
}
