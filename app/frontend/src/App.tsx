import React from "react";
import "@fontsource/jetbrains-mono";
import "@fontsource/rubik";
import type { AnalyticsEvent } from "@rebasepro/types";

// Global gtag function injected by the GA4 script in index.html
declare function gtag(...args: unknown[]): void;

import { useRebaseAuthController } from "@rebasepro/auth";
import { Rebase, RebaseAuth, UIReferenceView } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/admin";
import type { RebasePlugin } from "@rebasepro/types";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-data-enhancement";
import { useAppInsightsPlugin } from "./useAppInsightsPlugin";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";
import { BlogEntryPreview } from "./BlogEntryPreview";
import { DemoLoginView } from "./DemoLoginView";

// Configuration from environment
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL
    }), []);

    // Forward all Rebase analytics events to GA4
    const onAnalyticsEvent = React.useCallback((event: AnalyticsEvent, data?: object) => {
        if (typeof gtag === "function") {
            gtag("event", event, data);
        }
    }, []);

    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });


    const dataEnhancementPlugin = useDataEnhancementPlugin();

    // ── Insights Plugin ──────────────────────────────────────────────
    const insightsPlugin = useAppInsightsPlugin(rebaseClient);

    const collectionEditor = React.useMemo(() => ({
        getAuthToken: authController.getAuthToken
    }), [authController.getAuthToken]);

    const plugins: RebasePlugin[] = React.useMemo(
        () => [dataEnhancementPlugin, insightsPlugin],
        [dataEnhancementPlugin, insightsPlugin]
    );

    const entityViews = React.useMemo(() => [
        {
            key: "blog_preview",
            name: "Preview",
            Builder: BlogEntryPreview,
            position: "start" as const
        }
    ], []);

    const customViews = React.useMemo(() => [
        {
            slug: "debug/ui",
            name: "UI Reference / Debug",
            icon: "Plus",
            view: <UIReferenceView />
        }
    ], []);

    return (
        <Rebase
            client={rebaseClient}
            authController={authController}
            plugins={plugins}
            onAnalyticsEvent={onAnalyticsEvent}
        >
            <RebaseAuth loginView={<DemoLoginView authController={authController} googleClientId={GOOGLE_CLIENT_ID}/>}/>
            <RebaseCMS
                collections={collections}
                collectionEditor={collectionEditor}
                entityViews={entityViews}
                views={customViews}
            />
            <RebaseStudio/>
            <RebaseShell title="Rebase"/>
        </Rebase>
    );
}
