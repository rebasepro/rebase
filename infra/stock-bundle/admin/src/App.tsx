import "@fontsource/jetbrains-mono";
import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";

import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { ErrorBoundary } from "@rebasepro/ui";
import { RebaseStudio } from "@rebasepro/studio";
import { createRebaseClient } from "@rebasepro/client";

// The stock admin panel: what a Rebase Cloud project serves before anyone has
// deployed code to it. It knows nothing about the project. Every table comes
// from the backend (`GET /api/schema/tables`, which an introspected backend
// answers with every table that has row-level security on), so a table created
// in the console's SQL editor shows up here once it has RLS — no file to edit,
// nothing to redeploy.
//
// Served from the same origin as the API, so the client needs no base URL. The
// console signs the project's owner in by handing a one-time token in the URL
// fragment, which `useRebaseAuthController` spends.
const rebaseClient = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({ client: rebaseClient });

    return (
        <ErrorBoundary fullPage>
            <Rebase client={rebaseClient} authController={authController}>
                <RebaseAuth />
                <RebaseCMS />
                <RebaseStudio />
                <RebaseShell title="Rebase" />
            </Rebase>
        </ErrorBoundary>
    );
}
