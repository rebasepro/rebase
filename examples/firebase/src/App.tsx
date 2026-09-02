import React, { useCallback, useMemo } from "react";

import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";
import "@fontsource/jetbrains-mono";

import { FirebaseAccessGate, FirebaseUserWrapper, RebaseFirebaseApp } from "@rebasepro/firebase";
import { demoCollection } from "./collections/demo";
import { productsCollection } from "./collections/products";
import { blogCollection } from "./collections/blog";
import { usersCollection } from "./collections/users";
import { firebaseConfig } from "./firebase_config";

// From the environment, not from this file. See ./firebase_config for why a
// live project's configuration does not belong in a public example.
export { firebaseConfig } from "./firebase_config";

function App() {

    // Use your own authentication logic here
    const myAccessGate: FirebaseAccessGate<FirebaseUserWrapper> = useCallback(async ({
                                                                                       user,
                                                                                       authController
                                                                                   }) => {

        if (user?.email?.includes("flanders")) {
            // You can throw an error to prevent access
            throw Error("Stupid Flanders!");
        }

        const idTokenResult = await user?.firebaseUser?.getIdTokenResult();
        const userIsAdmin = idTokenResult?.claims.admin || user?.email?.endsWith("@rebase.pro");

        console.log("Allowing access to", user);

        // we allow access to every user in this case
        return true;
    }, []);

    const collections = useMemo(() => [
        productsCollection,
        blogCollection,
        usersCollection,
        demoCollection
    ], []);

    return <RebaseFirebaseApp
        name={"My demo app"}
        collections={collections}
        firebaseConfig={firebaseConfig}
        accessGate={myAccessGate}
        signInOptions={["google.com", "password"]}
    />;
}

export default App;

