import { Rebase, RebaseAuth, useRebaseAuthController } from "@rebasepro/app";
import { RebaseCMS, RebaseShell } from "@rebasepro/cms";
import { createRebaseClient } from "@rebasepro/client";
import { useFirestoreDataSource } from "@rebasepro/firebase";
import { ErrorBoundary } from "@rebasepro/ui";
import { firebaseApp } from "./firebase";
import { firestoreEvents } from "./cms/events";
import { ordersCms } from "./cms/orders";
// How the collection editor laid out the tables in development (labels, columns, views).
import uiConfig from "./cms/ui-config.json";

// One client for the page: the default data source, the Postgres tables the
// backend serves at /api/schema/tables.
const rebaseClient = createRebaseClient({
    baseUrl: import.meta.env.VITE_API_URL,
    auth: { authFlowMode: "cookie" }
});

export function App() {
    const authController = useRebaseAuthController({ client: rebaseClient });

    // The second data source: Firestore, straight from the browser. Its key
    // is what `dataSource: "firestore"` in cms/events.ts names.
    const firestoreSource = useFirestoreDataSource({ key: "firestore", firebaseApp, label: "Firestore" });

    return (
        <ErrorBoundary fullPage>
            <Rebase
                client={rebaseClient}
                dataSources={[firestoreSource]}
                authController={authController}
            >
                <RebaseAuth/>
                {/* Every Postgres table gets a view with no code; `ordersCms`
                    changes how one of them looks. `firestoreEvents` is mounted
                    beside them, in the same navigation and reference router. */}
                <RebaseCMS
                    tableCustomizations={[ordersCms]}
                    uiConfig={uiConfig}
                    externalCollections={[firestoreEvents]}
                />
                <RebaseShell title="Hybrid example"/>
            </Rebase>
        </ErrorBoundary>
    );
}
