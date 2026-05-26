import React from "react";

import "@fontsource/jetbrains-mono";
import "@fontsource/rubik";

import { useRebaseAuthController, useBackendUserManagement } from "@rebasepro/auth";
import { Rebase, RebaseAuth } from "@rebasepro/core";
import { RebaseCMS, RebaseShell } from "@rebasepro/admin";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";
import { collections } from "virtual:rebase-collections";

// Configuration from environment
const API_URL = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? "http://localhost:3001" : undefined);
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

    return (
        <Rebase
            client={rebaseClient}
            authController={authController}
            userManagement={userManagement}
        >
            <RebaseAuth />
            <RebaseCMS
                collections={collections}
            />
            <RebaseStudio/>
            <RebaseShell title="Rebase"/>
        </Rebase>
    );
}
