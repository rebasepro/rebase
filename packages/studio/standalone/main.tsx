import React from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter } from "react-router";
import { RouterProvider } from "react-router/dom";
import "./index.css";
import { StandalonePanel } from "./StandalonePanel";

// The panel a project with no code is served at `/_studio`: its content and
// its Studio. See StandalonePanel.
const router = createBrowserRouter([{ path: "/*", element: <StandalonePanel/> }], { basename: "/_studio" });

const rootEl = document.getElementById("root");
if (rootEl) {
    createRoot(rootEl).render(
        <React.StrictMode>
            <RouterProvider router={router}/>
        </React.StrictMode>
    );
}
