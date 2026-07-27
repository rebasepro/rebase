import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import { App } from "./App";
import "./index.css";

window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    console.error("[Rebase] Unhandled promise rejection:", event.reason);
});

// Where this app is mounted, from the `path` declared in rebase.json.
//
// `rebase build` passes it to Vite as `base` (REBASE_APP_BASE), and Vite exposes
// it back as BASE_URL — so the assets, the router and the server all agree on
// one value without it being written down three times. At "/" this is "".
const basename = import.meta.env.BASE_URL.replace(/\/$/, "");

const router = createBrowserRouter([
    {
        path: "/*",
        element: <App/>
    }
], { basename });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
    <React.StrictMode>
        <RouterProvider router={router}/>
    </React.StrictMode>
);
