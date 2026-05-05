import React from "react";
import "@fontsource/jetbrains-mono";
import "typeface-rubik";

import { useRebaseAuthController, useBackendUserManagement, RebaseAuth } from "@rebasepro/auth";
import { Rebase } from "@rebasepro/core";
import { RebaseCMS, RebaseShell } from "@rebasepro/admin";
import { useDataEnhancementPlugin } from "@rebasepro/plugin-data-enhancement";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";
import { BlogEntryPreview } from "./BlogEntryPreview";

// Configuration from environment
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3001";
const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

export function App() {
    const rebaseClient = React.useMemo(() => createRebaseClient({
        baseUrl: API_URL
    }), []);

    const authController = useRebaseAuthController({
        client: rebaseClient,
        googleClientId: GOOGLE_CLIENT_ID
    });

    const userManagement = useBackendUserManagement({
        client: rebaseClient,
        currentUser: authController.user
    });

    const dataEnhancementPlugin = useDataEnhancementPlugin();

    const collectionEditor = React.useMemo(() => ({
        getAuthToken: authController.getAuthToken
    }), [authController.getAuthToken]);

    const plugins = React.useMemo(() => [dataEnhancementPlugin], [dataEnhancementPlugin]);

    const entityViews = React.useMemo(() => [
        {
            key: "blog_preview",
            name: "Preview",
            Builder: BlogEntryPreview,
            position: "start" as const
        }
    ], []);

    return (
        <Rebase
            client={rebaseClient}
            authController={authController}
            userManagement={userManagement}
            plugins={plugins}
        >
            <RebaseAuth/>
            <RebaseCMS
                collections={collections}
                collectionEditor={collectionEditor}
                entityViews={entityViews}
            />
            <RebaseStudio/>
            <RebaseShell title="Rebase"/>
        </Rebase>
    );
}
