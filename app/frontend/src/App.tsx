import React from "react";
import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";
import type { AnalyticsEvent } from "@rebasepro/cms-types";

// Global gtag function injected by the GA4 script in index.html
declare function gtag(...args: unknown[]): void;

import { useRebaseAuthController } from "@rebasepro/app";
import { Rebase, RebaseAuth } from "@rebasepro/app";
import { UIReferenceView } from "@rebasepro/app/debug";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import type { RebasePlugin } from "@rebasepro/cms-types";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-ai";
import { useAppInsightsPlugin } from "./useAppInsightsPlugin";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";
import { BlogEntryPreview } from "./BlogEntryPreview";
import { ProductGalleryView } from "./ProductGalleryView";
import { DemoLoginView } from "./DemoLoginView";

// Configuration from environment
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL,
        // Local-first: reads populate an IndexedDB row database and fall back
        // to it when the network is gone, and writes made offline apply
        // immediately and replay when it returns.
        offline: true
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

    // Custom collection view modes, referenced by key from a collection's
    // `admin.customViews`. Products names "gallery".
    const collectionViews = React.useMemo(() => [
        {
            key: "gallery",
            name: "Gallery",
            icon: "Image",
            Builder: ProductGalleryView
        }
    ], []);

    const customViews = React.useMemo(() => [
        {
            slug: "debug/ui",
            name: "UI Reference / Debug",
            icon: "Plus",
            // Reachable at /debug/ui, but kept off the home page and the drawer:
            // this is the design reference, not something a demo visitor wants
            // sitting between the collections.
            hideFromNavigation: true,
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
                collectionViews={collectionViews}
                views={customViews}
            />
            <RebaseStudio/>
            <RebaseShell title="Rebase"/>
        </Rebase>
    );
}
