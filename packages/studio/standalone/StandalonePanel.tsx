import React from "react";
import { createRebaseClient } from "@rebasepro/client";
import { Rebase, RebaseAuth, useRebaseAuthController, useTranslation } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { Alert, ErrorBoundary, Typography } from "@rebasepro/ui";
import { ContentHomePage } from "../../cms/src/components/HomePage/ContentHomePage";
import { RebaseStudio } from "../src/components/RebaseStudio";

/**
 * The admin panel a project with no code is served at `/_studio`: the same
 * composition a scaffolded project's frontend has — the content (every table
 * the backend serves, users and their roles among them, as collections) and
 * the Studio — with nothing customised, because there is no code to
 * customise it with. Its home says so, and how to move to code.
 */

const client = createRebaseClient({ baseUrl: window.location.origin });

/** The command that writes the project out as code, from the database it runs on. */
const INIT_COMMAND = "pnpm dlx @rebasepro/cli init my-app --database-url \"<your database URL>\" --introspect --install";

function CodeNotice() {
    const { t } = useTranslation();
    return (
        <Alert color="info" outerClassName="mb-6">
            <div className="flex flex-col gap-2">
                <Typography variant="subtitle2">{t("zero_code_panel_title")}</Typography>
                <Typography variant="body2">{t("zero_code_panel_body")}</Typography>
                <code className="block font-mono text-xs px-3 py-2 rounded bg-surface-card overflow-x-auto whitespace-pre">{INIT_COMMAND}</code>
                <a className="text-sm underline" href="https://rebase.pro/docs/deployment/existing-database/" target="_blank" rel="noreferrer">
                    {t("zero_code_panel_link")}
                </a>
            </div>
        </Alert>
    );
}

export function StandalonePanel() {
    const authController = useRebaseAuthController({ client });
    return (
        <ErrorBoundary fullPage>
            <Rebase client={client} authController={authController}>
                <RebaseAuth/>
                <RebaseCMS homePage={<ContentHomePage additionalChildrenStart={<CodeNotice/>}/>}/>
                <RebaseStudio/>
                <RebaseShell title="Rebase"/>
            </Rebase>
        </ErrorBoundary>
    );
}
