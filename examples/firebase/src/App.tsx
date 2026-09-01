import React, { useCallback, useMemo } from "react";

import "@fontsource-variable/inter";
import "@fontsource-variable/instrument-sans";
import "@fontsource/jetbrains-mono";

import { FirebaseAccessGate, FirebaseUserWrapper, RebaseFirebaseApp } from "@rebasepro/firebase";
import { demoCollection } from "./collections/demo";
import { productsCollection } from "./collections/products";
import { blogCollection } from "./collections/blog";
import { usersCollection } from "./collections/users";

export const firebaseConfig = {
    apiKey: "AIzaSyBzt-JvcXvpDrdNU7jYX3fC3v0EAHjTKEw",
    authDomain: "demo.firecms.co",
    databaseURL: "https://firecms-demo-27150.firebaseio.com",
    projectId: "firecms-demo-27150",
    storageBucket: "firecms-demo-27150.appspot.com",
    messagingSenderId: "837544933711",
    appId: "1:837544933711:web:75822ffc0840e3ae01ad3a",
    measurementId: "G-8HRE8MVXZJ"
};

function App() {

    // Use your own authentication logic here
    const myAccessGate: FirebaseAccessGate<FirebaseUserWrapper> = useCallback(async ({
                                                                                       user,
                                                                                       authController
                                                                                   }) => {

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

